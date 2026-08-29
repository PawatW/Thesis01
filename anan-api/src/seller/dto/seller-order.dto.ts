import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * เลื่อนออเดอร์ไปสถานะถัดไป — **ไม่มีฟิลด์ `status`**
 *
 * ให้ server เป็นคนบอกว่า "ถัดไป" คืออะไร ไม่ใช่รับมาจาก client:
 * ลำดับ pending → preparing → shipped → delivered จึงกระโดดข้ามขั้นไม่ได้เลย
 * แม้จะยิงตรงด้วย curl (feature 12 · E2) และตรงกับปุ่มเดียวบนหน้าจอ
 */
export class AdvanceOrderDto {
  /** เลขพัสดุ — ใส่ได้ตอนเปลี่ยนเป็น "ส่งแล้ว" เท่านั้น (ไม่บังคับ) */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  trackingNote?: string;
}

export class ListSellerOrdersQuery {
  /** `open` = ค้างส่ง (pending/preparing) · `shipped` · `history` = ส่งจบ/ยกเลิก */
  @IsOptional()
  @IsIn(['open', 'shipped', 'history'])
  tab?: 'open' | 'shipped' | 'history';
}

/**
 * ★ สิ่งที่ไม่มีในนี้คือ data minimization ★
 *
 * ไม่มี `buyerId` · `subscriptionId` · `paymentMethodId` — ร้านเห็นข้อมูลผู้ซื้อ
 * เท่าที่ต้องส่งของ ซึ่งอยู่ใน `address_snapshot` ตอนออเดอร์เกิดจริงเท่านั้น
 * (CLAUDE.md ข้อ 7 · security-design S-07)
 */
export interface SellerOrderResponse {
  id: string;
  cycleDate: string;
  status: string;
  amount: number;
  quantity: number;
  trackingNote: string | null;
  productId: string;
  productName: string;
  productImage: string | null;
  cycle: string;
  recipient: {
    name: string;
    phone: string;
    addressLine: string;
    province: string;
    postcode: string;
  };
  /** ผู้ซื้อยกเลิกการสมัครไปแล้ว แต่ออเดอร์ใบนี้ยังต้องส่งจนจบ (W08 E2) */
  subscriptionCancelled: boolean;
  createdAt: string;
}

export interface ForecastResponse {
  days: number;
  /** เตือนบนหน้าจอเสมอ: ผู้ซื้อ skip/pause ได้ถึงวันก่อนรอบ ตัวเลขจึงเป็นค่าประมาณ */
  approximate: true;
  items: {
    productId: string;
    productName: string;
    ordersCount: number;
    units: number;
    revenue: number;
  }[];
}

/**
 * ร้านยกเลิกออเดอร์ที่ส่งไม่ได้ (feature 15)
 *
 * เหตุผลบังคับกรอกและยาวอย่างน้อย 5 ตัวอักษร — ผู้ซื้อเห็นข้อความนี้บนหน้าออเดอร์
 * ของตัวเอง จุดสำคัญคือ "." ลอย ๆ ต้องไม่ผ่าน (ผู้ซื้อต้องรู้ว่าทำไมไม่ได้ของ)
 */
export class CancelOrderDto {
  @Transform(trim)
  @IsString()
  @Length(5, 200, { message: 'ระบุเหตุผลอย่างน้อย 5 ตัวอักษร' })
  reason!: string;
}

/** ปิดเคสปัญหา — ผลลัพธ์มีแค่ 2 ทาง และเป็นสถานะสุดท้าย (W11 Flow C) */
export class ResolveIssueDto {
  @IsIn(['resolved', 'rejected'], {
    message: 'ผลของเคสต้องเป็น resolved หรือ rejected',
  })
  status!: 'resolved' | 'rejected';

  @Transform(trim)
  @IsString()
  @Length(5, 1000, { message: 'อธิบายผลอย่างน้อย 5 ตัวอักษร' })
  note!: string;
}

export class ListIssuesQuery {
  @IsOptional()
  @IsIn(['open', 'closed'])
  status?: 'open' | 'closed';
}

/**
 * เคสปัญหาในมุมของร้าน
 *
 * มีชื่อผู้รับจาก `address_snapshot` (ต้องใช้ระบุว่าเป็นออเดอร์ของใคร) แต่ **ไม่มี
 * `reporterId`** — ร้านไม่ต้องรู้ user id ของผู้ซื้อเพื่อจะตอบเคส
 */
export interface SellerIssueResponse {
  id: string;
  orderId: string;
  type: string;
  detail: string;
  status: string;
  resolutionNote: string | null;
  recipientName: string;
  productName: string;
  cycleDate: string;
  /** เคสเปิดค้างมากี่วัน — >3 วันหน้าจอไฮไลต์ (feature 16) */
  ageDays: number;
  createdAt: string;
  resolvedAt: string | null;
}
