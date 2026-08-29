-- ============================================================
-- L3 — the write RPCs: happy path + "not yours" + "wrong state"
-- Docs: docs/testing.md §3 · contracts: docs/security-design.md §5
-- ============================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- ---------- fixtures ----------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('aaaa0000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rpc-buyer@test.local', '', now(), now()),
  ('aaaa0000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rpc-other@test.local', '', now(), now()),
  ('aaaa0000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rpc-seller@test.local', '', now(), now());

insert into public.categories (id, name, sort_order) values (902, 'ทดสอบ RPC', 1);
insert into public.shops (id, owner_id, name)
values ('bbbb0000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000003', 'ร้าน RPC');
insert into public.products (id, shop_id, category_id, name, images, one_time_price)
values ('cccc0000-0000-4000-8000-000000000001', 'bbbb0000-0000-4000-8000-000000000001', 902, 'สินค้า RPC', array['a.jpg'], 400);
insert into public.product_plans (id, product_id, cycle, price_per_cycle, qty_per_cycle) values
  ('dddd0000-0000-4000-8000-000000000001', 'cccc0000-0000-4000-8000-000000000001', '1m', 300, 1),
  ('dddd0000-0000-4000-8000-000000000002', 'cccc0000-0000-4000-8000-000000000001', '2m', 560, 2),
  ('dddd0000-0000-4000-8000-000000000003', 'cccc0000-0000-4000-8000-000000000001', '2w', 160, 1);
update public.product_plans set is_active = false where id = 'dddd0000-0000-4000-8000-000000000003';

-- a second product, to prove a plan change cannot jump products
insert into public.products (id, shop_id, category_id, name, images, one_time_price)
values ('cccc0000-0000-4000-8000-000000000002', 'bbbb0000-0000-4000-8000-000000000001', 902, 'สินค้าอื่น', array['b.jpg'], 200);
insert into public.product_plans (id, product_id, cycle, price_per_cycle)
values ('dddd0000-0000-4000-8000-000000000004', 'cccc0000-0000-4000-8000-000000000002', '1m', 150);

insert into public.addresses (id, user_id, recipient_name, phone, address_line, province, postcode, is_default) values
  ('eeee0000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001', 'ผู้ซื้อ RPC', '0812345678', 'ที่อยู่ A', 'กรุงเทพ', '10110', true),
  ('eeee0000-0000-4000-8000-000000000002', 'aaaa0000-0000-4000-8000-000000000001', 'ผู้ซื้อ RPC', '0812345678', 'ที่อยู่ B', 'กรุงเทพ', '10120', false),
  ('eeee0000-0000-4000-8000-000000000009', 'aaaa0000-0000-4000-8000-000000000002', 'คนอื่น', '0899999999', 'ที่อยู่คนอื่น', 'กรุงเทพ', '10130', true);
insert into public.payment_methods (id, user_id, last4) values
  ('ffff0000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001', '4242'),
  ('ffff0000-0000-4000-8000-000000000009', 'aaaa0000-0000-4000-8000-000000000002', '9999');

-- ---------- checkout ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaa0000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ select public.subscribe_to_plan('dddd0000-0000-4000-8000-000000000001',
       'eeee0000-0000-4000-8000-000000000001', 'ffff0000-0000-4000-8000-000000000001', 2) $$,
  'สมัครสำเร็จด้วยข้อมูลที่ถูกต้อง');

select is((select count(*) from public.subscriptions where buyer_id = auth.uid())::text, '1',
          'เกิด subscription 1 รายการ');
select is((select amount::text from public.orders o
            join public.subscriptions s on s.id = o.subscription_id
           where s.buyer_id = auth.uid()), '600.00',
          'ยอดคำนวณจากราคาใน DB × จำนวน (300 × 2) ไม่ใช่ค่าที่ client ส่งมา');
select is((select p.status from public.payments p
            join public.orders o on o.id = p.order_id
            join public.subscriptions s on s.id = o.subscription_id
           where s.buyer_id = auth.uid()), 'paid',
          'ตัดเงินจำลองเกิดในทรานแซกชันเดียวกัน');
select is((select count(*) from public.subscription_events e
            join public.subscriptions s on s.id = e.subscription_id
           where s.buyer_id = auth.uid() and e.event = 'created')::text, '1',
          'บันทึก event created ให้อัตโนมัติ');
select is((select next_order_date - start_date from public.subscriptions where buyer_id = auth.uid())::text,
          '31', 'next_order_date = วันเริ่ม + 1 เดือน');

-- S-04: FKs that belong to someone else must be rejected
select throws_ok(
  $$ select public.subscribe_to_plan('dddd0000-0000-4000-8000-000000000001',
       'eeee0000-0000-4000-8000-000000000009', 'ffff0000-0000-4000-8000-000000000001') $$,
  '42501', null, 'T-12 ใช้ที่อยู่ของคนอื่นไม่ได้');
select throws_ok(
  $$ select public.subscribe_to_plan('dddd0000-0000-4000-8000-000000000001',
       'eeee0000-0000-4000-8000-000000000001', 'ffff0000-0000-4000-8000-000000000009') $$,
  '42501', null, 'ใช้บัตรของคนอื่นไม่ได้');
select throws_ok(
  $$ select public.subscribe_to_plan('dddd0000-0000-4000-8000-000000000003',
       'eeee0000-0000-4000-8000-000000000001', 'ffff0000-0000-4000-8000-000000000001') $$,
  '22023', null, 'สมัครแผนที่ปิดรับแล้วไม่ได้');
select throws_ok(
  $$ select public.subscribe_to_plan('dddd0000-0000-4000-8000-000000000001',
       'eeee0000-0000-4000-8000-000000000001', 'ffff0000-0000-4000-8000-000000000001', 99) $$,
  '22023', null, 'จำนวนเกิน 10 ไม่ได้');
select throws_ok(
  $$ select public.subscribe_to_plan('dddd0000-0000-4000-8000-000000000001',
       'eeee0000-0000-4000-8000-000000000001', 'ffff0000-0000-4000-8000-000000000001', 1,
       current_date + 60) $$,
  '22023', null, 'เลือกวันเริ่มเกิน 14 วันไม่ได้');

-- ---------- the seven actions ----------
create temporary table t_sub as
  select id from public.subscriptions where buyer_id = auth.uid() limit 1;

select lives_ok(
  $$ select public.skip_next_cycle((select id from t_sub)) $$,
  'ข้ามรอบได้');
select is((select count(*) from public.subscription_events
            where subscription_id = (select id from t_sub) and event = 'skipped')::text,
          '1', 'ข้ามรอบแล้วมี event skipped คู่กันเสมอ');

select lives_ok($$ select public.pause_subscription((select id from t_sub)) $$, 'หยุดชั่วคราวได้');
select is((select status || '/' || paused_reason from public.subscriptions where id = (select id from t_sub)),
          'paused/user', 'บันทึกว่าเป็นการหยุดโดยผู้ใช้เอง');
select throws_ok(
  $$ select public.skip_next_cycle((select id from t_sub)) $$,
  '22023', null, 'ข้ามรอบตอนที่หยุดอยู่ไม่ได้');

select lives_ok($$ select public.resume_subscription((select id from t_sub)) $$, 'กลับมาใช้งานได้');
select ok((select next_order_date from public.subscriptions where id = (select id from t_sub))
          > (now() at time zone 'Asia/Bangkok')::date,
          'resume แล้วรอบถัดไปต้องเป็นอนาคตเสมอ (ไม่ยิงย้อนหลัง)');

select lives_ok(
  $$ select public.change_subscription_plan((select id from t_sub), 'dddd0000-0000-4000-8000-000000000002') $$,
  'เปลี่ยนรอบส่งภายในสินค้าเดิมได้');
select throws_ok(
  $$ select public.change_subscription_plan((select id from t_sub), 'dddd0000-0000-4000-8000-000000000004') $$,
  '22023', null, 'เปลี่ยนไปแผนของสินค้าอื่นไม่ได้');

select lives_ok(
  $$ select public.change_subscription_address((select id from t_sub), 'eeee0000-0000-4000-8000-000000000002') $$,
  'เปลี่ยนที่อยู่เป็นของตัวเองได้');
select throws_ok(
  $$ select public.change_subscription_address((select id from t_sub), 'eeee0000-0000-4000-8000-000000000009') $$,
  '42501', null, 'เปลี่ยนไปที่อยู่ของคนอื่นไม่ได้');

select throws_ok(
  $$ select public.reschedule_subscription((select id from t_sub), current_date) $$,
  '22023', null, 'เลื่อนไปวันนี้หรือย้อนหลังไม่ได้');

select lives_ok($$ select public.cancel_subscription((select id from t_sub)) $$, 'ยกเลิกได้');
select is((select status from public.subscriptions where id = (select id from t_sub)), 'cancelled',
          'สถานะเป็น cancelled และ next_order_date ถูกล้าง');
select throws_ok(
  $$ select public.pause_subscription((select id from t_sub)) $$,
  '22023', null, 'ยกเลิกแล้วสั่งอะไรต่อไม่ได้');

-- ---------- another user cannot touch it ----------
set local request.jwt.claims = '{"sub":"aaaa0000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select public.cancel_subscription((select id from t_sub)) $$,
  '42501', 'ไม่พบรายการนี้', 'คนอื่นยกเลิก subscription ของเราไม่ได้');

select * from finish();
rollback;
