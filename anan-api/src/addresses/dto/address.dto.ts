import type { Address } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * ใช้แทน `@IsOptional()` กับฟิลด์ที่คอลัมน์ใน DB เป็น NOT NULL
 *
 * `@IsOptional()` ข้าม validator ทุกตัวเมื่อค่าเป็น **null** ด้วย ไม่ใช่แค่ undefined
 * → `{"recipientName": null}` จะทะลุ ValidationPipe ไปถึง Prisma แล้วระเบิดเป็น 500
 * ตัวนี้ยอมให้ "ไม่ส่งฟิลด์มา" แต่ปฏิเสธ "ส่ง null มา"
 */
const OptionalNotNull = () => ValidateIf((_o, value) => value !== undefined);

/**
 * ขอบเขตทุกข้อในนี้ต้องตรงกับ CHECK constraint ของตาราง `addresses`
 * DTO มีไว้ให้ error อ่านง่ายเป็นภาษาไทย · DB มีไว้กันตอนที่ service เขียนพลาด
 * ขาดชั้นใดชั้นหนึ่งไม่ได้ (CLAUDE.md กฎข้อ 7)
 */
export class CreateAddressDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  label?: string;

  @Transform(trim)
  @IsString()
  @Length(1, 100, { message: 'ชื่อผู้รับต้องยาว 1-100 ตัวอักษร' })
  recipientName!: string;

  @Transform(trim)
  @Matches(/^[0-9+\-() ]{6,20}$/, { message: 'รูปแบบเบอร์โทรไม่ถูกต้อง' })
  phone!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 300, { message: 'ที่อยู่ต้องยาวไม่เกิน 300 ตัวอักษร' })
  addressLine!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 100)
  province!: string;

  @Transform(trim)
  @Matches(/^[0-9]{5}$/, { message: 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก' })
  postcode!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 40) label?: string;

  @OptionalNotNull()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  recipientName?: string;

  @OptionalNotNull()
  @Transform(trim)
  @Matches(/^[0-9+\-() ]{6,20}$/, { message: 'รูปแบบเบอร์โทรไม่ถูกต้อง' })
  phone?: string;

  @OptionalNotNull()
  @Transform(trim)
  @IsString()
  @Length(1, 300)
  addressLine?: string;

  @OptionalNotNull()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  province?: string;

  @OptionalNotNull()
  @Transform(trim)
  @Matches(/^[0-9]{5}$/, { message: 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก' })
  postcode?: string;

  @OptionalNotNull()
  @IsBoolean()
  isDefault?: boolean;
}

export interface AddressResponse {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  addressLine: string;
  province: string;
  postcode: string;
  isDefault: boolean;
  createdAt: string;
}

/** ไม่ส่ง `userId` ออกไป — client รู้อยู่แล้วว่าเป็นของตัวเอง */
export function toAddressResponse(a: Address): AddressResponse {
  return {
    id: a.id,
    label: a.label,
    recipientName: a.recipientName,
    phone: a.phone,
    addressLine: a.addressLine,
    province: a.province,
    postcode: a.postcode,
    isDefault: a.isDefault,
    createdAt: a.createdAt.toISOString(),
  };
}
