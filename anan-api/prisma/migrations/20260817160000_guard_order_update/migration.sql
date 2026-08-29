-- ============================================================
-- ANAN — ลำดับสถานะออเดอร์ + ความคงที่ของยอดเงิน บังคับที่ฐานข้อมูล
--
-- ★ migration นี้เขียนมือ ห้ามลบ ★
--
-- ที่มา: รีวิว Phase 4 — `context/planing/12-seller-orders.md` ประกาศมาตั้งแต่
-- ยุค Supabase ว่า "ลำดับสถานะถูกบังคับด้วย trigger guard_order_update" แต่ตอน
-- ย้ายมา NestJS ด่านนี้หายไป เหลือแค่การตรวจใน service — เอกสารจึงอ้างชั้นป้องกัน
-- ที่ไม่มีอยู่จริง (อันตรายกว่าไม่มีเลย เพราะรอบตรวจถัดไปจะติ๊กผ่าน)
--
-- CHECK ธรรมดาทำแทนไม่ได้ เพราะกฎนี้ต้องเทียบค่า "ก่อน-หลัง" ของแถวเดียวกัน
-- (CLAUDE.md ข้อ 4 · security-rules D-3 · testing.md ชั้น L3)
-- ============================================================

CREATE OR REPLACE FUNCTION guard_order_update() RETURNS trigger AS $$
BEGIN
  -- 1) ยอดเงิน วันรอบ และที่อยู่ที่คัดลอกไว้ ห้ามเปลี่ยนหลังออเดอร์เกิดแล้ว
  --    (ร้านแก้ยอดของออเดอร์ตัวเองไม่ได้ แม้จะยิง SQL ตรง)
  IF NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.cycle_date IS DISTINCT FROM OLD.cycle_date
     OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
     OR NEW.buyer_id IS DISTINCT FROM OLD.buyer_id
     OR NEW.address_snapshot::text IS DISTINCT FROM OLD.address_snapshot::text THEN
    RAISE EXCEPTION 'ห้ามแก้ยอดเงิน วันรอบ เจ้าของ หรือที่อยู่ของออเดอร์ที่สร้างแล้ว';
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

CREATE TRIGGER guard_order_update
  BEFORE UPDATE ON "orders"
  FOR EACH ROW EXECUTE FUNCTION guard_order_update();

-- ---------- CHECK ของ URL รูป (กฎข้อ 9: ต้องมีทั้ง DTO และ DB) ----------
-- DTO บังคับ https อยู่แล้ว แต่ชั้นเดียวไม่พอ — สคริปต์/seed ที่เขียนตรงต้องโดนด้วย
-- ห้าม http เพราะรูปจะถูกเบราว์เซอร์บล็อกและเปิดช่อง mixed content
ALTER TABLE "shops"
  ADD CONSTRAINT shops_logo_url_https
    CHECK (logo_url IS NULL OR (logo_url ~ '^https://' AND char_length(logo_url) <= 500));
