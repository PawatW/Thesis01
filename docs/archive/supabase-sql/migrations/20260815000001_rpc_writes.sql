-- ============================================================
-- ANAN — write RPCs (checkout + the seven W05 actions)
-- Contracts: docs/security-design.md §5 · Flows: W04, W05
--
-- Clients hold no INSERT/UPDATE grant on subscriptions, orders, payments or
-- subscription_events. Every write below therefore runs here, where ownership,
-- state and money are all re-checked server-side in one transaction.
-- ============================================================

-- ---------- 0. SHARED CYCLE MATH ----------
-- One definition, used by checkout, the W05 actions and (later) the engine, so
-- "31 Jan + 1 month = 28 Feb" behaves identically everywhere.
create or replace function public.add_cycle(p_from date, p_cycle text)
returns date
language sql immutable
set search_path = ''
as $$
  select case p_cycle
           when '2w' then p_from + interval '14 days'
           when '1m' then p_from + interval '1 month'
           when '2m' then p_from + interval '2 months'
         end::date;
$$;

-- Loads a subscription that must belong to the caller, or raises. Every action
-- below starts with this — it is the ownership check (S-04).
create or replace function public.my_subscription(p_id uuid)
returns public.subscriptions
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions;
begin
  select * into v_sub from public.subscriptions where id = p_id and buyer_id = auth.uid();
  if v_sub.id is null then
    raise exception 'ไม่พบรายการนี้' using errcode = '42501';
  end if;
  return v_sub;
end;
$$;

-- ---------- 1. CHECKOUT ----------
create or replace function public.subscribe_to_plan(
  p_plan_id uuid,
  p_address_id uuid,
  p_payment_method_id uuid,
  p_quantity int default 1,
  p_start_date date default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_today      date := (now() at time zone 'Asia/Bangkok')::date;
  v_start      date := coalesce(p_start_date, v_today + 1);
  v_cycle      text;
  v_price      numeric(10,2);
  v_product    text;
  v_owner      uuid;
  v_snapshot   jsonb;
  v_sub_id     uuid;
  v_order_id   uuid;
  v_amount     numeric(10,2);
begin
  if v_uid is null then
    raise exception 'ต้องเข้าสู่ระบบก่อน' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity not between 1 and 10 then
    raise exception 'จำนวนต้องอยู่ระหว่าง 1-10' using errcode = '22023';
  end if;
  if v_start < v_today + 1 or v_start > v_today + 14 then
    raise exception 'วันเริ่มรอบแรกต้องอยู่ระหว่างพรุ่งนี้ถึง 14 วันข้างหน้า' using errcode = '22023';
  end if;

  -- plan must be open, and the product AND shop must be live (a suspended shop
  -- must not be able to take new money)
  select pp.cycle, pp.price_per_cycle, pr.name, s.owner_id
    into v_cycle, v_price, v_product, v_owner
    from public.product_plans pp
    join public.products pr on pr.id = pp.product_id
    join public.shops s     on s.id  = pr.shop_id
   where pp.id = p_plan_id
     and pp.is_active
     and pr.is_active and pr.suspended_at is null
     and s.is_active  and s.suspended_at  is null;

  if v_cycle is null then
    raise exception 'แผนนี้เพิ่งปิดรับสมาชิกใหม่' using errcode = '22023';
  end if;

  -- the address and card must belong to the caller (S-04)
  select jsonb_build_object(
           'recipient_name', a.recipient_name, 'phone', a.phone,
           'address_line', a.address_line, 'province', a.province, 'postcode', a.postcode)
    into v_snapshot
    from public.addresses a
   where a.id = p_address_id and a.user_id = v_uid;
  if v_snapshot is null then
    raise exception 'ไม่พบที่อยู่นี้ในบัญชีของคุณ' using errcode = '42501';
  end if;

  if not exists (select 1 from public.payment_methods pm
                  where pm.id = p_payment_method_id and pm.user_id = v_uid) then
    raise exception 'ไม่พบบัตรนี้ในบัญชีของคุณ' using errcode = '42501';
  end if;

  -- amount is computed here, never accepted from the client
  v_amount := v_price * p_quantity;

  insert into public.subscriptions
    (buyer_id, plan_id, address_id, payment_method_id, status, quantity, start_date, next_order_date)
  values
    (v_uid, p_plan_id, p_address_id, p_payment_method_id, 'active', p_quantity, v_start,
     public.add_cycle(v_start, v_cycle))
  returning id into v_sub_id;

  insert into public.orders (subscription_id, cycle_date, status, amount, address_snapshot)
  values (v_sub_id, v_start, 'pending', v_amount, v_snapshot)
  returning id into v_order_id;

  -- simulated charge (CLAUDE.md rule 1 — no gateway, ever)
  insert into public.payments (order_id, amount, status, paid_at)
  values (v_order_id, v_amount, 'paid', now());

  insert into public.subscription_events (subscription_id, event, detail)
  values (v_sub_id, 'created',
          jsonb_build_object('quantity', p_quantity, 'start_date', v_start, 'cycle', v_cycle));

  insert into public.notifications (user_id, type, title, body, link_path)
  values (v_owner, 'new_subscriber', 'มีผู้สมัครรับสินค้าใหม่',
          v_product || ' — ' || case v_cycle when '2w' then 'ทุก 2 สัปดาห์'
                                             when '2m' then 'ทุก 2 เดือน' else 'ทุกเดือน' end,
          '/orders');

  return v_sub_id;
end;
$$;

-- ---------- 2. THE SEVEN W05 ACTIONS ----------
-- Each one: load-and-own, check the state machine, write the row AND the event.

create or replace function public.pause_subscription(p_subscription_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_sub public.subscriptions;
begin
  v_sub := public.my_subscription(p_subscription_id);
  if v_sub.status <> 'active' then
    raise exception 'หยุดชั่วคราวได้เฉพาะรายการที่กำลังใช้งาน' using errcode = '22023';
  end if;

  update public.subscriptions
     set status = 'paused', paused_at = now(), paused_reason = 'user'
   where id = p_subscription_id;

  insert into public.subscription_events (subscription_id, event, detail)
  values (p_subscription_id, 'paused', jsonb_build_object('reason', 'user'));
end;
$$;

create or replace function public.resume_subscription(p_subscription_id uuid)
returns date
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sub  public.subscriptions;
  v_next date;
begin
  v_sub := public.my_subscription(p_subscription_id);
  if v_sub.status <> 'paused' then
    raise exception 'กลับมาใช้งานได้เฉพาะรายการที่หยุดชั่วคราว' using errcode = '22023';
  end if;
  if v_sub.paused_reason = 'shop_suspended' then
    raise exception 'ร้านค้าถูกระงับชั่วคราว — ระบบจะกลับมาส่งให้เองเมื่อร้านเปิดอีกครั้ง'
      using errcode = '22023';
  end if;

  -- never fire a cycle retroactively (W05)
  v_next := greatest(v_sub.next_order_date, (now() at time zone 'Asia/Bangkok')::date + 1);

  update public.subscriptions
     set status = 'active', paused_at = null, paused_reason = null, next_order_date = v_next
   where id = p_subscription_id;

  insert into public.subscription_events (subscription_id, event, detail)
  values (p_subscription_id, 'resumed', jsonb_build_object('next_order_date', v_next));

  return v_next;
end;
$$;

create or replace function public.skip_next_cycle(p_subscription_id uuid)
returns date
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sub   public.subscriptions;
  v_cycle text;
  v_next  date;
begin
  v_sub := public.my_subscription(p_subscription_id);
  if v_sub.status <> 'active' then
    raise exception 'ข้ามรอบได้เฉพาะรายการที่กำลังใช้งาน' using errcode = '22023';
  end if;

  select cycle into v_cycle from public.product_plans where id = v_sub.plan_id;
  v_next := public.add_cycle(v_sub.next_order_date, v_cycle);

  update public.subscriptions set next_order_date = v_next where id = p_subscription_id;

  insert into public.subscription_events (subscription_id, event, detail)
  values (p_subscription_id, 'skipped',
          jsonb_build_object('from', v_sub.next_order_date, 'to', v_next));

  return v_next;
end;
$$;

create or replace function public.reschedule_subscription(p_subscription_id uuid, p_date date)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sub   public.subscriptions;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  v_sub := public.my_subscription(p_subscription_id);
  if v_sub.status <> 'active' then
    raise exception 'เลื่อนวันได้เฉพาะรายการที่กำลังใช้งาน' using errcode = '22023';
  end if;
  if p_date is null or p_date <= v_today then
    raise exception 'เลือกวันที่หลังจากวันนี้' using errcode = '22023';
  end if;
  if p_date > v_today + 90 then
    raise exception 'เลื่อนได้ไม่เกิน 90 วัน' using errcode = '22023';
  end if;

  update public.subscriptions set next_order_date = p_date where id = p_subscription_id;

  insert into public.subscription_events (subscription_id, event, detail)
  values (p_subscription_id, 'rescheduled',
          jsonb_build_object('from', v_sub.next_order_date, 'to', p_date));
end;
$$;

create or replace function public.change_subscription_plan(p_subscription_id uuid, p_plan_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sub        public.subscriptions;
  v_old_cycle  text;
  v_new_cycle  text;
begin
  v_sub := public.my_subscription(p_subscription_id);
  if v_sub.status <> 'active' then
    raise exception 'เปลี่ยนรอบส่งได้เฉพาะรายการที่กำลังใช้งาน' using errcode = '22023';
  end if;

  select cycle into v_old_cycle from public.product_plans where id = v_sub.plan_id;

  -- must stay on the same product, and the target plan must be open
  select pp.cycle into v_new_cycle
    from public.product_plans pp
    join public.product_plans cur on cur.id = v_sub.plan_id
   where pp.id = p_plan_id
     and pp.product_id = cur.product_id
     and pp.is_active;

  if v_new_cycle is null then
    raise exception 'ไม่พบแผนรอบส่งนี้ หรือแผนถูกปิดไปแล้ว' using errcode = '22023';
  end if;

  update public.subscriptions set plan_id = p_plan_id where id = p_subscription_id;

  insert into public.subscription_events (subscription_id, event, detail)
  values (p_subscription_id, 'cycle_changed',
          jsonb_build_object('from', v_old_cycle, 'to', v_new_cycle));
end;
$$;

create or replace function public.change_subscription_address(p_subscription_id uuid, p_address_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_sub public.subscriptions;
begin
  v_sub := public.my_subscription(p_subscription_id);
  if v_sub.status = 'cancelled' then
    raise exception 'รายการนี้ยกเลิกไปแล้ว' using errcode = '22023';
  end if;
  if not exists (select 1 from public.addresses a
                  where a.id = p_address_id and a.user_id = auth.uid()) then
    raise exception 'ไม่พบที่อยู่นี้ในบัญชีของคุณ' using errcode = '42501';
  end if;

  update public.subscriptions set address_id = p_address_id where id = p_subscription_id;

  insert into public.subscription_events (subscription_id, event, detail)
  values (p_subscription_id, 'address_changed', jsonb_build_object('address_id', p_address_id));
end;
$$;

create or replace function public.cancel_subscription(p_subscription_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sub     public.subscriptions;
  v_owner   uuid;
  v_product text;
begin
  v_sub := public.my_subscription(p_subscription_id);
  if v_sub.status = 'cancelled' then
    return;   -- idempotent: cancelling twice is not an error
  end if;

  -- paused_reason is cleared by guard_subscription_update, but be explicit
  update public.subscriptions
     set status = 'cancelled', cancelled_at = now(), next_order_date = null,
         paused_at = null, paused_reason = null
   where id = p_subscription_id;

  insert into public.subscription_events (subscription_id, event, detail)
  values (p_subscription_id, 'cancelled', '{}'::jsonb);

  select s.owner_id, pr.name into v_owner, v_product
    from public.product_plans pp
    join public.products pr on pr.id = pp.product_id
    join public.shops s     on s.id  = pr.shop_id
   where pp.id = v_sub.plan_id;

  insert into public.notifications (user_id, type, title, body, link_path)
  values (v_owner, 'subscriber_cancelled', 'มีผู้ยกเลิกการสมัคร',
          coalesce(v_product, 'สินค้า'), '/dashboard');
end;
$$;

-- ---------- 3. ORDER STATUS NOTIFICATIONS (feature 08) ----------
-- The seller updates orders directly (status + tracking_note are granted), so the
-- buyer notification has to come from a trigger rather than an RPC.
create or replace function public.notify_order_status_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_buyer   uuid;
  v_product text;
  v_label   text;
begin
  if new.status = old.status then
    return new;
  end if;

  select ss.buyer_id, pr.name into v_buyer, v_product
    from public.subscriptions ss
    join public.product_plans pp on pp.id = ss.plan_id
    join public.products pr      on pr.id = pp.product_id
   where ss.id = new.subscription_id;

  v_label := case new.status
               when 'preparing' then 'ร้านกำลังจัดของ'
               when 'shipped'   then 'พัสดุออกจากร้านแล้ว'
               when 'delivered' then 'จัดส่งสำเร็จ'
               else null
             end;
  if v_label is null then
    return new;   -- 'cancelled' has its own notification inside seller_cancel_order
  end if;

  insert into public.notifications (user_id, type, title, body, link_path)
  values (v_buyer, 'order_status', v_label,
          coalesce(v_product, 'สินค้า') ||
          case when new.tracking_note is not null then ' — เลขพัสดุ ' || new.tracking_note else '' end,
          '/orders/' || new.id::text);

  return new;
end;
$$;

drop trigger if exists notify_order_status_change on public.orders;
create trigger notify_order_status_change after update of status on public.orders
  for each row execute function public.notify_order_status_change();

-- ---------- 4. EXECUTE GRANTS ----------
revoke execute on all functions in schema public from public, anon;

grant execute on function public.subscribe_to_plan(uuid, uuid, uuid, int, date)   to authenticated;
grant execute on function public.pause_subscription(uuid)                          to authenticated;
grant execute on function public.resume_subscription(uuid)                         to authenticated;
grant execute on function public.skip_next_cycle(uuid)                             to authenticated;
grant execute on function public.reschedule_subscription(uuid, date)               to authenticated;
grant execute on function public.change_subscription_plan(uuid, uuid)              to authenticated;
grant execute on function public.change_subscription_address(uuid, uuid)           to authenticated;
grant execute on function public.cancel_subscription(uuid)                         to authenticated;
grant execute on function public.add_cycle(date, text)                             to authenticated;
-- my_subscription() is an internal helper: no client grant
