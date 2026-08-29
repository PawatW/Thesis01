-- ============================================================
-- ANAN — `coupon_redemptions.buyer_id` ต้องตรงกับเจ้าของ subscription เสมอ
--
-- ที่มา: `/sec-check` รอบปิด feature 18 (security-rules D-4)
-- คอลัมน์นี้เป็น denormalize ที่ **กฎกันใช้คูปองซ้ำพึ่งพาอยู่** —
-- partial unique `coupon_once_per_user` บังคับที่ `(coupon_id, buyer_id)`
-- ถ้าค่านี้เพี้ยนไปจากเจ้าของจริงเมื่อไหร่ กฎ "1 คน 1 ครั้งต่อคูปอง" ก็ถูกข้ามได้
--
-- ใช้แพตเทิร์นเดียวกับ `orders` (migration init): อ้าง FK **คู่** ไปที่
-- `subscriptions(id, buyer_id)` ซึ่งมี UNIQUE รองรับอยู่แล้ว
-- → ค่าที่ไม่ตรงกับเจ้าของจริงเป็นไปไม่ได้ทางกายภาพ ไม่ใช่แค่ "service เขียนถูก"
-- ============================================================

-- DropForeignKey
ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "coupon_redemptions_buyer_id_fkey";

-- DropForeignKey
ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "coupon_redemptions_subscription_id_fkey";

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_subscription_id_buyer_id_fkey" FOREIGN KEY ("subscription_id", "buyer_id") REFERENCES "subscriptions"("id", "buyer_id") ON DELETE CASCADE ON UPDATE CASCADE;

