import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { CouponDiscountType, CouponPolicy, CouponTier } from '@prisma/client';

/**
 * DTO ของคูปอง 2 ระดับ (feature 18)
 *
 * ★ ฟิลด์ที่ "ไม่มี" ในไฟล์นี้สำคัญพอ ๆ กับที่มี ★
 *   - ไม่มี `discountAmount` / `amount` / `netAmount` ในฝั่งขาเข้าเลย —
 *     ยอดทุกตัวคำนวณที่ service จาก `price_per_cycle` ใน DB (กฎข้อ 7 · S-02)
 *   - ไม่มี `buyerId` / `shopId` / `tier` — ตัวตนมาจาก token และระดับของคูปอง
 *     ถูกกำหนดจาก **endpoint ที่ใช้** ไม่ใช่จากค่าที่ client ส่งมา
 *     (ถ้ารับ `tier` จาก body ร้านจะออกคูปองระดับแพลตฟอร์มได้ด้วย curl บรรทัดเดียว)
 *   - ไม่มี `inUseCount` / `isActive` — โควตาขยับได้จากการจองเท่านั้น
 *     และการปิดคูปองมี endpoint ของตัวเอง
 *   - ไม่มี `maxPerUser` — เฟสนี้ล็อกที่ 1 เพราะบังคับด้วย partial unique
 */

const upperTrim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const emptyToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;

/** ต้องตรงกับ CHECK `coupons_code_format` ใน migration เป๊ะ ๆ */
const CODE_FMT = /^[A-Z0-9-]{4,24}$/;

/** ยอดเงินสูงสุดที่ระบบรับ — ตรงกับ CHECK `orders_amount_range` */
const MAX_MONEY = 10_000_000;

// ============================================================
// ออกคูปอง — ใช้ร่วมกันทั้ง admin และ seller
// ============================================================

/**
 * ฟิลด์ที่เหมือนกันของทั้งสองระดับ
 *
 * `tier` กับ `shopId` **ไม่อยู่ที่นี่โดยตั้งใจ** — service เป็นคนเติมจาก endpoint
 * ที่ถูกเรียกกับ token ของผู้เรียก
 */
export class CreateCouponDto {
  @Transform(upperTrim)
  @IsString()
  @Matches(CODE_FMT, {
    message: 'โค้ดต้องเป็น A-Z 0-9 หรือ - ความยาว 4-24 ตัว',
  })
  code!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @Transform(emptyToNull)
  @Transform(trim)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsEnum(CouponDiscountType)
  discountType!: CouponDiscountType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MAX_MONEY)
  discountValue!: number;

  /** เพดานของแบบ percent — แบบ fixed ต้องไม่ส่งมา (CHECK `coupons_fixed_no_cap`) */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MAX_MONEY)
  maxDiscountAmount?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MAX_MONEY)
  minOrderAmount?: number | null;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;

  /** null = ไม่จำกัดจำนวนคนที่ใช้ได้ทั้งแคมเปญ */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxRedemptions?: number | null;
}

/**
 * คูปองของร้าน — เพิ่มขอบเขตเข้ามาจากของ admin
 *
 * `appliesToAllProducts = true` แปลว่าครอบทุกสินค้าของร้านนี้ **รวมที่เพิ่มทีหลัง**
 * (ร้านไม่ต้องกลับมาติ๊กใหม่ทุกครั้งที่ลงสินค้า) · false = ครอบเฉพาะที่ระบุใน `productIds`
 *
 * คูปองแพลตฟอร์มใช้โหมดนี้ไม่ได้ — CHECK `coupons_all_products_shop_tier_only` กันไว้
 * เพราะการเข้าร่วมแคมเปญของแพลตฟอร์มต้องเป็นการ "กด" ของร้านเสมอ (ร้านรับภาระเอง)
 */
export class CreateShopCouponDto extends CreateCouponDto {
  @IsBoolean()
  appliesToAllProducts!: boolean;

  /** ใช้เมื่อ `appliesToAllProducts = false` — ต้องเป็นสินค้าของร้านผู้เรียกทุกชิ้น */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @Type(() => String)
  productIds?: string[];
}

/**
 * แก้คูปองที่ออกไปแล้ว — **แก้ชนิดกับมูลค่าไม่ได้โดยตั้งใจ**
 *
 * ใบที่จองไปแล้วถือ snapshot ของเงื่อนไขอยู่ก็จริง แต่การแก้มูลค่ากลางแคมเปญ
 * ทำให้ผู้ซื้อสองคนได้คนละดีลจากโค้ดเดียวกันโดยไม่มีอะไรบนหน้าจอบอก
 * ถ้าจะเปลี่ยนดีล ให้ปิดใบเดิมแล้วออกใบใหม่
 */
export class UpdateCouponDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @Transform(emptyToNull)
  @Transform(trim)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxRedemptions?: number | null;
}

export class AdminCouponQuery {
  /** `active` = เปิดอยู่และยังไม่หมดอายุ · `inactive` = ปิดแล้วหรือหมดอายุ */
  @IsOptional()
  @IsEnum({ all: 'all', active: 'active', inactive: 'inactive' })
  status?: 'all' | 'active' | 'inactive';

  /** กรองตามระดับ — ผู้ดูแลต้องดูคูปองของร้านทั้งแพลตฟอร์มได้ด้วย */
  @IsOptional()
  @IsEnum(CouponTier)
  tier?: CouponTier;
}

export interface AdminCouponResponse {
  id: string;
  code: string;
  title: string;
  description: string | null;
  /** ระดับ — `platform` ผู้ดูแลออก · `shop` ร้านออกเอง */
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
  /** สถานะที่คนอ่านเข้าใจได้ทันที (คำนวณจาก isActive + ช่วงเวลา) */
  state: 'scheduled' | 'running' | 'expired' | 'disabled';
  /** ครอบทุกสินค้าของร้าน (เฉพาะคูปองร้าน) */
  appliesToAllProducts: boolean;
  /** จองอยู่ + ใช้ไปแล้ว = จำนวนที่กินโควตา */
  inUseCount: number;
  reservedCount: number;
  consumedCount: number;
  releasedCount: number;
  /** จำนวนสินค้าที่ติ๊กเข้าร่วมไว้ (ไม่นับโหมดครอบทั้งร้าน) */
  productCount: number;
  createdAt: string;
}

// ============================================================
// Seller — คูปองของร้าน + นโยบายรายสินค้า
// ============================================================

/**
 * ตั้งค่าคูปองของสินค้าหนึ่ง — **แทนที่ทั้งชุด** (idempotent)
 *
 * รวม 2 เรื่องไว้ในคำสั่งเดียวเพราะอยู่บนการ์ดเดียวกันบนหน้าจอ:
 *   1. `couponPolicy` — สินค้าชิ้นนี้รับคูปองระดับไหนบ้าง
 *   2. `couponIds`    — คูปองใบไหนครอบสินค้าชิ้นนี้ (ทั้งของแพลตฟอร์มและของร้านเอง)
 */
export class SetProductCouponsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @Type(() => String)
  couponIds!: string[];

  @IsEnum(CouponPolicy)
  couponPolicy!: CouponPolicy;
}

/** คูปอง 1 ใบในมุมของ "สินค้าชิ้นนี้เข้าร่วมไหม" */
export interface SellerCouponResponse {
  id: string;
  code: string;
  title: string;
  description: string | null;
  label: string;
  tier: CouponTier;
  minOrderAmount: number | null;
  startsAt: string;
  endsAt: string;
  /** สินค้าชิ้นนี้เข้าร่วมคูปองใบนี้อยู่ไหม */
  enabled: boolean;
  /**
   * ครอบอยู่แล้วโดยไม่ต้องติ๊ก (คูปองของร้านที่ตั้งเป็น "ทั้งร้าน")
   * — หน้าจอต้องล็อก checkbox ไว้ ไม่งั้นร้านจะงงว่าติ๊กออกแล้วทำไมยังใช้ได้
   */
  coveredByAllProducts: boolean;
  /**
   * ภาระส่วนลดสูงสุดต่อรอบของสินค้าชิ้นนี้ — คำนวณจากแผนที่แพงที่สุดที่ยังเปิดอยู่
   * ร้านต้องเห็นตัวเลขนี้ก่อนตัดสินใจเข้าร่วม ไม่ใช่รู้ตอนเงินหายไปแล้ว
   */
  maxDiscountPerCycle: number | null;
}

/** ผลของการเปิดหน้า "คูปอง" ของสินค้าหนึ่ง */
export interface ProductCouponsResponse {
  couponPolicy: CouponPolicy;
  /** คูปองของแพลตฟอร์มที่ร้านเลือกเข้าร่วมได้ */
  platform: SellerCouponResponse[];
  /** คูปองที่ร้านนี้ออกเอง */
  shop: SellerCouponResponse[];
}

/** คูปองของร้านในหน้าจัดการคูปองของร้าน (ไม่ผูกกับสินค้าชิ้นใดชิ้นหนึ่ง) */
export interface ShopCouponResponse extends AdminCouponResponse {
  /** สินค้าของร้านที่ครอบอยู่ — ว่างเมื่อ `appliesToAllProducts` */
  productIds: string[];
}

// ============================================================
// Buyer — จองคูปองกับรอบ
// ============================================================

export class ApplyCouponDto {
  @IsUUID()
  couponId!: string;
}

/** ดูคูปองของแผนหนึ่งตอน checkout — จำนวนชิ้นเปลี่ยนยอด จึงเปลี่ยนส่วนลดด้วย */
export class PlanCouponsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  quantity?: number;
}

/** 1 ใบในรายการที่ผู้ซื้อเลือก — ใบที่ใช้ไม่ได้ก็ส่งมาด้วยพร้อมเหตุผล (เทาไว้) */
export interface AvailableCouponResponse {
  id: string;
  code: string;
  title: string;
  description: string | null;
  label: string;
  tier: CouponTier;
  endsAt: string;
  usable: boolean;
  /** ยอดที่จะลดถ้าใช้ใบนี้กับรอบนี้ — null เมื่อใช้ไม่ได้ */
  discountAmount: number | null;
  /** ข้อความไทยบอกว่าทำไมใช้ไม่ได้ — null เมื่อใช้ได้ */
  blockedReason: string | null;
}

/** คูปองที่จองไว้กับรอบถัดไปแล้ว */
export interface AppliedCouponResponse {
  redemptionId: string;
  couponId: string;
  code: string;
  title: string;
  label: string;
  tier: CouponTier;
  cycleDate: string;
  /** ประมาณการ ณ ตอนจอง — ยอดจริงคำนวณใหม่ตอนตัดเงิน */
  discountAmount: number;
}

/** สถานะของคูปอง 1 ระดับ */
export interface CouponTierResponse {
  /** สินค้าชิ้นนี้เปิดรับระดับนี้ไหม (มาจาก `products.coupon_policy`) */
  allowed: boolean;
  /** เหตุที่ระดับนี้ใช้ไม่ได้ — null เมื่อใช้ได้ */
  blockedReason: string | null;
  applied: AppliedCouponResponse | null;
  available: AvailableCouponResponse[];
}

/**
 * สรุปคูปองของรอบถัดไป — ใช้ทั้งในหน้ารายการของฉันและหน้าจองคูปอง
 *
 * ★ ยอดรวมคำนวณที่ server เสมอ ★ หน้าจอห้ามบวกเอง เพราะกฎการหนีบเมื่อรวมเกินยอด
 * อยู่ใน `combineDiscounts()` ที่เดียว (ดู `discount.ts`)
 */
export interface SubscriptionCouponsResponse {
  cycleDate: string | null;
  /** ยอดก่อนลดของรอบถัดไป */
  grossAmount: number;
  /** ส่วนลดรวมของทั้งสองระดับ (หนีบไม่ให้เกินยอดแล้ว) */
  discountAmount: number;
  /** ยอดที่จะถูกตัดจริงในรอบถัดไป */
  netAmount: number;
  /** จองได้อยู่ไหม (false เมื่อเลยกำหนดหรือสถานะไม่ใช่ active) */
  canApply: boolean;
  /** เหตุที่จองไม่ได้ — null เมื่อจองได้ */
  blockedReason: string | null;
  platform: CouponTierResponse;
  shop: CouponTierResponse;
}
