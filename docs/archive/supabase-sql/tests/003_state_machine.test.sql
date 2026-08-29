-- ============================================================
-- L3 — invariants that live in triggers and CHECK constraints
-- Docs: docs/testing.md §3 · state machine: context/workflows/w05-manage-subscription.md
--
-- These are the rules the UI is NOT allowed to be the only enforcer of.
-- ============================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- ---------- fixtures ----------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('11111111-2222-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sm-buyer@test.local', '', now(), now()),
  ('11111111-2222-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sm-seller@test.local', '', now(), now()),
  ('11111111-2222-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sm-admin@test.local', '', now(), now());

update public.profiles set is_admin = true where id = '11111111-2222-0000-0000-000000000003';

insert into public.categories (id, name, sort_order) values (901, 'ทดสอบสถานะ', 1);
insert into public.shops (id, owner_id, name)
values ('a1a1a1a1-0000-0000-0000-000000000001', '11111111-2222-0000-0000-000000000002', 'ร้านสถานะ');
insert into public.products (id, shop_id, category_id, name, images, one_time_price)
values ('b1b1b1b1-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001', 901, 'สินค้าทดสอบ', array['x.jpg'], 300);
insert into public.product_plans (id, product_id, cycle, price_per_cycle)
values ('c1c1c1c1-0000-0000-0000-000000000001', 'b1b1b1b1-0000-0000-0000-000000000001', '1m', 250);
insert into public.addresses (id, user_id, recipient_name, phone, address_line, province, postcode, is_default)
values ('d1d1d1d1-0000-0000-0000-000000000001', '11111111-2222-0000-0000-000000000001', 'ผู้รับ', '0812345678', 'ที่อยู่ 1', 'กรุงเทพ', '10110', true);
insert into public.payment_methods (id, user_id, last4)
values ('e1e1e1e1-0000-0000-0000-000000000001', '11111111-2222-0000-0000-000000000001', '4242');
insert into public.subscriptions (id, buyer_id, plan_id, address_id, payment_method_id, start_date, next_order_date)
values ('f1f1f1f1-0000-0000-0000-000000000001', '11111111-2222-0000-0000-000000000001',
        'c1c1c1c1-0000-0000-0000-000000000001', 'd1d1d1d1-0000-0000-0000-000000000001',
        'e1e1e1e1-0000-0000-0000-000000000001', current_date, current_date + 30);
insert into public.orders (id, subscription_id, cycle_date, amount, address_snapshot)
values ('01010101-0000-0000-0000-000000000001', 'f1f1f1f1-0000-0000-0000-000000000001',
        current_date, 250, '{"recipient_name":"ผู้รับ"}'::jsonb);
insert into public.payments (order_id, amount, status, paid_at)
values ('01010101-0000-0000-0000-000000000001', 250, 'paid', now());

-- ---------- signup trigger sanitizes what the client controls ----------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_user_meta_data, created_at, updated_at)
values ('11111111-2222-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'long@test.local', '', jsonb_build_object('display_name', repeat('ก', 300), 'is_admin', true), now(), now());

select is(
  (select char_length(display_name) from public.profiles where id = '11111111-2222-0000-0000-000000000009')::text,
  '60', 'display_name ที่ยาวเกินถูกตัดเหลือ 60 ตัวใน trigger');
select is(
  (select is_admin from public.profiles where id = '11111111-2222-0000-0000-000000000009')::text,
  'false', 'ส่ง is_admin มาใน metadata ตอนสมัครแล้วไม่มีผล');

-- ---------- addresses: exactly one default ----------
insert into public.addresses (id, user_id, recipient_name, phone, address_line, province, postcode, is_default)
values ('d1d1d1d1-0000-0000-0000-000000000002', '11111111-2222-0000-0000-000000000001', 'ผู้รับ 2', '0899999999', 'ที่อยู่ 2', 'กรุงเทพ', '10120', true);

select is((select count(*) from public.addresses
            where user_id = '11111111-2222-0000-0000-000000000001' and is_default)::text,
          '1', 'ตั้งที่อยู่หลักใหม่แล้วอันเก่าถูกปลดอัตโนมัติ');

select throws_ok(
  $$ delete from public.addresses where id = 'd1d1d1d1-0000-0000-0000-000000000001' $$,
  '23503', null, 'ลบที่อยู่ที่ subscription ใช้อยู่ไม่ได้ และได้ข้อความไทย');

-- ---------- is_seller is derived from shop ownership ----------
-- Uses a second, empty shop: a shop whose products have subscribers cannot be
-- deleted at all (FK restrict), which is itself the behaviour we want.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('11111111-2222-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sm-seller2@test.local', '', now(), now());

select is((select is_seller from public.profiles where id = '11111111-2222-0000-0000-000000000002')::text,
          'true', 'เปิดร้านแล้ว is_seller เป็น true อัตโนมัติ');

insert into public.shops (id, owner_id, name)
values ('a2a2a2a2-0000-0000-0000-000000000002', '11111111-2222-0000-0000-000000000004', 'ร้านว่าง');
delete from public.shops where id = 'a2a2a2a2-0000-0000-0000-000000000002';
select is((select is_seller from public.profiles where id = '11111111-2222-0000-0000-000000000004')::text,
          'false', 'ลบร้านแล้ว is_seller กลับเป็น false');

select throws_ok(
  $$ delete from public.shops where id = 'a1a1a1a1-0000-0000-0000-000000000001' $$,
  '23503', null, 'ลบร้านที่ยังมี subscriber ไม่ได้ (FK restrict)');

-- ---------- orders: money is immutable, ladder is one step at a time ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-2222-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ update public.orders set status = 'shipped'
      where id = '01010101-0000-0000-0000-000000000001' $$,
  '22023', null, 'ข้ามจาก pending ไป shipped ไม่ได้');
reset role;

-- ---------- payments are append-only for clients ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-2222-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ update public.payments set status = 'refunded'
      where order_id = '01010101-0000-0000-0000-000000000001' $$,
  '42501', null, 'ผู้ซื้อแก้สถานะการจ่ายเงินเองไม่ได้');
reset role;

-- ---------- subscription state machine ----------
update public.subscriptions
   set status = 'paused', paused_at = now(), paused_reason = 'user'
 where id = 'f1f1f1f1-0000-0000-0000-000000000001';

select is((select paused_reason from public.subscriptions where id = 'f1f1f1f1-0000-0000-0000-000000000001'),
          'user', 'หยุดชั่วคราวเองบันทึกเหตุผลเป็น user');

-- cancel from paused must work — the constraint used to reject this (agent finding #2)
update public.subscriptions
   set status = 'cancelled', cancelled_at = now(), next_order_date = null
 where id = 'f1f1f1f1-0000-0000-0000-000000000001';
select is((select paused_reason from public.subscriptions where id = 'f1f1f1f1-0000-0000-0000-000000000001'),
          null, 'ยกเลิกจากสถานะ paused ได้ และ paused_reason ถูกล้างให้อัตโนมัติ');

select throws_ok(
  $$ update public.subscriptions set status = 'active', next_order_date = current_date + 30
      where id = 'f1f1f1f1-0000-0000-0000-000000000001' $$,
  '22023', null, 'cancelled กลับมา active ไม่ได้ (ถาวรจริง)');

-- ---------- admin moderation freezes billing ----------
insert into public.subscriptions (id, buyer_id, plan_id, address_id, payment_method_id, start_date, next_order_date)
values ('f1f1f1f1-0000-0000-0000-000000000002', '11111111-2222-0000-0000-000000000001',
        'c1c1c1c1-0000-0000-0000-000000000001', 'd1d1d1d1-0000-0000-0000-000000000002',
        'e1e1e1e1-0000-0000-0000-000000000001', current_date, current_date);

-- scoped to this file's shop: seed.sql also has subscriptions due today
select is((select count(*) from public.due_subscriptions(current_date)
            where shop_id = 'a1a1a1a1-0000-0000-0000-000000000001')::text, '1',
          'subscription ที่ถึงรอบอยู่ในคิวของ engine');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-2222-0000-0000-000000000003","role":"authenticated"}';
select is(public.admin_set_shop_suspension('a1a1a1a1-0000-0000-0000-000000000001', true, 'ทดสอบระงับ')::text,
          '1', 'ระงับร้าน → แช่แข็ง subscription 1 รายการ');
reset role;

select is((select status || '/' || paused_reason from public.subscriptions
            where id = 'f1f1f1f1-0000-0000-0000-000000000002'),
          'paused/shop_suspended', 'subscription ถูกหยุดพร้อมเหตุผล shop_suspended');
select is((select count(*) from public.due_subscriptions(current_date)
            where shop_id = 'a1a1a1a1-0000-0000-0000-000000000001')::text, '0',
          'ร้านถูกระงับแล้ว engine ไม่เรียกเก็บเงินอีก');
select throws_ok(
  $$ update public.subscriptions set status = 'active'
      where id = 'f1f1f1f1-0000-0000-0000-000000000002' $$,
  '22023', null, 'ผู้ซื้อ resume รายการที่ถูกแช่แข็งเองไม่ได้');

-- ---------- price change must reach the buyer ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-2222-0000-0000-000000000003","role":"authenticated"}';
select ok(public.admin_set_shop_suspension('a1a1a1a1-0000-0000-0000-000000000001', false) >= 0,
          'ปลดระงับร้านสำเร็จ');
reset role;

update public.product_plans set price_per_cycle = 299
 where id = 'c1c1c1c1-0000-0000-0000-000000000001';

select is((select count(*) from public.notifications
            where type = 'price_changed' and user_id = '11111111-2222-0000-0000-000000000001')::text,
          '1', 'ขึ้นราคาแล้ว subscriber ได้รับแจ้งเตือนทันที');

select * from finish();
rollback;
