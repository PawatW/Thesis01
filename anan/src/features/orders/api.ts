/**
 * ชั้นข้อมูลของออเดอร์ฝั่งผู้ซื้อ + รีวิว (features 07 · 15 · 16 · 17)
 *
 * ★ `confirmedAt` เขียนได้จาก endpoint ของผู้ซื้อเท่านั้น ★ ไม่มี API ไหนให้ร้าน
 * ตั้งค่านี้ — นั่นคือเหตุผลทั้งหมดที่ปุ่ม "ได้รับแล้ว" มีความหมาย (feature 16)
 */

import { ApiError, apiFetch } from '@/lib/api/client';

export type OrderStatus =
  | 'pending'
  | 'preparing'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export type OrderIssue = {
  id: string;
  type: string;
  detail: string;
  status: 'open' | 'resolved' | 'rejected';
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type BuyerOrder = {
  id: string;
  cycleDate: string;
  status: OrderStatus;
  /** ยอดที่ตัดจริง (หลังหักคูปองแล้ว) */
  amount: number;
  /** ส่วนลดรวมของรอบนี้ — 0 เมื่อไม่ได้ใช้คูปอง (feature 18) */
  discountAmount: number;
  /** คูปองที่ใช้กับรอบนี้ แยกรายใบ — ซ้อนได้สูงสุด 2 ใบ (แพลตฟอร์ม + ร้าน) */
  coupons: { tier: 'platform' | 'shop'; code: string; discountAmount: number }[];
  quantity: number;
  trackingNote: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  paymentStatus: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  /** เลขที่ใบเสร็จจำลอง — null แปลว่ารอบนี้ยังไม่เคยจ่ายสำเร็จ */
  receiptNo: string | null;
  subscriptionId: string;
  subscriptionStatus: string;
  productId: string;
  productName: string;
  productImage: string | null;
  shopName: string;
  cycle: string;
  shipTo: {
    name: string;
    phone: string;
    addressLine: string;
    province: string;
    postcode: string;
  };
  issue: OrderIssue | null;
  createdAt: string;
};

export type Review = {
  id: string;
  rating: number;
  comment: string | null;
  cyclesReceived: number;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
};

export type Result<T> = { data: T; error: null } | { data: null; error: string };

async function call<T>(
  path: string,
  init?: { method: 'POST'; body?: unknown },
): Promise<Result<T>> {
  try {
    const data = await apiFetch<T>(path, {
      method: init?.method ?? 'GET',
      ...(init?.body === undefined ? {} : { body: init.body }),
    });
    return { data, error: null };
  } catch (e) {
    return {
      data: null,
      error: e instanceof ApiError ? e.message : 'ทำรายการไม่สำเร็จ กรุณาลองใหม่',
    };
  }
}

export const listOrders = (tab: 'open' | 'done'): Promise<Result<BuyerOrder[]>> =>
  call<BuyerOrder[]>(`/orders?tab=${tab}`);

export const getOrder = (id: string): Promise<Result<BuyerOrder>> =>
  call<BuyerOrder>(`/orders/${id}`);

/** กดซ้ำได้ไม่พัง — API เป็น idempotent (W11 E3) */
export const confirmReceipt = (id: string): Promise<Result<BuyerOrder>> =>
  call<BuyerOrder>(`/orders/${id}/confirm`, { method: 'POST' });

/**
 * จ่ายเงินรอบนี้อีกครั้งหลังบัตรถูกปฏิเสธ (feature 09 เฟส 5)
 *
 * ไม่ส่งยอดหรือบัตรขึ้นไป — API อ่านจากออเดอร์เอง (เงินห้ามมาจาก client)
 */
export const retryPayment = (id: string): Promise<Result<BuyerOrder>> =>
  call<BuyerOrder>(`/orders/${id}/retry-payment`, { method: 'POST' });

export const reportIssue = (
  id: string,
  input: { type: string; detail: string },
): Promise<Result<BuyerOrder>> =>
  call<BuyerOrder>(`/orders/${id}/issues`, { method: 'POST', body: input });

export const getMyReview = (
  subscriptionId: string,
): Promise<Result<Review | null>> =>
  call<Review | null>(`/subscriptions/${subscriptionId}/review`);

/** เขียนหรือแก้ก็เส้นเดียวกัน — รีวิวที่ 2 บนรายการเดิมคือการแก้ */
export const upsertReview = (
  subscriptionId: string,
  input: { rating: number; comment?: string },
): Promise<Result<Review>> =>
  call<Review>(`/subscriptions/${subscriptionId}/review`, {
    method: 'POST',
    body: input,
  });

/* ---------------- ข้อความบนหน้าจอ ---------------- */

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'รอร้านจัดของ',
  preparing: 'ร้านกำลังจัดของ',
  shipped: 'อยู่ระหว่างจัดส่ง',
  delivered: 'ส่งถึงแล้ว',
  cancelled: 'ยกเลิกโดยร้าน',
};

export const orderStatusLabel = (status: OrderStatus): string =>
  STATUS_LABEL[status];

/** 4 ขั้นของ stepper — `cancelled` เป็นทางออกข้างทาง ไม่ใช่ขั้นหนึ่งในนี้ */
export const ORDER_STEPS: { key: OrderStatus; label: string }[] = [
  { key: 'pending', label: 'รับออเดอร์' },
  { key: 'preparing', label: 'จัดของ' },
  { key: 'shipped', label: 'ส่งแล้ว' },
  { key: 'delivered', label: 'ถึงมือ' },
];

export const stepIndex = (status: OrderStatus): number =>
  ORDER_STEPS.findIndex((s) => s.key === status);

/** สีของป้ายสถานะ — `cancelled` ต้องอ่านออกทันทีว่า "ไม่ได้ของ" ไม่ใช่แค่จบรอบ */
export function orderStatusTone(
  status: OrderStatus,
): 'active' | 'paused' | 'sale' | 'neutral' {
  if (status === 'delivered') return 'active';
  if (status === 'cancelled') return 'sale';
  if (status === 'shipped') return 'neutral';
  return 'paused';
}

export const ISSUE_TYPES: { value: string; label: string }[] = [
  { value: 'not_received', label: 'ของไม่ถึง' },
  { value: 'wrong_item', label: 'ได้ของผิด' },
  { value: 'damaged', label: 'ของเสียหาย' },
  { value: 'other', label: 'อื่น ๆ' },
];

export const issueTypeLabel = (type: string): string =>
  ISSUE_TYPES.find((t) => t.value === type)?.label ?? type;

export const issueStatusLabel = (status: OrderIssue['status']): string => {
  if (status === 'resolved') return 'ร้านแก้ไขให้แล้ว';
  if (status === 'rejected') return 'ร้านปฏิเสธเคสนี้';
  return 'รอร้านตอบกลับ';
};
