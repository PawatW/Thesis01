-- ============================================================
-- ANAN — คูปอง 2 ระดับ: แพลตฟอร์ม + ร้านค้า (feature 18 · รอบที่ 2)
--
-- ★ migration นี้เขียนมือทั้งไฟล์ ห้ามให้ Prisma generate ทับ ★
-- ตัว generator เสนอ `DROP COLUMN coupon_redemption_id` + `ADD platform_redemption_id`
-- ซึ่ง **ทำให้ออเดอร์ที่ลดไปแล้วขาดที่มา** แล้วผิด CHECK ทันที
-- ที่ถูกคือ RENAME เพราะแถวเดิมทุกแถวเป็นคูปองระดับแพลตฟอร์มอยู่แล้ว
-- ============================================================

-- ---------- enum ใหม่ ----------
CREATE TYPE "coupon_tier" AS ENUM ('platform', 'shop');
CREATE TYPE "coupon_policy" AS ENUM ('both', 'platform_only', 'shop_only', 'none');

-- ---------- coupons: ระดับ + เจ้าของร้าน + ขอบเขต ----------
ALTER TABLE "coupons"
  ADD COLUMN "tier" "coupon_tier" NOT NULL DEFAULT 'platform',
  ADD COLUMN "shop_id" UUID,
  ADD COLUMN "applies_to_all_products" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_shop_id_fkey" FOREIGN KEY ("shop_id")
    REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "coupons_shop_id_is_active_idx" ON "coupons"("shop_id", "is_active");

-- ★ ระดับกับเจ้าของต้องตรงกันเสมอ ★ คูปองร้านที่ไม่มีร้าน หรือคูปองแพลตฟอร์ม
-- ที่ดันมีร้านติดมา = สภาพที่ตอบไม่ได้ว่า "ใครรับภาระส่วนลด"
ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_tier_shop_consistent"
    CHECK (("tier" = 'shop') = ("shop_id" IS NOT NULL)),
  -- คูปองแพลตฟอร์มครอบทั้งร้านเองไม่ได้ — การเข้าร่วมต้องเป็นการ "กด" ของร้าน
  -- เท่านั้น (นั่นคือทั้งหมดของเหตุผลที่ระบบนี้ไม่ต้องมีโมเดลส่วนแบ่งรายได้)
  ADD CONSTRAINT "coupons_all_products_shop_tier_only"
    CHECK ("tier" = 'shop' OR "applies_to_all_products" = false);

-- ---------- products: ร้านตั้งนโยบายคูปองรายสินค้า ----------
ALTER TABLE "products"
  ADD COLUMN "coupon_policy" "coupon_policy" NOT NULL DEFAULT 'both';

-- ---------- coupon_redemptions: snapshot ระดับ + 1 รอบได้ระดับละ 1 ใบ ----------
ALTER TABLE "coupon_redemptions"
  ADD COLUMN "tier" "coupon_tier" NOT NULL DEFAULT 'platform';

-- แถวเดิมทั้งหมดเป็นคูปองแพลตฟอร์ม (ยังไม่มีคูปองร้านในระบบ) — default จึงถูกอยู่แล้ว
-- แต่เขียนไว้ให้ชัดเผื่ออ่านย้อน
UPDATE "coupon_redemptions" r
   SET "tier" = c."tier"
  FROM "coupons" c
 WHERE c."id" = r."coupon_id";

-- ★ เปลี่ยนกฎจาก "1 รอบ 1 ใบ" เป็น "1 รอบ ระดับละ 1 ใบ" ★
-- เพดาน "ซ้อนได้ไม่เกิน 2 ใบ" จึงมาจากจำนวนค่าใน enum `coupon_tier` เอง
-- ไม่ใช่จากการนับใน service
DROP INDEX "coupon_one_per_cycle";
CREATE UNIQUE INDEX "coupon_one_per_cycle_tier"
  ON "coupon_redemptions" ("subscription_id", "cycle_date", "tier")
  WHERE "status" <> 'released';

-- ---------- orders: 2 ช่องใบจอง (แพลตฟอร์ม + ร้าน) ----------
-- ★ RENAME ไม่ใช่ DROP+ADD ★ ดูเหตุผลหัวไฟล์
ALTER TABLE "orders" RENAME COLUMN "coupon_redemption_id" TO "platform_redemption_id";
ALTER TABLE "orders" RENAME CONSTRAINT "orders_coupon_redemption_id_fkey"
                          TO "orders_platform_redemption_id_fkey";
ALTER INDEX "orders_coupon_redemption_id_key" RENAME TO "orders_platform_redemption_id_key";

ALTER TABLE "orders" ADD COLUMN "shop_redemption_id" UUID;

CREATE UNIQUE INDEX "orders_shop_redemption_id_key"
  ON "orders"("shop_redemption_id");

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_shop_redemption_id_fkey" FOREIGN KEY ("shop_redemption_id")
    REFERENCES "coupon_redemptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ส่วนลดต้องชี้กลับไปหาที่มาได้เสมอ — ตอนนี้ "ที่มา" มีได้สองช่อง
ALTER TABLE "orders" DROP CONSTRAINT "orders_discount_needs_redemption";
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_discount_needs_redemption"
    CHECK (("discount_amount" > 0) =
           ("platform_redemption_id" IS NOT NULL OR "shop_redemption_id" IS NOT NULL));

-- ---------- guard_order_update: คุ้มช่องใบจองทั้งสองช่อง ----------
-- เหตุผลเดิม: ยอดของออเดอร์ที่เกิดแล้วคือข้อเท็จจริง ห้ามมีใครย้อนไปแก้
CREATE OR REPLACE FUNCTION guard_order_update() RETURNS trigger AS $$
BEGIN
  -- 1) ยอดเงิน ส่วนลด วันรอบ และที่อยู่ที่คัดลอกไว้ ห้ามเปลี่ยนหลังออเดอร์เกิดแล้ว
  IF NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
     OR NEW.platform_redemption_id IS DISTINCT FROM OLD.platform_redemption_id
     OR NEW.shop_redemption_id IS DISTINCT FROM OLD.shop_redemption_id
     OR NEW.cycle_date IS DISTINCT FROM OLD.cycle_date
     OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
     OR NEW.buyer_id IS DISTINCT FROM OLD.buyer_id
     OR NEW.address_snapshot::text IS DISTINCT FROM OLD.address_snapshot::text THEN
    RAISE EXCEPTION 'ห้ามแก้ยอดเงิน ส่วนลด วันรอบ เจ้าของ หรือที่อยู่ของออเดอร์ที่สร้างแล้ว';
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
