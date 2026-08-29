-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('shop_suspended', 'shop_unsuspended', 'product_suspended', 'product_unsuspended', 'category_created', 'category_updated', 'category_deleted', 'mail_settings_updated', 'engine_run_manual', 'password_reset_completed');

-- CreateEnum
CREATE TYPE "email_log_status" AS ENUM ('sent', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "mail_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "redirect_enabled" BOOLEAN NOT NULL DEFAULT false,
    "redirect_to" TEXT,
    "redirect_cc" TEXT,
    "smtp_host" TEXT,
    "smtp_port" INTEGER,
    "smtp_secure" BOOLEAN NOT NULL DEFAULT false,
    "mail_from" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "mail_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "actor_id" UUID,
    "action" "audit_action" NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "summary" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "to_intended" TEXT NOT NULL,
    "to_actual" TEXT NOT NULL,
    "cc_actual" TEXT,
    "redirected" BOOLEAN NOT NULL DEFAULT false,
    "status" "email_log_status" NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at" DESC);

-- CreateIndex
CREATE INDEX "email_logs_created_at_idx" ON "email_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "email_logs_status_created_at_idx" ON "email_logs"("status", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ------------------------------------------------------------
-- CHECK + แถวตั้งต้น ที่ Prisma เขียนเองไม่ได้ (CLAUDE.md ข้อ 4)
-- เพิ่มมือ — `prisma migrate dev` มองไม่เห็นของพวกนี้ จึงไม่ลบทิ้งเอง
-- ------------------------------------------------------------

-- ---------- mail_settings ----------

-- แถวเดียวเสมอ: ถ้ามีหลายแถว จะไม่มีทางรู้ว่าแถวไหนคือ "ค่าที่ใช้อยู่จริง"
ALTER TABLE "mail_settings"
  ADD CONSTRAINT "mail_settings_singleton" CHECK ("id" = 1);

-- ★ กฎที่สำคัญที่สุดของตารางนี้ ★
-- "เปิดโหมดเปลี่ยนเส้นทางแต่ไม่มีปลายทาง" ต้องเป็นไปไม่ได้ ไม่ใช่แค่ไม่ควรเกิด —
-- สภาพนั้นแปลว่าอีเมลทุกฉบับของระบบหายไปเงียบ ๆ โดยไม่มีใครรู้
ALTER TABLE "mail_settings"
  ADD CONSTRAINT "mail_settings_redirect_needs_target"
  CHECK ("redirect_enabled" = false OR "redirect_to" IS NOT NULL);

ALTER TABLE "mail_settings"
  ADD CONSTRAINT "mail_settings_redirect_to_fmt"
  CHECK ("redirect_to" IS NULL
         OR "redirect_to" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- รายการ Cc คั่นด้วย comma — ทุกตัวต้องเป็นอีเมล (เว้นวรรคหลัง comma ได้)
ALTER TABLE "mail_settings"
  ADD CONSTRAINT "mail_settings_redirect_cc_fmt"
  CHECK ("redirect_cc" IS NULL
         OR "redirect_cc" ~ '^[^@[:space:],]+@[^@[:space:],]+\.[^@[:space:],]+( *, *[^@[:space:],]+@[^@[:space:],]+\.[^@[:space:],]+)*$');

ALTER TABLE "mail_settings"
  ADD CONSTRAINT "mail_settings_port_range"
  CHECK ("smtp_port" IS NULL OR ("smtp_port" BETWEEN 1 AND 65535));

-- ชื่อโฮสต์ห้ามมีช่องว่างหรือบรรทัดใหม่ — กันการยัดอะไรแปลก ๆ ลงคอนฟิกของ transporter
ALTER TABLE "mail_settings"
  ADD CONSTRAINT "mail_settings_host_fmt"
  CHECK ("smtp_host" IS NULL
         OR ("smtp_host" ~ '^[A-Za-z0-9._-]+$' AND char_length("smtp_host") BETWEEN 1 AND 255));

ALTER TABLE "mail_settings"
  ADD CONSTRAINT "mail_settings_from_len"
  CHECK ("mail_from" IS NULL
         OR (char_length("mail_from") BETWEEN 1 AND 200 AND "mail_from" !~ '[\r\n]'));

ALTER TABLE "mail_settings"
  ADD CONSTRAINT "mail_settings_cc_len"
  CHECK ("redirect_cc" IS NULL OR char_length("redirect_cc") <= 500);

-- แถวตั้งต้น: ปิดโหมดไว้ และไม่ทับค่าอะไรใน .env เลย
INSERT INTO "mail_settings" ("id", "updated_at") VALUES (1, now())
  ON CONFLICT ("id") DO NOTHING;

-- ---------- audit_logs ----------

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_summary_len"
  CHECK (char_length("summary") BETWEEN 1 AND 500);

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_target_len"
  CHECK (("target_type" IS NULL OR char_length("target_type") <= 40)
     AND ("target_id"   IS NULL OR char_length("target_id")   <= 100));

-- ---------- email_logs ----------

-- ★ ธง `redirected` โกหกไม่ได้ ★ ถ้าบอกว่าไม่ได้เปลี่ยนเส้นทาง ปลายทางต้องตรงกับ
-- ผู้รับจริง — ไม่งั้นหน้า log จะแสดงว่า "ส่งถึงเจ้าตัวแล้ว" ทั้งที่เมลไปเข้ากล่องอื่น
ALTER TABLE "email_logs"
  ADD CONSTRAINT "email_logs_redirect_consistent"
  CHECK ("redirected" OR "to_actual" = "to_intended");

-- เหตุผลต้องมาคู่กับความล้มเหลวเสมอ (รูปแบบเดียวกับ refresh_tokens_revoke_consistent)
ALTER TABLE "email_logs"
  ADD CONSTRAINT "email_logs_error_consistent"
  CHECK (("status" = 'failed') = ("error" IS NOT NULL));

ALTER TABLE "email_logs"
  ADD CONSTRAINT "email_logs_lengths"
  CHECK (char_length("kind") BETWEEN 1 AND 40
     AND char_length("to_intended") BETWEEN 3 AND 254
     AND char_length("to_actual")   BETWEEN 3 AND 254
     AND ("cc_actual" IS NULL OR char_length("cc_actual") <= 500)
     AND ("error"     IS NULL OR char_length("error")     <= 500));
