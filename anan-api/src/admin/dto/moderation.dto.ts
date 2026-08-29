import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * ระงับ/คืนสถานะ — **ไม่มีฟิลด์ `suspendedAt`**
 *
 * client บอกได้แค่ "เอา/ไม่เอา" ส่วนเวลาที่ระงับเป็นของ server เสมอ
 * (ถ้ารับเวลาจาก client ได้ ประวัติการระงับจะปลอมย้อนหลังได้ทันที)
 */
export class SetSuspensionDto {
  @IsBoolean()
  suspend!: boolean;

  /** เหตุผล — บังคับตอนระงับ, ไม่ต้องมีตอนคืนสถานะ (ตรวจใน service) */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(5, 200, { message: 'ระบุเหตุผลอย่างน้อย 5 ตัวอักษร' })
  reason?: string;
}

export class ModerationQuery {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  q?: string;

  /** `suspended` = เฉพาะที่ถูกระงับอยู่ · ไม่ระบุ = ทั้งหมด */
  @IsOptional()
  @IsIn(['all', 'suspended'])
  filter?: 'all' | 'suspended';
}

export class IssueQueueQuery {
  @IsOptional()
  @IsIn(['open', 'closed'])
  status?: 'open' | 'closed';
}

/**
 * ร้านในมุมผู้ดูแล — มีเฉพาะสิ่งที่ใช้ตัดสินใจว่า "ร้านนี้มีปัญหาไหม"
 * ไม่มีข้อมูลผู้ซื้อรายคนแม้แต่ฟิลด์เดียว
 */
export interface AdminShopResponse {
  id: string;
  name: string;
  ownerName: string;
  ownerEmail: string;
  isActive: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  productCount: number;
  activeSubscribers: number;
  /** สัญญาณคุณภาพ: เคสที่ยังไม่ตอบ + ออเดอร์ที่ร้านยกเลิกใน 30 วัน */
  openIssues: number;
  cancelledOrders30d: number;
  createdAt: string;
}

export interface AdminProductResponse {
  id: string;
  name: string;
  shopId: string;
  shopName: string;
  isActive: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  activeSubscribers: number;
  createdAt: string;
}

/** ผลของการระงับ/คืนสถานะ — ตัวเลขที่ต้องเอาไปบอกผู้ดูแลว่ากระทบใครบ้าง */
export interface SuspensionResultResponse {
  id: string;
  name: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  /** จำนวน subscription ที่ถูกแช่แข็ง (ตอนระงับ) หรือถูกปลุกกลับมา (ตอนคืน) */
  affectedSubscriptions: number;
}

/** เคสปัญหาทั้งแพลตฟอร์ม — ไม่มี `reporterId`, มีแค่ชื่อร้านที่ต้องรับผิดชอบ */
export interface AdminIssueResponse {
  id: string;
  orderId: string;
  type: string;
  detail: string;
  status: string;
  shopId: string;
  shopName: string;
  productName: string;
  ageDays: number;
  createdAt: string;
  resolvedAt: string | null;
}
