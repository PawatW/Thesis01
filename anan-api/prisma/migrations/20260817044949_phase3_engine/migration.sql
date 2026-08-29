-- ============================================================
-- ANAN — Phase 3: recurring engine + จัดการ subscription
--
-- ★ migration นี้แก้มือหลัง generate ★ (เหมือน *_check_constraints)
-- 1) Prisma เขียน `ADD COLUMN ... NOT NULL` ตรง ๆ ซึ่งรันไม่ได้กับตารางที่มีข้อมูล
--    จึงเติมค่าย้อนหลังจาก start_date ก่อนแล้วค่อยบังคับ NOT NULL
-- 2) CHECK ท้ายไฟล์ Prisma schema language เขียนไม่ได้ — ห้ามลบ (CLAUDE.md ข้อ 4)
-- ============================================================

-- CreateEnum
CREATE TYPE "refresh_token_revoked_reason" AS ENUM ('rotated', 'logout', 'reuse');

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "revoked_reason" "refresh_token_revoked_reason";

-- token ที่ถูกเพิกถอนไว้ก่อนมี migration นี้ ไม่รู้ว่าเพราะอะไร — ถือว่า 'rotated'
-- (ค่าที่เข้มกว่า: การใช้ซ้ำยังถูกมองว่า token รั่วเหมือนพฤติกรรมเดิม)
UPDATE "refresh_tokens" SET "revoked_reason" = 'rotated' WHERE "revoked_at" IS NOT NULL;

-- AlterTable — หมุดของกริดรอบ (ดูคำอธิบายใน schema.prisma)
ALTER TABLE "subscriptions" ADD COLUMN "cycle_anchor_date" DATE;
UPDATE "subscriptions" SET "cycle_anchor_date" = "start_date" WHERE "cycle_anchor_date" IS NULL;
ALTER TABLE "subscriptions" ALTER COLUMN "cycle_anchor_date" SET NOT NULL;

-- ---------- CHECK (เขียนมือ) ----------

ALTER TABLE "refresh_tokens"
  -- เหตุผลมีได้เฉพาะตอนถูกเพิกถอนจริง และถูกเพิกถอนแล้วต้องบอกเหตุผลเสมอ:
  -- ถ้า reason หายไป การใช้ซ้ำของ token ที่ logout ไปแล้วจะถูกตีความผิดเป็น token รั่ว
  -- แล้วเจ้าของบัญชีจะถูกเตะออกทุกเครื่อง (A-8 ใน security-design §5)
  ADD CONSTRAINT refresh_tokens_revoke_consistent
    CHECK (("revoked_at" IS NULL) = ("revoked_reason" IS NULL));
