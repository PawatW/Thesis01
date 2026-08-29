/**
 * สัญญาเดียวของ "การตัดเงิน" ในระบบ (feature 09)
 *
 * ★ เหตุผลที่ต้องมี interface ทั้งที่มี implementation เดียว ★
 * โปรเจกต์นี้ห้ามต่อ payment gateway จริงทุกกรณี (CLAUDE.md กฎข้อ 1) แต่โค้ดที่
 * เรียกใช้ไม่ควรผูกกับ "การจำลอง" — checkout กับ engine เรียกผ่านสัญญานี้เท่านั้น
 * วันที่ระบบจริงต้องต่อ gateway จึงเป็นการเพิ่ม provider ตัวใหม่ ไม่ใช่ไล่แก้ทุกที่
 * ที่เคยเขียน `status: 'paid'` ตรง ๆ (เขียนเรื่องนี้เป็น future work ในเล่มได้)
 */

export interface ChargeInput {
  /** ออเดอร์ที่กำลังเรียกเก็บ — provider จริงใช้เป็น idempotency key ของ gateway */
  orderId: string;
  amount: number;
  /** บัตรที่ผูกกับ subscription — provider จริงจะใช้ token ของ gateway ตรงนี้ */
  card: { id: string; last4: string };
}

export interface ChargeResult {
  status: 'paid' | 'failed';
  /** เหตุผลที่ผู้ซื้ออ่านรู้เรื่อง — null เมื่อสำเร็จ */
  failureReason: string | null;
}

/**
 * ประกาศเป็น abstract class ไม่ใช่ `interface` เพราะ Nest ต้องใช้ค่า runtime
 * เป็น DI token — `interface` ของ TypeScript หายไปตอน compile
 */
export abstract class PaymentProvider {
  abstract charge(input: ChargeInput): Promise<ChargeResult>;
}
