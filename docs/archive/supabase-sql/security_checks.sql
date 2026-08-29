-- ============================================================
-- ANAN — automated security assertions
-- Run in Supabase SQL Editor (or `supabase db execute -f`) after every migration.
-- Checklist: docs/security-rules.md §E-2 | Rationale: docs/security-design.md
--
-- PASS = query 1 returns ZERO rows. Anything listed is a real finding.
-- ============================================================

-- ---------- 1. FAILURES (must be empty) ----------
with
-- 1.1 every public table must have RLS enabled
rls_off as (
  select 'RLS disabled: public.' || c.relname as finding
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and not c.relrowsecurity
),
-- 1.2 RLS enabled but no policy at all = table is invisible/unusable (usually a mistake)
rls_no_policy as (
  select 'RLS on but no policy: public.' || c.relname as finding
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = c.relname)
     and c.relname <> 'engine_runs'   -- has an admin-read policy; keep the guard honest if that changes
),
-- 1.3 write policies must state WITH CHECK explicitly (rule C-3).
--     storage.objects is included: an UPDATE policy without WITH CHECK lets a file
--     be renamed into someone else's folder.
policy_no_check as (
  select format('policy without WITH CHECK: %s on %s.%s (%s)',
                policyname, schemaname, tablename, cmd) as finding
    from pg_policies
   where (schemaname = 'public' or (schemaname = 'storage' and policyname like 'anan %'))
     and cmd in ('INSERT', 'UPDATE', 'ALL')
     and with_check is null
),
-- 1.4 security definer functions must pin search_path (rule C-5)
definer_no_path as (
  select 'SECURITY DEFINER without search_path: ' || p.proname as finding
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
                      where cfg like 'search_path=%')
),
-- 1.5 nothing in public may be callable by anon (rule C-5)
anon_callable as (
  select 'anon can EXECUTE: ' || p.proname as finding
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'EXECUTE')
),
-- 1.5b engine-only functions must not be reachable by logged-in users either
engine_only_callable as (
  select 'authenticated can EXECUTE engine-only function: ' || fname as finding
    from (values ('due_subscriptions'),
                 ('freeze_subscriptions_for_shop'),
                 ('unfreeze_subscriptions_for_shop')) as t(fname)
   where exists (select 1 from pg_proc p
                   join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = fname
                    and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
),
-- 1.6a write/read privileges that must NOT exist anywhere on the table.
--     has_any_column_privilege also catches column-level grants, which
--     has_table_privilege alone would miss.
forbidden_table as (
  select format('%s has %s on %s', grantee, priv, tbl) as finding
    from (values
      ('authenticated', 'public.subscriptions',       'INSERT'),
      ('authenticated', 'public.subscriptions',       'UPDATE'),
      ('authenticated', 'public.subscription_events', 'INSERT'),
      ('authenticated', 'public.subscription_events', 'UPDATE'),
      ('authenticated', 'public.orders',              'INSERT'),
      ('authenticated', 'public.payments',            'INSERT'),
      ('authenticated', 'public.payments',            'UPDATE'),
      ('authenticated', 'public.notifications',       'INSERT'),
      ('authenticated', 'public.engine_runs',         'INSERT'),
      ('authenticated', 'public.engine_runs',         'UPDATE'),
      ('authenticated', 'public.profiles',            'INSERT'),
      ('authenticated', 'public.order_issues',        'INSERT'),
      ('authenticated', 'public.order_issues',        'UPDATE'),
      ('authenticated', 'public.reviews',             'INSERT'),
      ('authenticated', 'public.reviews',             'UPDATE'),
      ('anon',          'public.order_issues',        'SELECT'),
      ('anon',          'public.reviews',             'SELECT'),
      ('anon',          'public.profiles',            'SELECT'),
      ('anon',          'public.addresses',           'SELECT'),
      ('anon',          'public.payment_methods',     'SELECT'),
      ('anon',          'public.subscriptions',       'SELECT'),
      ('anon',          'public.orders',              'SELECT'),
      ('anon',          'public.payments',            'SELECT'),
      ('anon',          'public.notifications',       'SELECT'),
      ('anon',          'public.engine_runs',         'SELECT')
    ) as t(grantee, tbl, priv)
   where has_any_column_privilege(grantee, tbl, priv)
),
-- 1.6b DELETE has no column-level form, so it is checked at table level
forbidden_delete as (
  select format('%s has DELETE on %s', grantee, tbl) as finding
    from (values
      ('authenticated', 'public.subscriptions'),
      ('authenticated', 'public.subscription_events'),
      ('authenticated', 'public.orders'),
      ('authenticated', 'public.payments'),
      ('authenticated', 'public.notifications'),
      ('authenticated', 'public.engine_runs'),
      ('authenticated', 'public.profiles'),
      ('authenticated', 'public.order_issues'),
      ('authenticated', 'public.reviews')
    ) as t(grantee, tbl)
   where has_table_privilege(grantee, tbl, 'DELETE')
),
-- 1.7 column-level privileges that must NOT exist (rule C-4)
forbidden_column as (
  select format('%s can %s %s.%s', grantee, priv, tbl, col) as finding
    from (values
      ('authenticated', 'public.profiles',      'is_admin',         'UPDATE'),
      ('authenticated', 'public.profiles',      'is_seller',        'UPDATE'),
      ('authenticated', 'public.shops',         'suspended_at',     'UPDATE'),
      ('authenticated', 'public.shops',         'suspended_reason', 'UPDATE'),
      ('authenticated', 'public.shops',         'owner_id',         'UPDATE'),
      ('authenticated', 'public.products',      'suspended_at',     'UPDATE'),
      ('authenticated', 'public.products',      'shop_id',          'UPDATE'),
      ('authenticated', 'public.product_plans', 'product_id',       'UPDATE'),
      ('authenticated', 'public.product_plans', 'cycle',            'UPDATE'),
      ('authenticated', 'public.orders',        'amount',           'UPDATE'),
      ('authenticated', 'public.orders',        'address_snapshot', 'UPDATE'),
      ('authenticated', 'public.orders',        'cycle_date',       'UPDATE'),
      ('authenticated', 'public.orders',        'subscription_id',  'UPDATE'),
      ('authenticated', 'public.orders',        'confirmed_at',     'UPDATE'),
      ('authenticated', 'public.orders',        'cancelled_at',     'UPDATE'),
      ('authenticated', 'public.orders',        'cancel_reason',    'UPDATE'),
      ('authenticated', 'public.subscriptions', 'paused_reason',    'UPDATE'),
      ('authenticated', 'public.notifications', 'title',            'UPDATE'),
      ('authenticated', 'public.notifications', 'body',             'UPDATE'),
      ('authenticated', 'public.notifications', 'link_path',        'UPDATE'),
      ('authenticated', 'public.notifications', 'user_id',          'UPDATE')
    ) as t(grantee, tbl, col, priv)
   where has_column_privilege(grantee, tbl, col, priv)
),
-- 1.8 privileges the app genuinely needs (catches an over-broad REVOKE)
missing_required as (
  select format('MISSING: %s needs %s on %s', grantee, priv, tbl) as finding
    from (values
      ('anon',          'public.products',        'SELECT'),
      ('anon',          'public.product_plans',   'SELECT'),
      ('anon',          'public.shops',           'SELECT'),
      ('anon',          'public.categories',      'SELECT'),
      ('authenticated', 'public.subscriptions',   'SELECT'),
      ('authenticated', 'public.orders',          'SELECT'),
      ('authenticated', 'public.payments',        'SELECT'),
      ('authenticated', 'public.notifications',   'SELECT'),
      ('authenticated', 'public.addresses',       'INSERT'),
      ('authenticated', 'public.payment_methods', 'INSERT'),
      ('authenticated', 'public.shops',           'INSERT'),
      ('authenticated', 'public.products',        'INSERT'),
      ('authenticated', 'public.product_plans',   'INSERT')
    ) as t(grantee, tbl, priv)
   where not has_any_column_privilege(grantee, tbl, priv)
),
-- 1.9 storage buckets must cap size and mime type (rule C-9)
bucket_unbounded as (
  select 'storage bucket without size/mime limits: ' || id as finding
    from storage.buckets
   where file_size_limit is null or allowed_mime_types is null
),
-- 1.10 guard triggers must exist (rule C-4, L4)
missing_trigger as (
  select 'missing guard trigger: ' || expected as finding
    from (values
      ('guard_profile_privileges'),
      ('sync_is_seller'),
      ('guard_order_update'),
      ('guard_payments_append_only'),
      ('guard_subscription_update'),
      ('enforce_single_default_address'),
      ('notify_plan_price_change')
    ) as t(expected)
   where not exists (select 1 from pg_trigger tg
                      where not tg.tgisinternal and tg.tgname = expected)
)
select * from rls_off
union all select * from rls_no_policy
union all select * from policy_no_check
union all select * from definer_no_path
union all select * from anon_callable
union all select * from engine_only_callable
union all select * from forbidden_table
union all select * from forbidden_delete
union all select * from forbidden_column
union all select * from missing_required
union all select * from bucket_unbounded
union all select * from missing_trigger;

-- ---------- 2. INVENTORY (read with your eyes, no pass/fail) ----------

-- 2.1 full policy list
-- select tablename, policyname, cmd, roles, qual, with_check
--   from pg_policies where schemaname = 'public' order by tablename, cmd;

-- 2.2 exactly which columns each client role may write
-- select grantee, table_name, privilege_type, string_agg(column_name, ', ' order by column_name)
--   from information_schema.column_privileges
--  where table_schema = 'public' and grantee in ('anon', 'authenticated')
--    and privilege_type in ('INSERT', 'UPDATE')
--  group by grantee, table_name, privilege_type order by table_name;

-- 2.3 functions and who may execute them
-- select p.proname, p.prosecdef as security_definer, p.proconfig,
--        has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_can_call,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as user_can_call
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' order by p.proname;
