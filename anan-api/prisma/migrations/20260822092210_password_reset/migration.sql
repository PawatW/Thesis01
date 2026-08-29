-- AlterEnum
ALTER TYPE "refresh_token_revoked_reason" ADD VALUE 'password_reset';

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------
-- CHECK ที่ Prisma เขียนไม่ได้ (CLAUDE.md ข้อ 4 · security-design L5)
-- เพิ่มมือ — `prisma migrate dev` มองไม่เห็นของพวกนี้ จึงไม่ลบทิ้งเอง
-- ------------------------------------------------------------

-- ★ ด่านที่ทำให้ "เก็บเฉพาะ hash" เป็นรูปร่างของข้อมูล ไม่ใช่แค่มารยาทของ service ★
-- sha256 ในรูป hex = 64 ตัวเสมอ · token จริงเป็น base64url 43 ตัว เขียนลงคอลัมน์นี้ไม่ผ่าน
ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_hash_fmt"
  CHECK ("token_hash" ~ '^[0-9a-f]{64}$');

-- ตั๋วที่หมดอายุตั้งแต่วินาทีที่เกิดคือของเสีย — กันความผิดพลาดของหน่วยเวลา (วินาที/มิลลิวินาที)
ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_lifetime"
  CHECK ("expires_at" > "created_at");

-- ใช้ก่อนถูกสร้างไม่ได้
ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_used_order"
  CHECK ("used_at" IS NULL OR "used_at" >= "created_at");
