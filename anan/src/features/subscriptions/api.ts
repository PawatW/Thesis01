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

/** ตรงกับ enum `subscription_cancel_reason` ของ API (Phase 8.3) */
export type CancelReason =
  | 'too_expensive'
  | 'too_much_stock'
  | 'taking_break'
  | 'quality'
  | 'switching'
  | 'other';

/** action ที่กดจาก "ข้อเสนอแทนการยกเลิก" — API เก็บไว้วัด save rate */
export type RetentionSource = 'cancel_flow';

export type SubscriptionCard = {
  id: string;
  status: 'active' | 'paused' | 'cancelled';
  pausedReason: string | null;
  /** หยุดพัก N รอบ — วันรอบแรกที่จะกลับมาส่ง · null = ไม่มีกำหนด/ไม่ได้หยุด */
  resumeOn: string | null;
  /** เหตุผลที่ยกเลิก — null ถ้ายังไม่ยกเลิก (หรือยกเลิกก่อนมีฟีเจอร์นี้) */
  cancelReason: CancelReason | null;
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

const withSource = (source?: RetentionSource): Record<string, unknown> =>
  source === undefined ? {} : { source };

export const skipCycle = (id: string, source?: RetentionSource): Promise<ActionResult> =>
  action(id, 'skip', withSource(source));
/** `cycles` ไม่ส่ง = หยุดไม่มีกำหนด · 1-3 = หยุดพักแล้วระบบเปิดคืนเอง */
export const pause = (
  id: string,
  opts: { cycles?: 1 | 2 | 3; source?: RetentionSource } = {},
): Promise<ActionResult> =>
  action(id, 'pause', {
    ...(opts.cycles === undefined ? {} : { cycles: opts.cycles }),
    ...withSource(opts.source),
  });
export const resume = (id: string): Promise<ActionResult> => action(id, 'resume');
export const reschedule = (id: string, date: string): Promise<ActionResult> =>
  action(id, 'reschedule', { date });
export const changePlan = (
  id: string,
  planId: string,
  source?: RetentionSource,
): Promise<ActionResult> => action(id, 'plan', { planId, ...withSource(source) });
export const changeAddress = (id: string, addressId: string): Promise<ActionResult> =>
  action(id, 'address', { addressId });
/** เหตุผลบังคับ (API ตอบ 400 ถ้าไม่ส่ง) · note ไม่ถูกส่งต่อให้ร้าน */
export const cancel = (id: string, reason: CancelReason, note?: string): Promise<ActionResult> =>
  action(id, 'cancel', { reason, ...(note != null && note.trim() !== '' ? { note: note.trim() } : {}) });
export const changeQuantity = (id: string, quantity: number): Promise<ActionResult> =>
  action(id, 'quantity', { quantity });
/** ไม่ส่งยอดเงิน — API คิดจากราคาแผนใน DB เอง */
export const shipNow = (id: string): Promise<ActionResult> => action(id, 'ship-now');

/** หนึ่งรอบที่จะถูกตัดเงินจริงในเดือนปฏิทินนี้ */
export type MonthCharge = {
  subscriptionId: string;
  productName: string;
  shopName: string;
  /** วันที่ engine จะสร้างออเดอร์ (Asia/Bangkok) */
  date: string;
  /** ยอดที่จะถูกตัดของรอบนั้น — รอบถัดไปหักคูปองที่จองไว้แล้ว */
  amount: number;
  /** ยอดเต็มก่อนหักคูปอง — เท่ากับ `amount` เมื่อไม่ได้จองคูปองไว้ */
  grossAmount: number;
  /** true เฉพาะรอบถัดไปที่มีคูปองจองไว้ (คูปองจองได้ทีละรอบเท่านั้น) */
  hasCoupon: boolean;
  /** รอบนี้ค้างมาจากอดีต — engine จะเก็บตกให้ในวันที่รันครั้งถัดไป */
  overdue: boolean;
};

/**
 * ทุกรอบที่จะถูกตัดเงิน **จริง** ภายในเดือนปฏิทินปัจจุบัน เรียงตามวัน
 *
 * ต่างจากการเฉลี่ยแบบเดิม (2w ×2 · 2m ×0.5) ที่นับรายการซึ่งยังไม่ถึงรอบในเดือนนี้
 * เข้ามาด้วย — ตัวเลขนั้นตอบว่า "โดยเฉลี่ยเดือนละเท่าไหร่" ไม่ใช่ "เดือนนี้จะโดนตัด
 * เท่าไหร่" ซึ่งเป็นคำถามที่ผู้ใช้ถามจริงเมื่อเห็นการ์ดนี้
 *
 * กติกาที่ต้องตรงกับ engine (W06):
 * - เดินบน "กริดของหมุด" ด้วย `nextCycleAfter` เหมือน `skipTargetDate` — รอบ 2 สัปดาห์
 *   จึงตกในเดือนเดียวกัน 2 หรือ 3 ครั้งตามปฏิทินจริง ไม่ใช่ ×2 ตายตัว
 * - รายการที่ค้าง (`next_order_date < วันนี้` เพราะ engine ยังไม่ได้รัน) ถูกหนีบมาเป็น
 *   วันนี้ เพราะเงื่อนไขของ engine คือ `<=` ไม่ใช่ `=` — มันจะเก็บตกให้ ไม่ใช่ข้ามไป
 * - นับเฉพาะ `active` · `paused` ไม่ถูกตัดเงินจนกว่าจะกดกลับมาใช้งาน
 * - คูปองจองได้เฉพาะ "รอบถัดไป" รอบเดียว รอบที่เหลือในเดือนเดียวกันจึงเป็นราคาเต็ม
 */
export function monthCharges(items: SubscriptionCard[], todayIso = todayISO()): MonthCharge[] {
  const monthPrefix = todayIso.slice(0, 7);
  const charges: MonthCharge[] = [];

  for (const s of items) {
    if (s.status !== 'active' || s.nextOrderDate == null) continue;

    const gross = s.pricePerCycle * s.quantity;
    // เก็บตกรอบที่ค้าง: engine ใช้ `<= วันนี้` จึงตัดให้ในวันที่รันครั้งถัดไป
    const overdue = s.nextOrderDate < todayIso;
    let date = overdue ? todayIso : s.nextOrderDate;
    let first = true;

    // ปีละ 26 รอบเป็นเพดานของรอบถี่สุด (2w) — กันลูปไม่รู้จบถ้าข้อมูลเพี้ยน
    for (let guard = 0; guard < 26 && date.slice(0, 7) === monthPrefix; guard++) {
      charges.push({
        subscriptionId: s.id,
        productName: s.productName,
        shopName: s.shopName,
        date,
        amount: first ? s.couponNetAmount : gross,
        grossAmount: gross,
        hasCoupon: first && s.couponDiscount > 0,
        overdue: first && overdue,
      });
      first = false;
      date = nextCycleAfter(s.cycleAnchorDate, s.cycle, date);
    }
  }

  return charges.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
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

/**
 * วันที่จะกลับมาส่งถ้าหยุดพัก `n` รอบ — กติกาเดียวกับ `skipFrom()` ของ API
 * (กด skip `n` ครั้งติดกัน) จึง "หยุด 1 รอบ" ได้วันเดียวกับ "ข้ามรอบ" เสมอ
 */
export function resumeDateAfter(item: SubscriptionCard, n: number): string | null {
  if (item.nextOrderDate == null) return null;
  const today = todayISO();
  let d = item.nextOrderDate;
  for (let i = 0; i < n; i++) {
    d = nextCycleAfter(item.cycleAnchorDate, item.cycle, d > today ? d : today);
  }
  return d;
}

/** ข้อความที่ต้องบอกผู้ใช้ **ก่อน** กดยืนยัน (W05) */
export function previewSkip(item: SubscriptionCard): string {
  const to = skipTargetDate(item);
  if (item.nextOrderDate == null || to == null) return '';
  return `ข้ามรอบวันที่ ${formatThaiDate(item.nextOrderDate)} — รอบถัดไปจะเป็น ${formatThaiDate(to)}`;
}
