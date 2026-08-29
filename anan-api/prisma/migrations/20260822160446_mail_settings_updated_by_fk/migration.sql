-- ★ ล้างค่ากำพร้าก่อนผูก FK ★
-- คอลัมน์นี้เคยไม่มี FK มาก่อน เครื่องที่ใช้งานมาแล้วจึงอาจมี uuid ของบัญชีที่ถูกลบไป
-- ค้างอยู่ (เช่น ผู้ใช้ของเทสที่ถูก cleanup) — ซึ่งเป็นเหตุผลทั้งหมดที่ต้องมี FK ตัวนี้
UPDATE "mail_settings" ms
   SET "updated_by_id" = NULL
 WHERE "updated_by_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u.id = ms."updated_by_id");

-- AddForeignKey
ALTER TABLE "mail_settings" ADD CONSTRAINT "mail_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
