import type { Shop } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** ยอมให้ "ไม่ส่งฟิลด์" แต่ปฏิเสธ "ส่ง null" กับคอลัมน์ที่เป็น NOT NULL */
const OptionalNotNull = () => ValidateIf((_o, value) => value !== undefined);

/**
 * ★ สิ่งที่ไม่มีในนี้คือหัวใจ ★
 *
 * ไม่มี `ownerId` (มาจาก token เท่านั้น) · ไม่มี `suspendedAt` / `suspendedReason`
 * (ของ admin — ร้านปลดแบนตัวเองไม่ได้ ดู database-schema.md ข้อ 7)
 * ขอบเขตความยาวตรงกับ CHECK `shops_name_len` / `shops_desc_len`
 */
export class OpenShopDto {
  @Transform(trim)
  @IsString()
  @Length(2, 80, { message: 'ชื่อร้านต้องยาว 2-80 ตัวอักษร' })
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 1000)
  description?: string;

  /**
   * URL ของโลโก้ที่อัปโหลดขึ้น Cloudinary แล้ว (ผ่าน `POST /uploads/signature`)
   * บังคับ https: ถ้ายอม http รูปจะถูก block บนเว็บและเปิดช่อง mixed content
   */
  @IsOptional()
  @Transform(trim)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @Length(0, 500)
  logoUrl?: string;
}

export class UpdateShopDto {
  @OptionalNotNull()
  @Transform(trim)
  @IsString()
  @Length(2, 80, { message: 'ชื่อร้านต้องยาว 2-80 ตัวอักษร' })
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 1000)
  description?: string;

  @IsOptional()
  @Transform(trim)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @Length(0, 500)
  logoUrl?: string;

  /** ปิดร้านเอง — subscriber เดิมยังได้รับของต่อ (ต่างจากการถูก admin ระงับ) */
  @OptionalNotNull()
  @IsBoolean()
  isActive?: boolean;
}

export interface ShopResponse {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  isActive: boolean;
  /** ถูกผู้ดูแลระงับอยู่ไหม — ส่งแค่ boolean ไม่ส่งเวลาและเหตุผลภายใน */
  isSuspended: boolean;
  createdAt: string;
}

export interface DashboardResponse {
  shop: ShopResponse;
  /** จำนวน subscription ที่ยัง active ของสินค้าในร้านนี้ */
  activeSubscribers: number;
  /** รายได้ต่อเดือนโดยประมาณ — normalize 2w×2 / 1m×1 / 2m×0.5 (CLAUDE.md ข้อ 5) */
  monthlyRevenue: number;
  /** ยกเลิกในเดือนนี้ (ตามปฏิทินไทย) — ตัวตั้งของ churn */
  cancelledThisMonth: number;
  activeProducts: number;
  pendingOrders: number;
  /** เหตุการณ์ล่าสุดแบบไม่ระบุตัวผู้ซื้อ (data minimization — CLAUDE.md ข้อ 7) */
  recentEvents: { event: string; productName: string; at: string }[];
}

export function toShopResponse(shop: Shop): ShopResponse {
  return {
    id: shop.id,
    name: shop.name,
    description: shop.description,
    logoUrl: shop.logoUrl,
    isActive: shop.isActive,
    isSuspended: shop.suspendedAt !== null,
    createdAt: shop.createdAt.toISOString(),
  };
}
