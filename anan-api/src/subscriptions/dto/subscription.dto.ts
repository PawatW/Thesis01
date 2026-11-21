import { CancelReason, type SubscriptionStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * ★ สิ่งที่ "ไม่มี" ในนี้คือหัวใจของกฎเหล็กข้อ 2 ★
 *
 * ไม่มี `amount` · ไม่มี `pricePerCycle` · ไม่มี `status`
 * ราคาทั้งหมดอ่านจาก `product_plans` ในฐานข้อมูลตอนสร้างรายการเสมอ
 * ถ้ารับมาจาก body ผู้ซื้อจะตั้งราคาสินค้าเองได้ด้วย curl บรรทัดเดียว
 */
export class CreateSubscriptionDto {
  @IsUUID()
  planId!: string;

  @IsInt()
  @Min(1)
  @Max(10)
  quantity!: number;

  @IsUUID()
  addressId!: string;

  @IsUUID()
  paymentMethodId!: string;

  /** 'YYYY-MM-DD' ตามปฏิทินไทย — ตรวจช่วงที่ service อีกชั้น */
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'รูปแบบวันที่ไม่ถูกต้อง' })
  startDate!: string;

  /**
   * คูปองของรอบแรก (feature 18) — **id ของคูปองเท่านั้น ไม่ใช่ยอดส่วนลด**
   * service เป็นคนคำนวณว่าลดเท่าไหร่จากราคาใน DB · ถ้าแนบ `discountAmount`
   * มาด้วยจะได้ 400 จาก `forbidNonWhitelisted` ไม่ใช่ถูกเชื่อ
   *
   * ซ้อนได้สูงสุด 2 ใบ (แพลตฟอร์ม + ร้าน) — เท่ากับที่รอบถัด ๆ ไปทำได้
   * ระดับซ้ำกันจะถูกปฏิเสธที่ partial unique ของ DB ไม่ใช่ที่ความยาว array
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @Type(() => String)
  couponIds?: string[];
}

/** เลื่อนวันส่ง — วันที่ต้องเป็นอนาคต ตรวจช่วงจริงที่ service */
export class RescheduleDto {
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'รูปแบบวันที่ไม่ถูกต้อง' })
  date!: string;
}

/**
 * ★ ป้ายวัดผลของ cancel flow ★ (Phase 8.3 · feature 06 R1)
 *
 * action ที่ผู้ซื้อกดจาก "ข้อเสนอแทนการยกเลิก" แนบค่านี้มา แล้วถูกเก็บลง
 * `subscription_events.detail.source` — ใช้นับ save rate ในเล่ม
 * เป็นข้อมูลวิเคราะห์ล้วน ไม่มีผลกับสิทธิ์หรือยอดเงินใด ๆ จึงรับจาก client ได้
 */
export const RETENTION_SOURCES = ['cancel_flow'] as const;
export type RetentionSource = (typeof RETENTION_SOURCES)[number];

/** body ของ skip — ไม่บังคับมี body (ของเดิมยิงเปล่าได้เหมือนเดิม) */
export class SkipDto {
  @IsOptional()
  @IsIn(RETENTION_SOURCES)
  source?: RetentionSource;
}

/** หยุดพัก — ไม่ส่ง `cycles` = หยุดไม่มีกำหนด (พฤติกรรมเดิม) */
export class PauseDto {
  @IsOptional()
  @IsInt()
  @IsIn([1, 2, 3], { message: 'หยุดพักได้ 1-3 รอบ' })
  cycles?: 1 | 2 | 3;

  @IsOptional()
  @IsIn(RETENTION_SOURCES)
  source?: RetentionSource;
}

/** เปลี่ยนรอบส่ง — เลือกได้เฉพาะแผนของสินค้าชิ้นเดิม (ตรวจที่ service) */
export class ChangePlanDto {
  @IsUUID()
  planId!: string;

  @IsOptional()
  @IsIn(RETENTION_SOURCES)
  source?: RetentionSource;
}

/** เปลี่ยนจำนวนต่อรอบ — ช่วงเดียวกับตอนสมัคร (CHECK `subs_quantity_range` ที่ DB) */
export class ChangeQuantityDto {
  @IsInt()
  @Min(1)
  @Max(10)
  quantity!: number;
}

/**
 * ยกเลิก — **เหตุผลบังคับ** (Phase 8.3)
 *
 * ไม่มีเหตุผลก็ไม่มีวันรู้ว่าลูกค้าออกเพราะอะไร · CHECK ที่ DB บังคับฝั่งกลับ
 * (มีเหตุผลได้เฉพาะตอน cancelled) ส่วนฝั่ง "ต้องมี" อยู่ที่นี่ เพราะแถวเก่าที่
 * ยกเลิกก่อนมีฟีเจอร์นี้ไม่มีเหตุผล จะใส่ NOT NULL ย้อนหลังไม่ได้
 */
export class CancelSubscriptionDto {
  @IsEnum(CancelReason, { message: 'กรุณาเลือกเหตุผลที่ยกเลิก' })
  reason!: CancelReason;

  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(0, 200)
  note?: string;
}

export class ChangeAddressDto {
  @IsUUID()
  addressId!: string;
}

export interface SubscriptionCardResponse {
  id: string;
  status: SubscriptionStatus;
  pausedReason: string | null;
  /** หยุดพักแบบมีวันกลับ — วันรอบแรกที่จะกลับมาส่ง · null = ไม่มีกำหนด/ไม่ได้หยุด */
  resumeOn: string | null;
  /** เหตุผลที่ยกเลิก (ของผู้เรียกเอง) — null สำหรับรายการที่ยังไม่ยกเลิก/ยกเลิกก่อน 8.3 */
  cancelReason: CancelReason | null;
  startDate: string;
  nextOrderDate: string | null;
  /**
   * หมุดของกริดรอบ — ส่งออกไปเพราะหน้าจอต้องบอก "รอบถัดไปจะเป็นวันไหน"
   * ก่อนผู้ใช้กดยืนยัน (ข้อบังคับของ W05) ถ้าไม่มีค่านี้ client จะคำนวณจาก
   * `nextOrderDate` แล้วได้คนละวันกับที่ server จะเขียนจริงในเดือนที่ไม่มีวันที่ 31
   */
  cycleAnchorDate: string;
  quantity: number;
  cycle: string;
  pricePerCycle: number;
  /** ให้หน้าจอรู้ว่ากำลังใช้แผน/ที่อยู่ไหนอยู่ — ของผู้เรียกเองทั้งคู่ */
  planId: string;
  addressId: string;
  productId: string;
  productName: string;
  shopName: string;
  images: string[];
  /**
   * จำนวนรอบที่ส่งถึงแล้ว — ใช้เปิด/ปิดปุ่มรีวิวบนหน้าจอด้วยเงื่อนไขเดียวกับที่
   * `upsertReview()` บังคับจริง (feature 17) · 0 = ยังรีวิวไม่ได้
   */
  cyclesReceived: number;
  /**
   * คูปองที่จองไว้กับรอบถัดไป (feature 18) — null เมื่อยังไม่ได้จอง
   * ยอดคำนวณสดจากราคาปัจจุบัน ไม่ใช่ค่าที่บันทึกตอนจอง
   */
  coupons: {
    tier: 'platform' | 'shop';
    code: string;
    discountAmount: number;
  }[];
  /** ยอดส่วนลดรวมของรอบถัดไป (หนีบไม่ให้เกินยอดแล้ว) — 0 เมื่อไม่ได้จองไว้ */
  couponDiscount: number;
  /** ยอดที่จะถูกตัดจริงในรอบถัดไป — `pricePerCycle × quantity − couponDiscount` */
  couponNetAmount: number;
  /** ดาวที่ผู้ซื้อคนนี้ให้ไว้เอง — null คือยังไม่เคยรีวิว (ไม่ใช่ 0 ดาว) */
  myRating: number | null;
}

export interface CheckoutResultResponse {
  subscription: SubscriptionCardResponse;
  firstOrder: {
    id: string;
    cycleDate: string;
    /** ยอดที่ตัดจริง (หลังหักคูปองแล้ว) */
    amount: number;
    /** ส่วนลดรวมของรอบแรก — 0 เมื่อไม่ได้ใช้คูปอง (feature 18) */
    discountAmount: number;
    /** โค้ดคูปองที่ใช้กับรอบแรก — ซ้อนได้สูงสุด 2 ใบ (แพลตฟอร์ม + ร้าน) */
    couponCodes: string[];
    status: string;
  };
}

/**
 * รีวิว — เขียนได้เมื่อ **เคยได้รับของจริงอย่างน้อย 1 รอบ** เท่านั้น (feature 17)
 *
 * ไม่มี `cyclesReceived` ใน DTO โดยตั้งใจ: จำนวนรอบที่รับมาแล้วเป็นข้อเท็จจริงที่
 * นับจากออเดอร์ในฐานข้อมูล ไม่ใช่สิ่งที่ผู้รีวิวประกาศเอง — ไม่งั้นป้าย
 * "รับมาแล้ว 12 รอบ" ที่เป็นจุดขายของรีวิวแบบ subscription จะเชื่อถือไม่ได้เลย
 */
export class UpsertReviewDto {
  @IsInt()
  @Min(1, { message: 'ให้คะแนน 1-5 ดาว' })
  @Max(5, { message: 'ให้คะแนน 1-5 ดาว' })
  rating!: number;

  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(0, 1000)
  comment?: string;
}

export interface ReviewResponse {
  id: string;
  rating: number;
  comment: string | null;
  /** นับจากออเดอร์ที่ส่งถึงจริง ณ เวลาที่บันทึก — คำนวณใหม่ทุกครั้งที่แก้ */
  cyclesReceived: number;
  createdAt: string;
  updatedAt: string;
  /** แก้ไขแล้วหรือยัง — หน้าจอแสดงป้าย "(แก้ไขแล้ว)" */
  edited: boolean;
}
