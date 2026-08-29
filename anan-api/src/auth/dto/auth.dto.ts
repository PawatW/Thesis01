import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MaxBytes } from '../../common/validators/max-bytes.validator';

/**
 * ★ ฟิลด์ที่ "ไม่มี" ในไฟล์นี้สำคัญพอ ๆ กับฟิลด์ที่มี ★
 * ไม่มี isAdmin / isSeller — ValidationPipe ตั้ง forbidNonWhitelisted ไว้
 * ถ้ามีใครแนบมากับ body จะได้ 400 ไม่ใช่ถูกส่งต่อไป Prisma
 */

// bcrypt ตัดข้อความที่เกิน 72 ไบต์ทิ้ง — ต้องนับเป็นไบต์ ไม่ใช่จำนวนตัวอักษร
const PASSWORD_MAX_BYTES = 72;

/**
 * `@IsEmail()` ของ validator.js ยอมรับ quoted local part เช่น `"a b"@x.com`
 * ซึ่ง CHECK `users_email_fmt` ที่ DB ปฏิเสธ → ผู้ใช้จะได้ 422 ที่อ่านไม่รู้เรื่อง
 * แทน 400 ที่บอกว่าผิดตรงไหน · regex นี้ต้องเหมือนกับใน migration เป๊ะ ๆ
 */
const EMAIL_FMT = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const lowerTrim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @Transform(lowerTrim)
  @IsEmail({}, { message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  @Matches(EMAIL_FMT, { message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(10, { message: 'รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร' })
  @MaxBytes(PASSWORD_MAX_BYTES, {
    message: 'รหัสผ่านยาวเกินไป — ภาษาไทย 1 ตัวนับเป็น 3 หน่วย',
  })
  password!: string;

  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 60, { message: 'ชื่อที่แสดงต้องยาว 1-60 ตัวอักษร' })
  displayName!: string;
}

export class LoginDto {
  @Transform(lowerTrim)
  @IsEmail({}, { message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  @MaxLength(254)
  email!: string;

  // ไม่ใส่ MinLength ที่นี่: ถ้ารหัสสั้นแล้วตอบ 400 แต่รหัสยาวผิดตอบ 401
  // ผู้โจมตีจะแยกได้ว่านโยบายรหัสผ่านคืออะไร — ให้ทุกกรณีจบที่ 401 เหมือนกัน
  @IsString()
  @MaxBytes(PASSWORD_MAX_BYTES)
  password!: string;
}

/**
 * ไม่มีอะไรนอกจากอีเมล — ห้ามรับ `redirectTo`/`callbackUrl` จาก client เด็ดขาด
 * ปลายทางของลิงก์ในเมลประกอบจาก `APP_WEB_URL` ของ API เท่านั้น ไม่งั้นใครก็ยิง
 * endpoint นี้ให้ระบบส่งเมลที่ดูน่าเชื่อถือพร้อมลิงก์ไปเว็บของตัวเองได้
 */
export class ForgotPasswordDto {
  @Transform(lowerTrim)
  @IsEmail({}, { message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  // token จริงเป็น base64url 43 ตัว — เพดานนี้กันของยาวผิดปกติ ไม่ได้ใช้ตัดสินความถูกต้อง
  @IsString()
  @Length(1, 512)
  token!: string;

  @IsString()
  @MinLength(10, { message: 'รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร' })
  @MaxBytes(PASSWORD_MAX_BYTES, {
    message: 'รหัสผ่านยาวเกินไป — ภาษาไทย 1 ตัวนับเป็น 3 หน่วย',
  })
  password!: string;
}

/**
 * ★ `refreshToken` ไม่บังคับตั้งแต่ย้ายมาใช้ httpOnly cookie ★
 *
 * ฝั่งเว็บไม่ส่งฟิลด์นี้เลย — token เดินทางมาใน cookie ที่ JavaScript อ่านไม่ได้
 * ฝั่ง native (Expo Go / แอปที่ build แล้ว) ไม่มี cookie jar ที่พึ่งพาได้ จึงยัง
 * ส่งลง body เหมือนเดิม · controller เป็นคนเลือกว่าจะอ่านจากทางไหน
 * (ดู `common/http/refresh-cookie.ts`)
 *
 * `@IsOptional()` ที่นี่ไม่ได้แปลว่า "ไม่ต้องมี token ก็ได้" — ถ้าไม่มีทั้งสองทาง
 * controller ตอบ 401 เอง การปล่อยให้ DTO ตัดสินจะได้ 400 ซึ่งบอกผู้โจมตีว่า
 * เส้นทางไหนถูกใช้อยู่
 */
export class RefreshDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  refreshToken?: string;
}

export class LogoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  refreshToken?: string;
}
