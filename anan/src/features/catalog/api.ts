/**
 * ชั้นข้อมูลของ catalog — คุยกับ API ของเราเอง (เดิมยิง PostgREST ตรง)
 *
 * ตัวเลข aggregate (จำนวนสมาชิก / คะแนนรีวิว) คำนวณฝั่ง API แล้วส่งมาพร้อมสินค้า
 * ทีเดียว — ของเดิมต้องยิง 3 request แล้วมา join กันเองในเครื่องผู้ใช้
 */

import { ApiError, apiFetch } from '@/lib/api/client';

export type Cycle = '2w' | '1m' | '2m';

export type Plan = {
  id: string;
  cycle: Cycle;
  pricePerCycle: number;
  qtyPerCycle: number;
  isActive: boolean;
};

export type ProductCardData = {
  id: string;
  name: string;
  shopName: string;
  /** ชื่อไอคอน Ionicons ของหมวด — ใช้เลือกสีประจำหมวดที่ทำหน้าที่แทนรูปสินค้า */
  categoryIcon: string | null;
  images: string[];
  oneTimePrice: number;
  netAmount: number | null;
  unit: string | null;
  plans: Plan[];
  activeSubscribers: number;
  rating: number | null;
  reviewCount: number;
};

export type Review = {
  id: string;
  rating: number;
  comment: string | null;
  cyclesReceived: number;
  reviewerName: string;
  createdAt: string;
};

export type ProductDetail = ProductCardData & {
  description: string | null;
  shopId: string;
  categoryId: number;
  reviews: Review[];
};

export type Category = { id: number; name: string; icon: string | null };

/** ส่งเป็น query param `sort` — ค่าตรงกับ `PRODUCT_SORT` ที่ API รองรับ (catalog.dto.ts) */
export type ProductSort = 'popular' | 'newest' | 'price_asc' | 'price_desc';

export type ShopPage = {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  createdAt: string;
  /** นับเฉพาะสินค้าที่ผู้ซื้อเห็นได้ */
  productCount: number;
  /** aggregate ล้วน — แทน "ผู้ติดตาม" ของ Shopee */
  activeSubscribers: number;
  rating: number | null;
  reviewCount: number;
  products: ProductCardData[];
};

/** การ์ดร้านในหน้าแรก / หน้าค้นหา — ทรงเดียวกับฟิลด์สถิติของ `ShopPage` */
export type ShopCardData = {
  id: string;
  name: string;
  logoUrl: string | null;
  description: string | null;
  productCount: number;
  activeSubscribers: number;
  rating: number | null;
  reviewCount: number;
  /** ISO string — "เข้าร่วมเมื่อ" */
  createdAt: string;
};

/**
 * `cycle` เป็น text + CHECK ที่ DB ไม่ใช่ enum — API จึงส่งมาเป็น string
 * ตรวจก่อนใช้ ไม่ใช่ cast: ถ้าวันหนึ่งมีแผน '3m' โผล่มา `cycleShort()` จะพิมพ์
 * รอบส่งผิดข้างราคาจริงโดยไม่มีใครรู้
 */
export function isCycle(value: string): value is Cycle {
  return value === '2w' || value === '1m' || value === '2m';
}

/** ตัดแผนที่รอบส่งไม่รู้จักทิ้ง ดีกว่าปล่อยให้แสดงผลผิด */
function keepKnownCycles<T extends { plans: { cycle: string }[] }>(product: T): T {
  return { ...product, plans: product.plans.filter((p) => isCycle(p.cycle)) };
}

export async function listCategories(): Promise<Category[]> {
  try {
    return await apiFetch<Category[]>('/catalog/categories');
  } catch {
    return [];
  }
}

export async function listProducts(opts: {
  categoryId?: number;
  /** กรองหลายหมวดพร้อมกัน (หน้าแรก) — ส่งเป็น `categories=1,4` ให้ API */
  categoryIds?: number[];
  search?: string;
  limit?: number;
  sort?: ProductSort;
}): Promise<ProductCardData[]> {
  const params = new URLSearchParams();
  if (opts.categoryIds != null && opts.categoryIds.length > 0) {
    params.set('categories', opts.categoryIds.join(','));
  } else if (opts.categoryId != null) {
    params.set('category', String(opts.categoryId));
  }
  if (opts.search != null && opts.search.trim().length > 0) {
    params.set('q', opts.search.trim());
  }
  if (opts.limit != null) params.set('limit', String(opts.limit));
  if (opts.sort != null) params.set('sort', opts.sort);

  const query = params.toString();
  try {
    const rows = await apiFetch<ProductCardData[]>(
      `/catalog/products${query ? `?${query}` : ''}`,
    );
    return rows.map(keepKnownCycles);
  } catch {
    return [];
  }
}

/** คืน [] เมื่อคำขอล้ม — ทรงเดียวกับ `listProducts()` */
export async function listShops(opts: { search?: string; limit?: number }): Promise<ShopCardData[]> {
  const params = new URLSearchParams();
  if (opts.search != null && opts.search.trim().length > 0) {
    params.set('q', opts.search.trim());
  }
  if (opts.limit != null) params.set('limit', String(opts.limit));

  const query = params.toString();
  try {
    return await apiFetch<ShopCardData[]>(`/catalog/shops${query ? `?${query}` : ''}`);
  } catch {
    return [];
  }
}

export async function getProduct(id: string): Promise<ProductDetail | null> {
  try {
    return keepKnownCycles(await apiFetch<ProductDetail>(`/catalog/products/${id}`));
  } catch {
    return null;
  }
}

/** หน้าร้านสาธารณะ — ร้านที่ถูกระงับ/ปิดเอง ตอบ 404 เหมือนไม่มีอยู่ */
export async function getShop(id: string): Promise<ShopPage | null> {
  try {
    const shop = await apiFetch<ShopPage>(`/catalog/shops/${id}`);
    return { ...shop, products: shop.products.map(keepKnownCycles) };
  } catch {
    return null;
  }
}

export type PlanLookup = {
  plan: Plan;
  product: { id: string; name: string; oneTimePrice: number; shopName: string };
};

/**
 * คืน `{ error }` เมื่อคำขอล้ม และ `null` เฉพาะตอนที่แผนนั้นไม่มีจริง ๆ
 * หน้า checkout ขึ้นข้อความคนละแบบสองกรณีนี้ — ถ้ารวมกันผู้ใช้จะเห็น
 * "ร้านปิดแผนนี้แล้ว" ทั้งที่ความจริงคือเน็ตหลุด
 */
export async function getPlan(
  planId: string,
): Promise<PlanLookup | { error: string } | null> {
  try {
    const data = await apiFetch<PlanLookup>(`/catalog/plans/${planId}`);
    return isCycle(data.plan.cycle) ? data : null;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    return { error: 'โหลดข้อมูลแผนไม่สำเร็จ กรุณาลองใหม่' };
  }
}

/* ---------------- pricing (แหล่งความจริงเดียว — features 02/03/04/11) ---------------- */

/** ถูกกว่าซื้อครั้งเดียวในจำนวนเท่ากันกี่ % */
export function discountPercent(plan: Plan, oneTimePrice: number): number {
  const outright = oneTimePrice * plan.qtyPerCycle;
  if (outright <= 0) return 0;
  const saved = 1 - plan.pricePerCycle / outright;
  return saved <= 0 ? 0 : Math.round(saved * 100);
}

export function cheapestPlan(plans: Plan[]): Plan | null {
  if (plans.length === 0) return null;
  return plans.reduce((best, p) => (p.pricePerCycle < best.pricePerCycle ? p : best));
}

export function bestDiscountPlan(plans: Plan[], oneTimePrice: number): Plan | null {
  if (plans.length === 0) return null;
  return plans.reduce((best, p) =>
    discountPercent(p, oneTimePrice) > discountPercent(best, oneTimePrice) ? p : best,
  );
}

/** ฿ ต่อกรัม/มล./ชิ้น — ตัวเลขที่ทำให้เทียบข้ามยี่ห้อได้อย่างซื่อสัตย์ */
export function pricePerUnit(plan: Plan, netAmount: number | null): number | null {
  if (netAmount == null || netAmount <= 0) return null;
  return plan.pricePerCycle / plan.qtyPerCycle / netAmount;
}

export function cycleLabel(cycle: string): string {
  if (cycle === '2w') return 'ทุก 2 สัปดาห์';
  if (cycle === '2m') return 'ทุก 2 เดือน';
  return 'ทุกเดือน';
}

export function cycleShort(cycle: string): string {
  if (cycle === '2w') return '/ 2 สัปดาห์';
  if (cycle === '2m') return '/ 2 เดือน';
  return '/ เดือน';
}

export function baht(n: number): string {
  return `฿${n.toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;
}
