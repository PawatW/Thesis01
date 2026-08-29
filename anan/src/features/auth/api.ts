/**
 * ชั้นข้อมูลของ feature auth — คุยกับ API ของเราเอง (เดิมคุยกับ Supabase ตรง)
 *
 * ข้อความ error ไม่ต้องแปลที่นี่อีกแล้ว: API ส่ง `message` ภาษาไทยมาให้พร้อมใช้
 * และ `code` ไว้ให้แตกเคสเมื่อจำเป็น (docs/architecture.md §3)
 */

import { ApiError, apiFetch, clearSession, saveSession } from '@/lib/api/client';
import { usesCookieTransport } from '@/lib/api/tokens';
import type {
  ApiAddress,
  ApiAuthResult,
  ApiPaymentMethod,
  ApiUser,
} from '@/types/api';

export type Profile = ApiUser;
export type Address = ApiAddress;
export type PaymentMethod = ApiPaymentMethod;

type Result<T = undefined> = { data: T; error: null } | { data: null; error: string };

function fail(error: unknown): { data: null; error: string } {
  if (error instanceof ApiError) return { data: null, error: error.message };
  return { data: null, error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' };
}

/* ---------------- validation (ฝั่ง client = UX เท่านั้น กฎจริงอยู่ที่ API + DB) ---------------- */

export const MIN_PASSWORD_LENGTH = 10;

export function validateEmail(email: string): string | null {
  if (email.trim().length === 0) return 'กรุณากรอกอีเมล';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'รูปแบบอีเมลไม่ถูกต้อง';
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`;
  }
  // bcrypt ตัดที่ 72 ไบต์ — ภาษาไทย 1 ตัวกินราว 3 ไบต์
  if (new TextEncoder().encode(password).length > 72) {
    return 'รหัสผ่านยาวเกินไป — ภาษาไทย 1 ตัวนับเป็น 3 หน่วย ลองใช้รหัสที่สั้นลง';
  }
  return null;
}

export function validateDisplayName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'กรุณากรอกชื่อที่แสดง';
  if (trimmed.length > 60) return 'ชื่อยาวเกิน 60 ตัวอักษร';
  return null;
}

export type AddressDraft = {
  label: string | null;
  recipientName: string;
  phone: string;
  addressLine: string;
  province: string;
  postcode: string;
  isDefault: boolean;
};

export function validateAddress(
  input: AddressDraft,
): Partial<Record<keyof AddressDraft, string>> {
  const errors: Partial<Record<keyof AddressDraft, string>> = {};
  if (input.recipientName.trim().length === 0) errors.recipientName = 'กรุณากรอกชื่อผู้รับ';
  if (input.recipientName.length > 100) errors.recipientName = 'ชื่อผู้รับยาวเกินไป';
  if (!/^[0-9+\-() ]{6,20}$/.test(input.phone.trim())) errors.phone = 'เบอร์โทรไม่ถูกต้อง (6-20 หลัก)';
  if (input.addressLine.trim().length === 0) errors.addressLine = 'กรุณากรอกที่อยู่';
  if (input.province.trim().length === 0) errors.province = 'กรุณากรอกจังหวัด';
  if (!/^[0-9]{5}$/.test(input.postcode.trim())) errors.postcode = 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก';
  return errors;
}

/* ---------------- auth ---------------- */

export async function signUpWithEmail(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<Result<ApiUser>> {
  try {
    const res = await apiFetch<ApiAuthResult>('/auth/register', {
      method: 'POST',
      body: {
        email: input.email.trim(),
        password: input.password,
        displayName: input.displayName.trim(),
      },
    });
    await saveSession(res);
    return { data: res.user, error: null };
  } catch (e) {
    return fail(e);
  }
}

export async function signInWithEmail(input: {
  email: string;
  password: string;
}): Promise<Result<ApiUser>> {
  try {
    const res = await apiFetch<ApiAuthResult>('/auth/login', {
      method: 'POST',
      body: { email: input.email.trim(), password: input.password },
    });
    await saveSession(res);
    return { data: res.user, error: null };
  } catch (e) {
    return fail(e);
  }
}

/**
 * ขอลิงก์ตั้งรหัสผ่านใหม่
 *
 * ★ สำเร็จเสมอในสายตาหน้าจอ ★ API ตอบ 204 ทั้งกรณีที่มีอีเมลนี้และไม่มี —
 * หน้าจอจึงต้องแสดงข้อความเดียวกันทั้งสองแบบ ห้ามเติม "ไม่พบอีเมลนี้" เข้าไปเอง
 * ไม่งั้นด่านกัน user enumeration ที่ทำไว้ฝั่ง API จะเสียไปกับข้อความบนหน้าจอ
 */
export async function requestPasswordReset(email: string): Promise<{ error: string | null }> {
  try {
    await apiFetch<void>('/auth/forgot-password', {
      method: 'POST',
      body: { email: email.trim() },
    });
    return { error: null };
  } catch (e) {
    // 429 (ขอถี่เกินไป) กับ 400 (รูปแบบอีเมลผิด) ยังต้องบอกผู้ใช้ — สองอย่างนี้
    // ไม่ได้บอกอะไรเกี่ยวกับว่าบัญชีมีจริงหรือไม่
    return { error: fail(e).error };
  }
}

/** ตั้งรหัสผ่านใหม่ด้วย token จากอีเมล — สำเร็จแล้วต้องล็อกอินใหม่ */
export async function resetPassword(input: {
  token: string;
  password: string;
}): Promise<{ error: string | null }> {
  try {
    await apiFetch<void>('/auth/reset-password', {
      method: 'POST',
      body: { token: input.token, password: input.password },
    });
    return { error: null };
  } catch (e) {
    return { error: fail(e).error };
  }
}

/** ล้าง token ในเครื่องก่อนเสมอ — ถ้า network ล้ม ต้องไม่ค้างสถานะล็อกอินไว้บนหน้าจอ */
export async function signOut(refreshToken: string | null): Promise<void> {
  try {
    // ★ บนเว็บ `refreshToken` เป็น null เสมอ แต่ยัง **ต้อง** ยิง logout ★
    // token อยู่ใน httpOnly cookie ที่เดินทางไปกับ request เอง ถ้าข้ามการเรียก
    // เพราะเห็นว่า null (แบบเดิม) จะได้ผลว่า: หน้าจอออกจากระบบแล้ว แต่ session
    // ฝั่ง server ยังไม่ถูกเพิกถอน และ cookie ยังอยู่ในเบราว์เซอร์อีก 7 วัน
    if (usesCookieTransport || refreshToken != null) {
      await apiFetch<void>('/auth/logout', {
        method: 'POST',
        ...(refreshToken == null ? {} : { body: { refreshToken } }),
      });
    }
  } catch {
    // token ที่เหลืออยู่หมดอายุเองใน 7 วัน — ผู้ใช้ไม่ควรติดอยู่ในแอพเพราะเน็ตหลุด
  } finally {
    await clearSession();
  }
}

/* ---------------- profile ---------------- */

export async function fetchMe(): Promise<Result<ApiUser>> {
  try {
    return { data: await apiFetch<ApiUser>('/me'), error: null };
  } catch (e) {
    return fail(e);
  }
}

export async function updateProfile(patch: {
  displayName?: string;
  phone?: string | null;
  avatarUrl?: string | null;
}): Promise<Result<ApiUser>> {
  try {
    return {
      data: await apiFetch<ApiUser>('/me', { method: 'PATCH', body: patch }),
      error: null,
    };
  } catch (e) {
    return fail(e);
  }
}

/* ---------------- addresses ---------------- */

export async function listAddresses(): Promise<{ data: Address[]; error: string | null }> {
  try {
    return { data: await apiFetch<Address[]>('/me/addresses'), error: null };
  } catch (e) {
    return { data: [], error: fail(e).error };
  }
}

export async function createAddress(draft: AddressDraft): Promise<Result<Address>> {
  try {
    return {
      data: await apiFetch<Address>('/me/addresses', { method: 'POST', body: draft }),
      error: null,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function updateAddress(
  id: string,
  draft: AddressDraft,
): Promise<Result<Address>> {
  try {
    return {
      data: await apiFetch<Address>(`/me/addresses/${id}`, {
        method: 'PATCH',
        body: draft,
      }),
      error: null,
    };
  } catch (e) {
    return fail(e);
  }
}

/** ส่งแค่ isDefault พอ — API เคลียร์ที่อยู่หลักเดิมให้ในทรานแซกชันเดียว */
export async function setDefaultAddress(id: string): Promise<Result<Address>> {
  try {
    return {
      data: await apiFetch<Address>(`/me/addresses/${id}`, {
        method: 'PATCH',
        body: { isDefault: true },
      }),
      error: null,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAddress(id: string): Promise<{ error: string | null }> {
  try {
    await apiFetch<void>(`/me/addresses/${id}`, { method: 'DELETE' });
    return { error: null };
  } catch (e) {
    // API ตอบ 409 ADDRESS_IN_USE พร้อมข้อความไทยเมื่อยังมี subscription ใช้อยู่
    return { error: fail(e).error };
  }
}

/* ---------------- บัตร ---------------- */

export async function listPaymentMethods(): Promise<{
  data: PaymentMethod[];
  error: string | null;
}> {
  try {
    return { data: await apiFetch<PaymentMethod[]>('/me/payment-methods'), error: null };
  } catch (e) {
    return { data: [], error: fail(e).error };
  }
}

/**
 * ★ รับเฉพาะร่องรอยของบัตร ★ เครือข่าย · 4 ตัวท้าย · เดือน/ปีหมดอายุ · ชื่อบนบัตร
 *
 * เลขบัตรเต็มกับ CVV ต้องไม่ออกจากฟอร์มที่ผู้ใช้กรอก — ไม่เข้า state ที่ persist
 * ไม่เข้า log และไม่เคยถูกส่งขึ้น network (กฎเหล็กข้อ 1 · แปลงร่างที่
 * `features/payment/card.ts#toCardPayload`)
 */
export async function createPaymentMethod(input: {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  holderName?: string;
}): Promise<Result<PaymentMethod>> {
  try {
    return {
      data: await apiFetch<PaymentMethod>('/me/payment-methods', {
        method: 'POST',
        body: input,
      }),
      error: null,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function deletePaymentMethod(id: string): Promise<{ error: string | null }> {
  try {
    await apiFetch<void>(`/me/payment-methods/${id}`, { method: 'DELETE' });
    return { error: null };
  } catch (e) {
    return { error: fail(e).error };
  }
}
