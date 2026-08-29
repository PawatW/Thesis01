import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AuditAction, EmailLogStatus } from '@prisma/client';
import type { AuditLog, EmailLog, User } from '@prisma/client';

/** เพดานต่อหน้า — กันดูดทั้งตารางในคำขอเดียว (security-rules B-11) */
export const LOG_PAGE_SIZE = 50;
export const LOG_MAX_PAGE = 200;

const toInt = ({ value }: { value: unknown }): unknown =>
  value === undefined || value === '' ? undefined : Number(value);

export class LogQuery {
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(LOG_MAX_PAGE)
  page?: number;
}

export class AuditLogQuery extends LogQuery {
  @IsOptional()
  @IsEnum(AuditAction, { message: 'ชนิดของเหตุการณ์ไม่ถูกต้อง' })
  action?: AuditAction;
}

export class EmailLogQuery extends LogQuery {
  @IsOptional()
  @IsEnum(EmailLogStatus, { message: 'สถานะการส่งไม่ถูกต้อง' })
  status?: EmailLogStatus;
}

export interface PagedResponse<T> {
  rows: T[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface AuditLogResponse {
  id: number;
  action: AuditAction;
  summary: string;
  /**
   * ★ ชื่อที่แสดง ไม่ใช่ `actorId` ★ id ของผู้ใช้ไม่มีประโยชน์กับคนอ่านหน้า log
   * และเป็นของที่ไม่ควรหลุดออก API โดยไม่จำเป็น (กฎข้อ 7 — ห้ามส่ง entity ดิบ)
   */
  actor: string | null;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
}

export interface EmailLogResponse {
  id: number;
  kind: string;
  toIntended: string;
  toActual: string;
  ccActual: string | null;
  redirected: boolean;
  status: EmailLogStatus;
  error: string | null;
  createdAt: string;
}

export function toAuditLogResponse(
  row: AuditLog & { actor: Pick<User, 'displayName'> | null },
): AuditLogResponse {
  return {
    id: row.id,
    action: row.action,
    summary: row.summary,
    // null = ระบบทำเอง (engine) หรือบัญชีที่ทำถูกลบไปแล้ว (FK เป็น SetNull)
    actor: row.actor?.displayName ?? null,
    targetType: row.targetType,
    targetId: row.targetId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toEmailLogResponse(row: EmailLog): EmailLogResponse {
  return {
    id: row.id,
    kind: row.kind,
    toIntended: row.toIntended,
    toActual: row.toActual,
    ccActual: row.ccActual,
    redirected: row.redirected,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}
