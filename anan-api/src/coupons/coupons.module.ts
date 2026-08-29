import { Module } from '@nestjs/common';
import { CouponsAdminController } from './coupons-admin.controller';
import { CouponsAdminService } from './coupons-admin.service';
import { CouponsBuyerController } from './coupons-buyer.controller';
import { CouponsSellerController } from './coupons-seller.controller';
import { CouponsSellerService } from './coupons-seller.service';
import { CouponsService } from './coupons.service';

/**
 * คูปองส่วนลดรายรอบ (feature 18 · W13)
 *
 * `CouponsService` ถูก export ออกไปเพราะ 3 โมดูลอื่นต้องเรียกใน **ทรานแซกชัน
 * ของตัวเอง**: subscriptions (จองตอน checkout + คืนตอนเปลี่ยนรอบ) · engine
 * (ใช้ตอนสร้างออเดอร์) · admin (คืนตอนระงับร้าน)
 * — ตรรกะการคืนคูปองจึงอยู่ที่เดียว ไม่ใช่ก็อปไปเขียนซ้ำ 3 ที่
 */
@Module({
  controllers: [
    CouponsAdminController,
    CouponsSellerController,
    CouponsBuyerController,
  ],
  providers: [CouponsService, CouponsAdminService, CouponsSellerService],
  exports: [CouponsService],
})
export class CouponsModule {}
