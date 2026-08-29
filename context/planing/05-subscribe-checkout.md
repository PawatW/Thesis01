# Feature 05: Subscribe Checkout — สมัคร subscription

> เฟส: 2 | ฝั่ง: Buyer | สถานะ: ✅ เสร็จ (Phase 2) — บัตรที่ถูกปฏิเสธเพิ่มใน Phase 5 | Workflows: [W04](../workflows/w04-subscribe-checkout.md) ⭐

## ทำอะไรได้

- สรุปรายการ: สินค้า, แผนรอบส่ง, ราคา/รอบ, จำนวน
- เลือกที่อยู่ (default ถูกเลือกไว้ / เพิ่มใหม่ inline ได้), เลือกบัตร demo (เพิ่ม inline ได้)
- เลือกวันเริ่มรอบแรก (default พรุ่งนี้, ภายใน 14 วัน)
- ยืนยัน → **ทรานแซกชันเดียว**: สร้าง subscription + ออเดอร์รอบแรก + ตัดเงินจำลอง + event + แจ้งเตือนร้าน

## หน้าจอ & Routes

| Route | หน้าจอ |
|---|---|
| `checkout/[planId].tsx` | checkout (stack/modal นอก tab — รับ `?qty=`) |

## Components หลัก

- `CheckoutSummaryCard` — สินค้า + แผน + ราคา
- `AddressSelector` / `PaymentMethodSelector` — radio list + ปุ่ม "เพิ่มใหม่" เปิด `AddressForm` (reuse จาก 01) / `DemoCardForm` (จาก 09) แบบ bottom sheet — **ไม่หลุดออกจาก flow**
- `StartDatePicker` — ปุ่มเลือกวัน (พรุ่งนี้ +14 วัน)
- `ConfirmPanel` — ข้อความ commitment ชัดเจน: "ระบบจะสร้างออเดอร์ทุก {รอบ} และตัดเงินจำลอง ฿{amount} — ยกเลิกได้ทุกเมื่อ" + `DemoBadge`

## Data & Queries (API)

| Endpoint | ใช้ที่ |
|---|---|
| `GET /catalog/plans/:id` | โหลดหน้า — แผน + สินค้า + ชื่อร้าน |
| `GET /me/addresses` · `GET /me/payment-methods` | ตัวเลือกที่อยู่/บัตรของผู้เรียก |
| `POST /me/addresses` · `POST /me/payment-methods` | เพิ่มแบบ inline ตอนยังไม่มี (W04 A2) |
| `POST /subscriptions` | ยืนยันสมัคร — body มีแค่ `planId · quantity · addressId · paymentMethodId · startDate` |

**⚠ ไม่มี `amount` / `price` / สถานะการจ่าย ใน DTO เลย** — service อ่าน `price_per_cycle` จาก DB เอง
(ถ้ารับยอดจาก client ได้ = สั่งของราคาศูนย์บาทได้ · [security-design S-02](../../docs/security-design.md))

ภายใน `SubscriptionsService.create()` — **ทรานแซกชันเดียว** (รายละเอียดใน [W04](../workflows/w04-subscribe-checkout.md)):
ตรวจแผนยังเปิดรับ + สินค้า/ร้านไม่ถูกระงับ (`VISIBLE_PRODUCT`) → **ตรวจว่า `addressId`/`paymentMethodId` เป็นของผู้เรียกจริง** →
สร้าง `subscriptions` (`cycle_anchor_date` = วันเริ่ม) → `orders` รอบแรก (พร้อม `address_snapshot`) →
**ตัดเงินผ่าน `PaymentProvider`** แล้วบันทึก `payments` → event `created` → แจ้งเตือนร้าน

> **ไม่มี endpoint ไหนให้ client เขียน `subscriptions` / `orders` / `payments` ตรง ๆ** — ทางเดียวคือ endpoint นี้
> และถ้าบัตรถูกปฏิเสธ (จำลอง) ทั้งก้อนถูก rollback ไม่เหลือข้อมูลค้าง ([feature 09](09-payment-demo.md))

## Validation & Edge cases

- quantity 1-10, startDate ∈ [พรุ่งนี้, +60 วัน] — validate ทั้งใน DTO และใน service (**ฝั่ง API คือชั้นที่บังคับจริง**) และมี CHECK ที่ DB ซ้ำอีกชั้น
- ไม่มีที่อยู่/บัตร → บังคับเพิ่มก่อน ปุ่มยืนยัน disabled พร้อมบอกว่าขาดอะไร
- plan ถูกปิดระหว่างทำรายการ → API ตอบ 409 `PLAN_UNAVAILABLE` → แสดง "แผนนี้ปิดรับสมาชิกใหม่แล้ว"
- กันกดซ้ำ: `useRef` guard ที่ปุ่ม (state อัปเดตหลัง re-render จึงกันเฟรมเดียวกันไม่ทัน) **และ** partial unique index ที่ DB — ยิงพร้อมกัน 3 เส้นได้ subscription เดียว (T-21)
- subscribe สินค้าเดิมซ้ำได้ (ตั้งใจ — เช่นบ้าน 2 หลัง) แต่แสดงเตือน: "คุณ subscribe สินค้านี้อยู่แล้ว ต้องการเพิ่มอีกรายการ?"

## Acceptance Criteria

- [ ] Flow ครบ: เลือกครบ → ยืนยัน → เข้าหน้า "ของฉัน" เห็นรายการใหม่ + toast
- [ ] DB ครบ 4 อย่างใน TX เดียว: subscription (active, next_order_date ถูก), order รอบแรก (pending, snapshot ครบ), payment (paid), event (created)
- [ ] user ใหม่ไม่มีที่อยู่/บัตร เพิ่ม inline ได้โดยไม่หลุด flow
- [ ] แผนถูกปิดกลาง flow → error สุภาพ ไม่มีข้อมูลครึ่งๆ กลางๆ ใน DB
- [ ] ป้าย DEMO เห็นชัดในหน้า checkout
- [x] **สมัครด้วย `addressId` ของบัญชีอื่น → 404** ([T-3](../../docs/security-rules.md)) · แนบ `amount` มาใน body → 400 (T-2) · แผนที่ปิดแล้ว → 409 (T-4)

## ข้อมูลที่เกี่ยวข้อง

`subscriptions`, `orders`, `payments`, `subscription_events` — เขียนพร้อมกันใน `SubscriptionsService.create()` ที่เดียว (ดู [architecture.md §5](../../docs/architecture.md))

## Out of scope

- **Payment gateway จริงทุกชนิด**, ตะกร้ารวมหลายสินค้า (สมัครทีละรายการ)
- ~~คูปอง/ส่วนลด~~ → **ย้ายไปเป็น [feature 18](18-coupons.md) แล้ว (2026-08-24)** — `POST /subscriptions` รับ `couponId?` เพิ่มได้ 1 ฟิลด์ แต่ยังห้ามรับยอดเงินจาก client เหมือนเดิม
