-- ============================================================
-- L3 — behavioral RLS test: impersonate real roles and try the forbidden things
-- Docs: docs/testing.md §3 · attack list: docs/security-rules.md §E-3
--
-- Everything here runs as `authenticated` with a real JWT claim, which is exactly
-- what a curl request past the UI looks like.
--
-- Plain SQL only — no psql meta-commands (\set), so this runs through any driver
-- including scripts/run-tests.mjs against Supabase Cloud.
-- ============================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- ---------- fixtures ----------
-- buyer A 1111… · buyer B 2222… · seller 3333… · admin 4444…

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.local', '', now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.local', '', now(), now()),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's@test.local', '', now(), now()),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'x@test.local', '', now(), now());

update public.profiles set is_admin = true where id = '44444444-4444-4444-4444-444444444444';

insert into public.categories (id, name, sort_order) values (900, 'ทดสอบ', 1);

insert into public.shops (id, owner_id, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'ร้านทดสอบ');

insert into public.products (id, shop_id, category_id, name, images, one_time_price)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 900,
        'กาแฟทดสอบ', array['x.jpg'], 320);

insert into public.product_plans (id, product_id, cycle, price_per_cycle)
values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '1m', 255);

insert into public.addresses (id, user_id, recipient_name, phone, address_line, province, postcode)
values ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ผู้ซื้อ เอ', '0812345678', '1 ถนนทดสอบ', 'กรุงเทพ', '10110'),
       ('dddddddd-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'ผู้ซื้อ บี', '0899999999', '2 ถนนทดสอบ', 'กรุงเทพ', '10120');

insert into public.payment_methods (id, user_id, last4)
values ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '4242');

insert into public.subscriptions (id, buyer_id, plan_id, address_id, payment_method_id, start_date, next_order_date)
values ('ffffffff-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
        current_date, current_date + 30);

insert into public.orders (id, subscription_id, cycle_date, amount, address_snapshot)
values ('99999999-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001',
        current_date, 255, '{"recipient_name":"ผู้ซื้อ เอ"}'::jsonb);

insert into public.payments (order_id, amount, status, paid_at)
values ('99999999-0000-0000-0000-000000000001', 255, 'paid', now());

-- ---------- buyer A ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is((select count(*) from public.subscriptions)::text, '1',
          'buyer เห็น subscription ของตัวเองเท่านั้น');
select is((select count(*) from public.addresses)::text, '1',
          'buyer เห็นที่อยู่ของตัวเองเท่านั้น (ไม่เห็นของ buyer B)');
select is((select count(*) from public.orders)::text, '1', 'buyer เห็นออเดอร์ของตัวเอง');
select is((select count(*) from public.payments)::text, '1', 'buyer เห็นการจ่ายเงินของตัวเอง');
select is((select count(*) from public.profiles)::text, '1', 'buyer เห็นโปรไฟล์ตัวเองคนเดียว');

select throws_ok(
  $$ update public.profiles set is_admin = true where id = auth.uid() $$,
  '42501', null, 'T-1 buyer ตั้งตัวเองเป็น admin ไม่ได้'
);
select throws_ok(
  $$ insert into public.payments (order_id, amount, status)
     values ('99999999-0000-0000-0000-000000000001', 0, 'paid') $$,
  '42501', null, 'T-2 buyer insert payments เองไม่ได้'
);
select throws_ok(
  $$ insert into public.orders (subscription_id, cycle_date, amount, address_snapshot)
     values ('ffffffff-0000-0000-0000-000000000001', current_date + 1, 0, '{}'::jsonb) $$,
  '42501', null, 'T-3 buyer สร้างออเดอร์ปลอมไม่ได้'
);
select throws_ok(
  $$ insert into public.subscriptions (buyer_id, plan_id, address_id, payment_method_id, start_date, next_order_date)
     values (auth.uid(), 'cccccccc-0000-0000-0000-000000000001',
             'dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
             current_date, current_date + 30) $$,
  '42501', null, 'T-4 buyer สมัคร subscription ตรงไม่ได้ (ต้องผ่าน RPC)'
);
select throws_ok(
  $$ update public.subscriptions set next_order_date = current_date + 999
      where id = 'ffffffff-0000-0000-0000-000000000001' $$,
  '42501', null, 'buyer เลื่อนรอบเองตรง ๆ ไม่ได้'
);
select throws_ok(
  $$ insert into public.subscription_events (subscription_id, event)
     values ('ffffffff-0000-0000-0000-000000000001', 'cancelled') $$,
  '42501', null, 'buyer ปลอม event ใน audit trail ไม่ได้'
);
select throws_ok(
  $$ select public.admin_stats() $$,
  '42501', 'admin only', 'T-10 บัญชีธรรมดาเรียก admin_stats ไม่ได้'
);
select throws_ok(
  $$ select public.admin_upsert_category('หมวดปลอม') $$,
  '42501', 'admin only', 'บัญชีธรรมดาเพิ่มหมวดสินค้าไม่ได้'
);

-- ---------- buyer B: no cross-tenant read ----------
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*) from public.subscriptions)::text, '0',
          'T-8 buyer B ไม่เห็น subscription ของ buyer A');
select is((select count(*) from public.orders)::text, '0',
          'buyer B ไม่เห็นออเดอร์ของคนอื่น');

-- ---------- seller ----------
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*) from public.subscriptions)::text, '0',
          'S-07 seller อ่านแถว subscriptions ไม่ได้เลย');
select is((select count(*) from public.seller_orders)::text, '1',
          'seller เห็นออเดอร์ร้านตัวเองผ่าน view');
select throws_ok(
  $$ update public.orders set status = 'delivered'
      where id = '99999999-0000-0000-0000-000000000001' $$,
  '22023', null, 'T-7 seller กระโดดสถานะ pending → delivered ไม่ได้'
);

-- ---------- anon ----------
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
-- scoped to this file's fixture so seed.sql rows cannot change the answer
select is((select count(*) from public.products
            where id = 'bbbbbbbb-0000-0000-0000-000000000001')::text,
          '1', 'anon อ่าน catalog ได้');

select * from finish();
rollback;
