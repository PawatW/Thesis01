-- Phase 8.3 — จำนวนชิ้นของออเดอร์ต้องเป็นข้อเท็จจริงของรอบนั้น (เขียนมือ)
--
-- ก่อน Phase 8.3 `subscriptions.quantity` ไม่เคยเปลี่ยนหลังสมัคร ร้านจึงอ่านจำนวนจาก
-- subscription ได้ · พอมี POST /subscriptions/:id/quantity ค่านั้นกลายเป็นของที่แก้ได้ตลอด
-- → จ่ายเงิน 1 ชิ้นแล้วแก้เป็น 10 ก่อนร้านแพ็คของ = ได้ของ 10 ชิ้น (พบจากการรีวิว security)

-- 1) เพิ่มแบบ nullable ก่อน — ตารางมีข้อมูลอยู่แล้ว (working-agreement §6)
ALTER TABLE "orders" ADD COLUMN "quantity" INTEGER;

-- 2) backfill จาก subscription — ถูกต้องสำหรับแถวเก่าเพราะก่อน migration นี้จำนวนแก้ไม่ได้
--    (ต้องปิด trigger ชั่วคราว ไม่งั้น guard_order_update ไม่ยอมให้แก้แถวที่มีอยู่ —
--     ตอนนี้ trigger ยังไม่รู้จัก quantity แต่ปิดไว้ให้ชัดว่าจงใจ)
ALTER TABLE "orders" DISABLE TRIGGER USER;
UPDATE "orders" o SET "quantity" = s."quantity"
  FROM "subscriptions" s WHERE s."id" = o."subscription_id";
ALTER TABLE "orders" ENABLE TRIGGER USER;

-- 3) บังคับ
ALTER TABLE "orders"
  ALTER COLUMN "quantity" SET NOT NULL,
  ADD CONSTRAINT orders_quantity_range CHECK ("quantity" BETWEEN 1 AND 10);

-- 4) guard_order_update: จำนวนชิ้นห้ามเปลี่ยนหลังออเดอร์เกิด (เหมือนยอดเงิน)
CREATE OR REPLACE FUNCTION guard_order_update() RETURNS trigger AS $$
BEGIN
  -- 1) ยอดเงิน ส่วนลด จำนวน วันรอบ และที่อยู่ที่คัดลอกไว้ ห้ามเปลี่ยนหลังออเดอร์เกิดแล้ว
  IF NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.platform_redemption_id IS DISTINCT FROM OLD.platform_redemption_id
     OR NEW.shop_redemption_id IS DISTINCT FROM OLD.shop_redemption_id
     OR NEW.cycle_date IS DISTINCT FROM OLD.cycle_date
     OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
     OR NEW.buyer_id IS DISTINCT FROM OLD.buyer_id
     OR NEW.address_snapshot::text IS DISTINCT FROM OLD.address_snapshot::text THEN
    RAISE EXCEPTION 'ห้ามแก้ยอดเงิน ส่วนลด จำนวน วันรอบ เจ้าของ หรือที่อยู่ของออเดอร์ที่สร้างแล้ว';
  END IF;

  -- 2) ลำดับสถานะเดินหน้าอย่างเดียว ทีละขั้น — ยกเลิกได้จนถึงก่อนส่งถึงมือ
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
         (OLD.status = 'pending'   AND NEW.status IN ('preparing', 'cancelled'))
      OR (OLD.status = 'preparing' AND NEW.status IN ('shipped', 'cancelled'))
      OR (OLD.status = 'shipped'   AND NEW.status IN ('delivered', 'cancelled'))
    ) THEN
      RAISE EXCEPTION 'ลำดับสถานะออเดอร์ไม่ถูกต้อง: % → %', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
