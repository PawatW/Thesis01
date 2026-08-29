-- ============================================================
-- ANAN — invariant ของหมุดกริดรอบ
--
-- ★ migration นี้เขียนมือ ห้ามลบ ★ (CHECK เขียนใน schema.prisma ไม่ได้)
--
-- ทุกวันตัดรอบคือ `cycle_anchor_date + k×cycle` โดย k ≥ 0 ดังนั้นวันรอบถัดไป
-- จะอยู่ก่อนหมุดไม่ได้เลย · ถ้าวันหนึ่งมีโค้ดเลื่อน next_order_date ย้อนหลัง
-- โดยลืมขยับหมุดตาม กริดจะเพี้ยนแบบเงียบ ๆ แล้วผู้ซื้อโดนตัดเงินผิดวัน
-- (cancelled ไม่มีรอบถัดไป จึงยกเว้นให้)
-- ============================================================

ALTER TABLE "subscriptions"
  ADD CONSTRAINT subs_anchor_not_after_next
    CHECK ("next_order_date" IS NULL OR "cycle_anchor_date" <= "next_order_date");
