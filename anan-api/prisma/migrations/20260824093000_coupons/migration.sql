-- CreateEnum
CREATE TYPE "coupon_discount_type" AS ENUM ('percent', 'fixed');

-- CreateEnum
CREATE TYPE "coupon_redemption_status" AS ENUM ('reserved', 'consumed', 'released');

-- CreateEnum
CREATE TYPE "coupon_release_reason" AS ENUM ('user_removed', 'cycle_changed', 'shop_suspended', 'min_order_not_met');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'coupon_created';
ALTER TYPE "audit_action" ADD VALUE 'coupon_updated';
ALTER TYPE "audit_action" ADD VALUE 'coupon_deactivated';

-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE 'coupon_released';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "subscription_event_type" ADD VALUE 'coupon_applied';
ALTER TYPE "subscription_event_type" ADD VALUE 'coupon_released';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "coupon_redemption_id" UUID,
ADD COLUMN     "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "discount_type" "coupon_discount_type" NOT NULL,
    "discount_value" DECIMAL(10,2) NOT NULL,
    "max_discount_amount" DECIMAL(10,2),
    "min_order_amount" DECIMAL(10,2),
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "max_redemptions" INTEGER,
    "in_use_count" INTEGER NOT NULL DEFAULT 0,
    "max_per_user" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "coupon_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "enabled_by" UUID,
    "enabled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "coupon_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "cycle_date" DATE NOT NULL,
    "status" "coupon_redemption_status" NOT NULL DEFAULT 'reserved',
    "discount_type" "coupon_discount_type" NOT NULL,
    "discount_value" DECIMAL(10,2) NOT NULL,
    "max_discount_amount" DECIMAL(10,2),
    "min_order_amount" DECIMAL(10,2),
    "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "reserved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at" TIMESTAMPTZ(6),
    "released_at" TIMESTAMPTZ(6),
    "released_reason" "coupon_release_reason",

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_is_active_ends_at_idx" ON "coupons"("is_active", "ends_at");

-- CreateIndex
CREATE INDEX "coupon_products_product_id_idx" ON "coupon_products"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_products_coupon_id_product_id_key" ON "coupon_products"("coupon_id", "product_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_subscription_id_status_idx" ON "coupon_redemptions"("subscription_id", "status");

-- CreateIndex
CREATE INDEX "coupon_redemptions_coupon_id_status_idx" ON "coupon_redemptions"("coupon_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_coupon_redemption_id_key" ON "orders"("coupon_redemption_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_redemption_id_fkey" FOREIGN KEY ("coupon_redemption_id") REFERENCES "coupon_redemptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_enabled_by_fkey" FOREIGN KEY ("enabled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================
-- ★ ส่วนที่เขียนมือ ห้ามลบ ★ (CLAUDE.md ข้อ 4 · feature 18 · W13)
-- CHECK / partial unique / trigger ที่ Prisma เขียนเองไม่ได้
-- ============================================================

-- ---------- coupons: เงื่อนไขของแคมเปญต้องสมเหตุสมผลตั้งแต่ระดับ DB ----------
ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_code_format"
    CHECK ("code" ~ '^[A-Z0-9-]{4,24}$'),
  ADD CONSTRAINT "coupons_title_len"
    CHECK (char_length("title") BETWEEN 1 AND 120),
  ADD CONSTRAINT "coupons_description_len"
    CHECK ("description" IS NULL OR char_length("description") <= 500),
  ADD CONSTRAINT "coupons_value_positive"
    CHECK ("discount_value" > 0),
  -- ลดเกิน 100% ไม่มีความหมาย และเปิดช่องให้ยอดติดลบถ้าโค้ดฝั่ง service พลาด
  ADD CONSTRAINT "coupons_percent_range"
    CHECK ("discount_type" <> 'percent' OR "discount_value" <= 100),
  -- เพดานส่วนลดมีความหมายเฉพาะกับแบบ percent — ใส่กับ fixed คือความสับสนที่รอเกิด
  ADD CONSTRAINT "coupons_fixed_no_cap"
    CHECK ("discount_type" <> 'fixed' OR "max_discount_amount" IS NULL),
  ADD CONSTRAINT "coupons_cap_positive"
    CHECK ("max_discount_amount" IS NULL OR "max_discount_amount" > 0),
  ADD CONSTRAINT "coupons_min_order_positive"
    CHECK ("min_order_amount" IS NULL OR "min_order_amount" > 0),
  ADD CONSTRAINT "coupons_window"
    CHECK ("ends_at" > "starts_at"),
  ADD CONSTRAINT "coupons_quota_nonneg"
    CHECK ("in_use_count" >= 0),
  -- ★ โควตาเกินเป็นไปไม่ได้ทางกายภาพ ★ ต่อให้ service คำนวณพลาด DB ก็ปฏิเสธ
  ADD CONSTRAINT "coupons_quota_within_max"
    CHECK ("max_redemptions" IS NULL OR "in_use_count" <= "max_redemptions"),
  ADD CONSTRAINT "coupons_max_redemptions_positive"
    CHECK ("max_redemptions" IS NULL OR "max_redemptions" >= 1),
  ADD CONSTRAINT "coupons_per_user_positive"
    CHECK ("max_per_user" >= 1);

-- ---------- coupon_redemptions: สถานะกับเวลาต้องตรงกันเสมอทั้งสองทาง ----------
-- รูปแบบเดียวกับ `refresh_tokens_revoke_consistent`: เหตุผล/เวลาต้องมาคู่กับสถานะ
-- ถ้าเป็นแค่ CHECK ทางเดียว แถวที่ released แต่ไม่มีเวลาจะกลายเป็นบั๊กเงียบ
ALTER TABLE "coupon_redemptions"
  ADD CONSTRAINT "redemption_amount_nonneg"
    CHECK ("discount_amount" >= 0),
  ADD CONSTRAINT "redemption_value_positive"
    CHECK ("discount_value" > 0),
  ADD CONSTRAINT "redemption_consumed_consistent"
    CHECK (("status" = 'consumed') = ("consumed_at" IS NOT NULL)),
  ADD CONSTRAINT "redemption_released_consistent"
    CHECK (("status" = 'released') = ("released_at" IS NOT NULL AND "released_reason" IS NOT NULL));

-- ★ 1 รอบ ใช้คูปองได้ 1 ใบ ★ partial เพื่อให้ "คืนแล้วจองใหม่กับรอบเดิม" ทำได้
CREATE UNIQUE INDEX "coupon_one_per_cycle"
  ON "coupon_redemptions" ("subscription_id", "cycle_date")
  WHERE "status" <> 'released';

-- ★ 1 คน ใช้คูปองใบนี้ได้ครั้งเดียว ★ กันยกเลิก subscription แล้วสมัครใหม่วนใช้ซ้ำ
-- (กฎนี้เช็คในโค้ดแล้วเอาไม่อยู่ เพราะอ่านแล้วค่อยเขียนมีช่องให้ 2 request ผ่านทั้งคู่)
CREATE UNIQUE INDEX "coupon_once_per_user"
  ON "coupon_redemptions" ("coupon_id", "buyer_id")
  WHERE "status" <> 'released';

-- ---------- orders: ส่วนลดต้องชี้กลับไปหาที่มาได้เสมอ ----------
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_discount_nonneg"
    CHECK ("discount_amount" >= 0),
  -- ออเดอร์ที่ลดแล้วแต่ไม่รู้ว่าลดจากคูปองใบไหน = เงินหายโดยตรวจย้อนไม่ได้
  ADD CONSTRAINT "orders_discount_needs_redemption"
    CHECK (("discount_amount" > 0) = ("coupon_redemption_id" IS NOT NULL));

-- ---------- ขยาย guard_order_update ให้คุ้มส่วนลดด้วย ----------
-- เหตุผลเดียวกับที่ `amount` ห้ามเปลี่ยน: ยอดของออเดอร์ที่เกิดแล้วคือข้อเท็จจริง
-- ถ้าปล่อยให้แก้ `discount_amount` ได้ ร้านหรือสคริปต์จะย้อนไปเปลี่ยนยอดที่ตัดไปแล้ว
CREATE OR REPLACE FUNCTION guard_order_update() RETURNS trigger AS $$
BEGIN
  -- 1) ยอดเงิน ส่วนลด วันรอบ และที่อยู่ที่คัดลอกไว้ ห้ามเปลี่ยนหลังออเดอร์เกิดแล้ว
  IF NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
     OR NEW.coupon_redemption_id IS DISTINCT FROM OLD.coupon_redemption_id
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
