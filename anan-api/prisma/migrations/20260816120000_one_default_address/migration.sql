-- ============================================================
-- ANAN — "ที่อยู่หลักมีได้อันเดียวต่อผู้ใช้" ต้องเป็นข้อเท็จจริงของ DB
--
-- ★ migration นี้เขียนมือ ห้ามลบ ★
--
-- เดิมบังคับด้วย logic ใน AddressesService (clearDefault แล้วค่อยเขียน)
-- ซึ่งอยู่ใน $transaction เดียวจริง แต่ Postgres ใช้ READ COMMITTED เป็นค่าเริ่มต้น
-- ทรานแซกชัน 2 ตัวที่ยิงพร้อมกันจึงมองไม่เห็นแถวที่อีกฝ่ายยังไม่ commit
-- → clearDefault ทั้งคู่ไม่เจออะไร → จบด้วยที่อยู่หลัก 2 อัน
--
-- ของเดิมในสถาปัตยกรรม Supabase มี trigger `enforce_single_default_address`
-- ตอนย้ายมา NestJS ด่านนี้หายไป — unique index คืนมันกลับมาในรูปที่ถูกกว่าเดิม
-- (CLAUDE.md ข้อ 4 · security-rules.md D-3)
-- ============================================================

-- ล้างข้อมูลที่ผิดกติกาอยู่ก่อน (ถ้ามี) — เก็บอันที่เก่าที่สุดไว้เป็นตัวหลัก
UPDATE "addresses" a
   SET is_default = false
 WHERE a.is_default
   AND a.id <> (
     SELECT b.id FROM "addresses" b
      WHERE b.user_id = a.user_id AND b.is_default
      ORDER BY b.created_at, b.id
      LIMIT 1
   );

CREATE UNIQUE INDEX addresses_one_default_per_user
  ON "addresses" (user_id)
  WHERE is_default;
