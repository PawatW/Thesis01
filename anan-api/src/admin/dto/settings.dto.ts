import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { MailSetting } from '@prisma/client';

/**
 * ★ ฟิลด์ที่ "ไม่มี" ในไฟล์นี้สำคัญพอ ๆ กับที่มี ★
 * ไม่มี `smtpUser` / `smtpPass` — credential จริงอยู่ใน `.env` เท่านั้น (กฎข้อ 7)
 * ถ้าใครแนบมากับ body จะได้ 400 จาก `forbidNonWhitelisted` ไม่ใช่ถูกเก็บลง DB
 */

/** ว่าง = "ใช้ค่าจาก .env ตามเดิม" ไม่ใช่ "ตั้งเป็นสตริงว่าง" */
const emptyToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const lowerTrim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** ต้องตรงกับ CHECK `mail_settings_redirect_cc_fmt` ใน migration เป๊ะ ๆ */
const CC_LIST_FMT =
  /^[^@\s,]+@[^@\s,]+\.[^@\s,]+( *, *[^@\s,]+@[^@\s,]+\.[^@\s,]+)*$/;

/** ต้องตรงกับ CHECK `mail_settings_host_fmt` — ห้ามมีช่องว่าง/บรรทัดใหม่ */
const HOSTNAME_FMT = /^[A-Za-z0-9._-]+$/;

export class UpdateMailSettingsDto {
  @IsBoolean()
  redirectEnabled!: boolean;

  /**
   * บังคับมีค่าเมื่อเปิดโหมด — ตรวจซ้ำที่ service และที่ CHECK ของ DB อีกชั้น
   * เพราะ "เปิดโหมดแล้วไม่มีปลายทาง" = อีเมลทั้งระบบหายเงียบ ๆ
   */
  @ValidateIf((o: UpdateMailSettingsDto) => o.redirectEnabled)
  @Transform(lowerTrim)
  @IsEmail({}, { message: 'รูปแบบอีเมลปลายทางไม่ถูกต้อง' })
  @MaxLength(254)
  redirectTo!: string;

  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Transform(emptyToNull)
  @Transform(lowerTrim)
  @IsString()
  @MaxLength(500)
  @Matches(CC_LIST_FMT, {
    message: 'Cc ต้องเป็นอีเมลคั่นด้วยเครื่องหมายจุลภาค',
  })
  redirectCc?: string | null;

  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Transform(emptyToNull)
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  @Matches(HOSTNAME_FMT, { message: 'ชื่อโฮสต์ SMTP ไม่ถูกต้อง' })
  smtpHost?: string | null;

  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort?: number | null;

  @IsBoolean()
  smtpSecure!: boolean;

  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Transform(emptyToNull)
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  @Matches(/^[^\r\n]+$/, { message: 'ชื่อผู้ส่งห้ามมีการขึ้นบรรทัดใหม่' })
  mailFrom?: string | null;
}

export interface MailSettingsResponse {
  redirectEnabled: boolean;
  redirectTo: string | null;
  redirectCc: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  mailFrom: string | null;
  updatedAt: string;
  /**
   * เครื่องนี้เปิดโหมด DEV ได้ไหม (`MAIL_UAT_MODE_AVAILABLE` + ไม่ใช่ production)
   * หน้าจอใช้ปิดสวิตช์และอธิบายให้ผู้ดูแลรู้ว่าทำไมกดไม่ได้ — **ไม่ใช่ด่าน**
   * ด่านจริงอยู่ที่ service ซึ่งปฏิเสธการเปิดโหมดเมื่อ env ไม่อนุญาต
   */
  uatModeAvailable: boolean;
  /** `.env` มี SMTP ครบไหม — บอกให้รู้ว่าตอนนี้เมลออกจริงหรือแค่ลง log */
  smtpConfigured: boolean;
}

export function toMailSettingsResponse(
  row: MailSetting,
  flags: { uatModeAvailable: boolean; smtpConfigured: boolean },
): MailSettingsResponse {
  return {
    redirectEnabled: row.redirectEnabled,
    redirectTo: row.redirectTo,
    redirectCc: row.redirectCc,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecure: row.smtpSecure,
    mailFrom: row.mailFrom,
    updatedAt: row.updatedAt.toISOString(),
    ...flags,
  };
}
