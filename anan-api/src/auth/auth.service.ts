import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AppError, AppException } from '../common/errors/app-exception';
import type { Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  toUserResponse,
  type UserResponse,
} from '../users/dto/user-response.dto';
import type { LoginDto, RegisterDto } from './dto/auth.dto';

const BCRYPT_COST = 12;

/**
 * อายุของลิงก์รีเซ็ต — สั้นพอที่ลิงก์ในกล่องเมลเก่าจะไร้ค่า แต่ยาวพอให้คนที่
 * เปิดเมลบนมืออีกเครื่องทำทัน · ใบเก่าตายทันทีที่ขอใบใหม่อยู่แล้ว
 */
const RESET_TOKEN_TTL_MINUTES = 30;

/**
 * เวลาตอบกลับ**ขั้นต่ำ**ของ `POST /auth/forgot-password`
 *
 * เส้นทาง "มีอีเมลนี้" ต้องเขียน DB 2 แถวในทรานแซกชัน ส่วนเส้นทาง "ไม่มี" จบที่
 * SELECT ครั้งเดียว — ต่างกันไม่กี่มิลลิวินาที แต่ก็ยังเป็นออราเคิลให้ไล่คัดรายชื่อ
 * สมาชิกได้ถ้าเก็บตัวอย่างมากพอ · การรอให้ครบ 250ms ทำให้ทั้งสองเส้นทางตอบกลับ
 * เวลาเดียวกันในสภาพปกติ
 *
 * ★ ขอบเขตของวิธีนี้ — เขียนในเล่มให้ตรง ★
 * นี่คือการตั้ง **พื้น** ไม่ใช่การทำให้ **ปริมาณงาน** เท่ากันแบบที่ `login` ทำกับ
 * `DUMMY_HASH` · มันปิดออราเคิลได้ตราบเท่าที่เส้นทาง "มีอีเมล" ยังไม่เกิน 250ms —
 * ถ้าวันไหน DB ช้าจนเกิน (โหลดสูง / lock / autovacuum) ส่วนต่างจะโผล่กลับมา
 * เพราะเส้นทาง "ไม่มีอีเมล" ยังจบเร็วเท่าเดิม · การทำให้เท่ากันจริงต้องเขียน DB
 * ทิ้งเปล่า ๆ ในเส้นทางที่ไม่พบผู้ใช้ ซึ่งแพงและทำให้ข้อมูลสกปรก จึงเลือกไม่ทำ
 * (ชั้นที่รับน้ำหนักจริงคือ rate limit 3 ครั้ง/5 นาที/IP ซึ่งทำให้เก็บตัวอย่าง
 * มากพอจะเฉลี่ย jitter ของเน็ตออกไม่ได้ในทางปฏิบัติ)
 */
const FORGOT_MIN_RESPONSE_MS = 250;

/**
 * hash ปลอมที่มีต้นทุนเท่าของจริง — ใช้เผาเวลาเมื่ออีเมลไม่มีในระบบ
 * ถ้าไม่ทำ เวลาตอบกลับจะต่างกันชัดเจนระหว่าง "ไม่มีอีเมลนี้" กับ "รหัสผิด"
 * ซึ่งพอจะใช้ไล่หาว่าใครเป็นสมาชิกได้ (user enumeration ผ่าน timing)
 */
const DUMMY_HASH = bcrypt.hashSync('anan-timing-equalizer', BCRYPT_COST);

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
export interface AuthResult extends AuthTokens {
  user: UserResponse;
}

/**
 * JWT อ่านได้ด้วยตาเปล่า (base64) — ใส่แค่ `sub` พอ ห้ามใส่อีเมลหรือ PII อื่น
 * สิทธิ์ (isSeller/isAdmin) ไม่อยู่ใน token เช่นกัน เพราะ JwtStrategy อ่านจาก DB
 * ใหม่ทุก request อยู่แล้ว การถอดสิทธิ์จึงมีผลทันที
 */
interface AccessPayload {
  sub: string;
}
interface RefreshPayload {
  sub: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    // hash ก่อนแตะ DB เสมอ — 2 เหตุผล
    // 1) bcrypt cost 12 ใช้เวลาราว 400ms ไม่ควรถือ connection ของ DB ค้างไว้
    // 2) ถ้าเช็คอีเมลซ้ำก่อน เส้นทาง "อีเมลมีอยู่แล้ว" จะตอบกลับเร็วกว่าเส้นทาง
    //    "อีเมลใหม่" เป็นสิบเท่า → แยกได้ว่าใครเป็นสมาชิกโดยไม่ต้องอ่านข้อความเลย
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);

    try {
      // สร้าง user + refresh token ต้องสำเร็จพร้อมกัน ไม่งั้นจะได้บัญชีที่
      // "มีอยู่ในระบบ" (สมัครซ้ำไม่ได้) แต่ผู้ใช้ไม่เคยได้ token กลับไป
      const { user, tokens } = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: dto.email,
            passwordHash,
            displayName: dto.displayName,
            // isSeller / isAdmin ใช้ค่า default เสมอ — ไม่มีทางมาจาก request
          },
        });
        return {
          user: created,
          tokens: await this.issueTokens(created.id, tx),
        };
      });

      return { ...tokens, user: toUserResponse(user) };
    } catch (e) {
      // ให้ unique constraint เป็นคนตัดสินว่าซ้ำ ไม่ใช่ SELECT ก่อนหน้า —
      // การเช็คแล้วค่อยเขียนมีช่องให้ 2 request ที่ยิงพร้อมกันผ่านทั้งคู่
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw AppError.conflict(
          'EMAIL_TAKEN',
          'อีเมลนี้ถูกใช้งานแล้ว กรุณาเข้าสู่ระบบแทน',
        );
      }
      throw e;
    }
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // เทียบกับ hash ปลอมเมื่อไม่พบผู้ใช้ เพื่อให้ใช้เวลาเท่ากันทั้งสองเส้นทาง
    const ok = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? DUMMY_HASH,
    );

    // ข้อความเดียวกันทุกกรณี: ไม่บอกว่าผิดอีเมลหรือผิดรหัส
    if (!user || !ok) {
      throw AppError.unauthorized(
        'INVALID_CREDENTIALS',
        'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
      );
    }

    return { ...(await this.issueTokens(user.id)), user: toUserResponse(user) };
  }

  /**
   * หมุน refresh token: ตัวเก่าใช้ไม่ได้ทันทีที่แลกตัวใหม่
   *
   * ถ้ามีคนเอา token ที่ถูกหมุนไปแล้วมาใช้ซ้ำ = token รั่ว (ไม่ใช่เจ้าของก็คนที่ขโมยไป)
   * แยกไม่ได้ว่าใครเป็นใคร จึงเพิกถอน session ทั้งหมดของบัญชีนั้นแล้วให้ล็อกอินใหม่
   */
  async refresh(rawToken: string): Promise<AuthResult> {
    const payload = await this.verifyRefreshToken(rawToken);
    const tokenHash = hashToken(rawToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored || stored.userId !== payload.sub) {
      throw AppError.unauthorized(
        'INVALID_REFRESH_TOKEN',
        'กรุณาเข้าสู่ระบบใหม่',
      );
    }

    if (stored.revokedAt) {
      // ★ A-8 ★ "ถูกเพิกถอนแล้ว" ไม่ได้แปลว่า "token รั่ว" เสมอไป
      //
      // มีเฉพาะใบที่ถูก **หมุน** (rotated) เท่านั้นที่การถูกใช้ซ้ำแปลว่ามีคนอื่น
      // ถือสำเนาอยู่ ส่วนใบที่เจ้าของกด logout ไปเองเป็นของที่ "ตายแล้วโดยตั้งใจ" —
      // ถ้าเหมารวมว่ารั่วทั้งหมด ใครก็ตามที่เคยเห็น token เก่าใบเดียว (หรือแอปที่
      // ยิงซ้ำเองตอนเน็ตกระตุก) จะเตะเจ้าของบัญชีออกจากทุกเครื่องได้ตลอดเวลา
      if (stored.revokedReason === 'rotated') {
        await this.handleReuse(stored.userId);
      }
      // ไม่ใช่ token รั่ว แต่ก็ไม่ปกติ — ไม่ลง `audit_logs` เพราะตารางนั้นเก็บ
      // "การกระทำที่คนตั้งใจทำ" ไม่ใช่เสียงรบกวนจากแอปที่ยิงซ้ำตอนเน็ตกระตุก
      // (ถ้าลงทุกครั้ง หน้า log ของผู้ดูแลจะถูกกลบจนอ่านของจริงไม่เจอ)
      this.logger.warn(
        `refresh token ที่ปิดด้วยเหตุผล ${stored.revokedReason ?? 'ไม่ระบุ'} ถูกใช้ซ้ำ (user ${stored.userId})`,
      );
      throw AppError.unauthorized(
        'INVALID_REFRESH_TOKEN',
        'กรุณาเข้าสู่ระบบใหม่',
      );
    }

    if (stored.expiresAt <= new Date()) {
      throw AppError.unauthorized(
        'REFRESH_EXPIRED',
        'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
      );
    }

    const tokens = await this.prisma.$transaction(async (tx) => {
      // ★ เงื่อนไข revokedAt อยู่ใน where ไม่ใช่ใน if ข้างบน ★
      // การเช็คแล้วค่อยเขียนเป็นคนละคำสั่งมีช่องให้ 2 request ที่ยิงพร้อมกัน
      // ผ่านทั้งคู่ → token ใบเดียวแลกได้ 2 session และ reuse detection ไม่ทำงาน
      // ที่ isolation READ COMMITTED การนับแถวที่ update ได้จริงคือคำตอบเดียวที่เชื่อได้
      const claimed = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'rotated' },
      });
      // ★ ห้ามส่ง `tx` เข้าไป ★ handleReuse จบด้วยการ throw ซึ่งทำให้ทรานแซกชัน
      // นี้ rollback — ถ้าเพิกถอนผ่าน tx เดียวกัน การตัดทุก session จะถูกย้อนกลับ
      // ไปด้วย เหลือแค่ log แล้ว reuse detection ก็ไม่เกิดขึ้นจริงเลยในเส้นทางนี้
      if (claimed.count === 0) await this.handleReuse(stored.userId);

      return this.issueTokens(stored.user.id, tx);
    });

    return { ...tokens, user: toUserResponse(stored.user) };
  }

  /** ออกจากระบบเฉพาะเครื่องนี้ — เครื่องอื่นของผู้ใช้คนเดียวกันยังใช้ต่อได้ */
  async logout(userId: string, rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      // ผูก userId ไว้ด้วย: กันคนเอา token ของคนอื่นมายิงให้หลุดออกจากระบบ
      where: { tokenHash: hashToken(rawToken), userId, revokedAt: null },
      // เหตุผลสำคัญกว่าที่เห็น: ใบที่ปิดด้วย 'logout' ถูกใช้ซ้ำแล้วไม่ถือว่ารั่ว (A-8)
      data: { revokedAt: new Date(), revokedReason: 'logout' },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'reuse' },
    });
  }

  /**
   * ขอลิงก์ตั้งรหัสผ่านใหม่
   *
   * ★ ตอบเหมือนกันทุกกรณี ★ ไม่ว่าอีเมลจะมีในระบบหรือไม่ ผู้เรียกได้ 204 เปล่า ๆ
   * เสมอ — endpoint นี้เป็น public และไม่ต้องล็อกอิน ถ้ามันตอบต่างกันเมื่อไหร่
   * ใครก็ยิงรายชื่ออีเมลเข้ามาเพื่อคัดว่าใครเป็นสมาชิกได้ (ปัญหาเดียวกับ A-7
   * ที่ยังค้างอยู่ที่ register — ที่นี่ปิดตั้งแต่แรกเพราะเพิ่งเขียนใหม่)
   *
   * การส่งเมล **ไม่ await** ด้วยเหตุผลเดียวกัน: เวลาตอบกลับต้องไม่ผูกกับ
   * handshake ของ SMTP ไม่งั้นจับเวลาแล้วแยกได้ว่าเส้นทางไหนมีการส่งเมลจริง
   */
  async forgotPassword(email: string): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.issueResetToken(email);
    } finally {
      // อยู่ใน finally: เส้นทางที่โยน error (DB ล่ม) ต้องใช้เวลาเท่ากันด้วย
      // ไม่งั้นความล้มเหลวกลายเป็นออราเคิลแทน
      await sleepUntil(startedAt + FORGOT_MIN_RESPONSE_MS);
    }
  }

  private async issueResetToken(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user == null) return;

    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000);

    await this.prisma.$transaction([
      // ขอใบใหม่ = ใบเก่าที่ยังลอยอยู่ต้องตายทันที · คนกดขอซ้ำเพราะเมลแรกไม่มา
      // ไม่ควรเหลือลิงก์ที่ใช้ได้หลายใบค้างอยู่ในกล่องเมลพร้อมกัน
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(rawToken), expiresAt },
      }),
    ]);

    const base = this.config.get('APP_WEB_URL', { infer: true });
    void this.mail
      .sendPasswordReset({
        to: user.email,
        // ปลายทางประกอบจาก env ของ API เท่านั้น — ไม่มีส่วนไหนมาจาก request
        resetUrl: `${base.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(rawToken)}`,
        expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
      })
      .catch((e: unknown) => {
        // ส่งไม่ออกก็ต้องไม่ทำให้ผู้เรียกรู้ว่ามีอีเมลนี้ — log เป็นร่องรอยเดียวที่เหลือ
        this.logger.error(
          `ส่งลิงก์รีเซ็ตรหัสผ่านไม่สำเร็จ (user ${user.id}): ${String(e)}`,
        );
      });
  }

  /**
   * ตั้งรหัสผ่านใหม่ด้วย token จากอีเมล
   *
   * ทุกกรณีที่ใช้ไม่ได้ (ไม่มีใบนี้ / ใช้ไปแล้ว / หมดอายุ) ตอบข้อความเดียวกัน —
   * การแยก "ลิงก์หมดอายุ" ออกจาก "ไม่มีลิงก์นี้" คือการยืนยันว่าเคยมีใบนั้นจริง
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });

    if (
      stored == null ||
      stored.usedAt != null ||
      stored.expiresAt <= new Date()
    ) {
      throw invalidResetToken();
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);

    await this.prisma.$transaction(async (tx) => {
      // ★ เงื่อนไข usedAt/expiresAt อยู่ใน where ไม่ใช่ใน if ข้างบน ★
      // บทเรียนเดียวกับ refresh token: การเช็คแล้วค่อยเขียนเป็นคนละคำสั่งมีช่องให้
      // 2 request ที่ยิงพร้อมกันผ่านทั้งคู่ → ตั๋วใบเดียวตั้งรหัสได้สองครั้ง
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: stored.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) throw invalidResetToken();

      await tx.user.update({
        where: { id: stored.userId },
        data: { passwordHash },
      });

      // ★ จุดประสงค์ทั้งหมดของการรีเซ็ตคือเตะคนที่ถือรหัสเก่าออก ★
      // ถ้าไม่ตัด session เดิม คนที่แอบเข้าบัญชีอยู่ก็ยังอยู่ต่อได้อีก 7 วันเต็ม
      // ทั้งที่เจ้าของเพิ่งเปลี่ยนรหัสไปแล้ว · ใบที่ปิดด้วยเหตุนี้ถูกใช้ซ้ำแล้ว
      // ไม่ถือว่ารั่ว (เหมือน 'logout' — ดู A-8)
      await tx.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'password_reset' },
      });
    });

    this.logger.log(`ตั้งรหัสผ่านใหม่สำเร็จ (user ${stored.userId})`);

    // ★ นอกทรานแซกชัน และล้มแล้วไม่ย้อนผล ★ รหัสถูกเปลี่ยนไปแล้วจริง การทำให้
    // ทั้งก้อน rollback เพราะเขียน log ไม่ผ่าน = ผู้ใช้ตั้งรหัสใหม่ไม่ได้เพราะ
    // ตารางที่ไม่เกี่ยวกับเขาเลย · เหตุการณ์นี้ต้องอยู่ในสายตาผู้ดูแลเพราะเป็น
    // ทางเดียวในระบบที่เปลี่ยนรหัสผ่านได้โดยไม่ต้องรู้รหัสเดิม
    await this.audit.recordDetached({
      action: 'password_reset_completed',
      actorId: stored.userId,
      targetType: 'user',
      targetId: stored.userId,
      summary:
        'ตั้งรหัสผ่านใหม่ผ่านลิงก์ในอีเมล — เพิกถอนทุก session ของบัญชีนี้',
    });
  }

  // ---------- ภายใน ----------

  /**
   * มีคนเอา token ที่ถูกหมุนไปแล้วมาใช้ = token รั่ว
   * แยกไม่ได้ว่าเป็นเจ้าของหรือคนที่ขโมยไป จึงตัดทุก session แล้วให้ล็อกอินใหม่
   */
  private async handleReuse(userId: string): Promise<never> {
    this.logger.warn(
      `ตรวจพบการใช้ refresh token ซ้ำของ user ${userId} — เพิกถอนทุก session`,
    );
    // ใช้ client หลักเสมอ ไม่ใช่ tx ของผู้เรียก — เมธอดนี้จบด้วย throw
    // การเขียนต้อง commit ให้ได้ก่อนที่ทรานแซกชันข้างนอกจะ rollback
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'reuse' },
    });
    throw AppError.unauthorized('TOKEN_REUSED', 'กรุณาเข้าสู่ระบบใหม่');
  }

  private async verifyRefreshToken(raw: string): Promise<RefreshPayload> {
    try {
      return await this.jwt.verifyAsync<RefreshPayload>(raw, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });
    } catch {
      throw AppError.unauthorized(
        'INVALID_REFRESH_TOKEN',
        'กรุณาเข้าสู่ระบบใหม่',
      );
    }
  }

  private async issueTokens(
    userId: string,
    tx?: Pick<PrismaService, 'refreshToken'>,
  ): Promise<AuthTokens> {
    const accessPayload: AccessPayload = { sub: userId };

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    });

    const refreshToken = await this.jwt.signAsync(
      { sub: userId },
      {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_REFRESH_TTL', { infer: true }),
        // jti สุ่ม: ออก token 2 ใบในวินาทีเดียวกันต้องได้คนละสตริง
        // ไม่งั้น hash ชนกันแล้วชน unique constraint
        jwtid: randomUUID(),
      },
    );

    const decoded = this.jwt.decode<{ exp: number }>(refreshToken);
    const client = tx ?? this.prisma;
    await client.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(decoded.exp * 1000),
      },
    });

    return { accessToken, refreshToken };
  }
}

/** เก็บเฉพาะลายนิ้วมือของ token — DB หลุดแล้วสวมสิทธิ์ไม่ได้ */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** รอจนถึงเวลาที่กำหนด — คืนทันทีถ้างานใช้เวลานานกว่านั้นไปแล้ว */
function sleepUntil(deadline: number): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, remaining));
}

/** ข้อความเดียวสำหรับทุกสาเหตุที่ลิงก์ใช้ไม่ได้ — ไม่ยืนยันว่าใบนั้นเคยมีจริงไหม */
function invalidResetToken(): AppException {
  return AppError.badRequest(
    'INVALID_RESET_TOKEN',
    'ลิงก์ตั้งรหัสผ่านใหม่นี้ใช้ไม่ได้แล้ว กรุณาขอลิงก์ใหม่อีกครั้ง',
  );
}
