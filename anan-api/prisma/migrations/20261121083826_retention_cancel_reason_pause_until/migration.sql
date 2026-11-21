-- CreateEnum
CREATE TYPE "subscription_cancel_reason" AS ENUM ('too_expensive', 'too_much_stock', 'taking_break', 'quality', 'switching', 'other');

-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE 'early_order';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "subscription_event_type" ADD VALUE 'quantity_changed';
ALTER TYPE "subscription_event_type" ADD VALUE 'ordered_early';

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "cancel_note" TEXT,
ADD COLUMN     "cancel_reason" "subscription_cancel_reason",
ADD COLUMN     "resume_on" DATE;

-- ---------- เขียนมือ: ข้อจำกัดของ Phase 8.3 (Prisma มองไม่เห็น CHECK) ----------

-- เหตุผลการยกเลิกมีได้เฉพาะรายการที่ยกเลิกแล้ว — กันเหตุผลค้างบนรายการที่ยังมีชีวิต
-- (ไม่บังคับ NOT NULL ตอน cancelled เพราะแถวที่ยกเลิกก่อน migration นี้ไม่มีเหตุผล
--  ด่าน "ต้องระบุเหตุผล" ของรายการใหม่อยู่ที่ CancelSubscriptionDto)
ALTER TABLE "subscriptions"
  ADD CONSTRAINT subs_cancel_reason_only_when_cancelled
    CHECK (cancel_reason IS NULL OR status = 'cancelled'),
  -- note เป็นคำอธิบายของเหตุผล ไม่มีเหตุผลก็ไม่มี note
  ADD CONSTRAINT subs_cancel_note_needs_reason
    CHECK (cancel_note IS NULL OR cancel_reason IS NOT NULL),
  ADD CONSTRAINT subs_cancel_note_len
    CHECK (cancel_note IS NULL OR char_length(cancel_note) BETWEEN 1 AND 200),
  -- วันกลับมามีได้เฉพาะการหยุดที่ผู้ซื้อตั้งเอง — การแช่แข็งของแอดมินไม่มีวันหมดอายุ
  ADD CONSTRAINT subs_resume_on_only_user_pause
    CHECK (resume_on IS NULL OR (status = 'paused' AND paused_reason = 'user'));
