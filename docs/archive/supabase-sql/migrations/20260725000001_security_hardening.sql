-- ============================================================
-- ANAN — Security hardening
-- Design doc: docs/security-design.md | Checklist: docs/security-rules.md
--
-- This file is the SOURCE OF TRUTH for authorization. It drops every policy
-- created in 0001 and re-declares the full set, so the whole permission model
-- can be reviewed in one place.
--
-- Defense in depth (5 layers) — each layer assumes the one above it failed:
--   L1 GRANT      : which COLUMNS a role may touch at all (RLS cannot do columns)
--   L2 RLS        : which ROWS that role may touch
--   L3 RPC        : business rules that need >1 statement (security definer)
--   L4 TRIGGER    : invariants no policy can express (state machines, immutability)
--   L5 CONSTRAINT : data shape / idempotency
-- ============================================================

-- ---------- 0. HELPERS ----------

-- Trusted writers = recurring engine (service role) + migrations/pg_cron (postgres).
-- Used by guard triggers to let the engine do what clients must never do.
-- NOT security definer on purpose: it must observe the REAL current_user. Guard
-- triggers that call it must stay invoker-rights for the same reason (a definer
-- trigger would report postgres and wave everyone through).
create or replace function public.is_trusted_writer()
returns boolean
language sql stable
set search_path = ''
as $$
  select current_user in ('service_role', 'postgres', 'supabase_admin');
$$;

-- Re-created from 0001 with an empty search_path (0001 used `= public`, which
-- still resolves pg_temp first on some paths -> definer function hijack risk).
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

-- Sellers can no longer SELECT subscription rows (S-07), but the orders policy
-- still has to answer "is this order for my shop?" — which means walking
-- subscriptions -> plans -> products -> shops. This definer helper does that walk
-- with full visibility and returns nothing but a boolean.
create or replace function public.order_is_for_my_shop(p_subscription_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.subscriptions ss
      join public.product_plans pp on pp.id = ss.plan_id
      join public.products p       on p.id  = pp.product_id
      join public.shops s          on s.id  = p.shop_id
     where ss.id = p_subscription_id
       and s.owner_id = auth.uid()
  );
$$;

-- A closed plan / hidden product / suspended shop must still be readable by the
-- people already subscribed to it — their deliveries continue (W05), so their
-- subscription list and order history must not turn into blank cards. Written as
-- definer helpers to keep the products <-> product_plans policies from referring
-- to each other recursively.
create or replace function public.i_subscribe_to_plan(p_plan_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.subscriptions ss
                  where ss.plan_id = p_plan_id and ss.buyer_id = auth.uid());
$$;

create or replace function public.i_subscribe_to_product(p_product_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.subscriptions ss
                   join public.product_plans pp on pp.id = ss.plan_id
                  where pp.product_id = p_product_id and ss.buyer_id = auth.uid());
$$;

create or replace function public.i_subscribe_to_shop(p_shop_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.subscriptions ss
                   join public.product_plans pp on pp.id = ss.plan_id
                   join public.products p       on p.id  = pp.product_id
                  where p.shop_id = p_shop_id and ss.buyer_id = auth.uid());
$$;

-- Sanitize the only signup input a client fully controls (auth metadata).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  -- fall back to the email local part, then to a literal: display_name is NOT NULL
  -- and now carries a length CHECK, so signup must never produce an empty string
  v_name := left(coalesce(v_name,
                          nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                          'ผู้ใช้ใหม่'), 60);
  -- never trust metadata for privileged columns: is_admin/is_seller keep their defaults
  insert into public.profiles (id, display_name) values (new.id, v_name);
  return new;
end;
$$;

-- EXECUTE rights for everything in this file are settled in one place: §8.

-- ---------- 1. SCHEMA: separate "seller closed it" from "admin suspended it" ----------
-- 0001 used a single is_active for both, so a suspended seller could just flip it
-- back on. Admin moderation now lives in a column no client role can write.

alter table public.shops    add column if not exists suspended_at     timestamptz;
alter table public.shops    add column if not exists suspended_reason text;
alter table public.products add column if not exists suspended_at     timestamptz;
alter table public.products add column if not exists suspended_reason text;

comment on column public.shops.suspended_at is
  'Admin moderation only (see admin_set_shop_suspension). Sellers cannot write this column.';
comment on column public.products.suspended_at is
  'Admin moderation only (see admin_set_product_suspension). Sellers cannot write this column.';

-- ---------- 2. CONSTRAINTS (L5) ----------
-- Bound every client-supplied text/number: unbounded input is a storage-abuse and
-- UI-injection vector, and numeric(10,2) overflow throws 500s from user input.

alter table public.profiles
  add constraint profiles_display_name_len check (char_length(display_name) between 1 and 60),
  add constraint profiles_phone_fmt        check (phone is null or phone ~ '^[0-9+\-() ]{6,20}$');

alter table public.addresses
  add constraint addresses_recipient_len check (char_length(recipient_name) between 1 and 100),
  add constraint addresses_line_len      check (char_length(address_line) between 1 and 300),
  add constraint addresses_province_len  check (char_length(province) between 1 and 100),
  add constraint addresses_postcode_fmt  check (postcode ~ '^[0-9]{5}$'),
  add constraint addresses_phone_fmt     check (phone ~ '^[0-9+\-() ]{6,20}$'),
  add constraint addresses_label_len     check (label is null or char_length(label) <= 40);

-- demo cards: last4 must literally be 4 digits, nothing else may be stored here
alter table public.payment_methods
  add constraint payment_methods_last4_fmt  check (last4 ~ '^[0-9]{4}$'),
  add constraint payment_methods_holder_len check (holder_name is null or char_length(holder_name) <= 80);

alter table public.shops
  add constraint shops_name_len check (char_length(name) between 2 and 80),
  add constraint shops_desc_len check (description is null or char_length(description) <= 1000);

alter table public.products
  add constraint products_name_len   check (char_length(name) between 2 and 120),
  add constraint products_desc_len   check (description is null or char_length(description) <= 2000),
  add constraint products_images_len check (coalesce(array_length(images, 1), 0) <= 5),
  add constraint products_price_max  check (one_time_price <= 1000000),
  add constraint products_net_amount check (net_amount is null or (net_amount > 0 and net_amount <= 1000000)),
  add constraint products_unit_len   check (unit is null or char_length(unit) <= 16);

alter table public.product_plans
  add constraint plans_price_max check (price_per_cycle <= 1000000),
  add constraint plans_qty_max   check (qty_per_cycle between 1 and 100);

-- quantity cap matches the checkout spec (feature 05); the state rule below makes
-- "cancelled is permanent" (CLAUDE.md rule 5) a database fact, not a UI convention.
alter table public.subscriptions
  add constraint subs_quantity_range check (quantity between 1 and 10),
  add constraint subs_state_consistent check (
    (status = 'active'    and next_order_date is not null and cancelled_at is null)
 or (status = 'paused'    and cancelled_at is null)
 or (status = 'cancelled' and next_order_date is null and cancelled_at is not null)
  );

alter table public.orders
  add constraint orders_amount_range  check (amount >= 0 and amount <= 10000000),
  add constraint orders_tracking_len  check (tracking_note is null or char_length(tracking_note) <= 200);

-- one charge per order: DB-level idempotency for the demo charge, same spirit as
-- orders UNIQUE (subscription_id, cycle_date)
alter table public.payments
  add constraint payments_one_per_order unique (order_id),
  add constraint payments_amount_range  check (amount >= 0 and amount <= 10000000);

alter table public.notifications
  add constraint notifications_title_len check (char_length(title) between 1 and 200),
  add constraint notifications_body_len  check (body is null or char_length(body) <= 1000),
  -- link_path must stay in-app: blocks stored phishing links inside notifications
  add constraint notifications_link_rel  check (link_path is null or link_path ~ '^/[A-Za-z0-9/_\-\[\]().?=&]*$');

-- ---------- 3. PRIVILEGES (L1) ----------
-- Supabase grants ALL on every public table to anon/authenticated by default, so
-- RLS was the ONLY thing standing between a client and `update profiles set
-- is_admin = true`. Start from zero and grant back column by column.

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- 3.1 public catalog (readable before login)
grant select on public.categories    to anon, authenticated;
grant select on public.shops         to anon, authenticated;
grant select on public.products      to anon, authenticated;
grant select on public.product_plans to anon, authenticated;

-- 3.2 private reads (RLS narrows these to "mine")
grant select on public.profiles, public.addresses, public.payment_methods,
                public.subscriptions, public.subscription_events,
                public.orders, public.payments, public.notifications,
                public.engine_runs
  to authenticated;

-- 3.3 writes — only the columns a user legitimately owns
--     is_admin / is_seller are absent on purpose: privilege escalation stops here.
grant update (display_name, phone, avatar_url) on public.profiles to authenticated;

grant insert (user_id, label, recipient_name, phone, address_line, province, postcode, is_default)
  on public.addresses to authenticated;
grant update (label, recipient_name, phone, address_line, province, postcode, is_default)
  on public.addresses to authenticated;
grant delete on public.addresses to authenticated;

-- demo cards are insert/delete only: an "editable" card row invites storing more than last4.
-- `kind` is not grantable either, so it can only ever take its 'card_demo' default.
grant insert (user_id, last4, holder_name) on public.payment_methods to authenticated;
grant delete on public.payment_methods to authenticated;

grant insert (owner_id, name, logo_url, description) on public.shops to authenticated;
grant update (name, logo_url, description, is_active) on public.shops to authenticated;
--       ^ suspended_at deliberately excluded: sellers cannot un-suspend themselves

grant insert (shop_id, category_id, name, description, images, one_time_price, net_amount, unit, is_active)
  on public.products to authenticated;
grant update (name, description, images, one_time_price, net_amount, unit, category_id, is_active)
  on public.products to authenticated;                               -- shop_id + suspended_at frozen

grant insert (product_id, cycle, price_per_cycle, qty_per_cycle, is_active)
  on public.product_plans to authenticated;
grant update (price_per_cycle, qty_per_cycle, is_active) on public.product_plans to authenticated;
--       ^ product_id + cycle frozen: a plan may not be re-pointed at another product
--         while people are subscribed to it

grant update (status, tracking_note) on public.orders to authenticated;  -- seller fulfillment only
grant update (read_at)               on public.notifications to authenticated;

-- categories are admin-managed through RPCs (§6) — no client write grant at all.
-- Granting the table and relying on RLS alone would leave this the one write surface
-- with a single layer of defense, and hand every logged-in user the id sequence.

-- 3.4 NOT granted to any client role, by design — writes go through RPCs:
--   subscriptions        -> subscribe_to_plan(), pause/resume/skip/... (migration 0003)
--   subscription_events  -> written by the same RPCs (audit trail must be tamper-proof)
--   orders  (insert)     -> subscribe_to_plan() for cycle 1, engine for the rest
--   payments             -> checkout RPC + engine only ("paid" must never be client-assertable)
--   notifications(insert)-> engine + triggers only (else anyone can phish any user in-app)
--   engine_runs          -> engine only

-- ---------- 4. RLS POLICIES (L2) ----------

do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Note on `to` clauses: policies are only evaluated for the roles they name, and
-- RLS expressions run with the CALLER's privileges. Any policy that calls
-- is_admin() is therefore restricted `to authenticated` — otherwise anon would
-- need EXECUTE on that function just to browse the catalog.

-- 4.1 profiles — owner + admin. Sellers do NOT read buyer profiles; everything a
--     seller needs to ship is in orders.address_snapshot.
create policy "profiles select own" on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "profiles select admin" on public.profiles for select to authenticated
  using (public.is_admin());
create policy "profiles update own" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- 4.2 addresses / payment_methods — owner only, explicit with check on every write
create policy "addresses select own" on public.addresses for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "addresses insert own" on public.addresses for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "addresses update own" on public.addresses for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "addresses delete own" on public.addresses for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "payment_methods select own" on public.payment_methods for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "payment_methods insert own" on public.payment_methods for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "payment_methods delete own" on public.payment_methods for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 4.3 shops — suspension is enforced here, not in client queries. A forgotten
--     `.eq('is_active', true)` in the app can no longer expose a suspended shop.
create policy "shops public read" on public.shops for select to anon, authenticated
  using (is_active = true and suspended_at is null);
create policy "shops owner read" on public.shops for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "shops admin read" on public.shops for select to authenticated
  using (public.is_admin());
create policy "shops subscriber read" on public.shops for select to authenticated
  using (public.i_subscribe_to_shop(id));   -- keep shop name visible in order history
create policy "shops owner insert" on public.shops for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "shops owner update" on public.shops for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- 4.4 categories — public read; writes go through admin RPCs (§6), so there is no
--     write policy here at all
create policy "categories public read" on public.categories for select
  to anon, authenticated using (true);

-- 4.5 products / product_plans — visibility cascades from the shop, and a suspended
--     shop cannot publish new products either.
create policy "products public read" on public.products for select to anon, authenticated
  using (
    is_active = true and suspended_at is null
    and exists (select 1 from public.shops s
                where s.id = shop_id and s.is_active and s.suspended_at is null)
  );
create policy "products owner read" on public.products for select to authenticated
  using (exists (select 1 from public.shops s
                 where s.id = shop_id and s.owner_id = (select auth.uid())));
create policy "products admin read" on public.products for select to authenticated
  using (public.is_admin());
create policy "products subscriber read" on public.products for select to authenticated
  using (public.i_subscribe_to_product(id));
create policy "products owner insert" on public.products for insert to authenticated
  with check (exists (select 1 from public.shops s
                      where s.id = shop_id and s.owner_id = (select auth.uid())
                        and s.suspended_at is null));
create policy "products owner update" on public.products for update to authenticated
  using (exists (select 1 from public.shops s
                 where s.id = shop_id and s.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.shops s
                      where s.id = shop_id and s.owner_id = (select auth.uid())
                        and s.suspended_at is null));

create policy "plans public read" on public.product_plans for select to anon, authenticated
  using (
    is_active = true
    and exists (select 1 from public.products p
                join public.shops s on s.id = p.shop_id
                where p.id = product_id
                  and p.is_active and p.suspended_at is null
                  and s.is_active and s.suspended_at is null)
  );
create policy "plans owner read" on public.product_plans for select to authenticated
  using (exists (select 1 from public.products p
                 join public.shops s on s.id = p.shop_id
                 where p.id = product_id and s.owner_id = (select auth.uid())));
create policy "plans admin read" on public.product_plans for select to authenticated
  using (public.is_admin());
create policy "plans subscriber read" on public.product_plans for select to authenticated
  using (public.i_subscribe_to_plan(id));   -- a closed plan is still MY plan
create policy "plans owner insert" on public.product_plans for insert to authenticated
  with check (exists (select 1 from public.products p
                      join public.shops s on s.id = p.shop_id
                      where p.id = product_id and s.owner_id = (select auth.uid())
                        and s.suspended_at is null));
create policy "plans owner update" on public.product_plans for update to authenticated
  using (exists (select 1 from public.products p
                 join public.shops s on s.id = p.shop_id
                 where p.id = product_id and s.owner_id = (select auth.uid())))
  -- suspended_at check must be here too: without it a suspended shop can still edit
  -- price_per_cycle, which fires notify_plan_price_change and messages every subscriber
  with check (exists (select 1 from public.products p
                      join public.shops s on s.id = p.shop_id
                      where p.id = product_id and s.owner_id = (select auth.uid())
                        and s.suspended_at is null));

-- 4.6 subscriptions — buyer reads own, admin reads all.
--     Sellers used to read whole rows (buyer_id, address_id, payment_method_id) just
--     to build a forecast. They now call shop_forecast() which returns counts only.
create policy "subs buyer read" on public.subscriptions for select to authenticated
  using (buyer_id = (select auth.uid()) or public.is_admin());

-- 4.7 subscription_events — read-only for the buyer; the churn dataset used in the
--     thesis must not be writable by the subject of the measurement.
create policy "sub_events read own" on public.subscription_events for select to authenticated
  using (
    exists (select 1 from public.subscriptions ss
            where ss.id = subscription_id and ss.buyer_id = (select auth.uid()))
    or public.is_admin()
  );

-- 4.8 orders — buyer reads own, seller reads + fulfills own shop's, admin reads all.
--     No client insert: cycle-1 orders come from subscribe_to_plan(), later cycles
--     from the engine.
create policy "orders buyer read" on public.orders for select to authenticated
  using (exists (select 1 from public.subscriptions ss
                 where ss.id = subscription_id and ss.buyer_id = (select auth.uid()))
         or public.is_admin());
create policy "orders seller read" on public.orders for select to authenticated
  using (public.order_is_for_my_shop(subscription_id));
create policy "orders seller update" on public.orders for update to authenticated
  using (public.order_is_for_my_shop(subscription_id))
  with check (public.order_is_for_my_shop(subscription_id));

-- 4.9 payments — read only, for the buyer and admin. Sellers see the order, not the
--     charge record.
create policy "payments buyer read" on public.payments for select to authenticated
  using (exists (select 1 from public.orders o
                 join public.subscriptions ss on ss.id = o.subscription_id
                 where o.id = order_id and ss.buyer_id = (select auth.uid()))
         or public.is_admin());

-- 4.10 notifications — owner reads and marks read (read_at is the only granted column)
create policy "notifications own read" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "notifications own update" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 4.11 engine_runs — admin read; engine writes via service role
create policy "engine_runs admin read" on public.engine_runs for select to authenticated
  using (public.is_admin());

-- ---------- 5. GUARD TRIGGERS (L4) ----------
-- These re-assert the rules above even if a future migration hands out a wider
-- GRANT by accident. Every guard exempts trusted writers (engine/migrations).

-- 5.1 privilege columns can only change via SQL/seed, never through the API
create or replace function public.guard_profile_privileges()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if public.is_trusted_writer() then return new; end if;
  if new.is_admin is distinct from old.is_admin then
    raise exception 'is_admin cannot be changed through the API' using errcode = '42501';
  end if;
  if new.is_seller is distinct from old.is_seller then
    raise exception 'is_seller is derived from shop ownership' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'profile id is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_profile_privileges on public.profiles;
create trigger guard_profile_privileges before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- 5.2 is_seller becomes a derived fact: it tracks whether a shop actually exists,
--     in both directions (a delete must not leave a seller-mode toggle behind)
create or replace function public.sync_is_seller()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.profiles set is_seller = false where id = old.owner_id;
    return old;
  end if;
  update public.profiles set is_seller = true where id = new.owner_id;
  return new;
end;
$$;
drop trigger if exists sync_is_seller on public.shops;
create trigger sync_is_seller after insert on public.shops
  for each row execute function public.sync_is_seller();
drop trigger if exists sync_is_seller_delete on public.shops;
create trigger sync_is_seller_delete after delete on public.shops
  for each row execute function public.sync_is_seller();

-- 5.2b deleting an address or card that a live subscription points at raises a raw
--      23503 from Postgres; turn it into a message the UI can show as-is
create or replace function public.guard_referenced_delete()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'addresses'
     and exists (select 1 from public.subscriptions s
                  where s.address_id = old.id and s.status <> 'cancelled') then
    raise exception 'ที่อยู่นี้ถูกใช้ใน subscription ที่ยังทำงานอยู่ — เปลี่ยนที่อยู่ใน subscription ก่อน'
      using errcode = '23503';
  end if;
  if tg_table_name = 'payment_methods'
     and exists (select 1 from public.subscriptions s
                  where s.payment_method_id = old.id and s.status <> 'cancelled') then
    raise exception 'บัตรนี้ผูกกับ subscription ที่ยังทำงานอยู่ — เปลี่ยนบัตรใน subscription ก่อน'
      using errcode = '23503';
  end if;
  return old;
end;
$$;
drop trigger if exists guard_referenced_delete on public.addresses;
create trigger guard_referenced_delete before delete on public.addresses
  for each row execute function public.guard_referenced_delete();
drop trigger if exists guard_referenced_delete on public.payment_methods;
create trigger guard_referenced_delete before delete on public.payment_methods
  for each row execute function public.guard_referenced_delete();

-- 5.3 orders: money/address/cycle are immutable for clients, and status may only
--     move one step forward (W08). delivered is terminal.
create or replace function public.guard_order_update()
returns trigger language plpgsql
set search_path = ''
as $$
declare
  v_from int;
  v_to   int;
begin
  if public.is_trusted_writer() then return new; end if;

  if new.subscription_id  is distinct from old.subscription_id
     or new.cycle_date    is distinct from old.cycle_date
     or new.amount        is distinct from old.amount
     or new.address_snapshot::text is distinct from old.address_snapshot::text then
    raise exception 'order financial/shipping fields are immutable' using errcode = '42501';
  end if;

  v_from := array_position(array['pending','preparing','shipped','delivered'], old.status);
  v_to   := array_position(array['pending','preparing','shipped','delivered'], new.status);
  if v_to <> v_from and v_to <> v_from + 1 then
    raise exception 'invalid order status transition: % -> %', old.status, new.status
      using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_order_update on public.orders;
create trigger guard_order_update before update on public.orders
  for each row execute function public.guard_order_update();

-- 5.4 payments are append-only for everyone except the engine (phase 5 retry)
create or replace function public.guard_payments_append_only()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if public.is_trusted_writer() then return coalesce(new, old); end if;
  raise exception 'payments are append-only' using errcode = '42501';
end;
$$;
drop trigger if exists guard_payments_append_only on public.payments;
create trigger guard_payments_append_only before update or delete on public.payments
  for each row execute function public.guard_payments_append_only();

-- 5.5 subscription state machine: cancelled is permanent (CLAUDE.md rule 5) and the
--     owner/plan-product may never be swapped underneath an existing subscription.
-- security definer here (unlike the guards above) because it must see every plan
-- row regardless of the caller's RLS view; it does not consult is_trusted_writer,
-- so definer rights cannot weaken it.
create or replace function public.guard_subscription_update()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if new.buyer_id is distinct from old.buyer_id then
    raise exception 'subscription owner is immutable' using errcode = '42501';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'cancelled subscriptions cannot be reactivated' using errcode = '22023';
  end if;
  -- changing cycle is allowed, changing product is not
  if new.plan_id is distinct from old.plan_id
     and (select product_id from public.product_plans where id = new.plan_id)
      is distinct from
         (select product_id from public.product_plans where id = old.plan_id) then
    raise exception 'plan change must stay within the same product' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_subscription_update on public.subscriptions;
create trigger guard_subscription_update before update on public.subscriptions
  for each row execute function public.guard_subscription_update();

-- 5.6 exactly one default address per user, enforced in one statement instead of
--     the read-then-write pair the client would otherwise race on
create or replace function public.enforce_single_default_address()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if new.is_default then
    update public.addresses set is_default = false
     where user_id = new.user_id and id <> new.id and is_default;
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_single_default_address on public.addresses;
create trigger enforce_single_default_address after insert or update of is_default
  on public.addresses for each row execute function public.enforce_single_default_address();

-- ---------- 6. ADMIN MODERATION RPCs (L3) ----------
-- suspended_at has no client GRANT, so moderation must go through these. Each one
-- re-checks is_admin() itself: the RPC is the trust boundary, not the UI route guard.

create or replace function public.admin_set_shop_suspension(
  p_shop_id uuid, p_suspend boolean, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.shops
     set suspended_at     = case when p_suspend then now() else null end,
         suspended_reason = case when p_suspend then left(coalesce(p_reason, ''), 200) else null end
   where id = p_shop_id;
end;
$$;

-- category management (feature 14). Kept as RPCs so categories has the same two
-- layers as every other write surface: no GRANT + an is_admin() check inside.
create or replace function public.admin_upsert_category(
  p_name text, p_icon text default null, p_sort_order int default 0, p_id int default null)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id int;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 40 then
    raise exception 'ชื่อหมวดต้องมี 1-40 ตัวอักษร' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.categories (name, icon, sort_order)
    values (btrim(p_name), p_icon, coalesce(p_sort_order, 0))
    returning id into v_id;
  else
    update public.categories
       set name = btrim(p_name), icon = p_icon, sort_order = coalesce(p_sort_order, 0)
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'ไม่พบหมวดนี้' using errcode = '22023';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_delete_category(p_id int)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_products int;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select count(*) into v_products from public.products where category_id = p_id;
  if v_products > 0 then
    raise exception 'มีสินค้า % ชิ้นในหมวดนี้ — ย้ายออกก่อน', v_products using errcode = '23503';
  end if;
  delete from public.categories where id = p_id;
end;
$$;

create or replace function public.admin_set_product_suspension(
  p_product_id uuid, p_suspend boolean, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.products
     set suspended_at     = case when p_suspend then now() else null end,
         suspended_reason = case when p_suspend then left(coalesce(p_reason, ''), 200) else null end
   where id = p_product_id;
end;
$$;

-- ---------- 7. STORAGE ----------
-- Buckets are public-read (catalog images) but writes are scoped to a folder the
-- caller provably owns: <shop_id>/... for shop content, <user_id>/... for avatars.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-images', 'product-images', true, 2097152, array['image/jpeg','image/png','image/webp']),
  ('shop-assets',    'shop-assets',    true, 2097152, array['image/jpeg','image/png','image/webp']),
  ('avatars',        'avatars',        true, 1048576, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "anan public read images"  on storage.objects;
drop policy if exists "anan shop folder write"   on storage.objects;
drop policy if exists "anan shop folder update"  on storage.objects;
drop policy if exists "anan shop folder delete"  on storage.objects;
drop policy if exists "anan avatar folder write" on storage.objects;

create policy "anan public read images" on storage.objects for select
  using (bucket_id in ('product-images', 'shop-assets', 'avatars'));

create policy "anan shop folder write" on storage.objects for insert to authenticated
  with check (
    bucket_id in ('product-images', 'shop-assets')
    and (storage.foldername(name))[1] =
        (select s.id::text from public.shops s where s.owner_id = (select auth.uid()))
  );
-- with check matters here: without it an UPDATE could rename an object into
-- another shop's folder
create policy "anan shop folder update" on storage.objects for update to authenticated
  using (
    bucket_id in ('product-images', 'shop-assets')
    and (storage.foldername(name))[1] =
        (select s.id::text from public.shops s where s.owner_id = (select auth.uid()))
  )
  with check (
    bucket_id in ('product-images', 'shop-assets')
    and (storage.foldername(name))[1] =
        (select s.id::text from public.shops s where s.owner_id = (select auth.uid()))
  );
create policy "anan shop folder delete" on storage.objects for delete to authenticated
  using (
    bucket_id in ('product-images', 'shop-assets')
    and (storage.foldername(name))[1] =
        (select s.id::text from public.shops s where s.owner_id = (select auth.uid()))
  );

create policy "anan avatar folder write" on storage.objects for all to authenticated
  using  (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------- 8. FUNCTION PRIVILEGES (last word — must run after every CREATE FUNCTION above) ----------
-- Postgres grants EXECUTE to PUBLIC on every new function, which would expose each
-- RPC to anonymous callers. Close the default, then hand out execute rights one by one.
-- Trigger functions need no grant at all: triggers fire regardless of caller privileges.

revoke execute on all functions in schema public from public, anon, authenticated;

-- `alter default privileges ... revoke execute ... from public` looks like it closes
-- the door for future functions, but it cannot: Postgres merges the hard-wired
-- default (PUBLIC=EXECUTE) into every new function's ACL, and a merge cannot subtract.
-- Verified — a function created by a later migration came out callable by anon.
-- An event trigger is the only thing that actually holds, and it means a future
-- migration cannot forget.
create or replace function public.lock_down_new_functions()
returns event_trigger
language plpgsql
as $$
declare
  r record;
begin
  for r in
    select object_identity
      from pg_event_trigger_ddl_commands()
     where command_tag in ('CREATE FUNCTION', 'CREATE PROCEDURE')
       and schema_name = 'public'
  loop
    execute format('revoke execute on routine %s from public, anon', r.object_identity);
  end loop;
end;
$$;

drop event trigger if exists lock_down_new_functions;
create event trigger lock_down_new_functions on ddl_command_end
  when tag in ('CREATE FUNCTION', 'CREATE PROCEDURE')
  execute function public.lock_down_new_functions();

grant execute on function public.is_admin()                                        to authenticated;
grant execute on function public.admin_upsert_category(text, text, int, int)       to authenticated;
grant execute on function public.admin_delete_category(int)                        to authenticated;
-- guard triggers run with invoker rights, so the engine's own role must be able to
-- call the helper they consult — do not rely on Supabase's inherited default grants
grant execute on function public.is_trusted_writer()                               to service_role;
grant execute on function public.order_is_for_my_shop(uuid)                        to authenticated;
grant execute on function public.i_subscribe_to_plan(uuid)                         to authenticated;
grant execute on function public.i_subscribe_to_product(uuid)                      to authenticated;
grant execute on function public.i_subscribe_to_shop(uuid)                         to authenticated;
grant execute on function public.admin_set_shop_suspension(uuid, boolean, text)    to authenticated;
grant execute on function public.admin_set_product_suspension(uuid, boolean, text) to authenticated;
-- required by the invoker-rights guard triggers above: an authenticated UPDATE on
-- profiles/orders/payments fires a trigger that calls this in the caller's context
grant execute on function public.is_trusted_writer()                               to authenticated;
