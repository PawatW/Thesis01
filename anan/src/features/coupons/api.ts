/**
 * ชั้นข้อมูลของคูปองรายรอบ 2 ระดับ (feature 18 · W13)
 *
 * ★ ไม่มีการคำนวณยอดส่วนลดในไฟล์นี้เลย ★ ทุกตัวเลขมาจาก API — ถ้าคำนวณฝั่งนี้
 * ด้วย หน้าจอจะโชว์เลขหนึ่งแต่ถูกตัดอีกเลขหนึ่งทันทีที่สูตรสองฝั่งเริ่มไม่ตรงกัน
 * โดยเฉพาะกฎ "หนีบเมื่อรวมเกินยอด" ตอนซ้อน 2 ใบ ซึ่งอยู่ใน `combineDiscounts()`
 * ฝั่ง API ที่เดียว (และเลขฝั่งนี้ผู้ใช้แก้เองได้ จึงใช้ตัดสินอะไรไม่ได้อยู่แล้ว)
 */

import { ApiError, apiFetch } from '@/lib/api/client';

export type CouponDiscountType = 'percent' | 'fixed';
export type CouponState = 'scheduled' | 'running' | 'expired' | 'disabled';

/** ระดับของคูปอง — `platform` ผู้ดูแลออก · `shop` ร้านออกเอง */
export type CouponTier = 'platform' | 'shop';

/** สินค้าชิ้นนี้เปิดรับคูปองระดับไหนบ้าง — ร้านตั้งเองรายสินค้า */
export type CouponPolicy = 'both' | 'platform_only' | 'shop_only' | 'none';

export const TIER_LABEL: Record<CouponTier, string> = {
  platform: 'คูปองแพลตฟอร์ม',
  shop: 'คูปองร้านค้า',
};

export const POLICY_LABEL: Record<CouponPolicy, string> = {
  both: 'รับทั้งสองระดับ (ซ้อนกันได้)',
  platform_only: 'เฉพาะคูปองแพลตฟอร์ม',
  shop_only: 'เฉพาะคูปองของร้าน',
  none: 'ไม่ร่วมรายการคูปอง',
};

/** คูปอง 1 ใบในหน้าคอนโซล (ใช้ร่วมกันทั้งฝั่งผู้ดูแลและฝั่งร้าน) */
export type AdminCoupon = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  tier: CouponTier;
  /** ชื่อร้านเจ้าของ — null เมื่อเป็นคูปองของแพลตฟอร์ม */
  shopName: string | null;
  discountType: CouponDiscountType;
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number | null;
  /** ป้ายพร้อมแสดง เช่น "ลด 20% (สูงสุด ฿50.00)" — ประกอบที่ server ที่เดียว */
  label: string;
  startsAt: string;
  endsAt: string;
  maxRedemptions: number | null;
  maxPerUser: number;
  isActive: boolean;
  state: CouponState;
  appliesToAllProducts: boolean;
  inUseCount: number;
  reservedCount: number;
  consumedCount: number;
  releasedCount: number;
  productCount: number;
  createdAt: string;
};

/** คูปองของร้าน — เพิ่มรายการสินค้าที่ครอบอยู่ */
export type ShopCoupon = AdminCoupon & { productIds: string[] };

export type CreateCouponInput = {
  code: string;
  title: string;
  description?: string;
  discountType: CouponDiscountType;
  discountValue: number;
  maxDiscountAmount?: number;
  minOrderAmount?: number;
  startsAt: string;
  endsAt: string;
  maxRedemptions?: number;
};

/** คูปองของร้าน — เพิ่มขอบเขต (ทั้งร้าน หรือเลือกสินค้าเอง) */
export type CreateShopCouponInput = CreateCouponInput & {
  appliesToAllProducts: boolean;
  productIds?: string[];
};

/** คูปอง 1 ใบในมุมของ "สินค้าชิ้นนี้เข้าร่วมไหม" */
export type SellerCoupon = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  label: string;
  tier: CouponTier;
  minOrderAmount: number | null;
  startsAt: string;
  endsAt: string;
  enabled: boolean;
  /** ครอบอยู่แล้วโดยไม่ต้องติ๊ก (คูปองของร้านที่ตั้งเป็น "ทั้งร้าน") */
  coveredByAllProducts: boolean;
  maxDiscountPerCycle: number | null;
};

export type ProductCoupons = {
  couponPolicy: CouponPolicy;
  platform: SellerCoupon[];
  shop: SellerCoupon[];
};

/** คูปอง 1 ใบในรายการที่ผู้ซื้อเลือก — ใบที่ใช้ไม่ได้ก็ส่งมาพร้อมเหตุผล */
export type AvailableCoupon = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  label: string;
  tier: CouponTier;
  endsAt: string;
  usable: boolean;
  discountAmount: number | null;
  blockedReason: string | null;
};

export type AppliedCoupon = {
  redemptionId: string;
  couponId: string;
  code: string;
  title: string;
  label: string;
  tier: CouponTier;
  cycleDate: string;
  discountAmount: number;
};

/** สถานะของคูปอง 1 ระดับ */
export type CouponTierView = {
  /** สินค้าชิ้นนี้เปิดรับระดับนี้ไหม (มาจากนโยบายที่ร้านตั้ง) */
  allowed: boolean;
  blockedReason: string | null;
  applied: AppliedCoupon | null;
  available: AvailableCoupon[];
};

/** สรุปคูปองของรอบถัดไปของ subscription หนึ่ง */
export type SubscriptionCoupons = {
  cycleDate: string | null;
  grossAmount: number;
  /** ส่วนลดรวมของทั้งสองระดับ (หนีบไม่ให้เกินยอดแล้ว) — มาจาก API เท่านั้น */
  discountAmount: number;
  netAmount: number;
  canApply: boolean;
  blockedReason: string | null;
  platform: CouponTierView;
  shop: CouponTierView;
};

export type Result<T> = { data: T; error: null } | { data: null; error: string };

async function call<T>(
  path: string,
  init?: { method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown },
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
      error:
        e instanceof ApiError ? e.message : 'ทำรายการไม่สำเร็จ กรุณาลองใหม่',
    };
  }
}

/* ---------------- admin ---------------- */

export const listAdminCoupons = (
  status: 'all' | 'active' | 'inactive',
  tier?: CouponTier,
): Promise<Result<AdminCoupon[]>> =>
  call<AdminCoupon[]>(
    `/admin/coupons?status=${status}${tier === undefined ? '' : `&tier=${tier}`}`,
  );

export const createCoupon = (
  input: CreateCouponInput,
): Promise<Result<AdminCoupon>> =>
  call<AdminCoupon>('/admin/coupons', { method: 'POST', body: input });

/** แก้ได้เฉพาะ 4 ช่องนี้ — ชนิดกับมูลค่าแก้ไม่ได้ ต้องปิดใบเดิมแล้วออกใบใหม่ */
export const updateCoupon = (
  id: string,
  input: {
    title?: string;
    description?: string | null;
    endsAt?: string;
    maxRedemptions?: number | null;
  },
): Promise<Result<AdminCoupon>> =>
  call<AdminCoupon>(`/admin/coupons/${id}`, { method: 'PATCH', body: input });

/** ไม่มีปุ่มลบทั้งฝั่งนี้และฝั่ง API — ใบที่ถูกใช้แล้วต้องอ้างอิงกลับได้ตลอด */
export const deactivateCoupon = (id: string): Promise<Result<AdminCoupon>> =>
  call<AdminCoupon>(`/admin/coupons/${id}/deactivate`, { method: 'POST' });

/* ---------------- seller: คูปองของร้าน ---------------- */

export const listShopCoupons = (): Promise<Result<ShopCoupon[]>> =>
  call<ShopCoupon[]>('/seller/coupons');

export const createShopCoupon = (
  input: CreateShopCouponInput,
): Promise<Result<ShopCoupon>> =>
  call<ShopCoupon>('/seller/coupons', { method: 'POST', body: input });

export const updateShopCoupon = (
  id: string,
  input: { title?: string; endsAt?: string; maxRedemptions?: number | null },
): Promise<Result<ShopCoupon>> =>
  call<ShopCoupon>(`/seller/coupons/${id}`, { method: 'PATCH', body: input });

export const deactivateShopCoupon = (
  id: string,
): Promise<Result<ShopCoupon>> =>
  call<ShopCoupon>(`/seller/coupons/${id}/deactivate`, { method: 'POST' });

/* ---------------- seller: คูปอง + นโยบายของสินค้า ---------------- */

export const listProductCoupons = (
  productId: string,
): Promise<Result<ProductCoupons>> =>
  call<ProductCoupons>(`/seller/products/${productId}/coupons`);

/** ส่งค่าทั้งชุดเสมอ (PUT) — "ติ๊กออกทุกใบ" กับ "ไม่ได้แตะ" ต้องแยกกันออก */
export const setProductCoupons = (
  productId: string,
  input: { couponIds: string[]; couponPolicy: CouponPolicy },
): Promise<Result<ProductCoupons>> =>
  call<ProductCoupons>(`/seller/products/${productId}/coupons`, {
    method: 'PUT',
    body: input,
  });

/* ---------------- buyer ---------------- */

export const getSubscriptionCoupons = (
  subscriptionId: string,
): Promise<Result<SubscriptionCoupons>> =>
  call<SubscriptionCoupons>(`/subscriptions/${subscriptionId}/coupons`);

/** body มีแค่ `couponId` — ระดับมาจากตัวคูปอง และยอดคำนวณที่ server เสมอ */
export const applyCoupon = (
  subscriptionId: string,
  couponId: string,
): Promise<Result<SubscriptionCoupons>> =>
  call<SubscriptionCoupons>(`/subscriptions/${subscriptionId}/coupon`, {
    method: 'POST',
    body: { couponId },
  });

/** ถอนเฉพาะระดับที่ระบุ — อีกระดับที่จองไว้ยังอยู่ */
export const removeCoupon = (
  subscriptionId: string,
  tier: CouponTier,
): Promise<Result<SubscriptionCoupons>> =>
  call<SubscriptionCoupons>(
    `/subscriptions/${subscriptionId}/coupon/${tier}`,
    { method: 'DELETE' },
  );

/** คูปองที่ใช้ได้กับแผนหนึ่งตอน checkout (รอบแรก) — คืนมาทั้งสองระดับปนกัน */
export const listPlanCoupons = (
  planId: string,
  quantity: number,
): Promise<Result<AvailableCoupon[]>> =>
  call<AvailableCoupon[]>(
    `/catalog/plans/${planId}/coupons?quantity=${quantity}`,
  );
