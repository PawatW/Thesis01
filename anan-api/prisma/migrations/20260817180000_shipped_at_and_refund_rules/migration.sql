-- ============================================================
-- ANAN — Phase 4.5: เวลาที่ส่งของจริง + กติกาสถานะของการจ่ายเงิน
--
-- ★ migration นี้แก้มือ ห้ามลบ ★
--
-- 1) `orders.shipped_at` — engine ต้องรู้ว่า "ของออกจากร้านเมื่อไหร่" เพื่อนับ 7 วัน
--    ก่อนปิดออเดอร์ให้เอง · ใช้ `cycle_date` แทนไม่ได้เพราะนั่นคือวันตัดรอบ
--    (ร้านที่ส่งช้า 5 วันจะถูกปิดออเดอร์ให้หลังส่งแค่ 2 วัน)
--
-- 2) ★ CHECK เดิมทำให้ "คืนเงิน" เป็นไปไม่ได้ ★ พบตอนเขียนเทสของ feature 15:
--    `payments_paid_consistent` บังคับ `(status='paid') = (paid_at IS NOT NULL)`
--    พอคืนเงินแล้ว status กลายเป็น 'refunded' แต่ `paid_at` ยังอยู่ (เพราะเคยจ่ายจริง)
--    → CHECK ล้มทุกครั้ง ยกเลิกออเดอร์จึงทำไม่ได้เลยทั้งที่สเปกบอกให้คืนเงิน
--
--    แทนที่ด้วยกติกาที่อธิบายวงจรชีวิตทั้งหมดในข้อเดียว:
--      paid     → จ่ายแล้ว ยังไม่คืน
--      refunded → เคยจ่ายจริง แล้วคืนไป (ต้องมีทั้งสองเวลา)
--      failed   → ไม่มีเวลาไหนเลย
-- ============================================================

ALTER TABLE "orders" ADD COLUMN "shipped_at" TIMESTAMPTZ(6);

-- ออเดอร์ที่ส่งไปแล้วก่อนมีคอลัมน์นี้: ใช้เวลาที่แถวถูกแก้ล่าสุดเป็นค่าประมาณ
UPDATE "orders" SET "shipped_at" = "created_at"
 WHERE "status" IN ('shipped', 'delivered') AND "shipped_at" IS NULL;

ALTER TABLE "payments"
  DROP CONSTRAINT payments_paid_consistent,
  DROP CONSTRAINT payments_refund_consistent,
  ADD CONSTRAINT payments_lifecycle CHECK (
       (status = 'paid'     AND paid_at IS NOT NULL AND refunded_at IS NULL)
    OR (status = 'refunded' AND paid_at IS NOT NULL AND refunded_at IS NOT NULL)
    OR (status = 'failed'   AND paid_at IS NULL     AND refunded_at IS NULL)
  );
