import { Global, Module } from '@nestjs/common';
import { DemoPaymentProvider } from './demo-payment.provider';
import { PaymentProvider } from './payment.provider';

/**
 * ผูก `PaymentProvider` เข้ากับตัวจำลองตัวเดียวที่โปรเจกต์นี้มี
 *
 * ทำเป็น `@Global()` เพราะทั้ง checkout · engine · การจ่ายซ้ำ ต้องใช้ตัวเดียวกัน
 * และการมีสองตัวในระบบเดียวคือความเสี่ยงที่ไม่มีข้อดีเลย
 */
@Global()
@Module({
  providers: [{ provide: PaymentProvider, useClass: DemoPaymentProvider }],
  exports: [PaymentProvider],
})
export class PaymentsModule {}
