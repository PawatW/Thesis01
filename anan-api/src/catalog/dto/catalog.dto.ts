import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const PRODUCT_SORT = [
  'popular',
  'price_asc',
  'price_desc',
  'newest',
] as const;
export type ProductSort = (typeof PRODUCT_SORT)[number];

export class ListProductsQuery {
  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  category?: number;

  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim().slice(0, 60) : value,
  )
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(PRODUCT_SORT)
  sort?: ProductSort;

  // เพดานตายตัว: ไม่ให้ client ขอทั้งตารางในคำขอเดียว
  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(60)
  limit?: number;
}

export interface PlanResponse {
  id: string;
  cycle: string;
  pricePerCycle: number;
  qtyPerCycle: number;
  isActive: boolean;
}

export interface ProductCardResponse {
  id: string;
  name: string;
  shopName: string;
  /** ชื่อไอคอน Ionicons ของหมวด — หน้าจอ map เป็นสีประจำหมวดที่ใช้แทนรูปสินค้า */
  categoryIcon: string | null;
  images: string[];
  oneTimePrice: number;
  netAmount: number | null;
  unit: string | null;
  plans: PlanResponse[];
  /** aggregate เท่านั้น — ไม่มีทางรู้ว่า "ใคร" สมัคร (data minimization) */
  activeSubscribers: number;
  rating: number | null;
  reviewCount: number;
}

export interface ReviewResponse {
  id: string;
  rating: number;
  comment: string | null;
  /** "รีวิวหลังรับมาแล้วกี่รอบ" — สัญญาณที่ marketplace แบบซื้อครั้งเดียวให้ไม่ได้ */
  cyclesReceived: number;
  reviewerName: string;
  createdAt: string;
}

export interface ProductDetailResponse extends ProductCardResponse {
  description: string | null;
  shopId: string;
  categoryId: number;
  reviews: ReviewResponse[];
}

/** หน้าร้านสาธารณะ — ข้อมูลร้านเท่าที่ผู้ซื้อควรเห็น ไม่มี `ownerId`/อีเมลเจ้าของ */
export interface ShopPageResponse {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  createdAt: string;
  products: ProductCardResponse[];
}

export interface PlanLookupResponse {
  plan: PlanResponse;
  product: {
    id: string;
    name: string;
    oneTimePrice: number;
    shopName: string;
  };
}

export interface CategoryResponse {
  id: number;
  name: string;
  icon: string | null;
}

/**
 * ปิดชื่อผู้รีวิวเหลือตัวแรก — หน้ารีวิวเป็น public ใครก็อ่านได้
 * ชื่อเต็มคู่กับ "ซื้อสินค้านี้ทุกเดือน" คือข้อมูลพฤติกรรมของคนจริง
 */
export function maskReviewerName(name: string): string {
  const first = [...name.trim()][0] ?? '?';
  return `${first}***`;
}
