import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CYCLES } from '../../common/date';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const OptionalNotNull = () => ValidateIf((_o, value) => value !== undefined);

/**
 * ★ หมายเหตุเรื่อง "เงินห้ามมาจาก client" ★
 *
 * กฎข้อ 7 ห้ามรับยอดเงินจาก client ในเส้นทาง **ที่ผู้ซื้อจ่าย** — ราคาที่ผู้ซื้อ
 * ถูกเรียกเก็บต้องอ่านจาก DB เสมอ (ดู `CreateSubscriptionDto`)
 * ตรงนี้ต่างกันโดยสิ้นเชิง: **เจ้าของร้านเป็นผู้ตั้งราคาสินค้าของตัวเอง** ค่าที่ส่งมา
 * จึงเป็นต้นทางของราคา ไม่ใช่การประกาศว่า "ฉันจะจ่ายเท่านี้"
 * สิ่งที่ยังต้องกันคือช่วงของค่า (ตรงกับ CHECK `plans_price_range` ที่ DB)
 */
export class PlanInputDto {
  @IsIn(CYCLES as readonly string[], {
    message: 'รอบส่งต้องเป็น 2w, 1m หรือ 2m',
  })
  cycle!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'ราคาต่อรอบต้องมากกว่า 0' })
  @Max(1_000_000)
  pricePerCycle!: number;

  @IsInt()
  @Min(1)
  @Max(100)
  qtyPerCycle!: number;
}

export class CreateProductDto {
  @Transform(trim)
  @IsString()
  @Length(2, 120, { message: 'ชื่อสินค้าต้องยาว 2-120 ตัวอักษร' })
  name!: string;

  @IsInt()
  @Min(1)
  categoryId!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 2000)
  description?: string;

  /** 1-5 รูป · https เท่านั้น (CHECK `products_images_len` กันจำนวนอีกชั้น) */
  @IsArray()
  @ArrayMinSize(1, { message: 'ต้องมีรูปสินค้าอย่างน้อย 1 รูป' })
  @ArrayMaxSize(5, { message: 'ใส่รูปได้สูงสุด 5 รูป' })
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { each: true, message: 'ลิงก์รูปต้องเป็น https' },
  )
  images!: string[];

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'ราคาซื้อครั้งเดียวต้องมากกว่า 0' })
  @Max(1_000_000)
  oneTimePrice!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  netAmount?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 16)
  unit?: string;

  /** อย่างน้อย 1 แผน ไม่งั้นสินค้าขึ้น catalog แล้วสมัครไม่ได้ (W07 E3) */
  @IsArray()
  @ArrayMinSize(1, { message: 'ต้องเปิดรอบส่งอย่างน้อย 1 รอบ' })
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => PlanInputDto)
  plans!: PlanInputDto[];
}

/** แก้สินค้า — `shopId` / `suspendedAt` ไม่มีในนี้โดยตั้งใจ (ย้ายร้าน/ปลดแบนเองไม่ได้) */
export class UpdateProductDto {
  @OptionalNotNull()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name?: string;

  @OptionalNotNull()
  @IsInt()
  @Min(1)
  categoryId?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 2000)
  description?: string;

  @OptionalNotNull()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true })
  images?: string[];

  @OptionalNotNull()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  oneTimePrice?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  netAmount?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 16)
  unit?: string;

  /** ปิดการขาย — subscriber เดิมยังได้รับของต่อ (W07) */
  @OptionalNotNull()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * แก้แผน — เปลี่ยน `cycle` ไม่ได้เลย (ไม่มีฟิลด์นี้)
 *
 * รอบส่งคือสิ่งที่ผู้ซื้อตัดสินใจสมัคร การแก้รอบของแผนที่มีสมาชิกอยู่แล้วเท่ากับ
 * เปลี่ยนสัญญาย้อนหลัง — ถ้าอยากมีรอบอื่นให้เปิดแผนใหม่ (UQ `product_id + cycle`)
 */
export class UpdatePlanDto {
  @OptionalNotNull()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  pricePerCycle?: number;

  @OptionalNotNull()
  @IsInt()
  @Min(1)
  @Max(100)
  qtyPerCycle?: number;

  /** ปิดรับสมาชิกใหม่ — subscriber เดิมยังอยู่ต่อ */
  @OptionalNotNull()
  @IsBoolean()
  isActive?: boolean;
}

export interface SellerPlanResponse {
  id: string;
  cycle: string;
  pricePerCycle: number;
  qtyPerCycle: number;
  isActive: boolean;
  /** จำนวนสมาชิกที่ยังใช้งานอยู่ของแผนนี้ */
  activeSubscribers: number;
  /**
   * จำนวนคนที่จะ **ได้รับแจ้งเตือน** ถ้าแก้ราคา = active + paused
   *
   * ต่างจาก `activeSubscribers` โดยตั้งใจ: คนที่หยุดชั่วคราวกลับมาเมื่อไหร่ก็เจอ
   * ราคาใหม่ จึงต้องได้รับแจ้งด้วย — กล่องยืนยันบนหน้าจอต้องบอกตัวเลขนี้
   * ไม่งั้นร้านเห็น "3 คน" แต่ระบบส่งแจ้งเตือนไป 5 คน
   */
  affectedSubscribers: number;
}

export interface SellerProductResponse {
  id: string;
  name: string;
  description: string | null;
  categoryId: number;
  images: string[];
  oneTimePrice: number;
  netAmount: number | null;
  unit: string | null;
  isActive: boolean;
  /** ถูกผู้ดูแลระงับ — ร้านแก้เองไม่ได้ ต้องเห็นบนหน้าจอว่าทำไมของหาย */
  isSuspended: boolean;
  activeSubscribers: number;
  plans: SellerPlanResponse[];
  createdAt: string;
}
