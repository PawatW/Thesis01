-- ============================================================
-- L2 — privilege audit (static: no data needed)
-- Docs: docs/testing.md §3 · rationale: docs/security-design.md
-- Run: npm run test:db
-- ============================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- ---------- RLS is on everywhere ----------
select is_empty(
  $$ select c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'ทุกตารางใน public เปิด RLS'
);

select is_empty(
  $$ select c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        and not exists (select 1 from pg_policies p
                         where p.schemaname = 'public' and p.tablename = c.relname) $$,
  'ตารางที่เปิด RLS ต้องมี policy อย่างน้อยหนึ่งอัน'
);

-- ---------- write policies declare WITH CHECK ----------
select is_empty(
  $$ select policyname || ' on ' || tablename from pg_policies
      where (schemaname = 'public' or (schemaname = 'storage' and policyname like 'anan %'))
        and cmd in ('INSERT','UPDATE','ALL') and with_check is null $$,
  'policy ที่เขียนข้อมูลได้ทุกอันประกาศ WITH CHECK'
);

-- ---------- definer hygiene ----------
select is_empty(
  $$ select p.proname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) cfg
                         where cfg like 'search_path=%') $$,
  'security definer ทุกตัวตรึง search_path'
);

select is_empty(
  $$ select p.proname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'anon เรียกฟังก์ชันใน public ไม่ได้เลย'
);

select is_empty(
  $$ select fname from (values ('due_subscriptions'),
                               ('freeze_subscriptions_for_shop'),
                               ('unfreeze_subscriptions_for_shop')) t(fname)
      where exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname='public' and p.proname = fname
                       and has_function_privilege('authenticated', p.oid, 'EXECUTE')) $$,
  'ฟังก์ชันของ engine ผู้ใช้ที่ล็อกอินเรียกไม่ได้'
);

-- ---------- columns clients must never write ----------
select ok(not has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'UPDATE'),
          'ยกระดับตัวเองเป็น admin ไม่ได้ (profiles.is_admin)');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'is_seller', 'UPDATE'),
          'ตั้ง is_seller เองไม่ได้ (มาจาก trigger เท่านั้น)');
select ok(not has_column_privilege('authenticated', 'public.shops', 'suspended_at', 'UPDATE'),
          'ร้านปลดการระงับตัวเองไม่ได้ (shops.suspended_at)');
select ok(not has_column_privilege('authenticated', 'public.products', 'suspended_at', 'UPDATE'),
          'สินค้าที่ถูกระงับ ร้านปลดเองไม่ได้');
select ok(not has_column_privilege('authenticated', 'public.products', 'shop_id', 'UPDATE'),
          'ย้ายสินค้าข้ามร้านไม่ได้');
select ok(not has_column_privilege('authenticated', 'public.product_plans', 'cycle', 'UPDATE'),
          'เปลี่ยน cycle ของแผนที่มีคนสมัครอยู่ไม่ได้');
select ok(not has_column_privilege('authenticated', 'public.orders', 'amount', 'UPDATE'),
          'ร้านแก้ยอดเงินบนออเดอร์ไม่ได้');
select ok(not has_column_privilege('authenticated', 'public.orders', 'address_snapshot', 'UPDATE'),
          'ร้านแก้ที่อยู่บนออเดอร์ไม่ได้');
select ok(not has_column_privilege('authenticated', 'public.orders', 'confirmed_at', 'UPDATE'),
          'ร้านยืนยันรับของแทนผู้ซื้อไม่ได้');
select ok(not has_column_privilege('authenticated', 'public.orders', 'cancelled_at', 'UPDATE'),
          'ยกเลิกออเดอร์ต้องผ่าน RPC (orders.cancelled_at)');
select ok(not has_column_privilege('authenticated', 'public.subscriptions', 'paused_reason', 'UPDATE'),
          'ตั้งเหตุผลการหยุดเองไม่ได้');
select ok(not has_column_privilege('authenticated', 'public.notifications', 'title', 'UPDATE'),
          'แก้ข้อความแจ้งเตือนของตัวเองไม่ได้ (แก้ได้แค่ read_at)');

-- ---------- tables clients may not write at all ----------
select is_empty(
  $$ select grantee || ' ' || priv || ' ' || tbl from (values
       ('authenticated','public.subscriptions','INSERT'),
       ('authenticated','public.subscriptions','UPDATE'),
       ('authenticated','public.subscription_events','INSERT'),
       ('authenticated','public.orders','INSERT'),
       ('authenticated','public.payments','INSERT'),
       ('authenticated','public.payments','UPDATE'),
       ('authenticated','public.notifications','INSERT'),
       ('authenticated','public.engine_runs','INSERT'),
       ('authenticated','public.order_issues','INSERT'),
       ('authenticated','public.order_issues','UPDATE'),
       ('authenticated','public.reviews','INSERT'),
       ('authenticated','public.reviews','UPDATE')
     ) t(grantee, tbl, priv)
     where has_any_column_privilege(grantee, tbl, priv) $$,
  'ตารางที่ต้องเขียนผ่าน RPC เท่านั้น ไม่มี grant ให้ client'
);

select is_empty(
  $$ select tbl from (values
       ('public.subscriptions'),('public.subscription_events'),('public.orders'),
       ('public.payments'),('public.notifications'),('public.engine_runs'),
       ('public.profiles'),('public.order_issues'),('public.reviews')
     ) t(tbl) where has_table_privilege('authenticated', tbl, 'DELETE') $$,
  'ผู้ใช้ลบข้อมูลหลักทิ้งไม่ได้ (audit trail ต้องอยู่ครบ)'
);

-- ---------- anon sees only the public catalog ----------
select is_empty(
  $$ select tbl from (values
       ('public.profiles'),('public.addresses'),('public.payment_methods'),
       ('public.subscriptions'),('public.orders'),('public.payments'),
       ('public.notifications'),('public.engine_runs'),('public.order_issues'),('public.reviews')
     ) t(tbl) where has_any_column_privilege('anon', tbl, 'SELECT') $$,
  'anon อ่านข้อมูลส่วนบุคคลไม่ได้'
);

select ok(has_table_privilege('anon', 'public.products', 'SELECT'), 'anon อ่าน catalog ได้ (products)');
select ok(has_table_privilege('anon', 'public.product_plans', 'SELECT'), 'anon อ่านแผนรอบส่งได้');

-- ---------- required client privileges still intact ----------
select is_empty(
  $$ select grantee || ' ' || priv || ' ' || tbl from (values
       ('authenticated','public.addresses','INSERT'),
       ('authenticated','public.payment_methods','INSERT'),
       ('authenticated','public.shops','INSERT'),
       ('authenticated','public.products','INSERT'),
       ('authenticated','public.product_plans','INSERT'),
       ('authenticated','public.orders','UPDATE'),
       ('authenticated','public.notifications','UPDATE')
     ) t(grantee, tbl, priv)
     where not has_any_column_privilege(grantee, tbl, priv) $$,
  'สิทธิ์ที่แอพต้องใช้จริงยังอยู่ครบ (revoke ไม่กว้างเกินไป)'
);

-- ---------- guard triggers present ----------
select is_empty(
  $$ select expected from (values
       ('guard_profile_privileges'),('sync_is_seller'),('guard_order_update'),
       ('guard_payments_append_only'),('guard_subscription_update'),
       ('enforce_single_default_address'),('notify_plan_price_change')
     ) t(expected)
     where not exists (select 1 from pg_trigger tg
                        where not tg.tgisinternal and tg.tgname = expected) $$,
  'guard trigger ครบทุกตัว'
);

-- ---------- storage ----------
select is_empty(
  $$ select id from storage.buckets
      where id in ('product-images','shop-assets','avatars')
        and (file_size_limit is null or allowed_mime_types is null) $$,
  'ทุก bucket จำกัดขนาดไฟล์และชนิดไฟล์'
);

select is('' || (select count(*) from storage.buckets where id in ('product-images','shop-assets','avatars')),
          '3', 'สร้าง bucket ครบ 3 ตัว');

-- ---------- definer views expose no buyer identifiers ----------
select is_empty(
  $$ select v.table_name || '.' || c.column_name
       from information_schema.columns c
       join information_schema.views v
         on v.table_schema = c.table_schema and v.table_name = c.table_name
      where c.table_schema = 'public'
        and v.table_name in ('product_reviews','product_stats','product_review_stats')
        and c.column_name in ('buyer_id','subscription_id','address_id','payment_method_id','user_id') $$,
  'view สาธารณะไม่มีคอลัมน์ที่ระบุตัวผู้ซื้อ'
);

select is_empty(
  $$ select c.column_name from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'seller_orders'
        and c.column_name in ('buyer_id','address_id','payment_method_id','subscription_id') $$,
  'seller_orders ไม่เปิดเผยตัวตนผู้ซื้อ (มีแค่ address_snapshot ที่ต้องใช้ส่งของ)'
);

select * from finish();
rollback;
