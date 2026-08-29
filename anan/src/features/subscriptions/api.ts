/**
 * ชั้นข้อมูลของ subscription — คุยกับ API ของเราเอง
 *
 * ทั้งการอ่าน การสมัคร และ 7 actions ของ W05 ยิง endpoint จริงทั้งหมดแล้ว
 * (ข้าม/หยุด/กลับมา/เลื่อน/เปลี่ยนรอบ/เปลี่ยนที่อยู่/ยกเลิก)
 *
 * ★ ที่นี่ไม่มีการตัดสินใจเรื่องสิทธิ์หรือสถานะเลย ★ ปุ่มที่หน้าจอซ่อนไว้เป็นแค่ UX
 * กฎจริง (ใครทำได้ · สถานะไหนทำได้ · วันไหนเลื่อนได้) อยู่ใน service ของ API
 * ฝั่งนี้มีหน้าที่แค่ส่งคำสั่งไปแล้วแปลง error เป็นข้อความให้ผู้ใช้อ่าน
 */

import { apiFetch, ApiError } from '@/lib/api/client';
import { formatThaiDate, nextCycleAfter, todayISO } from '@/lib/date';

export type Cycle = '2w' | '1m' | '2m';

export type SubscriptionCard = {
  id: string;
  status: 'active' | 'paused' | 'cancelled';
  pausedReason: string | null;
  startDate: string;
  nextOrderDate: string | null;
  /** หมุดของกริดรอบ — ใช้คำนวณ preview ให้ตรงกับที่ API จะเขียนจริง */
  cycleAnchorDate: string;
  quantity: number;
  cycle: string;
  pricePerCycle: number;
  /** แผน/ที่อยู่ปัจจุบัน — ใช้ทำเครื่องหมาย "อันที่ใช้อยู่" ในกล่องตัวเลือก */
  planId: string;
  addressId: string;
  productId: string;
  productName: string;
  shopName: string;
  images: string[];
  /** รอบที่ส่งถึงแล้ว — 0 แปลว่ายังรีวิวไม่ได้ (API บังคับกฎเดียวกัน) */
  cyclesReceived: number;
  /** ดาวที่เราให้ไว้เอง — null คือยังไม่เคยรีวิว ไม่ใช่ 0 ดาว */
  myRating: number | null;
  /**
   * คูปองที่จองไว้กับรอบถัดไป (feature 18) — null = ยังไม่ได้จอง
   * ยอดมาจาก API ทั้งหมด ฝั่งนี้ไม่คำนวณส่วนลดเอง
   */
  coupons: {
    tier: 'platform' | 'shop';
    code: string;
    discountAmount: number;
  }[];
  /** ยอดส่วนลดรวมของรอบถัดไป (หนีบไม่ให้เกินยอดแล้ว) — 0 เมื่อไม่ได้จองไว้ */
  couponDiscount: number;
  /** ยอดที่จะถูกตัดจริงในรอบถัดไป */
  couponNetAmount: number;
};

export async function listMySubscriptions(): Promise<{
  data: SubscriptionCard[];
  error: string | null;
}> {
  try {
    // API กรองด้วย buyerId จาก token — ไม่มีทางขอของคนอื่นได้
    return { data: await apiFetch<SubscriptionCard[]>('/subscriptions'), error: null };
  } catch (e) {
    return {
      data: [],
      error: e instanceof ApiError ? e.message : 'โหลดรายการไม่สำเร็จ',
    };
  }
}

export type CheckoutInput = {
  planId: string;
  quantity: number;
  addressId: string;
  paymentMethodId: string;
  startDate: string;
  /** คูปองของรอบแรก (feature 18) — **id เท่านั้น ไม่ใช่ยอดส่วนลด** · ซ้อนได้ 2 ใบ */
  couponIds?: string[];
};

export type CheckoutResult = {
  subscription: SubscriptionCard;
  firstOrder: {
    id: string;
    cycleDate: string;
    /** ยอดที่ตัดจริง (หลังหักคูปองแล้ว) */
    amount: number;
    discountAmount: number;
    couponCodes: string[];
    status: string;
  };
};

/**
 * สมัครรับสินค้า — request เดียวจบ
 *
 * ★ ไม่ส่งราคาหรือยอดเงินขึ้นไป ★ API คำนวณจากราคาในฐานข้อมูลเอง
 * (CLAUDE.md กฎข้อ 7 — เงินห้ามมาจาก client)
 */
export async function subscribeToPlan(
  input: CheckoutInput,
): Promise<{ data: CheckoutResult; error: null } | { data: null; error: string }> {
  try {
    return {
      data: await apiFetch<CheckoutResult>('/subscriptions', {
        method: 'POST',
        body: input,
      }),
      error: null,
    };
  } catch (e) {
    return {
      data: null,
      error: e instanceof ApiError ? e.message : 'สมัครไม่สำเร็จ กรุณาลองใหม่',
    };
  }
}

/* ---------------- 7 actions ของ W05 ---------------- */

type ActionResult = { error: string | null };

/**
 * ยิง action แล้วแปลงผลเป็น `{ error }` แบบเดียวกันทุกตัว
 *
 * ข้อความ error มาจาก API ตรง ๆ (เป็นภาษาไทยพร้อมแสดงอยู่แล้ว) เพราะฝั่งนี้
 * ไม่รู้กติกาจริง เช่น "ร้านถูกระงับ" กับ "รายการเปลี่ยนสถานะไปแล้ว" ต้องบอก
 * ผู้ใช้คนละอย่าง — ถ้ามาเขียนข้อความเองตรงนี้จะไม่มีวันตรงกับกฎที่ API ใช้จริง
 */
async function action(
  id: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<ActionResult> {
  try {
    await apiFetch<SubscriptionCard>(`/subscriptions/${id}/${path}`, {
      method: 'POST',
      body: body ?? {},
    });
    return { error: null };
  } catch (e) {
    return {
      error: e instanceof ApiError ? e.message : 'ทำรายการไม่สำเร็จ กรุณาลองใหม่',
    };
  }
}

export const skipCycle = (id: string): Promise<ActionResult> => action(id, 'skip');
export const pause = (id: string): Promise<ActionResult> => action(id, 'pause');
export const resume = (id: string): Promise<ActionResult> => action(id, 'resume');
export const reschedule = (id: string, date: string): Promise<ActionResult> =>
  action(id, 'reschedule', { date });
export const changePlan = (id: string, planId: string): Promise<ActionResult> =>
  action(id, 'plan', { planId });
export const changeAddress = (id: string, addressId: string): Promise<ActionResult> =>
  action(id, 'address', { addressId });
export const cancel = (id: string): Promise<ActionResult> => action(id, 'cancel');

export function monthlySpend(items: SubscriptionCard[]): number {
  return items
    .filter((s) => s.status === 'active')
    .reduce((sum, s) => {
      const factor = s.cycle === '2w' ? 2 : s.cycle === '2m' ? 0.5 : 1;
      return sum + s.pricePerCycle * s.quantity * factor;
    }, 0);
}

export function cycleLabel(cycle: string): string {
  if (cycle === '2w') return 'ทุก 2 สัปดาห์';
  if (cycle === '2m') return 'ทุก 2 เดือน';
  return 'ทุกเดือน';
}

export { daysUntil, formatThaiDate } from '@/lib/date';

/**
 * วันที่ระบบจะตั้งให้ถ้าผู้ใช้กดข้ามรอบ — ต้องได้ค่าเดียวกับที่ API จะเขียนจริง
 *
 * เดินบน "กริดของหมุด" เหมือน `SubscriptionsService.skip()` ทุกขั้น รวมถึงการ
 * หนีบกับวันนี้เมื่อรายการค้างมาจากรอบที่ engine ไม่ได้รัน — ถ้าคำนวณเป็นอย่างอื่น
 * กล่องยืนยันจะบอกวันหนึ่ง แต่ระบบเขียนอีกวันหนึ่ง
 */
export function skipTargetDate(item: SubscriptionCard): string | null {
  if (item.nextOrderDate == null) return null;
  const today = todayISO();
  const after = item.nextOrderDate > today ? item.nextOrderDate : today;
  return nextCycleAfter(item.cycleAnchorDate, item.cycle, after);
}

/** ข้อความที่ต้องบอกผู้ใช้ **ก่อน** กดยืนยัน (W05) */
export function previewSkip(item: SubscriptionCard): string {
  const to = skipTargetDate(item);
  if (item.nextOrderDate == null || to == null) return '';
  return `ข้ามรอบวันที่ ${formatThaiDate(item.nextOrderDate)} — รอบถัดไปจะเป็น ${formatThaiDate(to)}`;
}
