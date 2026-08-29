-- ============================================================
-- ANAN — Tier 1 features: order exceptions, delivery confirmation, reviews
-- Specs: context/planing/15-order-exceptions.md, 16-delivery-confirmation.md,
--        17-reviews.md | Workflows: W11, W12
--
-- Follows the authorization model set in 20260725000001_security_hardening.sql:
--   no client writes on these tables — every mutation goes through a
--   security definer RPC that re-checks ownership and state.
-- ============================================================

-- ---------- 1. SCHEMA ----------

-- 1.1 orders: a cycle can now end without a delivery (seller ran out of stock),
--     and the buyer gets an explicit say in whether it actually arrived.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in ('pending', 'preparing', 'shipped', 'delivered', 'cancelled'));

alter table public.orders
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists confirmed_at  timestamptz;   -- set by the BUYER only

alter table public.orders
  add constraint orders_cancel_reason_len
    check (cancel_reason is null or char_length(cancel_reason) <= 200),
  add constraint orders_cancel_consistent
    check ((status = 'cancelled') = (cancelled_at is not null));

comment on column public.orders.confirmed_at is
  'Buyer confirmation of receipt. Sellers can set status=delivered themselves, so this
   column is the only trustworthy "it actually arrived" signal (see feature 16).';

-- 1.2 payments: demo refund when a cycle is cancelled
alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments
  add constraint payments_status_check
  check (status in ('paid', 'failed', 'refunded'));

alter table public.payments
  add column if not exists refunded_at timestamptz;

-- 1.3 subscription timeline gains the cancelled-cycle event
alter table public.subscription_events drop constraint if exists subscription_events_event_check;
alter table public.subscription_events
  add constraint subscription_events_event_check
  check (event in ('created', 'paused', 'resumed', 'skipped', 'rescheduled',
                   'cycle_changed', 'address_changed', 'cancelled',
                   'order_cancelled', 'reviewed'));

-- 1.4 order issues — the buyer's channel when something goes wrong.
--     One open case per order keeps the queue meaningful.
create table public.order_issues (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  reporter_id     uuid not null references public.profiles(id) on delete cascade,
  type            text not null check (type in ('not_received', 'wrong_item', 'damaged', 'other')),
  detail          text not null check (char_length(detail) between 5 and 1000),
  status          text not null default 'open' check (status in ('open', 'resolved', 'rejected')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000),
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  unique (order_id),
  check ((status = 'open') = (resolved_at is null))
);

-- 1.5 reviews — one per subscription, only from people who actually received goods.
--     `cycles_received` is snapshotted at write time: "reviewed after 4 cycles" is
--     the signal a single-purchase marketplace cannot produce.
create table public.reviews (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  buyer_id        uuid not null references public.profiles(id) on delete cascade,
  rating          int  not null check (rating between 1 and 5),
  comment         text check (comment is null or char_length(comment) <= 1000),
  cycles_received int  not null default 1 check (cycles_received >= 1),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (subscription_id)
);

create index idx_order_issues_status  on public.order_issues (status, created_at desc);
create index idx_order_issues_order   on public.order_issues (order_id);
create index idx_reviews_product      on public.reviews (product_id, created_at desc);
-- the real query is "shipped orders still awaiting buyer confirmation"
create index idx_orders_awaiting_confirm on public.orders (status, cycle_date) where confirmed_at is null;

-- ---------- 2. PRIVILEGES ----------
-- Read-only for clients; every write goes through the RPCs in §4.

alter table public.order_issues enable row level security;
alter table public.reviews      enable row level security;

grant select on public.order_issues to authenticated;
grant select on public.reviews      to authenticated;

-- ---------- 3. RLS POLICIES ----------

-- issues: reporter, the shop that has to fix it, and admins
create policy "issues reporter read" on public.order_issues for select to authenticated
  using (reporter_id = (select auth.uid()));
create policy "issues seller read" on public.order_issues for select to authenticated
  using (exists (select 1 from public.orders o
                 where o.id = order_id and public.order_is_for_my_shop(o.subscription_id)));
create policy "issues admin read" on public.order_issues for select to authenticated
  using (public.is_admin());

-- reviews: authors read their own rows raw; everyone else reads the masked view (§5)
create policy "reviews author read" on public.reviews for select to authenticated
  using (buyer_id = (select auth.uid()));
create policy "reviews admin read" on public.reviews for select to authenticated
  using (public.is_admin());

-- ---------- 4. RPCs ----------

-- 4.1 seller cancels a cycle it cannot ship. Refund is issued in the same
--     transaction: an order must never be cancelled while its charge stays 'paid'.
create or replace function public.seller_cancel_order(p_order_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order   public.orders;
  v_buyer   uuid;
  v_product text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'order not found' using errcode = '22023';
  end if;
  if not public.order_is_for_my_shop(v_order.subscription_id) then
    raise exception 'not your shop''s order' using errcode = '42501';
  end if;
  if v_order.status not in ('pending', 'preparing') then
    raise exception 'only pending/preparing orders can be cancelled (this one is %)', v_order.status
      using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;

  update public.orders
     set status = 'cancelled', cancelled_at = now(), cancel_reason = left(btrim(p_reason), 200)
   where id = p_order_id;

  -- demo refund (no gateway involved — CLAUDE.md rule 1)
  update public.payments
     set status = 'refunded', refunded_at = now()
   where order_id = p_order_id and status = 'paid';

  select ss.buyer_id, pr.name
    into v_buyer, v_product
    from public.subscriptions ss
    join public.product_plans pp on pp.id = ss.plan_id
    join public.products pr      on pr.id = pp.product_id
   where ss.id = v_order.subscription_id;

  insert into public.subscription_events (subscription_id, event, detail)
  values (v_order.subscription_id, 'order_cancelled',
          jsonb_build_object('order_id', p_order_id, 'reason', left(btrim(p_reason), 200)));

  insert into public.notifications (user_id, type, title, body, link_path)
  values (v_buyer, 'order_status', 'ร้านยกเลิกออเดอร์รอบนี้',
          v_product || ' — ' || left(btrim(p_reason), 200) || ' (คืนเงินจำลองแล้ว)',
          '/orders/' || p_order_id::text);
end;
$$;

-- 4.2 buyer confirms receipt. Also closes out the seller-driven status when the
--     parcel arrives before the seller remembers to tick 'delivered'.
create or replace function public.confirm_order_received(p_order_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select o.* into v_order
    from public.orders o
    join public.subscriptions ss on ss.id = o.subscription_id
   where o.id = p_order_id and ss.buyer_id = auth.uid();

  if v_order.id is null then
    raise exception 'order not found' using errcode = '42501';
  end if;
  if v_order.status not in ('shipped', 'delivered') then
    raise exception 'nothing to confirm yet (status %)', v_order.status using errcode = '22023';
  end if;
  if v_order.confirmed_at is not null then
    return;   -- idempotent: double tap is not an error
  end if;

  update public.orders
     set confirmed_at = now(),
         status = 'delivered'
   where id = p_order_id;
end;
$$;

-- 4.3 buyer reports a problem; the shop owner gets notified immediately and the
--     case shows up in the admin queue (feature 14).
create or replace function public.report_order_issue(
  p_order_id uuid, p_type text, p_detail text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_order    public.orders;
  v_issue_id uuid;
  v_owner    uuid;
begin
  select o.* into v_order
    from public.orders o
    join public.subscriptions ss on ss.id = o.subscription_id
   where o.id = p_order_id and ss.buyer_id = auth.uid();

  if v_order.id is null then
    raise exception 'order not found' using errcode = '42501';
  end if;
  if p_type not in ('not_received', 'wrong_item', 'damaged', 'other') then
    raise exception 'unknown issue type: %', p_type using errcode = '22023';
  end if;
  if v_order.status in ('pending', 'cancelled') then
    raise exception 'nothing to report on an order with status %', v_order.status
      using errcode = '22023';
  end if;

  insert into public.order_issues (order_id, reporter_id, type, detail)
  values (p_order_id, auth.uid(), p_type, btrim(p_detail))
  returning id into v_issue_id;

  select s.owner_id into v_owner
    from public.subscriptions ss
    join public.product_plans pp on pp.id = ss.plan_id
    join public.products pr      on pr.id = pp.product_id
    join public.shops s          on s.id  = pr.shop_id
   where ss.id = v_order.subscription_id;

  insert into public.notifications (user_id, type, title, body, link_path)
  values (v_owner, 'order_status', 'ผู้ซื้อแจ้งปัญหาออเดอร์',
          'มีการแจ้งปัญหา: ' || p_type, '/orders/' || p_order_id::text);

  return v_issue_id;
end;
$$;

-- 4.4 shop owner (or admin) closes a case
create or replace function public.resolve_order_issue(
  p_issue_id uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_issue public.order_issues;
  v_order public.orders;
begin
  if p_status not in ('resolved', 'rejected') then
    raise exception 'status must be resolved or rejected' using errcode = '22023';
  end if;

  select * into v_issue from public.order_issues where id = p_issue_id;
  if v_issue.id is null then
    raise exception 'issue not found' using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = v_issue.order_id;

  if not (public.is_admin() or public.order_is_for_my_shop(v_order.subscription_id)) then
    raise exception 'not your shop''s issue' using errcode = '42501';
  end if;
  if v_issue.status <> 'open' then
    raise exception 'issue is already closed' using errcode = '22023';
  end if;

  update public.order_issues
     set status = p_status,
         resolution_note = nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
         resolved_at = now(),
         resolved_by = auth.uid()
   where id = p_issue_id;

  insert into public.notifications (user_id, type, title, body, link_path)
  values (v_issue.reporter_id, 'order_status',
          case p_status when 'resolved' then 'ปัญหาออเดอร์ได้รับการแก้ไขแล้ว'
                        else 'ร้านตอบกลับเรื่องที่แจ้ง' end,
          nullif(left(btrim(coalesce(p_note, '')), 200), ''),
          '/orders/' || v_issue.order_id::text);
end;
$$;

-- 4.5 review — write allowed only after at least one cycle actually arrived.
--     Insert or update in one call; cycles_received is recomputed each time.
create or replace function public.upsert_review(
  p_subscription_id uuid, p_rating int, p_comment text default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_cycles     int;
  v_review_id  uuid;
begin
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'rating must be 1-5' using errcode = '22023';
  end if;

  select pp.product_id into v_product_id
    from public.subscriptions ss
    join public.product_plans pp on pp.id = ss.plan_id
   where ss.id = p_subscription_id and ss.buyer_id = auth.uid();

  if v_product_id is null then
    raise exception 'subscription not found' using errcode = '42501';
  end if;

  -- "verified subscriber": count only cycles that were really delivered
  select count(*) into v_cycles
    from public.orders o
   where o.subscription_id = p_subscription_id
     and (o.status = 'delivered' or o.confirmed_at is not null);

  if v_cycles = 0 then
    raise exception 'you can review after receiving at least one cycle' using errcode = '42501';
  end if;

  insert into public.reviews (subscription_id, product_id, buyer_id, rating, comment, cycles_received)
  values (p_subscription_id, v_product_id, auth.uid(), p_rating,
          nullif(btrim(coalesce(p_comment, '')), ''), v_cycles)
  on conflict (subscription_id) do update
     set rating = excluded.rating,
         comment = excluded.comment,
         cycles_received = excluded.cycles_received,
         updated_at = now()
  returning id into v_review_id;

  insert into public.subscription_events (subscription_id, event, detail)
  values (p_subscription_id, 'reviewed', jsonb_build_object('rating', p_rating, 'cycles', v_cycles));

  return v_review_id;
end;
$$;

-- ---------- 5. PUBLIC READ APIs (aggregate / masked — see security-design §4) ----------

-- 5.1 rating summary per product, for cards, product page and the compare table
create or replace view public.product_review_stats as
  select p.id                                   as product_id,
         count(r.id)                            as review_count,
         round(avg(r.rating)::numeric, 2)       as avg_rating,
         max(r.cycles_received)                 as max_cycles_reviewed
    from public.products p
    left join public.reviews r on r.product_id = p.id
   group by p.id;

comment on view public.product_review_stats is
  'Aggregate only. Definer rights on purpose (counts across all buyers) — docs/security-design.md §4.';

-- 5.2 the public review list. Reviewer names are masked here rather than exposing
--     profiles: a review must not become a way to enumerate who buys what.
create or replace view public.product_reviews
with (security_barrier = true) as
  select r.id,
         r.product_id,
         r.rating,
         r.comment,
         r.cycles_received,
         r.created_at,
         -- fixed-width mask: a length-preserving mask would publish how long each
         -- reviewer's name is, which is free metadata nobody asked to share
         left(pf.display_name, 1) || '***' as reviewer_masked_name
    from public.reviews r
    join public.profiles pf on pf.id = r.buyer_id
    join public.products p  on p.id = r.product_id
    join public.shops s     on s.id = p.shop_id
   where p.suspended_at is null
     and s.suspended_at is null;   -- suspended listings disappear, reviews included

comment on view public.product_reviews is
  'Public reviews with masked reviewer names. Never expose buyer_id/subscription_id here.';

grant select on public.product_review_stats to anon, authenticated;
grant select on public.product_reviews      to anon, authenticated;

-- 5.3 seller_orders gains the new columns (appended — never reorder an existing view)
create or replace view public.seller_orders
with (security_barrier = true) as
  select o.id            as order_id,
         o.cycle_date,
         o.status,
         o.amount,
         o.tracking_note,
         o.created_at,
         o.address_snapshot,
         pr.id           as product_id,
         pr.name         as product_name,
         pr.images       as product_images,
         sub.quantity * pp.qty_per_cycle as units,
         s.id            as shop_id,
         o.confirmed_at,
         o.cancelled_at,
         o.cancel_reason,
         exists (select 1 from public.order_issues oi
                  where oi.order_id = o.id and oi.status = 'open') as has_open_issue
    from public.orders o
    join public.subscriptions sub on sub.id = o.subscription_id
    join public.product_plans pp  on pp.id  = sub.plan_id
    join public.products pr       on pr.id  = pp.product_id
    join public.shops s           on s.id   = pr.shop_id
   where s.owner_id = auth.uid();

grant select on public.seller_orders to authenticated;

-- ---------- 6. GUARD TRIGGER UPDATE ----------
-- The status ladder now has a side exit (cancelled) and two columns clients must
-- never write directly.
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

  -- cancellation must go through seller_cancel_order() so the refund happens too;
  -- confirmation must go through confirm_order_received() so only buyers set it
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    raise exception 'use seller_cancel_order() to cancel an order' using errcode = '42501';
  end if;
  if new.confirmed_at is distinct from old.confirmed_at
     or new.cancelled_at is distinct from old.cancelled_at
     or new.cancel_reason is distinct from old.cancel_reason then
    raise exception 'confirmation/cancellation fields are set by RPC only' using errcode = '42501';
  end if;
  if old.status = 'cancelled' then
    raise exception 'cancelled orders are final' using errcode = '22023';
  end if;

  v_from := array_position(array['pending','preparing','shipped','delivered'], old.status);
  v_to   := array_position(array['pending','preparing','shipped','delivered'], new.status);
  -- fail closed: a status added to orders_status_check but not to this array must
  -- raise, not silently disable the ladder (NULL comparisons make `if` fall through)
  if v_from is null or v_to is null or (v_to <> v_from and v_to <> v_from + 1) then
    raise exception 'invalid order status transition: % -> %', old.status, new.status
      using errcode = '22023';
  end if;
  return new;
end;
$$;

-- ---------- 7. EXECUTE GRANTS ----------

revoke execute on function public.seller_cancel_order(uuid, text)          from public, anon;
revoke execute on function public.confirm_order_received(uuid)             from public, anon;
revoke execute on function public.report_order_issue(uuid, text, text)     from public, anon;
revoke execute on function public.resolve_order_issue(uuid, text, text)    from public, anon;
revoke execute on function public.upsert_review(uuid, int, text)           from public, anon;

grant execute on function public.seller_cancel_order(uuid, text)           to authenticated;
grant execute on function public.confirm_order_received(uuid)              to authenticated;
grant execute on function public.report_order_issue(uuid, text, text)      to authenticated;
grant execute on function public.resolve_order_issue(uuid, text, text)     to authenticated;
grant execute on function public.upsert_review(uuid, int, text)            to authenticated;
