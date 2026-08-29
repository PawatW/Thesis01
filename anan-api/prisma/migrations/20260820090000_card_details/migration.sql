-- บัตรเก็บรายละเอียดชุดเดียวกับที่ผู้ให้บริการชำระเงินจริงเก็บหลัง tokenization
-- (เครือข่าย · 4 ตัวท้าย · เดือน/ปีหมดอายุ) — เลขบัตรเต็มและ CVV ยังไม่มีอยู่ใน DB
-- ทั้งคู่ ตามกฎเหล็กข้อ 1

-- 1) ไม่มี "ชนิดปลอม" อีกแล้ว — วิธีชำระเงินชนิดเดียวที่มีคือบัตร
ALTER TYPE "payment_method_kind" RENAME VALUE 'card_demo' TO 'card';

-- 2) เครือข่ายบัตร (ได้จาก BIN ที่ฝั่งแอป — ใช้แสดงผลอย่างเดียว)
CREATE TYPE "card_brand" AS ENUM ('visa', 'mastercard', 'jcb', 'amex', 'unionpay', 'unknown');
ALTER TABLE "payment_methods" ADD COLUMN "brand" "card_brand" NOT NULL DEFAULT 'unknown';

-- 3) วันหมดอายุ — เติมค่าให้แถวเดิมก่อน แล้วค่อยบังคับ NOT NULL
--    ปีของแถวเดิมไล่ทีละใบภายในกลุ่ม (user_id, last4) เพื่อให้ UNIQUE ข้อ 4 ข้างล่าง
--    ไม่ล้มบน DB ที่เคยกดเล่นจนมีบัตร 4 ตัวท้ายซ้ำกันอยู่ก่อน
ALTER TABLE "payment_methods" ADD COLUMN "exp_month" INTEGER;
ALTER TABLE "payment_methods" ADD COLUMN "exp_year"  INTEGER;

UPDATE "payment_methods" p
SET    "exp_month" = 12,
       "exp_year"  = 2029 + (r.rn - 1)
FROM (
  SELECT id,
         row_number() OVER (PARTITION BY user_id, last4 ORDER BY created_at, id) AS rn
  FROM   "payment_methods"
) r
WHERE  p.id = r.id;

ALTER TABLE "payment_methods" ALTER COLUMN "exp_month" SET NOT NULL;
ALTER TABLE "payment_methods" ALTER COLUMN "exp_year"  SET NOT NULL;

ALTER TABLE "payment_methods"
  ADD CONSTRAINT payment_methods_exp_month_rng CHECK (exp_month BETWEEN 1 AND 12),
  ADD CONSTRAINT payment_methods_exp_year_rng  CHECK (exp_year BETWEEN 2000 AND 2100);

-- 4) บัตรใบเดิมผูกซ้ำไม่ได้ (ของจริงกันด้วย fingerprint ของเลขบัตร — ที่นี่ไม่มีเลขเต็ม
--    ให้ hash จึงใช้ชุดที่เก็บไว้จริงแทน)
CREATE UNIQUE INDEX "payment_methods_user_card_uq"
  ON "payment_methods"("user_id", "last4", "exp_month", "exp_year");
