-- ============================================================
-- ANAN — aggregate read APIs (privacy-preserving replacements)
-- Design doc: docs/security-design.md §4
--
-- Hardening removed two over-broad reads:
--   * sellers could SELECT whole subscription rows (buyer_id / address_id /
--     payment_method_id) just to build a stock forecast
--   * buyers cannot count other people's subscriptions, so "popularity" had no
--     legitimate client-side query
-- Both come back here as aggregates: counts and sums, never identities.
-- Every function is `security definer` + re-checks the caller, so the RPC itself
-- is the trust boundary.
-- ============================================================

-- ---------- 1. product_stats — public popularity counter ----------
-- Deliberately bypasses RLS on subscriptions: it exposes a COUNT only, which the
-- catalog already shows as "popular". No row-level data leaves this view.
create or replace view public.product_stats as
  select p.id                             as product_id,
         count(s.id) filter (where s.status = 'active') as active_subscribers
    from public.products p
    left join public.product_plans pp on pp.product_id = p.id
    left join public.subscriptions s  on s.plan_id = pp.id
   group by p.id;

comment on view public.product_stats is
  'Aggregate-only (counts). Runs with definer rights on purpose — see docs/security-design.md §4.';

grant select on public.product_stats to anon, authenticated;

-- ---------- 2. shop_dashboard — seller KPIs for their own shop ----------
create or replace function public.shop_dashboard()
returns table (
  shop_id               uuid,
  active_subscribers    bigint,
  mrr                   numeric,
  cancelled_this_month  bigint
)
language sql stable security definer
set search_path = ''
as $$
  -- a caller with no shop gets a row of nulls rather than an error; the seller UI
  -- routes them to "เปิดร้านค้า" before this is ever called (feature 10)
  with my_shop as (
    select s.id from public.shops s where s.owner_id = auth.uid()
  ),
  my_subs as (
    select sub.status, sub.cancelled_at, sub.quantity, pp.cycle, pp.price_per_cycle
      from public.subscriptions sub
      join public.product_plans pp on pp.id = sub.plan_id
      join public.products pr      on pr.id = pp.product_id
     where pr.shop_id = (select id from my_shop)
  )
  select
    (select id from my_shop),
    count(*) filter (where status = 'active'),
    coalesce(sum(
      case cycle when '2w' then price_per_cycle * quantity * 2
                 when '1m' then price_per_cycle * quantity
                 when '2m' then price_per_cycle * quantity * 0.5 end
    ) filter (where status = 'active'), 0),
    count(*) filter (
      where status = 'cancelled'
        -- back to timestamptz on purpose: `at time zone` alone yields a plain
        -- timestamp that Postgres re-casts using the session zone (UTC), putting
        -- the month boundary at 07:00 Bangkok
        and cancelled_at >= (date_trunc('month', now() at time zone 'Asia/Bangkok')
                             at time zone 'Asia/Bangkok')
    )
  from my_subs;
$$;

-- ---------- 3. shop_forecast — upcoming cycles per product, no buyer identity ----------
create or replace function public.shop_forecast(p_days int default 7)
returns table (
  product_id   uuid,
  product_name text,
  orders_count bigint,
  units        bigint
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_shop_id uuid;
  v_today   date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if p_days is null or p_days not between 1 and 90 then
    raise exception 'p_days must be between 1 and 90' using errcode = '22023';
  end if;

  select s.id into v_shop_id from public.shops s where s.owner_id = auth.uid();
  if v_shop_id is null then
    raise exception 'caller does not own a shop' using errcode = '42501';
  end if;

  return query
    select pr.id,
           pr.name,
           count(*)::bigint,
           sum(sub.quantity * pp.qty_per_cycle)::bigint
      from public.subscriptions sub
      join public.product_plans pp on pp.id = sub.plan_id
      join public.products pr      on pr.id = pp.product_id
     where pr.shop_id = v_shop_id
       and sub.status = 'active'
       and sub.next_order_date between v_today and v_today + p_days
     group by pr.id, pr.name
     order by pr.name;
end;
$$;

-- ---------- 3b. seller_orders — fulfillment list without reading subscription rows ----------
-- The seller UI used to nest orders -> subscriptions -> plans -> products, which no
-- longer resolves (sellers cannot SELECT subscriptions). This view joins that path
-- with definer rights, filters to the caller's own shop, and exposes only what is
-- needed to pack and ship: no buyer_id, no address_id, no payment_method_id.
create or replace view public.seller_orders
with (security_barrier = true) as
  select o.id            as order_id,
         o.cycle_date,
         o.status,
         o.amount,
         o.tracking_note,
         o.created_at,
         o.address_snapshot,           -- required to actually ship the parcel
         pr.id           as product_id,
         pr.name         as product_name,
         pr.images       as product_images,
         sub.quantity * pp.qty_per_cycle as units,
         s.id            as shop_id
    from public.orders o
    join public.subscriptions sub on sub.id = o.subscription_id
    join public.product_plans pp  on pp.id  = sub.plan_id
    join public.products pr       on pr.id  = pp.product_id
    join public.shops s           on s.id   = pr.shop_id
   where s.owner_id = auth.uid();

comment on view public.seller_orders is
  'Seller fulfillment list. Definer rights on purpose; filtered to auth.uid() ownership and stripped of buyer identifiers — see docs/security-design.md §4.';

grant select on public.seller_orders to authenticated;

-- ---------- 4. admin_stats — platform overview (feature 14) ----------
create or replace function public.admin_stats()
returns table (
  users                 bigint,
  shops                 bigint,
  products              bigint,
  active_subscriptions  bigint,
  orders_today          bigint,
  mrr                   numeric,
  cancelled_this_month  bigint
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  return query
    select
      (select count(*) from public.profiles),
      (select count(*) from public.shops),
      (select count(*) from public.products),
      (select count(*) from public.subscriptions where status = 'active'),
      (select count(*) from public.orders where cycle_date = v_today),
      (select coalesce(sum(
                case pp.cycle when '2w' then pp.price_per_cycle * s.quantity * 2
                              when '1m' then pp.price_per_cycle * s.quantity
                              when '2m' then pp.price_per_cycle * s.quantity * 0.5 end), 0)
         from public.subscriptions s
         join public.product_plans pp on pp.id = s.plan_id
        where s.status = 'active'),
      (select count(*) from public.subscriptions
        where status = 'cancelled'
          and cancelled_at >= (date_trunc('month', now() at time zone 'Asia/Bangkok')
                               at time zone 'Asia/Bangkok'));
end;
$$;

-- ---------- 5. EXECUTE grants ----------
-- anon may not call any of these: every one of them reads private data with
-- definer rights and identifies the caller through auth.uid().
revoke execute on function public.shop_dashboard()      from public, anon;
revoke execute on function public.shop_forecast(int)    from public, anon;
revoke execute on function public.admin_stats()         from public, anon;
grant  execute on function public.shop_dashboard()      to authenticated;
grant  execute on function public.shop_forecast(int)    to authenticated;
grant  execute on function public.admin_stats()         to authenticated;
