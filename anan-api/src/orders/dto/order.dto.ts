import { OrderIssueType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ListOrdersQuery {
  /** `open` = ยังไม่ถึงมือ · `done` = ส่งสำเร็จ/ยกเลิกแล้ว (2 แท็บตาม feature 07) */
  @IsOptional()
  @IsIn(['open', 'done'])
  tab?: 'open' | 'done';
}

/**
 * แจ้งปัญหาออเดอร์ — **ไม่มี `orderId` / `reporterId` ใน body**
 * ออเดอร์มาจาก path และผู้แจ้งมาจาก token เท่านั้น (ปลอมผู้แจ้งไม่ได้)
 */
export class ReportIssueDto {
  @IsEnum(OrderIssueType, {
    message: 'ประเภทปัญหาไม่ถูกต้อง',
  })
  type!: OrderIssueType;

  @Transform(trim)
  @IsString()
  @Length(5, 1000, { message: 'อธิบายปัญหาอย่างน้อย 5 ตัวอักษร' })
  detail!: string;
}

/** สถานะเคสที่ผู้ซื้อเห็น — ไม่มี `reporterId`/`resolvedBy` ออกไป */
export interface OrderIssueResponse {
  id: string;
  type: string;
  detail: string;
  status: string;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface BuyerOrderResponse {
  id: string;
  cycleDate: string;
  status: string;
  /** ยอดที่ตัดจริง (หลังหักคูปองแล้ว) — ใบเสร็จและปุ่มจ่ายซ้ำใช้ค่านี้ */
  amount: number;
  /** ส่วนลดรวมของรอบนี้ — 0 เมื่อไม่ได้ใช้คูปอง · ยอดก่อนลด = amount + ค่านี้ */
  discountAmount: number;
  /**
   * คูปองที่ใช้กับรอบนี้ แยกรายใบ (feature 18) — ว่างเมื่อไม่ได้ใช้
   * ซ้อนได้สูงสุด 2 ใบ (แพลตฟอร์ม + ร้าน) ผลรวมของ `discountAmount`
   * ในนี้เท่ากับ `discountAmount` ของออเดอร์เสมอ
   */
  coupons: {
    tier: 'platform' | 'shop';
    code: string;
    discountAmount: number;
  }[];
  quantity: number;
  trackingNote: string | null;
  /** ผู้ซื้อกดยืนยันเองเมื่อไหร่ — null แปลว่าระบบ/ร้านปิดให้ ไม่ใช่ผู้ซื้อยืนยัน */
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** สถานะการจ่ายเงินจำลอง — `refunded` คือหลักฐานว่าได้เงินคืนแล้ว */
  paymentStatus: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  /**
   * เลขที่ใบเสร็จจำลอง — คำนวณจาก id ของออเดอร์ ไม่ได้เก็บเป็นคอลัมน์
   * (ใบเสร็จ 1 ใบต่อออเดอร์อยู่แล้ว การเพิ่ม sequence ในตารางจึงเป็นหนี้เปล่า ๆ)
   * null เมื่อยังไม่เคยจ่ายสำเร็จ — ยังไม่มีอะไรให้ออกใบเสร็จ
   */
  receiptNo: string | null;
  subscriptionId: string;
  subscriptionStatus: string;
  productId: string;
  productName: string;
  productImage: string | null;
  shopName: string;
  cycle: string;
  /** คัดลอกไว้ตอนออเดอร์เกิด — แก้ที่อยู่ทีหลังต้องไม่ย้อนมาแก้ประวัติ */
  shipTo: {
    name: string;
    phone: string;
    addressLine: string;
    province: string;
    postcode: string;
  };
  issue: OrderIssueResponse | null;
  createdAt: string;
}
