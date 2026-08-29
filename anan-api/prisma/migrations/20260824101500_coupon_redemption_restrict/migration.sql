-- ============================================================
-- ANAN — ใบจองคูปองห้ามถูกลบขณะที่ออเดอร์ยังชี้อยู่ (feature 18)
--
-- ค่าปริยายของ Prisma สำหรับ FK ที่เป็น optional คือ SET NULL ซึ่ง **ขัดกับ**
-- CHECK `orders_discount_needs_redemption`: ลบใบจองทิ้งเมื่อไหร่ คอลัมน์จะกลาย
-- เป็น NULL ทั้งที่ `discount_amount > 0` แล้วแถวนั้นผิด constraint ทันที
-- (เจอตอนเขียน cleanup ของ e2e — ลำดับการลบต้องเป็น ออเดอร์ → ใบจอง → คูปอง)
-- ============================================================

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_coupon_redemption_id_fkey";

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_redemption_id_fkey" FOREIGN KEY ("coupon_redemption_id") REFERENCES "coupon_redemptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

