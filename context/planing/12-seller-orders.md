# Feature 12: Seller Orders — ออเดอร์รอบถัดไป

> เฟส: 4 | ฝั่ง: Seller | สถานะ: ✅ เสร็จ (2026-08-17) · แท็บ "ปัญหา" + ปุ่มยกเลิกออเดอร์เพิ่มใน Phase 4.5 | Workflows: [W08](../workflows/w08-seller-orders.md)
> จุดขายฝั่งร้าน: **forecast — รู้ล่วงหน้าว่ารอบหน้าต้องส่งอะไรเท่าไหร่**

## ทำอะไรได้

- แท็บ "ค้างส่ง": ออเดอร์ pending/preparing → ไล่สถานะ **pending → preparing → shipped (+เลขพัสดุ) → delivered** ทีละขั้น ไม่มีทางลัด + **ปุ่มยกเลิกออเดอร์เมื่อส่งไม่ได้** ([15](15-order-exceptions.md))
- แท็บ "ล่วงหน้า" (forecast): ออเดอร์ที่จะเกิดใน 7/14/30 วัน สรุปเป็นรายสินค้า (นับจาก subscriptions active)
- แท็บ "ประวัติ": delivered/cancelled ทั้งหมด
- แท็บ **"ปัญหา"**: เคสที่ผู้ซื้อแจ้ง → ตอบและปิดเคส ([16](16-delivery-confirmation.md))
- อัปเดตสถานะ → buyer ได้ notification อัตโนมัติ (DB trigger — feature 08)

## หน้าจอ & Routes

| Route | หน้าจอ |
|---|---|
| `(seller)/orders/index.tsx` | 3 แท็บ: ค้างส่ง / ล่วงหน้า / ประวัติ |
| `(seller)/orders/[id].tsx` | รายละเอียด + ปุ่มสถานะถัดไป + ช่องเลขพัสดุ |

## Components หลัก

- `SellerOrderCard` — สินค้า+จำนวน, ชื่อผู้รับ (จาก snapshot), cycle_date, `OrderStatusPill` (reuse จาก 07), ไฮไลต์แดงถ้า pending เกิน 2 วัน
- `NextStatusButton` — ปุ่มเดียวเปลี่ยนสถานะถัดไปตามลำดับ; ขั้น shipped เปิด dialog กรอก tracking_note (ไม่บังคับแต่เตือน)
- `ForecastList` — เลือกช่วง 7/14/30 วัน → group รายสินค้า: "กาแฟคั่วกลาง — 18 ออเดอร์ / 22 ชิ้น"

## Data & Queries (API ของเราเอง — ทำแล้วใน Phase 4)

```ts
GET  /api/v1/seller/orders?tab=open|shipped|history   // ไม่มี buyerId / subscriptionId / paymentMethodId
GET  /api/v1/seller/orders/:id
POST /api/v1/seller/orders/:id/advance  { trackingNote? }   // ★ ไม่ส่ง status ขึ้นไป
GET  /api/v1/seller/forecast?days=7|14|30
```

- **`advance` ไม่รับสถานะเป้าหมายจาก client** — server หาขั้นถัดไปจากสถานะปัจจุบันเอง
  (`pending → preparing → shipped → delivered`) จึงกระโดดข้ามขั้นไม่ได้แม้ยิง curl ตรง
  และ `status: ปัจจุบัน` อยู่ใน `where` ของคำสั่งเขียน → พนักงาน 2 คนกดพร้อมกัน คนที่สองได้ 409
- **เลขพัสดุกรอกได้เฉพาะตอนเปลี่ยนเป็น `shipped`** (ขั้นอื่นตอบ 422 `TRACKING_NOTE_NOT_ALLOWED`)
- ownership อยู่ใน `where` ผ่านความสัมพันธ์ order → subscription → plan → product → `shop.ownerId`
  ไม่มีการรับ `shopId` จาก client ที่ไหนเลย · ออเดอร์ร้านอื่นตอบ 404
- **forecast เป็น aggregate ล้วน** (`ordersCount` / `units` / `revenue` ต่อสินค้า) + ฟิลด์ `approximate: true`
  ให้หน้าจอบอกผู้ใช้เสมอว่าผู้ซื้อ skip/pause ได้ถึงวันก่อนรอบ · ช่วงวันจำกัดที่ 7/14/30 (กันกวาดทั้งตาราง)

## Validation & Edge cases

- update ใส่ `.eq('status', cur)` guard — สองเครื่องกดพร้อมกัน แถวหลังได้ 0 rows → refresh + toast
- **ลำดับสถานะถูกบังคับ 2 ชั้น** — ชั้นแรกคือ API (`advance` ไม่รับสถานะเป้าหมายจาก client เลย) ชั้นสองคือ trigger `guard_order_update` ที่ DB (migration `20260817160000`) ซึ่งปฏิเสธการข้ามขั้น การย้อนสถานะ และการแก้ `amount`/`cycle_date`/`address_snapshot` แม้จะยิง SQL ตรง ([S-06](../../docs/security-design.md) · เทสชั้น L3 ใน `db-invariants.e2e-spec.ts`)
- forecast ไม่มีข้อมูลผู้ซื้อโดยตั้งใจ (data minimization) — ร้านเห็นชื่อ/ที่อยู่ผู้รับก็ต่อเมื่อออเดอร์เกิดจริงผ่าน `address_snapshot`
- forecast รวม subscription ที่จะโดน skip ไม่ได้ล่วงหน้า → ระบุใต้หัวข้อ: "ตัวเลขโดยประมาณ — ผู้ซื้อ skip/pause ได้ถึงวันก่อนรอบ"
- ออเดอร์จาก subscription ที่ cancel แล้ว → ยังต้องส่งจนจบ + ป้ายบอก
- delivered แล้ว → แก้อะไรไม่ได้อีก (ปุ่มหาย)

## Acceptance Criteria

- [ ] เห็นเฉพาะออเดอร์ร้านตัวเอง (ทดสอบด้วย 2 ร้าน)
- [ ] ไล่สถานะได้ทีละขั้นเท่านั้น, shipped ต้องผ่าน dialog เลขพัสดุ
- [ ] ทุกครั้งที่เปลี่ยนสถานะ buyer ได้ notification
- [ ] forecast ตรงกับ subscriptions จริง และอัปเดตเมื่อ buyer skip/cancel
- [ ] ที่อยู่บนออเดอร์มาจาก snapshot
- [ ] **ยิง API ตรงแก้ `amount` ของออเดอร์ตัวเอง หรือกระโดดสถานะ → ถูกปฏิเสธ** ([T-6, T-7](../../docs/security-rules.md))

## ข้อมูลที่เกี่ยวข้อง

view `seller_orders` (อ่าน), `orders` (เขียนสถานะ — RLS `order_is_for_my_shop()` + grant เฉพาะ `status`, `tracking_note`), RPC `shop_forecast(days)`

## Out of scope

- ใบปะหน้าพัสดุ/เชื่อมขนส่ง, staff accounts, export รายงาน
