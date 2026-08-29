import { CardBrand, type PaymentMethod } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * ★ ห้ามมีเลขบัตรเต็มหรือ CVV ในไฟล์นี้ ใน DB หรือใน log ★ (CLAUDE.md กฎข้อ 1)
 *
 * ที่นี่รับเฉพาะ "ร่องรอยของบัตร" ชุดเดียวกับที่ระบบชำระเงินจริงเก็บไว้หลัง
 * tokenization: เครือข่าย · 4 ตัวท้าย · เดือน/ปีหมดอายุ · ชื่อบนบัตร
 *
 * เลข 16 หลักอยู่แค่ในตัวแปร local ของฟอร์มบนเครื่องผู้ใช้ (ใช้เช็ค Luhn และอ่าน
 * BIN เพื่อรู้เครือข่าย) แล้วถูกทิ้งก่อนยิง request — ต่อให้มีคนยิงเลข 16 หลักมาใน
 * `last4` ก็ไม่ผ่าน @Matches และไม่ผ่าน CHECK `payment_methods_last4_fmt` ที่ DB อีกชั้น
 */
export class CreatePaymentMethodDto {
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Matches(/^[0-9]{4}$/, { message: 'ต้องเป็นเลข 4 หลักท้ายบัตรเท่านั้น' })
  last4!: string;

  /**
   * เครือข่ายบัตร — ฝั่งแอปอ่านจาก BIN (6 หลักแรก) ให้ เพราะ BIN ไม่เคยถูกส่งมา
   *
   * รับจาก client ได้เพราะเป็น "ป้ายกำกับสำหรับแสดงผล" ของบัตรตัวเอง ไม่ได้ใช้
   * ตัดสินเงิน สิทธิ์ หรือสถานะใด ๆ (กฎข้อ 7 ห้ามรับจาก client เฉพาะสามอย่างนั้น)
   * ต่อให้ปลอมมาเป็น `visa` ทั้งที่เป็น Mastercard ผลเสียคือไอคอนผิดใบเดียวของตัวเอง
   */
  @IsEnum(CardBrand, { message: 'ไม่รู้จักเครือข่ายบัตรนี้' })
  brand!: CardBrand;

  @Type(() => Number)
  @IsInt({ message: 'เดือนหมดอายุต้องเป็นตัวเลข' })
  @Min(1, { message: 'เดือนหมดอายุต้องอยู่ระหว่าง 1–12' })
  @Max(12, { message: 'เดือนหมดอายุต้องอยู่ระหว่าง 1–12' })
  expMonth!: number;

  /** ปี ค.ศ. เต็ม 4 หลัก — ฟอร์มกรอก YY แล้วฝั่งแอปเติม 20xx ให้ */
  @Type(() => Number)
  @IsInt({ message: 'ปีหมดอายุต้องเป็นตัวเลข' })
  @Min(2000, { message: 'ปีหมดอายุไม่ถูกต้อง' })
  @Max(2100, { message: 'ปีหมดอายุไม่ถูกต้อง' })
  expYear!: number;

  /**
   * ชื่อบนบัตร — ฟอร์มบังคับกรอก แต่ที่ชั้น API ปล่อยเป็น optional ไว้ เพราะเป็น
   * ป้ายกำกับสำหรับแสดงผล และคอลัมน์ใน DB เป็น nullable (บัตรที่ผูกไว้ก่อนหน้านี้)
   */
  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 80, { message: 'ชื่อบนบัตรยาวเกิน 80 ตัวอักษร' })
  holderName?: string;
}

export interface PaymentMethodResponse {
  id: string;
  kind: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  holderName: string | null;
  createdAt: string;
}

export function toPaymentMethodResponse(
  pm: PaymentMethod,
): PaymentMethodResponse {
  return {
    id: pm.id,
    kind: pm.kind,
    brand: pm.brand,
    last4: pm.last4,
    expMonth: pm.expMonth,
    expYear: pm.expYear,
    holderName: pm.holderName,
    createdAt: pm.createdAt.toISOString(),
  };
}
