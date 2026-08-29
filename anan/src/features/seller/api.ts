/**
 * ชั้นข้อมูลฝั่งร้านค้า (features 10/11/12)
 *
 * ★ ที่นี่ไม่มีการตัดสินใจเรื่องสิทธิ์เลย ★ ทุก endpoint กรองด้วย "ร้านของ token นี้"
 * ที่ API — หน้าจอไม่เคยส่ง `shopId` ขึ้นไป และไม่มีทางขอข้อมูลร้านอื่นได้
 * ตัวเลข dashboard/forecast เป็น aggregate ที่คำนวณฝั่ง API ไม่ใช่การดึงแถว
 * subscription ของผู้ซื้อมานับเอง (CLAUDE.md ข้อ 7)
 */

import { ApiError, apiFetch } from '@/lib/api/client';

export type Shop = {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  isActive: boolean;
  isSuspended: boolean;
  createdAt: string;
};

export type Dashboard = {
  shop: Shop;
  activeSubscribers: number;
  monthlyRevenue: number;
  cancelledThisMonth: number;
  activeProducts: number;
  pendingOrders: number;
  recentEvents: { event: string; productName: string; at: string }[];
};

export type SellerPlan = {
  id: string;
  cycle: string;
  pricePerCycle: number;
  qtyPerCycle: number;
  isActive: boolean;
  activeSubscribers: number;
  /** คนที่จะได้รับแจ้งเตือนถ้าแก้ราคา = active + paused (คนที่หยุดไว้กลับมาก็เจอราคาใหม่) */
  affectedSubscribers: number;
};

export type SellerProduct = {
  id: string;
  name: string;
  description: string | null;
  categoryId: number;
  images: string[];
  oneTimePrice: number;
  netAmount: number | null;
  unit: string | null;
  isActive: boolean;
  isSuspended: boolean;
  activeSubscribers: number;
  plans: SellerPlan[];
  createdAt: string;
};

export type SellerOrder = {
  id: string;
  cycleDate: string;
  status: 'pending' | 'preparing' | 'shipped' | 'delivered' | 'cancelled';
  amount: number;
  quantity: number;
  trackingNote: string | null;
  productId: string;
  productName: string;
  productImage: string | null;
  cycle: string;
  recipient: {
    name: string;
    phone: string;
    addressLine: string;
    province: string;
    postcode: string;
  };
  subscriptionCancelled: boolean;
  createdAt: string;
};

export type SellerIssue = {
  id: string;
  orderId: string;
  type: string;
  detail: string;
  status: 'open' | 'resolved' | 'rejected';
  resolutionNote: string | null;
  recipientName: string;
  productName: string;
  cycleDate: string;
  /** เคสเปิดค้างมากี่วัน — >3 วันหน้าจอไฮไลต์ (feature 16) */
  ageDays: number;
  createdAt: string;
  resolvedAt: string | null;
};

export type Forecast = {
  days: number;
  approximate: boolean;
  items: {
    productId: string;
    productName: string;
    ordersCount: number;
    units: number;
    revenue: number;
  }[];
};

export type Result<T> = { data: T; error: null } | { data: null; error: string };

/** แปลง error เป็นข้อความไทยจาก API ตรง ๆ — ฝั่งนี้ไม่รู้กติกาจริงจึงไม่แต่งข้อความเอง */
async function call<T>(
  path: string,
  init?: { method: 'POST' | 'PATCH'; body?: unknown },
  fallback = 'ทำรายการไม่สำเร็จ กรุณาลองใหม่',
): Promise<Result<T>> {
  try {
    const data = await apiFetch<T>(path, {
      method: init?.method ?? 'GET',
      ...(init?.body === undefined ? {} : { body: init.body }),
    });
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e instanceof ApiError ? e.message : fallback };
  }
}

/* ---------------- ร้านค้า (feature 10) ---------------- */

export type OpenShopInput = {
  name: string;
  description?: string;
  logoUrl?: string;
};

export const openShop = (input: OpenShopInput): Promise<Result<Shop>> =>
  call<Shop>('/seller/shop', { method: 'POST', body: input }, 'เปิดร้านไม่สำเร็จ');

export const getMyShop = (): Promise<Result<Shop>> => call<Shop>('/seller/shop');

export const updateShop = (
  input: Partial<Pick<Shop, 'name' | 'description' | 'logoUrl' | 'isActive'>>,
): Promise<Result<Shop>> =>
  call<Shop>('/seller/shop', { method: 'PATCH', body: input });

export const getDashboard = (): Promise<Result<Dashboard>> =>
  call<Dashboard>('/seller/dashboard');

/* ---------------- สินค้า + แผน (feature 11) ---------------- */

export type NewProductInput = {
  name: string;
  categoryId: number;
  description?: string;
  images: string[];
  oneTimePrice: number;
  netAmount?: number;
  unit?: string;
  plans: { cycle: string; pricePerCycle: number; qtyPerCycle: number }[];
};

export const listMyProducts = (): Promise<Result<SellerProduct[]>> =>
  call<SellerProduct[]>('/seller/products');

export const createProduct = (
  input: NewProductInput,
): Promise<Result<SellerProduct>> =>
  call<SellerProduct>('/seller/products', { method: 'POST', body: input }, 'ลงขายไม่สำเร็จ');

export const updateProduct = (
  id: string,
  input: Partial<NewProductInput> & { isActive?: boolean },
): Promise<Result<SellerProduct>> =>
  call<SellerProduct>(`/seller/products/${id}`, { method: 'PATCH', body: input });

export const addPlan = (
  productId: string,
  input: { cycle: string; pricePerCycle: number; qtyPerCycle: number },
): Promise<Result<SellerProduct>> =>
  call<SellerProduct>(`/seller/products/${productId}/plans`, {
    method: 'POST',
    body: input,
  });

export const updatePlan = (
  planId: string,
  input: { pricePerCycle?: number; qtyPerCycle?: number; isActive?: boolean },
): Promise<Result<SellerProduct>> =>
  call<SellerProduct>(`/seller/plans/${planId}`, { method: 'PATCH', body: input });

/* ---------------- ออเดอร์ + forecast (feature 12) ---------------- */

export type OrderTab = 'open' | 'shipped' | 'history';

export const listOrders = (tab: OrderTab): Promise<Result<SellerOrder[]>> =>
  call<SellerOrder[]>(`/seller/orders?tab=${tab}`);

/**
 * เลื่อนสถานะ — ไม่ส่งสถานะเป้าหมายขึ้นไป
 * server เป็นคนบอกว่าขั้นถัดไปคืออะไร ลำดับจึงข้ามไม่ได้แม้แก้โค้ดฝั่งแอป
 */
export const advanceOrder = (
  id: string,
  trackingNote?: string,
): Promise<Result<SellerOrder>> =>
  call<SellerOrder>(`/seller/orders/${id}/advance`, {
    method: 'POST',
    body: trackingNote === undefined ? {} : { trackingNote },
  });

export const getForecast = (days: number): Promise<Result<Forecast>> =>
  call<Forecast>(`/seller/forecast?days=${days}`);

/* ---------------- ยกเลิกออเดอร์ + เคสปัญหา (features 15/16) ---------------- */

/**
 * ยกเลิกออเดอร์ที่ส่งไม่ได้ — ยอดคืนเงินไม่ได้ส่งขึ้นไป
 *
 * API คืนเงินตามยอดที่บันทึกไว้ในออเดอร์เอง (CLAUDE.md ข้อ 7 — เงินห้ามมาจาก client)
 * และ subscription ของผู้ซื้อไม่ถูกแตะ รอบถัดไปยังเดินตามปกติ (feature 15)
 */
export const cancelOrder = (
  id: string,
  reason: string,
): Promise<Result<SellerOrder>> =>
  call<SellerOrder>(`/seller/orders/${id}/cancel`, {
    method: 'POST',
    body: { reason },
  });

export const listIssues = (
  status: 'open' | 'closed',
): Promise<Result<SellerIssue[]>> =>
  call<SellerIssue[]>(`/seller/issues?status=${status}`);

export const resolveIssue = (
  id: string,
  input: { status: 'resolved' | 'rejected'; note: string },
): Promise<Result<SellerIssue>> =>
  call<SellerIssue>(`/seller/issues/${id}/resolve`, {
    method: 'POST',
    body: input,
  });

/* ---------------- ข้อความบนหน้าจอ ---------------- */

const STATUS_LABEL: Record<SellerOrder['status'], string> = {
  pending: 'รอจัดของ',
  preparing: 'กำลังจัดของ',
  shipped: 'ส่งแล้ว',
  delivered: 'ถึงมือผู้ซื้อ',
  cancelled: 'ยกเลิก',
};

export const orderStatusLabel = (status: SellerOrder['status']): string =>
  STATUS_LABEL[status];

/** ปุ่มเดียวบนการ์ด — ข้อความต้องบอกว่ากดแล้วจะเกิดอะไร ไม่ใช่ชื่อสถานะปัจจุบัน */
export function nextActionLabel(status: SellerOrder['status']): string | null {
  if (status === 'pending') return 'เริ่มจัดของ';
  if (status === 'preparing') return 'ส่งแล้ว';
  if (status === 'shipped') return 'จัดส่งสำเร็จ';
  return null;
}

export const issueTypeLabel = (type: string): string => {
  if (type === 'not_received') return 'ของไม่ถึง';
  if (type === 'wrong_item') return 'ได้ของผิด';
  if (type === 'damaged') return 'ของเสียหาย';
  return 'อื่น ๆ';
};

export const eventLabel = (event: string): string => {
  if (event === 'created') return 'มีผู้สมัครใหม่';
  if (event === 'cancelled') return 'ยกเลิกการสมัคร';
  if (event === 'paused') return 'หยุดชั่วคราว';
  if (event === 'resumed') return 'กลับมาใช้งาน';
  return event;
};

/** ส่วนลดเทียบราคาซื้อครั้งเดียว — สูตรเดียวกับฝั่งผู้ซื้อ (features 02/03/11) */
export function discountPercent(
  pricePerCycle: number,
  qtyPerCycle: number,
  oneTimePrice: number,
): number {
  const outright = oneTimePrice * qtyPerCycle;
  if (outright <= 0) return 0;
  const saved = 1 - pricePerCycle / outright;
  return saved <= 0 ? 0 : Math.round(saved * 100);
}
