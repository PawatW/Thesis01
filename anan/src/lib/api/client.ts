/**
 * HTTP client ตัวเดียวของทั้งแอพ — แทนที่ `src/lib/supabase.ts` เดิม
 *
 * หน้าที่: แนบ token, ต่ออายุ token อัตโนมัติ, แปลง error เป็นข้อความไทย
 *
 * ★ ที่นี่ไม่มีความลับใด ๆ ★ ทุกอย่างในบันเดิลของ Expo ผู้ใช้เปิดอ่านได้
 * การอนุญาตทั้งหมดอยู่ที่ API (docs/security-design.md)
 */

import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  purgeLegacyRefreshToken,
  setAccessToken,
  setRefreshToken,
  usesCookieTransport,
} from './tokens';

/**
 * บนเว็บทุก request ต้องพก cookie ไปด้วย ไม่งั้นเบราว์เซอร์ไม่แนบให้เลยเพราะ
 * API อยู่คนละ origin กับหน้าจอ · cookie ถูกจำกัด path ไว้ที่ `/auth` อยู่แล้ว
 * จึงติดไปเฉพาะ endpoint ที่ต้องใช้จริง ไม่ได้ติดไปทุกเส้น
 *
 * บนมือถือปล่อยเป็นค่าเริ่มต้น: RN มี cookie jar ของตัวเองที่พฤติกรรมต่างกัน
 * ระหว่าง iOS/Android และไม่การันตีว่าอยู่ข้ามการปิดแอพ — ฝั่งนั้นจึงใช้
 * refresh token ใน keychain ผ่าน body แทน (ดู tokens.ts)
 */
const CREDENTIALS: RequestCredentials | undefined = usesCookieTransport
  ? 'include'
  : undefined;

const baseUrl = process.env.EXPO_PUBLIC_API_URL;

if (!baseUrl) {
  throw new Error(
    'ไม่พบ EXPO_PUBLIC_API_URL — คัดลอก .env.example เป็น .env (ค่าเริ่มต้น http://localhost:3000/api/v1)',
  );
}

/** รูปแบบ error เดียวของ API (docs/architecture.md §3) */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** ข้อความสำรองเมื่อ API ไม่ตอบเลย (เน็ตหลุด / ยังไม่ได้เปิด API) */
const NETWORK_MESSAGE = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';

type AuthLostListener = () => void;
const authLostListeners = new Set<AuthLostListener>();

/** เรียกเมื่อ refresh ไม่สำเร็จ = session จบแล้ว ให้ AuthProvider พากลับหน้า login */
export function onAuthLost(listener: AuthLostListener): () => void {
  authLostListeners.add(listener);
  return () => authLostListeners.delete(listener);
}

function emitAuthLost(): void {
  for (const listener of authLostListeners) listener();
}

export interface Session {
  accessToken: string;
  /** ไม่มีบนเว็บ — อยู่ใน httpOnly cookie ที่โค้ดฝั่งนี้แตะไม่ได้ */
  refreshToken?: string;
}

export async function saveSession(session: Session): Promise<void> {
  setAccessToken(session.accessToken);
  // บนเว็บไม่มีอะไรให้เก็บ (และ setRefreshToken ก็ไม่ทำอะไรอยู่แล้ว) —
  // เช็คตรงนี้เพื่อไม่ให้เผลอเขียน `undefined` ลง keychain บนมือถือ
  if (session.refreshToken != null) {
    await setRefreshToken(session.refreshToken);
  }
}

/**
 * ต่ออายุ token แบบ single-flight
 *
 * ถ้ามี 3 request หมดอายุพร้อมกันแล้วต่างคนต่างยิง refresh ตัวที่ 2 กับ 3 จะใช้
 * token ที่เพิ่งถูกหมุนไปแล้ว → server มองว่าเป็นการใช้ซ้ำ (token รั่ว) แล้ว
 * เพิกถอนทุก session ผู้ใช้จะหลุดออกจากระบบเองโดยไม่มีสาเหตุ
 * ตัวแปรนี้จึงบังคับให้ทุกคนรอ refresh ครั้งเดียวกัน
 */
let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      // บนเว็บไม่มี token ให้เช็คก่อนยิง — cookie เป็นของ API และ JavaScript
      // มองไม่เห็น คำตอบเดียวที่เชื่อได้คือถาม API ตรง ๆ แล้วดูว่า 200 หรือ 401
      const refreshToken = usesCookieTransport ? null : await getRefreshToken();
      if (!usesCookieTransport && refreshToken == null) return false;

      const res = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        credentials: CREDENTIALS,
        // ★ บนเว็บไม่มี body เลย ★ ไม่ใช่แค่ไม่จำเป็น — การไม่ส่ง Content-Type
        // ทำให้ request นี้เป็น "simple request" ที่ไม่มี preflight มากรอง
        // ด่านที่กัน CSRF แทนคือ `AllowedOriginGuard` ฝั่ง API
        ...(refreshToken == null
          ? {}
          : {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken }),
            }),
      });
      if (!res.ok) return false;

      const data = (await res.json()) as Session;
      await saveSession(data);
      return true;
    } catch {
      return false;
    } finally {
      // ปล่อยล็อกใน microtask ถัดไป เพื่อให้ทุกคนที่รออยู่ได้ผลของรอบนี้ก่อน
      queueMicrotask(() => {
        refreshing = null;
      });
    }
  })();

  return refreshing;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** ใช้ภายในเท่านั้น: กันการวน refresh ไม่รู้จบ */
  retrying?: boolean;
  signal?: AbortSignal;
}

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, retrying = false, signal } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      credentials: CREDENTIALS,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
  }

  // access token หมดอายุ → ต่ออายุแล้วยิงซ้ำ 1 ครั้ง
  if (res.status === 401 && !retrying) {
    if (await refreshSession()) {
      return apiFetch<T>(path, { ...options, retrying: true });
    }
    await clearTokens();
    emitAuthLost();
  }

  if (res.status === 204) return undefined as T;

  const payload: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const err = payload as { code?: string; message?: string } | null;
    throw new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      // API ส่งข้อความไทยมาให้อยู่แล้ว — ไม่ต้องแปลซ้ำเหมือนสมัย Supabase
      err?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
    );
  }

  return payload as T;
}

/**
 * ใช้ตอนเปิดแอพ: ยังมี session ที่ใช้ได้อยู่ไหม
 *
 * บนเว็บต้องยิงถาม API เสมอ เพราะ cookie เป็น httpOnly — โค้ดฝั่งนี้ดูไม่ได้ว่า
 * มีอยู่หรือเปล่า · ผู้ใช้ที่ยังไม่เคยล็อกอินจะเสีย request เปล่า 1 ครั้งต่อการ
 * เปิดแอพ ซึ่งแลกกับการที่ token ไม่ต้องนอนอยู่ในที่ที่ XSS อ่านได้
 */
export async function restoreSession(): Promise<boolean> {
  // ผู้ใช้ที่ล็อกอินค้างไว้ตั้งแต่ก่อนอัปเดตยังมี token ตัวจริงใน localStorage
  // ล้างทิ้งตั้งแต่บูตแรก ไม่ต้องรอให้เขากด "ออกจากระบบ"
  await purgeLegacyRefreshToken();

  if (!usesCookieTransport && (await getRefreshToken()) == null) return false;
  return refreshSession();
}

export async function clearSession(): Promise<void> {
  await clearTokens();
}
