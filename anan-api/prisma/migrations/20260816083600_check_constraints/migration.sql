-- ============================================================
-- ANAN — CHECK constraints + partial indexes
--
-- ★ migration นี้เขียนมือ ห้ามลบ ★
-- Prisma schema language เขียน CHECK constraint กับ partial index ไม่ได้
-- แต่กฎของโปรเจกต์ (CLAUDE.md ข้อ 4) บอกว่า "ข้อจำกัดที่เป็นความถูกต้อง
-- ของข้อมูลต้องอยู่ใน DB" — ไม่ใช่แค่ validator ใน DTO ที่ client
-- ยิง curl ข้ามได้ หรือ service ที่คนเขียนโค้ดอาจลืมเช็ค
--
-- Prisma มองไม่เห็น CHECK constraint จึงไม่ลบทิ้งเวลารัน migrate ครั้งต่อไป
-- (ต่างจาก index/unique ที่ต้องประกาศใน schema.prisma เท่านั้น)
--
-- ที่มา: docs/security-design.md ชั้น L5 · migration เดิม 20260725000001
-- ============================================================

-- ---------- 1. USERS / AUTH ----------

ALTER TABLE "users"
  ADD CONSTRAINT users_email_len   CHECK (char_length(email) BETWEEN 5 AND 254),
  ADD CONSTRAINT users_email_fmt   CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- normalize ที่ service แล้ว แต่บังคับซ้ำที่นี่: กัน 2 บัญชีที่ต่างกันแค่ตัวพิมพ์
  ADD CONSTRAINT users_email_lower CHECK (email = lower(email)),
  ADD CONSTRAINT users_display_name_len CHECK (char_length(display_name) BETWEEN 1 AND 60),
  ADD CONSTRAINT users_phone_fmt   CHECK (phone IS NULL OR phone ~ '^[0-9+\-() ]{6,20}$'),
  -- DB ปฏิเสธทุกอย่างที่ไม่ใช่ bcrypt hash — เผลอเขียน plaintext ลงไปไม่ได้เลย
  ADD CONSTRAINT users_password_is_bcrypt CHECK (password_hash ~ '^\$2[aby]\$[0-9]{2}\$');

ALTER TABLE "refresh_tokens"
  -- เก็บได้เฉพาะ sha256 hex — เผลอเก็บตัว token จริงจะไม่ผ่าน
  ADD CONSTRAINT refresh_tokens_hash_fmt CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT refresh_tokens_expiry   CHECK (expires_at > created_at);

-- ---------- 2. ที่อยู่ / บัตรจำลอง ----------

ALTER TABLE "addresses"
  ADD CONSTRAINT addresses_recipient_len CHECK (char_length(recipient_name) BETWEEN 1 AND 100),
  ADD CONSTRAINT addresses_line_len      CHECK (char_length(address_line) BETWEEN 1 AND 300),
  ADD CONSTRAINT addresses_province_len  CHECK (char_length(province) BETWEEN 1 AND 100),
  ADD CONSTRAINT addresses_postcode_fmt  CHECK (postcode ~ '^[0-9]{5}$'),
  ADD CONSTRAINT addresses_phone_fmt     CHECK (phone ~ '^[0-9+\-() ]{6,20}$'),
  ADD CONSTRAINT addresses_label_len     CHECK (label IS NULL OR char_length(label) <= 40);

-- DEMO เท่านั้น: ช่องนี้เก็บได้แค่เลข 4 ตัว จะยัดเลขบัตรเต็มลงไปไม่ได้ (CLAUDE.md ข้อ 1)
ALTER TABLE "payment_methods"
  ADD CONSTRAINT payment_methods_last4_fmt  CHECK (last4 ~ '^[0-9]{4}$'),
  ADD CONSTRAINT payment_methods_holder_len CHECK (holder_name IS NULL OR char_length(holder_name) <= 80);

-- ---------- 3. CATALOG ----------

ALTER TABLE "shops"
  ADD CONSTRAINT shops_name_len CHECK (char_length(name) BETWEEN 2 AND 80),
  ADD CONSTRAINT shops_desc_len CHECK (description IS NULL OR char_length(description) <= 1000),
  ADD CONSTRAINT shops_suspend_reason_len CHECK (suspended_reason IS NULL OR char_length(suspended_reason) <= 200),
  -- มีเหตุผลระงับได้ก็ต่อเมื่อถูกระงับจริง
  ADD CONSTRAINT shops_suspend_consistent CHECK (suspended_at IS NOT NULL OR suspended_reason IS NULL);

ALTER TABLE "products"
  ADD CONSTRAINT products_name_len   CHECK (char_length(name) BETWEEN 2 AND 120),
  ADD CONSTRAINT products_desc_len   CHECK (description IS NULL OR char_length(description) <= 2000),
  ADD CONSTRAINT products_images_len CHECK (coalesce(array_length(images, 1), 0) <= 5),
  -- เพดานราคา: numeric(10,2) overflow จาก input ผู้ใช้ = 500 ที่ควรเป็น 400
  ADD CONSTRAINT products_price_range CHECK (one_time_price > 0 AND one_time_price <= 1000000),
  ADD CONSTRAINT products_net_amount  CHECK (net_amount IS NULL OR (net_amount > 0 AND net_amount <= 1000000)),
  ADD CONSTRAINT products_unit_len    CHECK (unit IS NULL OR char_length(unit) <= 16),
  ADD CONSTRAINT products_suspend_reason_len CHECK (suspended_reason IS NULL OR char_length(suspended_reason) <= 200),
  ADD CONSTRAINT products_suspend_consistent CHECK (suspended_at IS NOT NULL OR suspended_reason IS NULL);

ALTER TABLE "product_plans"
  -- ค่านี้เป็น text แทน enum เพราะ '2w' ขึ้นต้นด้วยตัวเลข (ดูหมายเหตุใน schema.prisma)
  ADD CONSTRAINT plans_cycle_valid CHECK (cycle IN ('2w', '1m', '2m')),
  ADD CONSTRAINT plans_price_range CHECK (price_per_cycle > 0 AND price_per_cycle <= 1000000),
  ADD CONSTRAINT plans_qty_range   CHECK (qty_per_cycle BETWEEN 1 AND 100);

-- ---------- 4. SUBSCRIPTION ----------

ALTER TABLE "subscriptions"
  ADD CONSTRAINT subs_quantity_range CHECK (quantity BETWEEN 1 AND 10),
  -- "cancelled คือถาวร" (CLAUDE.md ข้อ 5) เป็นข้อเท็จจริงของฐานข้อมูล ไม่ใช่ธรรมเนียมของ UI
  ADD CONSTRAINT subs_state_consistent CHECK (
       (status = 'active'    AND next_order_date IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'paused'    AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND next_order_date IS NULL     AND cancelled_at IS NOT NULL)
  ),
  -- เหตุผลการหยุดมีได้เฉพาะตอนหยุดจริง: กัน paused_reason ค้างหลัง resume
  ADD CONSTRAINT subs_paused_reason_only_when_paused CHECK (status = 'paused' OR paused_reason IS NULL);

-- ---------- 5. ORDERS / PAYMENTS ----------

ALTER TABLE "orders"
  ADD CONSTRAINT orders_amount_range CHECK (amount >= 0 AND amount <= 10000000),
  ADD CONSTRAINT orders_tracking_len CHECK (tracking_note IS NULL OR char_length(tracking_note) <= 200),
  ADD CONSTRAINT orders_cancel_reason_len CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 200),
  ADD CONSTRAINT orders_cancel_consistent CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  -- ยืนยันรับของได้เฉพาะออเดอร์ที่ส่งแล้ว — กันการยืนยันออเดอร์ที่ยังไม่ออกจากร้าน
  ADD CONSTRAINT orders_confirm_after_ship CHECK (confirmed_at IS NULL OR status IN ('shipped', 'delivered'));

ALTER TABLE "payments"
  ADD CONSTRAINT payments_amount_range CHECK (amount >= 0 AND amount <= 10000000),
  ADD CONSTRAINT payments_paid_consistent     CHECK ((status = 'paid')     = (paid_at IS NOT NULL)),
  ADD CONSTRAINT payments_refund_consistent   CHECK ((status = 'refunded') = (refunded_at IS NOT NULL));

ALTER TABLE "order_issues"
  ADD CONSTRAINT order_issues_detail_len     CHECK (char_length(detail) BETWEEN 5 AND 1000),
  ADD CONSTRAINT order_issues_note_len       CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 1000),
  ADD CONSTRAINT order_issues_open_consistent CHECK ((status = 'open') = (resolved_at IS NULL));

ALTER TABLE "reviews"
  ADD CONSTRAINT reviews_rating_range   CHECK (rating BETWEEN 1 AND 5),
  ADD CONSTRAINT reviews_comment_len    CHECK (comment IS NULL OR char_length(comment) <= 1000),
  ADD CONSTRAINT reviews_cycles_min     CHECK (cycles_received >= 1);

-- ---------- 6. SYSTEM ----------

ALTER TABLE "notifications"
  ADD CONSTRAINT notifications_title_len CHECK (char_length(title) BETWEEN 1 AND 200),
  ADD CONSTRAINT notifications_body_len  CHECK (body IS NULL OR char_length(body) <= 1000),
  -- link ต้องเป็น path ในแอปเท่านั้น: กัน stored phishing link ในกล่องแจ้งเตือน
  ADD CONSTRAINT notifications_link_rel  CHECK (link_path IS NULL OR link_path ~ '^/[A-Za-z0-9/_\-\[\]().?=&]*$');

ALTER TABLE "engine_runs"
  ADD CONSTRAINT engine_runs_counts_nonneg CHECK (orders_created >= 0 AND notifications_created >= 0);

-- ---------- 7. PARTIAL INDEXES ----------
-- เส้นทางร้อนของ engine: "subscription ที่ active และถึงรอบแล้ว"
-- index เต็มตารางจะกวาดแถวที่ยกเลิกไปแล้วด้วย ซึ่งโตขึ้นเรื่อย ๆ ไม่มีวันลด

CREATE INDEX idx_subs_due
  ON "subscriptions" (next_order_date)
  WHERE status = 'active';

-- คิวจริงของ feature 16 คือ "ส่งแล้วแต่ผู้ซื้อยังไม่กดยืนยัน"
CREATE INDEX idx_orders_awaiting_confirm
  ON "orders" (status, cycle_date)
  WHERE confirmed_at IS NULL;
