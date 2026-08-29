-- ============================================================
-- ANAN — initial schema
-- Design doc: docs/database-schema.md | Feature specs: context/planing/
-- Rules (CLAUDE.md): RLS on every table, snake_case, demo payment only
-- ============================================================

-- ---------- 1. USER DOMAIN ----------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  phone text,
  avatar_url text,
  is_seller boolean not null default false,
  is_admin boolean not null default false, -- set via seed/SQL only, no UI
  created_at timestamptz not null default now()
);

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text,
  recipient_name text not null,
  phone text not null,
  address_line text not null,
  province text not null,
  postcode text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- DEMO ONLY: never store full card numbers, even fake ones (last4 only)
create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'card_demo' check (kind = 'card_demo'),
  last4 char(4) not null,
  holder_name text,
  created_at timestamptz not null default now()
);

-- ---------- 2. CATALOG DOMAIN ----------

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id) on delete cascade, -- 1 shop per account
  name text not null,
  logo_url text,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.categories (
  id serial primary key,
  name text not null unique,
  icon text,
  sort_order int not null default 0
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  category_id int not null references public.categories(id),
  name text not null,
  description text,
  images text[] not null default '{}',
  one_time_price numeric(10,2) not null check (one_time_price > 0), -- reference price for discount display
  net_amount numeric(10,2), -- e.g. 250 (for per-unit price comparison)
  unit text,                -- e.g. 'g', 'ml', 'piece'
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.product_plans (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  cycle text not null check (cycle in ('2w','1m','2m')),
  price_per_cycle numeric(10,2) not null check (price_per_cycle > 0),
  qty_per_cycle int not null default 1 check (qty_per_cycle > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (product_id, cycle)
);

-- ---------- 3. SUBSCRIPTION CORE ----------

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.product_plans(id), -- no cascade: block deleting plans with subscribers
  address_id uuid not null references public.addresses(id),
  payment_method_id uuid not null references public.payment_methods(id),
  status text not null default 'active' check (status in ('active','paused','cancelled')),
  quantity int not null default 1 check (quantity > 0),
  start_date date not null,
  next_order_date date, -- null once cancelled
  paused_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

-- churn analytics source for the thesis
create table public.subscription_events (
  id bigserial primary key,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  event text not null check (event in
    ('created','paused','resumed','skipped','rescheduled','cycle_changed','address_changed','cancelled')),
  detail jsonb,
  created_at timestamptz not null default now()
);

-- ---------- 4. FULFILLMENT ----------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id),
  cycle_date date not null,
  status text not null default 'pending' check (status in ('pending','preparing','shipped','delivered')),
  amount numeric(10,2) not null,
  address_snapshot jsonb not null, -- copied at creation so later address edits don't rewrite history
  tracking_note text,
  created_at timestamptz not null default now(),
  unique (subscription_id, cycle_date) -- recurring engine idempotency
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  amount numeric(10,2) not null,
  status text not null check (status in ('paid','failed')), -- simulated only
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- 5. SYSTEM ----------

create table public.notifications (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null, -- upcoming_cycle | order_created | order_status | new_subscriber | subscriber_cancelled | engine_summary
  title text not null,
  body text,
  link_path text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- written by the recurring engine (service role) only
create table public.engine_runs (
  id bigserial primary key,
  run_date date not null,
  orders_created int not null default 0,
  notifications_created int not null default 0,
  detail jsonb,
  ran_at timestamptz not null default now()
);

-- ---------- 6. INDEXES ----------

create index idx_products_category on public.products (category_id);
create index idx_products_shop on public.products (shop_id);
create index idx_plans_product on public.product_plans (product_id);
create index idx_subs_buyer on public.subscriptions (buyer_id);
create index idx_subs_due on public.subscriptions (next_order_date) where status = 'active'; -- engine hot path
create index idx_orders_sub on public.orders (subscription_id);
create index idx_orders_status on public.orders (status);
create index idx_payments_order on public.payments (order_id);
create index idx_notifications_user on public.notifications (user_id, created_at desc);
create index idx_sub_events_sub on public.subscription_events (subscription_id);

-- ---------- 7. AUTO-CREATE PROFILE ON SIGNUP ----------

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- admin check used inside policies (security definer avoids RLS recursion on profiles)
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ---------- 8. ROW LEVEL SECURITY ----------

alter table public.profiles            enable row level security;
alter table public.addresses           enable row level security;
alter table public.payment_methods     enable row level security;
alter table public.shops               enable row level security;
alter table public.categories          enable row level security;
alter table public.products            enable row level security;
alter table public.product_plans       enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.subscription_events enable row level security;
alter table public.orders              enable row level security;
alter table public.payments            enable row level security;
alter table public.notifications       enable row level security;
alter table public.engine_runs         enable row level security; -- service role writes; admin read (section 9)

-- profiles: owner only
create policy "profiles read own"   on public.profiles for select using (auth.uid() = id);
create policy "profiles update own" on public.profiles for update using (auth.uid() = id);

-- addresses / payment_methods: owner only
create policy "addresses own" on public.addresses for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "payment_methods own" on public.payment_methods for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- shops: public read (active), owner write
create policy "shops public read" on public.shops for select
  using (is_active = true or owner_id = auth.uid());
create policy "shops owner insert" on public.shops for insert with check (owner_id = auth.uid());
create policy "shops owner update" on public.shops for update using (owner_id = auth.uid());

-- categories: public read; writes via seed/service role only
create policy "categories public read" on public.categories for select using (true);

-- products: public read (active), shop owner write
create policy "products public read" on public.products for select
  using (is_active = true
         or exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid()));
create policy "products owner insert" on public.products for insert
  with check (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid()));
create policy "products owner update" on public.products for update
  using (exists (select 1 from public.shops s where s.id = shop_id and s.owner_id = auth.uid()));

-- product_plans: public read (active), shop owner write
create policy "plans public read" on public.product_plans for select
  using (is_active = true
         or exists (select 1 from public.products p
                    join public.shops s on s.id = p.shop_id
                    where p.id = product_id and s.owner_id = auth.uid()));
create policy "plans owner insert" on public.product_plans for insert
  with check (exists (select 1 from public.products p
                      join public.shops s on s.id = p.shop_id
                      where p.id = product_id and s.owner_id = auth.uid()));
create policy "plans owner update" on public.product_plans for update
  using (exists (select 1 from public.products p
                 join public.shops s on s.id = p.shop_id
                 where p.id = product_id and s.owner_id = auth.uid()));

-- subscriptions: buyer full access; seller read-only (order forecast)
create policy "subs buyer all" on public.subscriptions for all
  using (buyer_id = auth.uid()) with check (buyer_id = auth.uid());
create policy "subs seller read" on public.subscriptions for select
  using (exists (select 1 from public.product_plans pp
                 join public.products p on p.id = pp.product_id
                 join public.shops s on s.id = p.shop_id
                 where pp.id = plan_id and s.owner_id = auth.uid()));

-- subscription_events: buyer of parent subscription
create policy "sub_events buyer read" on public.subscription_events for select
  using (exists (select 1 from public.subscriptions ss
                 where ss.id = subscription_id and ss.buyer_id = auth.uid()));
create policy "sub_events buyer insert" on public.subscription_events for insert
  with check (exists (select 1 from public.subscriptions ss
                      where ss.id = subscription_id and ss.buyer_id = auth.uid()));

-- orders: buyer read + insert first order at checkout (engine inserts later cycles via service role);
--         seller read + update status
create policy "orders buyer read" on public.orders for select
  using (exists (select 1 from public.subscriptions ss
                 where ss.id = subscription_id and ss.buyer_id = auth.uid()));
create policy "orders buyer insert" on public.orders for insert
  with check (exists (select 1 from public.subscriptions ss
                      where ss.id = subscription_id and ss.buyer_id = auth.uid()));
create policy "orders seller read" on public.orders for select
  using (exists (select 1 from public.subscriptions ss
                 join public.product_plans pp on pp.id = ss.plan_id
                 join public.products p on p.id = pp.product_id
                 join public.shops s on s.id = p.shop_id
                 where ss.id = subscription_id and s.owner_id = auth.uid()));
create policy "orders seller update" on public.orders for update
  using (exists (select 1 from public.subscriptions ss
                 join public.product_plans pp on pp.id = ss.plan_id
                 join public.products p on p.id = pp.product_id
                 join public.shops s on s.id = p.shop_id
                 where ss.id = subscription_id and s.owner_id = auth.uid()));

-- payments: buyer read + insert (demo charge at checkout)
create policy "payments buyer read" on public.payments for select
  using (exists (select 1 from public.orders o
                 join public.subscriptions ss on ss.id = o.subscription_id
                 where o.id = order_id and ss.buyer_id = auth.uid()));
create policy "payments buyer insert" on public.payments for insert
  with check (exists (select 1 from public.orders o
                      join public.subscriptions ss on ss.id = o.subscription_id
                      where o.id = order_id and ss.buyer_id = auth.uid()));

-- notifications: owner read + mark-as-read; inserts via service role only
create policy "notifications own read" on public.notifications for select using (user_id = auth.uid());
create policy "notifications own update" on public.notifications for update using (user_id = auth.uid());

-- ---------- 9. ADMIN POLICIES (minimal admin — feature 14) ----------
-- platform overview (read), category management (write), suspend shops/products (update is_active)

create policy "profiles admin read"     on public.profiles      for select using (public.is_admin());
create policy "shops admin read"        on public.shops         for select using (public.is_admin());
create policy "shops admin update"      on public.shops         for update using (public.is_admin());
create policy "products admin read"     on public.products      for select using (public.is_admin());
create policy "products admin update"   on public.products      for update using (public.is_admin());
create policy "plans admin read"        on public.product_plans for select using (public.is_admin());
create policy "categories admin write"  on public.categories    for all    using (public.is_admin()) with check (public.is_admin());
create policy "subs admin read"         on public.subscriptions for select using (public.is_admin());
create policy "orders admin read"       on public.orders        for select using (public.is_admin());
create policy "engine_runs admin read"  on public.engine_runs   for select using (public.is_admin());
