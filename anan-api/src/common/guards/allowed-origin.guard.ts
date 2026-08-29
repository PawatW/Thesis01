import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { corsOrigins, type Env } from '../../config/env';
import { AppError } from '../errors/app-exception';

/**
 * ด่านกัน CSRF ของ endpoint ที่กิน refresh token จาก cookie
 *
 * ★ ทำไมยังต้องมีทั้งที่ตั้ง SameSite ไว้แล้ว ★
 *
 * ตราบใดที่ `REFRESH_COOKIE_SAMESITE=lax` เบราว์เซอร์ไม่แนบ cookie ไปกับ POST
 * ข้าม site อยู่แล้ว CSRF จึงเป็นไปไม่ได้ตั้งแต่ต้นทาง — แต่วันที่หน้าจอกับ API
 * ถูก deploy คนละโดเมน ค่านั้นต้องเปลี่ยนเป็น `none` แล้วช่องจะเปิดกลับมาทันที
 *
 * endpoint อื่นของระบบรอดด้วย preflight โดยบังเอิญ: ทุกตัวต้องมี
 * `Content-Type: application/json` หรือ `Authorization` ซึ่งเป็น header ที่
 * บังคับให้เบราว์เซอร์ยิง OPTIONS ถามก่อน แล้ว CORS ก็ปัดตกให้เอง
 * ส่วน `POST /auth/refresh` ในโหมด cookie **ไม่มี body และไม่มี header อะไรเลย**
 * → เป็น "simple request" ที่ยิงจากฟอร์มในเว็บของผู้โจมตีได้ตรง ๆ ไม่มี preflight
 * ให้พึ่ง · ด่านนี้จึงเป็นตัวที่ปิดช่องนั้นเอง ไม่ใช่ผลพลอยได้ของอย่างอื่น
 *
 * ไม่มี `Origin` = ไม่ใช่เบราว์เซอร์ (Expo native, supertest, curl) → ผ่าน
 * เพราะ CSRF เป็นการโจมตีที่อาศัยเบราว์เซอร์แนบ credential ให้เองเท่านั้น
 * ผู้โจมตีที่ยิง request เองอยู่แล้วไม่ได้อะไรเพิ่มจากการปลอม header นี้
 */
@Injectable()
export class AllowedOriginGuard implements CanActivate {
  private readonly allowed: Set<string>;

  constructor(config: ConfigService<Env, true>) {
    this.allowed = new Set(
      corsOrigins(config.get('CORS_ORIGINS', { infer: true })),
    );
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const origin = req.headers.origin;

    if (origin == null || origin === '') return true;
    if (this.allowed.has(origin)) return true;

    throw AppError.forbidden(
      'ORIGIN_NOT_ALLOWED',
      'คำขอนี้มาจากที่มาที่ไม่ได้รับอนุญาต',
    );
  }
}
