import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

/**
 * แก้ได้แค่ 3 ฟิลด์นี้ — `email`, `isSeller`, `isAdmin`, `passwordHash`
 * ไม่อยู่ในนี้โดยตั้งใจ (`isSeller` เป็นค่า derived จากการเปิดร้าน)
 */
export class UpdateProfileDto {
  // ไม่ใช้ @IsOptional(): มันข้าม validator เมื่อค่าเป็น null ด้วย ทำให้ null
  // ทะลุไปถึง Prisma แล้วระเบิดเป็น 500 แทนที่จะเป็น 400 (displayName เป็น NOT NULL)
  @ValidateIf((_o, value) => value !== undefined)
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 60, { message: 'ชื่อที่แสดงต้องยาว 1-60 ตัวอักษร' })
  displayName?: string;

  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' && value.trim() === '' ? null : value,
  )
  // รูปแบบเดียวกับ CHECK `users_phone_fmt` ใน DB — ถ้าไม่ตรงกันจะได้ 500 แทน 400
  @Matches(/^[0-9+\-() ]{6,20}$/, { message: 'รูปแบบเบอร์โทรไม่ถูกต้อง' })
  phone?: string | null;

  // https เท่านั้น + ยาวไม่เกิน 500 ให้ตรงกับ CHECK ที่ DB
  @IsOptional()
  @IsUrl(
    { require_protocol: true, protocols: ['https'] },
    { message: 'ลิงก์รูปต้องเป็น https' },
  )
  @Length(1, 500)
  avatarUrl?: string | null;
}
