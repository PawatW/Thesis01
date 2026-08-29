-- ============================================================
-- ANAN — closing two logic holes found while reviewing Phase 4.5
--
-- A. A suspended shop kept billing: the engine only checked subscription status,
--    so the platform went on charging buyers (demo) and generating orders for a
--    shop it had itself suspended.
-- B. A seller could raise price_per_cycle and buyers were charged more on the next
--    cycle with no notice at all.
--
-- Specs: context/planing/13-recurring-engine.md, 14-admin.md, 11-seller-products.md
-- Workflows: W05 (state), W06 (engine), W10 (admin)
-- ============================================================

-- ---------- 1. WHY a subscription is paused ----------
-- "paused by the buyer" and "frozen because the shop was suspended" must be
-- distinguishable: the buyer may resume the first, never the second.

alter table public.subscriptions
  add column if not exists paused_reason text;

alter table public.subscriptions
  add constraint subs_paused_reason_valid
    check (paused_reason is null or paused_reason in ('user', 'shop_suspended')),
  add constraint subs_paused_reason_only_when_paused
    check (status = 'paused' or paused_reason is null);

comment on column public.subscriptions.paused_reason is
  'user = buyer pressed pause; shop_suspended = frozen by admin moderation (buyer cannot resume it).';

-- price changes join the subscription timeline
alter table public.subscription_events drop constraint if exists subscription_events_event_check;
alter table public.subscription_events
  add constraint subscription_events_event_check
  check (event in ('created', 'paused', 'resumed', 'skipped', 'rescheduled',
                   'cycle_changed', 'address_changed', 'cancelled',
                   'order_cancelled', 'reviewed', 'price_changed'));

-- ---------- 2. (A) THE ENGINE'S DEFINITION OF "DUE" ----------
-- Single source of truth for which subscriptions may be billed today. The engine
-- (migration for feature 13) must select from here rather than writing its own
-- WHERE clause — that duplication is exactly how the shop check went missing.
create or replace function public.due_subscriptions(p_run_date date)
returns table (
  subscription_id   uuid,
  plan_id           uuid,
  buyer_id          uuid,
  address_id        uuid,
  payment_method_id uuid,
  quantity          int,
  cycle             text,
  price_per_cycle   numeric,
  qty_per_cycle     int,
  next_order_date   date,
  shop_id           uuid
)
language sql stable security definer
set search_path = ''
as $$
  select s.id, s.plan_id, s.buyer_id, s.address_id, s.payment_method_id, s.quantity,
         pp.cycle, pp.price_per_cycle, pp.qty_per_cycle, s.next_order_date, sh.id
    from public.subscriptions s
    join public.product_plans pp on pp.id = s.plan_id
    join public.products p       on p.id  = pp.product_id
    join public.shops sh         on sh.id = p.shop_id
   where s.status = 'active'
     and s.next_order_date <= p_run_date
     and sh.suspended_at is null      -- never bill for a shop the platform suspended
     and p.suspended_at is null;      -- ...or a product it took down
$$;

comment on function public.due_subscriptions(date) is
  'Engine-only. Seller closing their own shop (is_active=false) still delivers to existing
   subscribers by design; ADMIN suspension stops billing — that is the difference.';

-- engine runs as service_role / postgres; no client role may call this.
-- The grant to service_role is explicit: the hardening migration removed the
-- default PUBLIC execute, so relying on an inherited grant here would be a guess.
revoke execute on function public.due_subscriptions(date) from public, anon, authenticated;
grant  execute on function public.due_subscriptions(date) to service_role;

-- ---------- 3. (A) FREEZE / UNFREEZE ON MODERATION ----------
-- Suspension now propagates to the money: active subscriptions are paused with a
-- reason, and restored when the suspension is lifted.

create or replace function public.freeze_subscriptions_for_shop(p_shop_id uuid, p_product_id uuid default null)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count int := 0;
begin
  with frozen as (
    update public.subscriptions s
       set status = 'paused', paused_at = now(), paused_reason = 'shop_suspended'
      from public.product_plans pp
      join public.products p on p.id = pp.product_id
     where pp.id = s.plan_id
       and s.status = 'active'
       and p.shop_id = p_shop_id
       and (p_product_id is null or p.id = p_product_id)
    returning s.id, s.buyer_id, p.name as product_name
  ),
  ev as (
    insert into public.subscription_events (subscription_id, event, detail)
    select id, 'paused', jsonb_build_object('reason', 'shop_suspended') from frozen
  )
  insert into public.notifications (user_id, type, title, body, link_path)
  select buyer_id, 'subscription_frozen',
         'หยุดรอบส่งชั่วคราว: ' || product_name,
         'ร้านค้าถูกระงับโดยผู้ดูแลระบบ — รอบถัดไปจะไม่ถูกสร้างและไม่มีการตัดเงิน จนกว่าร้านจะกลับมาให้บริการ',
         '/subscriptions/' || id::text
    from frozen;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.unfreeze_subscriptions_for_shop(p_shop_id uuid, p_product_id uuid default null)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count int := 0;
  v_tomorrow date := ((now() at time zone 'Asia/Bangkok')::date + 1);
begin
  with thawed as (
    update public.subscriptions s
       set status = 'active',
           paused_at = null,
           paused_reason = null,
           -- same rule as a normal resume (W05): never fire a cycle retroactively
           next_order_date = greatest(s.next_order_date, v_tomorrow)
      from public.product_plans pp
      join public.products p on p.id = pp.product_id
      join public.shops sh   on sh.id = p.shop_id
     where pp.id = s.plan_id
       and s.status = 'paused'
       and s.paused_reason = 'shop_suspended'
       and p.shop_id = p_shop_id
       and (p_product_id is null or p.id = p_product_id)
       and p.suspended_at is null
       -- must match guard_subscription_update exactly, or un-suspending a product
       -- while its shop is still suspended aborts the whole RPC
       and sh.suspended_at is null
    returning s.id, s.buyer_id, s.next_order_date, p.name as product_name
  ),
  ev as (
    insert into public.subscription_events (subscription_id, event, detail)
    select id, 'resumed', jsonb_build_object('reason', 'shop_unsuspended') from thawed
  )
  insert into public.notifications (user_id, type, title, body, link_path)
  select buyer_id, 'subscription_resumed',
         'กลับมาส่งตามปกติ: ' || product_name,
         'ร้านค้ากลับมาให้บริการแล้ว — รอบถัดไปคือวันที่ ' || to_char(next_order_date, 'DD/MM/YYYY'),
         '/subscriptions/' || id::text
    from thawed;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 3.1 moderation RPCs now freeze/unfreeze in the same transaction as the flag.
--     They return the number of affected subscriptions, so the return type changes
--     from void -> int and the old signatures must be dropped first.
drop function if exists public.admin_set_shop_suspension(uuid, boolean, text);
drop function if exists public.admin_set_product_suspension(uuid, boolean, text);

create or replace function public.admin_set_shop_suspension(
  p_shop_id uuid, p_suspend boolean, p_reason text default null)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_affected int;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  update public.shops
     set suspended_at     = case when p_suspend then now() else null end,
         suspended_reason = case when p_suspend then left(coalesce(p_reason, ''), 200) else null end
   where id = p_shop_id;

  if not found then
    raise exception 'shop not found' using errcode = '22023';
  end if;

  if p_suspend then
    v_affected := public.freeze_subscriptions_for_shop(p_shop_id);
  else
    v_affected := public.unfreeze_subscriptions_for_shop(p_shop_id);
  end if;

  return v_affected;   -- how many subscriptions were frozen/thawed (shown in the confirm dialog)
end;
$$;

create or replace function public.admin_set_product_suspension(
  p_product_id uuid, p_suspend boolean, p_reason text default null)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_shop_id  uuid;
  v_affected int;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  update public.products
     set suspended_at     = case when p_suspend then now() else null end,
         suspended_reason = case when p_suspend then left(coalesce(p_reason, ''), 200) else null end
   where id = p_product_id
  returning shop_id into v_shop_id;

  if v_shop_id is null then
    raise exception 'product not found' using errcode = '22023';
  end if;

  if p_suspend then
    v_affected := public.freeze_subscriptions_for_shop(v_shop_id, p_product_id);
  else
    v_affected := public.unfreeze_subscriptions_for_shop(v_shop_id, p_product_id);
  end if;

  return v_affected;
end;
$$;

-- 3.2 a frozen subscription cannot be resumed while the suspension stands —
--     enforced for every caller, RPC and engine included
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

  -- no resuming into a suspended shop/product (covers the buyer pressing resume on
  -- a subscription that was frozen by moderation)
  if new.status = 'active' and old.status <> 'active'
     and exists (select 1
                   from public.product_plans pp
                   join public.products p on p.id = pp.product_id
                   join public.shops sh   on sh.id = p.shop_id
                  where pp.id = new.plan_id
                    and (sh.suspended_at is not null or p.suspended_at is not null)) then
    raise exception 'cannot resume while the shop or product is suspended' using errcode = '22023';
  end if;

  -- paused_reason only means something while paused. Normalizing here (rather than
  -- trusting every caller) keeps `subs_paused_reason_only_when_paused` satisfied on
  -- the paused -> cancelled transition that W05 allows.
  if new.status <> 'paused' then
    new.paused_reason := null;
  end if;

  return new;
end;
$$;

-- ---------- 4. (B) PRICE CHANGE MUST REACH THE BUYER ----------
-- Feature 11 warned the SELLER before a price change; the people who actually pay
-- were told nothing. Every affected subscriber now gets a notification naming the
-- old price, the new price, the cycle it takes effect, and a link to pause/cancel.
create or replace function public.notify_plan_price_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_product text;
begin
  if new.price_per_cycle = old.price_per_cycle then
    return new;
  end if;

  select p.name into v_product from public.products p where p.id = new.product_id;

  with affected as (
    select s.id, s.buyer_id, s.next_order_date
      from public.subscriptions s
     where s.plan_id = new.id
       and s.status in ('active', 'paused')
  ),
  ev as (
    insert into public.subscription_events (subscription_id, event, detail)
    select id, 'price_changed',
           jsonb_build_object('from', old.price_per_cycle, 'to', new.price_per_cycle)
      from affected
  )
  insert into public.notifications (user_id, type, title, body, link_path)
  select buyer_id, 'price_changed',
         'ราคารอบส่งเปลี่ยนแปลง: ' || coalesce(v_product, 'สินค้า'),
         'จาก ฿' || trim(to_char(old.price_per_cycle, 'FM999999990.00')) ||
         ' เป็น ฿'  || trim(to_char(new.price_per_cycle, 'FM999999990.00')) ||
         case when next_order_date is not null
              then ' มีผลตั้งแต่รอบวันที่ ' || to_char(next_order_date, 'DD/MM/YYYY')
              else '' end ||
         ' — หยุดชั่วคราวหรือยกเลิกได้ทุกเมื่อ',
         '/subscriptions/' || id::text
    from affected;

  return new;
end;
$$;

drop trigger if exists notify_plan_price_change on public.product_plans;
create trigger notify_plan_price_change
  after update of price_per_cycle on public.product_plans
  for each row execute function public.notify_plan_price_change();

-- ---------- 5. EXECUTE GRANTS ----------
-- All of these are internal (called by RPCs/triggers/engine), so no client role
-- gets EXECUTE except the two admin entry points.

revoke execute on function public.freeze_subscriptions_for_shop(uuid, uuid)   from public, anon, authenticated;
revoke execute on function public.unfreeze_subscriptions_for_shop(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.admin_set_shop_suspension(uuid, boolean, text)    from public, anon;
revoke execute on function public.admin_set_product_suspension(uuid, boolean, text) from public, anon;

grant execute on function public.admin_set_shop_suspension(uuid, boolean, text)     to authenticated;
grant execute on function public.admin_set_product_suspension(uuid, boolean, text)  to authenticated;

-- Postgres grants EXECUTE to PUBLIC on every newly created function, and
-- `alter default privileges ... revoke execute ... from public` (set in the hardening
-- migration) does NOT reliably suppress that for functions created by later
-- migrations — pgTAP caught `notify_plan_price_change` exposed to anon this way.
-- Every migration that creates a function must therefore end with this sweep:
-- revoke from public/anon (leaves explicit grants to authenticated untouched).
revoke execute on all functions in schema public from public, anon;
