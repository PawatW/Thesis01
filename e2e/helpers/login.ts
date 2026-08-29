/**
 * การล็อกอินของเทส
 *
 * มีสองทางโดยตั้งใจ:
 *   - `loginAs()`      ยิง `/auth/login` ตรง แล้วฝัง refresh token ลง cookie ของ context
 *                      ใช้กับเคสที่ "ต้องล็อกอินอยู่" แต่ไม่ได้ทดสอบตัวล็อกอิน
 *   - `loginThroughUi()` กรอกฟอร์มจริงแล้วกดปุ่มจริง ใช้เฉพาะเคสของ feature auth
 *
 * ถ้าใช้ UI ล็อกอินในทุกเคส เวลารันจะบานและเคสที่พังจะชี้ไปที่หน้า login ทุกครั้ง
 * แทนที่จะชี้ไปที่ของที่เคสนั้นตั้งใจทดสอบ
 */
import type { Page } from '@playwright/test';
import { expect } from './fixtures';
import * as ids from './selectors';
import { USERS, type Role } from './test-data';

/**
 * ชื่อ cookie เดียวกับ `anan-api/src/common/http/refresh-cookie.ts`
 *
 * ★ ทำไมไม่ใช่ localStorage แล้ว ★ refresh token ของฝั่งเว็บย้ายไปอยู่ใน
 * httpOnly cookie — โค้ดในหน้าเว็บเขียนหรืออ่านมันไม่ได้อีกต่อไป (ซึ่งเป็น
 * ประเด็นทั้งหมดของการย้าย) เทสจึงต้องใส่ผ่าน CDP ของเบราว์เซอร์แทน
 */
const REFRESH_COOKIE = 'anan_rt';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** export ไว้ให้เคสที่ต้องยิง API ตรงข้าม UI (พิสูจน์ว่ากฎอยู่ที่ API ไม่ใช่ที่ปุ่ม) */
export function apiBaseUrl(): string {
  const port = process.env.E2E_API_PORT ?? '3100';
  return `http://127.0.0.1:${port}/api/v1`;
}

function webBaseUrl(): string {
  const port = process.env.E2E_WEB_PORT ?? '8082';
  return `http://127.0.0.1:${port}`;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; displayName: string };
}

/** ล็อกอินผ่าน API ตรง ๆ — ได้ token จริงที่ผ่าน bcrypt + guard เหมือนผู้ใช้จริง */
export async function apiLogin(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${apiBaseUrl()}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`ล็อกอิน ${email} ไม่สำเร็จ: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as LoginResponse;
}

/**
 * ใส่ refresh token ให้ browser context นี้ในรูป cookie แบบเดียวกับที่ API ตั้ง
 *
 * ★ ปัญหาที่เคยต้องแก้ด้วยธงพิเศษ หายไปเองเพราะย้ายมาใช้ cookie ★
 * ของเดิมใช้ `addInitScript` ซึ่งทำงานใหม่ทุกครั้งที่ navigate จึงต้องมีธงกัน
 * ไม่ให้ยัด token ใบเดิมซ้ำ (ยัดซ้ำ = server เห็นเป็น token ที่หมุนไปแล้ว →
 * ตีความว่ารั่ว → เพิกถอนทุก session) · `addCookies` ใส่ครั้งเดียวต่อ context
 * และหลังจากนั้น server เป็นคนหมุน cookie ให้เองผ่าน `Set-Cookie` เหมือนผู้ใช้จริง
 *
 * ผลพลอยได้: หลัง logout server สั่งลบ cookie ไปแล้ว การ navigate ต่อจึงยังคง
 * สถานะ "ออกจากระบบ" อยู่ — ตรงกับที่ธงเดิมพยายามรักษาไว้ แต่ไม่ต้องมีธง
 */
export async function seedSession(page: Page, refreshToken: string): Promise<void> {
  await page.context().addCookies([
    {
      name: REFRESH_COOKIE,
      value: refreshToken,
      url: `${apiBaseUrl().replace('/api/v1', '')}${REFRESH_COOKIE_PATH}`,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

/** ทำให้ browser context นี้ "ล็อกอินอยู่" ในฐานะ role ที่ระบุ */
export async function loginAs(page: Page, role: Role = 'buyer'): Promise<LoginResponse> {
  const user = USERS[role];
  const session = await apiLogin(user.email, user.password);
  await seedSession(page, session.refreshToken);
  return session;
}

/** เปิดหน้าแล้วรอจนแอป resolve session เสร็จ (ตัวโหลดเต็มจอหายไป) */
export async function gotoApp(page: Page, path = '/'): Promise<void> {
  await page.goto(`${webBaseUrl()}${path}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(ids.splash)).toHaveCount(0, { timeout: 30_000 });
}

/** กรอกฟอร์มล็อกอินจริง — ใช้เฉพาะเคสที่ทดสอบตัวล็อกอินเอง */
export async function loginThroughUi(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await gotoApp(page, '/login');
  await page.locator(ids.login.email).fill(credentials.email);
  await page.locator(ids.login.password).fill(credentials.password);
  await page.locator(ids.login.submit).click();
}

/** ยืนยันว่าอยู่ในสถานะล็อกอินแล้ว โดยดูของที่มีเฉพาะเมื่อมี session */
export async function expectSignedIn(page: Page): Promise<void> {
  await expect(page.locator(ids.home.greeting)).toBeVisible({ timeout: 20_000 });
}

/** ยืนยันว่าถูกพากลับมาหน้า login (auth gate ทำงาน) */
export async function expectSignedOut(page: Page): Promise<void> {
  await expect(page.locator(ids.login.submit)).toBeVisible({ timeout: 20_000 });
}
