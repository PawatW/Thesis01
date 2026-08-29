# Feature 06: My Subscriptions — จัดการ subscription ของฉัน

> เฟส: 2-3 | ฝั่ง: Buyer | สถานะ: ✅ เสร็จ (Phase 3) | Workflows: [W05](../workflows/w05-manage-subscription.md) ⭐
> **หัวใจของแอพ** — ทุก action จบใน ≤2 คลิก

## ทำอะไรได้

- Dashboard รวม: แยกกลุ่ม active / paused / cancelled + การ์ดสรุป "เดือนนี้จ่ายรวม ≈ ฿X จาก Y รายการ"
- ต่อรายการ: **Pause / Resume / Skip รอบ / เลื่อนวันส่ง / เปลี่ยนรอบ / เปลี่ยนที่อยู่ / Cancel** — กติกาแต่ละ action + state machine อยู่ใน [W05](../workflows/w05-manage-subscription.md) (source of truth)
- หน้ารายละเอียด: ข้อมูลแผน + ประวัติออเดอร์ของ sub นี้ + timeline เหตุการณ์ (จาก events)

## หน้าจอ & Routes

| Route | หน้าจอ |
|---|---|
| `(buyer)/subscriptions/index.tsx` | แท็บ "ของฉัน" — sections + การ์ดสรุปรายจ่าย |
| `(buyer)/subscriptions/[id].tsx` | รายละเอียด + ปุ่ม actions ทั้งหมด + ประวัติ |

## Components หลัก

- `SubscriptionCard` — รูปสินค้า, ร้าน, รอบ, ราคา, **วันรอบถัดไปเด่นๆ**, status pill (สี: เขียว/เหลือง/เทา) — ถ้า `paused_reason = 'shop_suspended'` ใช้ป้ายส้ม **"ร้านถูกระงับชั่วคราว — ไม่มีการตัดเงิน"** และซ่อนปุ่ม Resume
- `MonthlySpendCard` — สูตร normalize: 2w = ×2, 1m = ×1, 2m = ×0.5 (ระบุ "โดยประมาณ")
- `ActionSheet` ต่อ action + `ConfirmDialog` — ทุก dialog บอกผลลัพธ์ล่วงหน้า ("รอบถัดไปจะเป็น 15 ก.ย.")
- `EventTimeline` — ไล่ events: สมัคร → skip → pause → …

## Data & Queries (API ของเราเอง — ทำแล้วใน Phase 3)

```ts
// list — API กรองด้วย buyerId จาก token ไม่มีทางขอของคนอื่นได้
GET  /api/v1/subscriptions          → SubscriptionCardResponse[]
GET  /api/v1/subscriptions/:id      → ของคนอื่นตอบ 404 (ไม่ใช่ 403)

// 7 actions — ทุกตัวคืนการ์ดที่อัปเดตแล้ว เพื่อให้หน้าจอวาดใหม่โดยไม่ต้องยิงซ้ำ
POST /api/v1/subscriptions/:id/skip
POST /api/v1/subscriptions/:id/pause
POST /api/v1/subscriptions/:id/resume
POST /api/v1/subscriptions/:id/reschedule   { date: 'YYYY-MM-DD' }
POST /api/v1/subscriptions/:id/plan         { planId }
POST /api/v1/subscriptions/:id/address      { addressId }
POST /api/v1/subscriptions/:id/cancel
```

- **ทุก action เขียน `subscriptions` + `subscription_events` ในทรานแซกชันเดียว** ที่ `SubscriptionsService.commit()` — client เขียนสองตารางนี้ตรงไม่ได้ จึงไม่มีทางปลอม event หรือได้ update ที่ event หาย
- **เงื่อนไขที่ต้องแข่งกับ request อื่นอยู่ใน `where` ของคำสั่งเขียน** (สถานะ + วันรอบ + แผนที่อ่านมาตอนตรวจสิทธิ์) → กดปุ่มรัว 2 ครั้งได้ผลครั้งเดียว ครั้งที่สองได้ 409 `SUBSCRIPTION_CHANGED`
- รหัส error ที่หน้าจอต้องรองรับ: `SUBSCRIPTION_NOT_FOUND` (404) · `SUBSCRIPTION_CANCELLED` / `SUBSCRIPTION_PAUSED` / `SUBSCRIPTION_ACTIVE` / `SHOP_SUSPENDED` / `ALREADY_SUBSCRIBED` / `PLAN_UNAVAILABLE` (409) · `RESCHEDULE_OUT_OF_RANGE` (422)
- **วันรอบทั้งหมดคิดจาก `subscriptions.cycle_anchor_date`** ด้วย `nextCycleAfter()` ใน `anan-api/src/common/date.ts` — ที่เดียวในระบบ ฝั่ง engine ใช้ตัวเดียวกัน (เดือนสั้นหนีบปลายเดือน: 31 ม.ค. + 1 เดือน = 28 ก.พ. แต่รอบถัดไปกลับเป็น 31 มี.ค. เพราะคิดจากหมุด ไม่ใช่บวกทบ)
- เปลี่ยนรอบ: หน้าจอโหลดแผนของสินค้าชิ้นเดิมจาก `GET /catalog/products/:id` (คืนเฉพาะแผนที่เปิดรับ) แล้วส่ง `planId` — API ตรวจซ้ำว่าเป็นแผนของสินค้าชิ้นเดียวกันและยังเปิดรับอยู่

## Validation & Edge cases

- RPC ทุกตัวตรวจสถานะปัจจุบันเองก่อนทำ — ถ้าไม่ตรง (จออื่นเปลี่ยนไปแล้ว) โยน error → refresh + toast "รายการเปลี่ยนสถานะไปแล้ว"; state machine ยังถูกบังคับซ้ำด้วย CHECK + trigger ระดับ DB (cancelled → active ทำไม่ได้แม้เขียน SQL ตรง)
- Resume: `next_order_date = max(เดิม, พรุ่งนี้)` — กันออเดอร์ยิงย้อนหลังทันทีหลังหยุดนาน
- **รายการที่ถูกแช่แข็งเพราะร้านถูกระงับ** (`paused_reason='shop_suspended'`): ไม่มีปุ่ม Resume/Skip/เลื่อนวัน เหลือแค่ "ยกเลิก" กับ "ดูประวัติ" — ระบบจะ resume ให้เองเมื่อร้านกลับมา (ทดสอบร่วมกับ [14](14-admin.md))
- เลื่อนวัน: เลือกได้เฉพาะ > วันนี้
- Cancel dialog ต้องบอกชัด: "ยกเลิกถาวร สมัครใหม่ได้ภายหลัง — ออเดอร์ที่ค้างส่งจะส่งจนจบ"
- cancelled: ซ่อนปุ่มทุก action เหลือ "ดูประวัติ"

## Acceptance Criteria

- [x] ทั้ง 7 actions ทำงานตามตารางใน W05 — DB อัปเดต + event ถูก insert คู่กันทุกครั้ง (`test/subscriptions.e2e-spec.ts`)
- [x] Skip แล้ว engine รอบนั้นไม่สร้างออเดอร์ (`test/engine.e2e-spec.ts`)
- [x] Pause → Resume หลัง next_order_date เดิมผ่านไปแล้ว → ไม่มีออเดอร์ย้อนหลัง (resume ดัน next เป็นพรุ่งนี้เป็นอย่างเร็ว)
- [x] ยอดรวมรายเดือน normalize ถูกต้อง (TC-047)
- [x] ทุก action จบใน ≤2 คลิกจากหน้ารายการ + toast ยืนยันผล (TC-044…TC-052)
- [ ] **แผนถูกปิด / สินค้าถูกซ่อน / ร้านถูกระงับ → subscription ของฉันยังแสดงชื่อสินค้า-ร้าน-ราคาครบ** (policy `*_subscriber read` — ของยังส่งอยู่ การ์ดต้องไม่ว่าง)

## ข้อมูลที่เกี่ยวข้อง

`subscriptions`, `subscription_events`, `product_plans`, `addresses` (อ่านตรง) + RPC 7 ตัวใน migration 0003 — contract ใน [security-design.md §5](../../docs/security-design.md)

## Out of scope

- Win-back offer ตอนยกเลิก (future work ในเล่ม), โอน subscription ให้คนอื่น
