# Feature 13: Recurring Engine — สร้างออเดอร์อัตโนมัติตามรอบ

> เฟส: 3 | ฝั่ง: System | สถานะ: ✅ เสร็จ (2026-08-17) | Workflows: [W06](../workflows/w06-recurring-cycle.md) ⭐
> **หัวใจทางเทคนิคของ thesis** — บทที่อธิบายละเอียดสุดในเล่มควรเป็นบทนี้
>
> ⚠️ หัวข้อ "สถาปัตยกรรม" กับ "Logic หลัก" ข้างล่างเขียนไว้สมัย Supabase (SQL function + Edge Function)
> **ของจริงที่ทำแล้วคือ `anan-api/src/engine/`** — ตรรกะเหมือนกันทุกข้อ เปลี่ยนแค่ที่อยู่:
>
> | สเปกเดิม | ของจริงตอนนี้ |
> |---|---|
> | `pg_cron 0 18 * * * UTC` | `@Cron('0 1 * * *', { timeZone: 'Asia/Bangkok' })` ใน `EngineService.daily()` |
> | `run_recurring_engine(p_run_date)` | `EngineService.run(runDate)` |
> | `due_subscriptions()` | `EngineService.dueSubscriptions()` + ค่าคงที่ `BILLABLE_PRODUCT` |
> | Edge Function `engine-trigger` | `POST /api/v1/admin/engine/run` (role admin **และ** `DEMO_MODE=true` **และ** NODE_ENV อยู่ใน allowlist จึงจะส่ง `runDate` เองได้) |
> | `insert ... on conflict do nothing` | `UNIQUE(subscription_id, cycle_date)` + ดัก `P2002` แล้วนับเป็น "ข้าม" — ทรานแซกชันเดียวกับการเลื่อนวัน จึงไม่มีทางเลื่อนโดยไม่มีออเดอร์ |
> | `+ interval '1 month'` ใน SQL | `nextCycleAfter(cycleAnchorDate, cycle, runDate)` ใน `src/common/date.ts` (หมุดของกริดรอบ — กันวันตัดเงินยุบเป็นวันที่ 28 ถาวร) |

## ทำอะไรได้ (งานรายวัน 3 อย่าง)

1. **สร้างออเดอร์:** subs ที่ active และ `next_order_date <= today` → insert order + payment (paid) + เลื่อน next_order_date + แจ้ง buyer
2. **แจ้งล่วงหน้า T-3:** subs ที่จะถึงรอบในอีก 3 วัน → notification "skip ได้ถึงวันที่ X"
3. **สรุปให้ร้าน:** notification ต่อร้านที่มีออเดอร์ใหม่วันนี้ + log ลง `engine_runs`
4. **Auto-confirm (Phase 4.5):** ออเดอร์ `shipped` เกิน 7 วันและไม่มีเคสปัญหาเปิดอยู่ → ตั้ง `delivered` ให้ (แต่ **ไม่แตะ `confirmed_at`** เพื่อให้แยกได้ว่าใครยืนยันเอง) + แจ้งผู้ซื้อ — [feature 16](16-delivery-confirmation.md)

## สถาปัตยกรรม

```
pg_cron (0 18 * * * UTC = 01:00 ไทย)
   └─▶ SQL function public.run_recurring_engine(p_run_date date default current_date)
        (ทำงานทั้งหมดใน DB — เร็ว, atomic ต่อ statement, ไม่มี network hop)

Edge Function `engine-trigger` (service role)
   └─▶ เรียก function เดียวกัน — ใช้กับปุ่ม "Run now" + time-travel ในหน้า admin
```

**ข้อกำหนดความปลอดภัยของ `engine-trigger`** (ดู [security-design.md §6](../../docs/security-design.md)):
1. ตรวจ JWT ผู้เรียกด้วย **anon client** (`auth.getUser(jwt)`) แล้วเช็ค `is_admin` ก่อน — จึงค่อยสร้าง client ด้วย service key (ห้ามใช้ service client ตรวจสิทธิ์ เพราะมันผ่านทุกอย่าง)
2. `run_date` รับได้เฉพาะเมื่อ env `DEMO_MODE = 'true'` + parse เป็น date จริง + จำกัดช่วง ±180 วัน (time-travel = เขียนข้อมูลย้อนหลัง ถือเป็น privileged action)
3. service key อยู่ใน Edge Function secrets เท่านั้น — **ห้ามอยู่ในแอพ Expo** (CLAUDE.md ข้อ 7 Security)
4. ไม่ส่ง SQL error ดิบกลับ client

- เลือกทำ logic ทั้งหมดเป็น **SQL function** (migration 0003) แทน TypeScript ใน edge function — เหตุผล: ใช้ `insert ... on conflict` + `update from` ชุดเดียว ครอบ transaction ง่าย และ pg_cron เรียกตรงได้; edge function เป็นแค่ทางเข้า HTTP สำหรับ demo
- `p_run_date` รับวันที่จำลองได้ = **time-travel สำหรับเดโม่** ([W09](../workflows/w09-demo-script.md))

## Logic หลัก (pseudocode ของ SQL function)

```sql
-- 1) สร้างออเดอร์ (idempotent ด้วย UQ)
-- ⚠ ห้ามเขียน where เอง — ใช้ due_subscriptions() ที่เป็นนิยามเดียวของคำว่า "ถึงรอบ"
--   (มันกรองร้าน/สินค้าที่ถูกแอดมินระงับออกด้วย — ดู migration 0725-4)
with due as (
  select * from public.due_subscriptions(p_run_date)
),
ins as (
  insert into orders (subscription_id, cycle_date, amount, address_snapshot, status)
  select id, next_order_date, price_per_cycle * quantity, snapshot_of(address_id), 'pending'
  from due
  on conflict (subscription_id, cycle_date) do nothing
  returning id, subscription_id
)
-- payments + notifications: insert เฉพาะแถวจาก ins
-- เลื่อนรอบ: update subscriptions set next_order_date = next_order_date + cycle_interval
--            where id in (select subscription_id from ins)   ← เฉพาะที่ insert สำเร็จ!
-- ⚠ ถ้าเลื่อนทุกแถวใน due แต่ order ชน conflict → รอบนั้นหายเงียบ = บั๊กร้ายแรงสุดของระบบ

-- 2) T-3: insert notifications สำหรับ subs ที่ next_order_date = p_run_date + 3
--    (กันแจ้งซ้ำ: เช็คว่ายังไม่มี notification type upcoming_cycle ของ sub+วันที่นั้น)
-- 3) insert engine_runs (run_date, orders_created, notifications_created, detail)
```

- cycle → interval: `2w = 14 days, 1m = 1 month, 2m = 2 months` (Postgres interval semantics — 31 ม.ค. +1 เดือน = 28 ก.พ. — ตรงกับ util ฝั่ง client ใน feature 06)
- Timezone: ทุก date เทียบที่ Asia/Bangkok (`current_date at time zone 'Asia/Bangkok'`)

## หน้าควบคุม Engine (อยู่ใต้ Admin — [feature 14](14-admin.md))

| Route | ใครเข้าได้ |
|---|---|
| `(admin)/engine.tsx` | admin เท่านั้น — ปุ่ม Run now, ช่อง run_date จำลอง (time-travel), ตาราง engine_runs ล่าสุด · **ไม่มีปุ่ม reset demo** (ใช้ `npm run db:seed` แทน — ดูเหตุผลใน [14](14-admin.md) Out of scope) |

## Validation & Edge cases

- **รันซ้ำวันเดียวกัน:** on conflict do nothing + เลื่อนวันเฉพาะแถว insert สำเร็จ → ไม่มีออเดอร์ซ้ำ ไม่มีรอบหาย (นี่คือ demo ชิ้นเอกต่อกรรมการ)
- **cron หยุดไปหลายวัน:** เงื่อนไข `<=` เก็บตก — ได้ออเดอร์ 1 ใบต่อ sub (รอบที่ค้าง) cycle_date = วันเดิมที่ควรเกิด แล้วรอบถัดไปเดินปกติ; ตั้งใจ **ไม่สร้างย้อนหลังหลายใบ** (ผู้ใช้ไม่ควรถูกตัดเงินรัว) — ตัดสินใจนี้ต้องเขียนในเล่ม
- pause/cancel ก่อนถึงรอบ → เงื่อนไข status กรองออกเอง
- **ร้าน/สินค้าถูกแอดมินระงับ → ไม่สร้างออเดอร์และไม่ตัดเงินเด็ดขาด** (กรองใน `due_subscriptions()` + subscription ถูก auto-pause ตอนระงับอยู่แล้ว = ป้องกัน 2 ชั้น) — ต่างจาก **ร้านปิดเอง** (`is_active=false`) ที่ subscriber เดิมยังได้รับของต่อตามเจตนาเดิมของสเปก
- address ถูกลบไม่ได้ (FK restrict) → snapshot_of ไม่มีทาง null
- แจ้ง T-3 ไม่ซ้ำแม้รันหลายรอบ/วัน

## Acceptance Criteria

- [x] Run 1 ครั้ง: sub ที่ถึงรอบได้ order+payment+notification ครบ, next_order_date เลื่อนถูกตาม cycle
- [x] Run ซ้ำทันที: engine_runs เพิ่ม แต่ orders_created = 0, ไม่มีอะไรซ้ำ/หาย
- [x] time-travel +1 เดือน: sub รายเดือนเกิดออเดอร์ใหม่
- [x] skip แล้ว run วันรอบเดิม → ไม่มีออเดอร์
- [x] ร้านถูกระงับ → ไม่สร้างออเดอร์ ไม่ตัดเงิน และวันรอบไม่ถูกข้ามให้ฟรี ๆ
- [x] เรียก endpoint ด้วย JWT ของบัญชีธรรมดา → 403 และเรียกโดยไม่มี JWT → 401 ([W10 E3](../workflows/w10-admin.md))
- [ ] cron รันเองจริงตอน 01:00 ไทย — ตรวจจาก `engine_runs` ของวันถัดไป (ต้องเปิด API ทิ้งไว้ข้ามคืน · ทำตอนซ้อมเดโม่ Phase 7)

ทั้งหมดพิสูจน์ด้วย `anan-api/test/engine.e2e-spec.ts` (14 เคส)

## ข้อมูลที่เกี่ยวข้อง

อ่าน: `subscriptions`, `product_plans`, `addresses` / เขียน: `orders`, `payments`, `notifications`, `engine_runs` — ทั้งหมดในสิทธิ์ definer/service role (client ทำไม่ได้)

## Out of scope

- Dunning/retry จริง (มีจำลองเฟส 5 ใน [09](09-payment-demo.md)), timezone หลายโซน, สร้างออเดอร์ย้อนหลังหลายรอบ
