import { Injectable } from '@nestjs/common';
import {
  PaymentProvider,
  type ChargeInput,
  type ChargeResult,
} from './payment.provider';

/**
 * บัตรจำลองที่ลงท้ายด้วยเลขนี้ = **จ่ายไม่ผ่านเสมอ**
 *
 * เลือกวิธีนี้แทน `DEMO_FAIL_RATE` แบบสุ่ม เพราะการนำเสนอต้องการผลที่ทำซ้ำได้:
 * ตอนซ้อมและตอนขึ้นเวทีต้องเกิดเหมือนกันทุกครั้ง และกรรมการต้องเห็นว่า "อะไร
 * เป็นตัวกำหนด" ได้จากหน้าจอ ไม่ใช่จากค่า config ที่มองไม่เห็น
 * (เป็นวิธีเดียวกับบัตรทดสอบของ gateway จริง เช่น 4000 0000 0000 0002 = declined)
 */
export const DEMO_DECLINE_LAST4 = '0000';

const DECLINE_MESSAGE = 'บัตรถูกปฏิเสธ — ลองใช้บัตรใบอื่น';

/**
 * ตัวจำลองการตัดเงินตัวเดียวของโปรเจกต์
 *
 * ★ ไม่มีการเชื่อมต่อออกนอกเครื่องแม้แต่บรรทัดเดียว ★ และไม่เคยเห็นเลขบัตรเต็ม —
 * ระบบเก็บแค่ `last4` ตั้งแต่ตอนเพิ่มบัตร (กฎเหล็กข้อ 1 + security-rules C-2)
 */
@Injectable()
export class DemoPaymentProvider extends PaymentProvider {
  charge(input: ChargeInput): Promise<ChargeResult> {
    if (input.card.last4 === DEMO_DECLINE_LAST4) {
      return Promise.resolve({
        status: 'failed',
        failureReason: DECLINE_MESSAGE,
      });
    }
    return Promise.resolve({ status: 'paid', failureReason: null });
  }
}
