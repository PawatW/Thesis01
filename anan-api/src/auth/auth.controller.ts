import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AppError } from '../common/errors/app-exception';
import { AllowedOriginGuard } from '../common/guards/allowed-origin.guard';
import {
  isBrowserRequest,
  readRefreshCookie,
  RefreshCookieService,
} from '../common/http/refresh-cookie';
import { AuthService, type AuthResult } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';

/**
 * endpoint ที่เดารหัสผ่านได้ต้องคุมอัตราการเรียกให้แน่นกว่าค่ากลางของระบบ
 * 10 ครั้ง/นาที/IP — พอสำหรับคนพิมพ์ผิด แต่ไม่พอสำหรับการไล่เดา
 */
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * "ลืมรหัสผ่าน" แน่นกว่าที่อื่นอีกชั้น เพราะมันไม่ได้แค่เดารหัส — มันสั่งให้ระบบ
 * **ส่งอีเมลออกไปหาคนอื่น** ปล่อยไว้คือเครื่องยิงเมลกวนฟรีที่ผูกกับโดเมนของเรา
 * (และเป็นทางที่ทำให้ IP ของ SMTP โดนขึ้นบัญชีดำเร็วที่สุด) · 3 ครั้ง/5 นาที/IP
 */
const FORGOT_THROTTLE = { default: { limit: 3, ttl: 300_000 } };

/**
 * สิ่งที่ client ได้รับจริง
 *
 * `refreshToken` เป็น optional **โดยตั้งใจ** — เบราว์เซอร์จะไม่ได้รับฟิลด์นี้เลย
 * เพราะ token เดินทางกลับไปทาง httpOnly cookie แทน (ดู `deliver()` ข้างล่าง)
 */
export type AuthResponse = Omit<AuthResult, 'refreshToken'> & {
  refreshToken?: string;
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: RefreshCookieService,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.deliver(await this.auth.register(dto), req, res);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.deliver(await this.auth.login(dto), req, res);
  }

  /**
   * ต่ออายุ session — รับ token จาก cookie (เว็บ) หรือ body (native)
   *
   * `AllowedOriginGuard` จำเป็นเฉพาะที่นี่: ในโหมด cookie request นี้ไม่มีทั้ง
   * body และ header พิเศษ จึงเป็น "simple request" ที่ยิงข้ามเว็บได้โดยไม่มี
   * preflight มาช่วยกรอง (ดูเหตุผลเต็มใน guard)
   */
  @Public()
  @UseGuards(AllowedOriginGuard)
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    // cookie มาก่อน body: เบราว์เซอร์มีทางเดียวคือ cookie ส่วน native ไม่มี cookie
    // การอ่านจาก body ไม่ใช่ช่องโหว่ — ด่านที่กัน XSS อยู่ที่ "ไม่ส่ง token กลับ"
    // ให้เบราว์เซอร์ต่างหาก ไม่ใช่ที่การรับเข้า
    const token = readRefreshCookie(req) ?? dto.refreshToken;

    if (token == null || token === '') {
      throw AppError.unauthorized(
        'INVALID_REFRESH_TOKEN',
        'กรุณาเข้าสู่ระบบใหม่',
      );
    }

    try {
      return this.deliver(await this.auth.refresh(token), req, res);
    } catch (e) {
      // ★ ต้องลบ cookie ที่ใช้ไม่ได้แล้วทิ้งตรงนี้ ★
      // ไม่ว่าจะเพราะหมดอายุ ถูกหมุนไปแล้ว หรือถูกเพิกถอนตอนรีเซ็ตรหัสผ่าน
      // ถ้าปล่อยไว้ เบราว์เซอร์จะส่งใบที่ตายแล้วกลับมาทุกครั้งที่เปิดแอป
      // แล้วผู้ใช้จะติดอยู่ในวง 401 โดยไม่มีทางออกด้วยตัวเอง (ล้าง cookie เองไม่ได้
      // เพราะมันเป็น httpOnly)
      this.cookies.clear(res);
      throw e;
    }
  }

  /**
   * ขอลิงก์ตั้งรหัสผ่านใหม่ — **204 เสมอ** ไม่ว่าอีเมลจะมีในระบบหรือไม่
   * (ถ้าตอบต่างกันเมื่อไหร่ endpoint นี้กลายเป็นเครื่องคัดรายชื่อสมาชิกทันที)
   */
  @Public()
  @Throttle(FORGOT_THROTTLE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.auth.forgotPassword(dto.email);
  }

  /** ตั้งรหัสผ่านใหม่ด้วย token จากอีเมล — สำเร็จแล้วต้องล็อกอินใหม่ทุกเครื่อง */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('reset-password')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.password);
    // การรีเซ็ตเพิกถอน refresh token ทุกใบของบัญชีนี้ (revokedReason 'password_reset')
    // เบราว์เซอร์ที่กดรีเซ็ตจึงถือ cookie ที่ตายแล้วอยู่ — ล้างทิ้งพร้อมกันเลย
    this.cookies.clear(res);
  }

  /** ต้องล็อกอินอยู่ — กันคนอื่นยิง token ที่เก็บมาได้เพื่อไล่คนออกจากระบบ */
  @UseGuards(AllowedOriginGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(
    @CurrentUser() user: AuthUser,
    @Body() dto: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = readRefreshCookie(req) ?? dto.refreshToken;

    // ล้าง cookie ก่อนเสมอ ไม่ต้องรอผลจาก DB — ผู้ใช้กด "ออกจากระบบ" แล้วต้อง
    // ออกจริงบนเครื่องนี้ทุกกรณี แม้ token ที่ส่งมาจะใช้ไม่ได้แล้วก็ตาม
    this.cookies.clear(res);

    if (token != null && token !== '') {
      await this.auth.logout(user.id, token);
    }
  }

  /**
   * ★ จุดเดียวที่ตัดสินว่า refresh token จะเดินทางกลับไปทางไหน ★
   *
   * เบราว์เซอร์ → httpOnly cookie เท่านั้น และ **ไม่มี** `refreshToken` ใน body
   * เพราะถ้าส่งลง body ด้วย โค้ด XSS ก็อ่านจาก response ตรงนั้นได้เลย
   * แล้ว httpOnly ทั้งหมดที่ทำมาก็ไม่เหลือความหมาย
   *
   * ไม่ใช่เบราว์เซอร์ (Expo native) → ลง body เหมือนเดิม แล้วแอปเก็บลง
   * `expo-secure-store` ซึ่งเป็น keychain/keystore ของ OS ไม่ใช่ไฟล์ธรรมดา
   * — สองฝั่งไม่มีการเก็บ token ไว้ในที่ที่ JavaScript อ่านได้อีกต่อไป
   */
  private deliver(
    result: AuthResult,
    req: Request,
    res: Response,
  ): AuthResponse {
    if (!isBrowserRequest(req)) return result;

    this.cookies.issue(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }
}
