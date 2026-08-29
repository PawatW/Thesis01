/**
 * รูปร่างข้อมูลที่ API ส่งกลับมา — ต้องตรงกับ response DTO ฝั่ง `anan-api`
 *
 * ไฟล์นี้เขียนมือ (ไม่ได้ generate) จึงต้องอัปเดตพร้อมกันทุกครั้งที่ DTO ฝั่ง API
 * เปลี่ยน · ชื่อฟิลด์เป็น camelCase ตาม API ไม่ใช่ snake_case ของตารางใน DB
 */

export interface ApiUser {
  id: string;
  email: string;
  displayName: string;
  phone: string | null;
  avatarUrl: string | null;
  isSeller: boolean;
  isAdmin: boolean;
  createdAt: string;
}

export interface ApiAddress {
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

export interface ApiPaymentMethod {
  id: string;
  kind: string;
  /** เครือข่ายบัตร — ค่าเดียวกับ enum `card_brand` ของ API */
  brand: string;
  last4: string;
  /** เดือน 1–12 และปี ค.ศ. เต็ม 4 หลัก */
  expMonth: number;
  expYear: number;
  holderName: string | null;
  createdAt: string;
}

export interface ApiAuthResult {
  accessToken: string;
  /**
   * มีเฉพาะบนมือถือ — บนเว็บ API ส่ง refresh token กลับมาทาง httpOnly cookie
   * แทน จึงไม่มีฟิลด์นี้ในคำตอบ (ตั้งใจ: ถ้ามี โค้ด XSS ก็อ่านไปเก็บได้)
   */
  refreshToken?: string;
  user: ApiUser;
}
