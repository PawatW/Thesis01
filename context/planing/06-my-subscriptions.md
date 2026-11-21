# Feature 06: My Subscriptions — จัดการ subscription ของฉัน

> เฟส: 2-3 | ฝั่ง: Buyer | สถานะ: ✅ เสร็จ (Phase 3) | Workflows: [W05](../workflows/w05-manage-subscription.md) ⭐
> **หัวใจของแอพ** — ทุก action จบใน ≤2 คลิก

## ทำอะไรได้

- Dashboard รวม: แยกกลุ่ม active / paused / cancelled + การ์ดสรุป "เดือนนี้จ่ายรวม ฿X จาก Y รอบ" พร้อมปฏิทินว่ารอบไหนตัดวันไหน — เป็นยอดที่ตัดจริงในเดือนปฏิทินนี้ ไม่ใช่ค่าเฉลี่ยต่อเดือน (กติกาการนับอยู่ใน [W05](../workflows/w05-manage-subscription.md))
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

## Retention — ผู้ใช้สั่งให้เพิ่ม 2026-11-21 (Phase 8.3)

ที่มา: ผล research ว่าระบบ subscription จริงมีอะไรที่เรายังไม่มี (Recurly/Skio/Paddle/Amazon Subscribe & Save) — 3 อย่างที่ทุกเจ้ามีตรงกัน

| # | ความสามารถ | Endpoint | กติกา |
|---|---|---|---|
| R1 | **ยกเลิกแบบบอกเหตุผล + ข้อเสนอทางเลือก** | `POST /:id/cancel` `{ reason, note? }` | `reason` **บังคับ** (enum 6 ค่า: `too_expensive` · `too_much_stock` · `taking_break` · `quality` · `switching` · `other`) · `note` ≤200 ตัว · เก็บที่ `subscriptions.cancel_reason/cancel_note` · CHECK: มีเหตุผลได้เฉพาะตอน cancelled · ร้านเห็น**แค่หมวดเหตุผล** ในแจ้งเตือน ไม่เห็น note (ข้อความอิสระอาจมีข้อมูลส่วนตัว) |
| R1 | ข้อเสนอ (UI) | ใช้ action เดิม | `taking_break` → หยุด 1 รอบ · `too_much_stock` → เปลี่ยนเป็นรอบที่ห่างกว่า (ไม่มี → ข้ามรอบ) · `too_expensive` → เปิดกล่องคูปอง · อื่น ๆ ไม่มีข้อเสนอ · **ปุ่ม "ยืนยันยกเลิก" อยู่ในหน้าเดียวกันเสมอ** (การซ่อนปุ่มยกเลิกคือ dark pattern) · action ที่กดจากข้อเสนอส่ง `source: 'cancel_flow'` ไปเก็บใน `subscription_events.detail` เพื่อวัด save rate ในเล่ม |
| R2 | **หยุดพักแบบมีวันกลับ** | `POST /:id/pause` `{ cycles?: 1\|2\|3 }` | ไม่ส่ง `cycles` = หยุดไม่มีกำหนด (เหมือนเดิม) · ส่งมา = `resume_on` คือวันรอบที่เกิดหลังข้าม N รอบบนกริดเดิม (กติกาเดียวกับกด skip N ครั้ง) · **engine เปิดรายการให้ล่วงหน้า 3 วันก่อน `resume_on`** เพื่อให้ผู้ซื้อได้แจ้งเตือน T-3 ตามปกติและยังข้ามรอบได้ · กลับมาเองก่อนกำหนดก็ได้ (กฎ resume เดิม) · CHECK: `resume_on` มีได้เฉพาะ `paused/user` · ร้านถูกระงับระหว่างพัก → engine ไม่เปิดให้ (กรองด้วย `BILLABLE_PRODUCT`) และเมื่อปลดแล้วรอบแรกต้องไม่ย้อนหลัง (`max(resume_on, พรุ่งนี้)`) |
| R3 | **ส่งรอบนี้เลย** | `POST /:id/ship-now` (ไม่มี body) | active เท่านั้น · สร้างออเดอร์ `cycle_date = วันนี้` + ตัดเงินจำลองทันที · **หมุดย้ายมาที่วันนี้** รอบถัดไป = วันนี้ + 1 รอบ (ไม่ให้ได้ของสองชุดติดกัน) · จ่ายไม่ผ่าน → rollback ทั้งก้อน 402 แบบ checkout (ผู้ใช้กดเองต้องรู้ผลทันที) · วันนี้มีออเดอร์แล้ว → 409 `ORDER_EXISTS_TODAY` (ด่านคือ UNIQUE เดิมของ engine) · คูปองที่จองกับรอบเดิมถูกคืน (กฎ W05) · ร้านได้แจ้งเตือน `early_order` |
| R3 | **เปลี่ยนจำนวนต่อรอบ** | `POST /:id/quantity` `{ quantity: 1..10 }` | active/paused · มีผลกับออเดอร์ถัดไป · ไม่แตะวันรอบ จึงไม่คืนคูปอง (เหมือนเปลี่ยนที่อยู่) · event `quantity_changed` |

**สิ่งที่เปลี่ยนตามผลรีวิว (agent ขนาน 2 ตัว · 2026-11-21)**

- **`orders.quantity` (คอลัมน์ใหม่ · NOT NULL · CHECK 1-10 · trigger ห้ามแก้)** — ก่อนหน้านี้ร้านอ่านจำนวนจาก `subscriptions.quantity` ซึ่งไม่เคยเปลี่ยนจึงไม่เป็นปัญหา พอ R3 ทำให้แก้จำนวนได้ ผู้ซื้อจ่าย 1 ชิ้นแล้วแก้เป็น 10 ก่อนร้านแพ็คของได้ → ออเดอร์ทุกใบเก็บจำนวนของรอบตัวเองแล้ว (checkout · engine · ship-now) และหน้าออเดอร์ทั้งสองฝั่งอ่านจากออเดอร์ · migration backfill แถวเก่าจาก subscription (ถูกต้องเพราะก่อนหน้านี้แก้จำนวนไม่ได้)
- **autoResume คงหมุดเดิมเมื่อกลับมาตรงวันบนกริด** — ย้ายหมุดเฉพาะตอนถูกหนีบเป็นพรุ่งนี้ ไม่งั้นหมุดวันที่ 31 ยุบเป็น 30 ถาวร
- ship-now ชนกับ engine แบบ deadlock (P2034) → 409 `SUBSCRIPTION_CHANGED` แทน 500 · ไม่มีการตัดเงินซ้ำในทุกกรณี (UNIQUE + guard)
- **ข้อจำกัดที่ยอมรับ:** ถ้า engine ไม่ได้รันหลายวันจน `resume_on` เหลือ 1-2 วัน ผู้ซื้อได้แค่แจ้งเตือน "ครบกำหนดหยุดพัก" ที่บอกวัน ไม่ได้ T-3 · `source: 'cancel_flow'` มาจาก client จึงปลอมให้ save rate ดูดีได้ — ใช้เป็นตัวเลขประกอบในเล่ม ไม่ใช่ตัวชี้วัดที่เชื่อถือได้ 100%

## Out of scope

- ~~Win-back offer ตอนยกเลิก~~ → ทำแล้วเป็น R1 ด้านบน (2026-11-21) · **ยังไม่ทำ:** หน้ารายงานเหตุผลการยกเลิก/save rate ฝั่งร้าน-แอดมิน (ข้อมูลเก็บครบแล้ว) · ข้อเสนอส่วนลดที่ระบบออกให้เองตอนยกเลิก
- โอน subscription ให้คนอื่น · ส่งรอบนี้ให้คนอื่น (gift)
