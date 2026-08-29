import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { API_PREFIX } from '../../bootstrap';
import type { Env } from '../../config/env';

/** ชื่อ cookie ที่ถือ refresh token ของฝั่งเว็บ */
export const REFRESH_COOKIE = 'anan_rt';

/**
 * cookie ถูกแนบเฉพาะ path ของ auth เท่านั้น
 *
 * ไม่ใช่แค่ประหยัดไบต์ — ทุก endpoint ที่ได้รับ cookie ติดมาด้วยคือ endpoint ที่
 * ต้องคิดเรื่อง CSRF เพิ่มอีกหนึ่งจุด · จำกัด path ไว้แปลว่ามีแค่ 4 endpoint ใน
 * ไฟล์เดียวที่ต้องระวัง ไม่ใช่ทั้ง API
 */
export const REFRESH_COOKIE_PATH = `/${API_PREFIX}/auth`;

/**
 * request นี้มาจากเบราว์เซอร์หรือเปล่า — ตัดสินจาก `Origin` เท่านั้น
 *
 * ★ ทำไมต้องเป็น Origin และห้ามใช้อย่างอื่น ★
 *
 * `Origin` เป็น **forbidden header name** ตาม Fetch spec: โค้ด JavaScript ใน
 * หน้าเว็บตั้งเองหรือลบทิ้งไม่ได้ เบราว์เซอร์เป็นคนใส่ให้เองเสมอสำหรับทุก request
 * ที่ไม่ใช่ same-origin GET/HEAD (endpoint ของ auth เป็น POST ทั้งหมด)
 *
 * ถ้าใช้ header ที่ client ตั้งเองได้เป็นตัวแยกแทน เช่น `X-Client: native`
 * โค้ด XSS ในหน้าเว็บก็แค่ใส่ header นั้นแล้วขอ refresh token ลง body ไปเก็บไว้
 * ใช้ต่ออีก 7 วัน — httpOnly ทั้งหมดที่ทำมาจะไม่เหลือความหมายเลย
 *
 * `Origin: null` (sandboxed iframe / redirect ข้าม origin) ก็ยังนับเป็นเบราว์เซอร์
 * ซึ่งเป็นด้านที่ปลอดภัยกว่า: ได้ cookie อย่างเดียว ไม่ได้ token ลง body
 */
export function isBrowserRequest(req: Request): boolean {
  return typeof req.headers.origin === 'string' && req.headers.origin !== '';
}

/**
 * อ่าน cookie ใบเดียวจาก header ตรง ๆ แทนการลง `cookie-parser`
 *
 * ค่าที่เก็บเป็น JWT (base64url + จุด) ซึ่งไม่มีอักขระที่ต้อง percent-encode
 * และเราต้องการแค่ใบเดียว — การเพิ่ม dependency (+ @types อีกตัว) เพื่อเรื่องนี้
 * ไม่คุ้มตามกฎข้อ 6 ของโปรเจกต์ · `decodeURIComponent` ยังใส่ไว้เผื่อ client
 * ตัวอื่นเข้ารหัสมา และห่อ try ไว้เพราะ `%` เดี่ยว ๆ ทำให้มันโยน URIError
 */
export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (header == null || header === '') return undefined;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== REFRESH_COOKIE) continue;

    const raw = part.slice(eq + 1).trim();
    if (raw === '') return undefined;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

/**
 * แปลงค่าอายุแบบเดียวกับที่ `@nestjs/jwt` รับ (`7d` / `15m` / `3600s` / `3600`)
 * ให้เป็นมิลลิวินาที เพื่อให้ `Max-Age` ของ cookie หมดอายุพร้อมกับตัว token
 *
 * cookie ที่อยู่นานกว่า token ไม่ได้อันตรายขึ้น (server ปฏิเสธอยู่แล้ว) แต่ทำให้
 * ผู้ใช้เจอ 401 หนึ่งครั้งทุกครั้งที่เปิดแอปหลังหมดอายุ แทนที่จะเห็นหน้า login ทันที
 */
export function parseDurationMs(value: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(value.trim());
  if (m == null) {
    throw new Error(
      `JWT_REFRESH_TTL อ่านไม่ออก: "${value}" — รองรับรูปแบบ 7d / 12h / 30m / 60s / 1000ms`,
    );
  }
  const n = Number(m[1]);
  switch (m[2] ?? 's') {
    case 'ms':
      return n;
    case 's':
      return n * 1000;
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 3_600_000;
    default:
      return n * 86_400_000;
  }
}

/**
 * ที่เดียวที่ออกและล้าง cookie ของ refresh token
 *
 * ★ นี่คือของที่มาแทน localStorage ★ เดิม refresh token ถูกเก็บไว้ในที่ที่
 * `document.cookie` / `localStorage.getItem()` อ่านได้ แปลว่า XSS ครั้งเดียว
 * = ผู้โจมตีถือกุญแจบัญชีนั้นต่อไปอีก 7 วันแม้ผู้ใช้ปิดแท็บไปแล้ว
 * `HttpOnly` ตัดความสามารถนั้นทิ้ง: JavaScript อ่านค่าไม่ได้เลย ทำได้แค่ "ใช้"
 * ผ่านเบราว์เซอร์ขณะที่หน้ายังเปิดอยู่ ซึ่งขโมยออกไปนอกเครื่องไม่ได้
 */
@Injectable()
export class RefreshCookieService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  issue(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      ...this.baseOptions(),
      maxAge: parseDurationMs(
        this.config.get('JWT_REFRESH_TTL', { infer: true }),
      ),
    });
  }

  /**
   * ต้องส่ง option ชุดเดียวกับตอนออกทุกตัว (path/sameSite/secure) —
   * เบราว์เซอร์ลบ cookie ได้ก็ต่อเมื่อ path กับ domain ตรงกันเป๊ะ
   * ถ้าไม่ตรง จะได้ cookie ใบที่สองที่ทับกันแทนที่จะเป็นการลบ
   */
  clear(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, this.baseOptions());
  }

  private baseOptions(): CookieOptions {
    const sameSite = this.config.get('REFRESH_COOKIE_SAMESITE', {
      infer: true,
    });
    return {
      httpOnly: true,
      // SameSite=None บังคับให้ต้อง Secure เสมอตามสเปกของเบราว์เซอร์
      // (env.ts กันไม่ให้ตั้ง none บนที่ที่ไม่ใช่ production อยู่แล้ว)
      secure:
        sameSite === 'none' ||
        this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite,
      path: REFRESH_COOKIE_PATH,
    };
  }
}
