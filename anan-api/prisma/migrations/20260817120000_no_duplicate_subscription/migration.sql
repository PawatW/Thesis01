-- ============================================================
-- ANAN — กฎ "ห้ามซ้ำ" 2 ข้อที่เคยอยู่แค่ในโค้ด ย้ายมาบังคับที่ฐานข้อมูล
--
-- ★ migration นี้เขียนมือ ห้ามลบ ★ (partial index เขียนใน schema.prisma ไม่ได้)
--
-- ที่มา: รีวิว security รอบ Phase 3 — ทั้งสองข้อเป็น "อ่านแล้วค่อยเขียน" ซึ่งที่
-- isolation READ COMMITTED สอง request ที่ยิงพร้อมกันมองไม่เห็นแถวที่อีกฝ่าย
-- ยังไม่ commit → ผ่านด่านทั้งคู่ (บทเรียนเดียวกับ addresses_one_default_per_user
-- และ refresh token · security-rules.md D-2/D-3)
-- ============================================================

-- ---------- 1. สมัครแผนเดิมไปที่อยู่เดิมซ้ำ ----------
-- SubscriptionsService.create() เช็คด้วย findFirst ก่อน create แต่ subscription id
-- ใหม่ทุกครั้งจึงไม่มีอะไรชนกันที่ DB เลย → กดปุ่มยืนยัน 2 ครั้งพร้อมกัน (หรือ curl
-- 2 เส้น) ได้ 2 subscription + 2 order + **ตัดเงินจำลอง 2 ครั้ง**
-- เงื่อนไขเดียวกับกฎธุรกิจเป๊ะ: ยกเลิกแล้วสมัครใหม่ได้ จึงนับเฉพาะที่ยังมีชีวิต
CREATE UNIQUE INDEX subs_one_live_per_plan_address
  ON "subscriptions" (buyer_id, plan_id, address_id)
  WHERE status IN ('active', 'paused');

-- ---------- 2. แจ้งล่วงหน้า T-3 ซ้ำ ----------
-- EngineService.notifyUpcoming() เช็คว่ามีใบเดิมหรือยังก่อน insert — cron ตี 1
-- ชนกับ admin กดปุ่ม "Run now" เมื่อไหร่ ผู้ซื้อได้แจ้งเตือนซ้ำ
-- link_path มีวันรอบฝังอยู่ (`?cycle=YYYY-MM-DD`) จึงเป็นคีย์ของ "รอบไหน" ได้จริง
CREATE UNIQUE INDEX notifications_upcoming_cycle_once
  ON "notifications" (user_id, link_path)
  WHERE type = 'upcoming_cycle';
