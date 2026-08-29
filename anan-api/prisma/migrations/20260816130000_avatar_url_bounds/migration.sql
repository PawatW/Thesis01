-- ============================================================
-- ANAN — ปิดช่องว่าง "ชั้นเดียวไม่พอ" ของ users.avatar_url
--
-- ★ migration นี้เขียนมือ ห้ามลบ ★
--
-- users มี CHECK ครบทุกฟิลด์ที่ client ป้อน ยกเว้น avatar_url ซึ่งเป็น TEXT
-- ไม่จำกัดความยาว กันอยู่ที่ DTO ชั้นเดียว — ผิดกฎข้อ 9 (ต้องมีทั้ง validator
-- และ CHECK) ตอนนี้ยังไม่รั่วเพราะมีทางเข้าเดียวคือ PATCH /me แต่ Phase 4
-- (uploads + Cloudinary) กับ seed จะเขียนคอลัมน์นี้เพิ่ม
--
-- บังคับ https ด้วย: URL ปลายทางไหนก็ได้ = เจ้าของ URL เก็บ IP ของทุกคนที่
-- เปิดดูโปรไฟล์/รีวิวได้ (tracking pixel) และ http บนหน้าเว็บ https จะโดนบล็อก
-- ============================================================

ALTER TABLE "users"
  ADD CONSTRAINT users_avatar_url_len
    CHECK (avatar_url IS NULL OR char_length(avatar_url) BETWEEN 1 AND 500),
  ADD CONSTRAINT users_avatar_url_https
    CHECK (avatar_url IS NULL OR avatar_url ~ '^https://');
