# W11 — เมื่อรอบนั้นไม่เป็นไปตามแผน (ร้านยกเลิก / ผู้ซื้อแจ้งปัญหา)

> Actor: Seller + Buyer + Admin | Features: [15](../planing/15-order-exceptions.md), [16](../planing/16-delivery-confirmation.md)
> เพิ่ม 2026-07-25 · **ทำจริงแล้ว 2026-08-18 (Phase 4.5)** — core loop ใน [W06](w06-recurring-cycle.md) ครอบคลุมเฉพาะกรณีทุกอย่างราบรื่น flow นี้คือทางออกเมื่อไม่ราบรื่น

## Precondition
- มีออเดอร์ที่ engine หรือ checkout สร้างไว้แล้ว ([W04](w04-subscribe-checkout.md)/[W06](w06-recurring-cycle.md))

## Flow A: ร้านส่งไม่ได้ → ยกเลิก + คืนเงินจำลอง

| # | ผู้กระทำ | การกระทำ | ระบบทำอะไร |
|---|---|---|---|
| 1 | Seller | หน้าออเดอร์ (`pending`/`preparing`) → กด "ยกเลิกออเดอร์" | เปิด dialog เลือกเหตุผล + คำเตือน "ผู้ซื้อได้เงินคืนจำลองทันที รอบถัดไปยังเดินปกติ" |
| 2 | Seller | เลือกเหตุผล + ยืนยัน | `POST /seller/orders/:id/cancel` — **ทรานแซกชันเดียว**: `orders.status='cancelled'` + `cancelled_at` + `cancel_reason` → `payments.status='refunded'` + `refunded_at` → event `order_cancelled` → notification ผู้ซื้อ |
| 3 | Buyer | เปิดแจ้งเตือน | หน้าออเดอร์แสดงป้ายแดง "ยกเลิกโดยร้าน" + เหตุผล + ใบคืนเงินจำลอง (DemoBadge) |
| 4 | ระบบ | รอบถัดไป | ไม่กระทบ — `next_order_date` เดิม engine สร้างออเดอร์รอบหน้าตามปกติ |

## Flow B: ของถึงแล้ว → ผู้ซื้อยืนยันรับ

| # | ผู้กระทำ | การกระทำ | ระบบทำอะไร |
|---|---|---|---|
| 1 | Seller | กด shipped + ใส่เลขพัสดุ ([W08](w08-seller-orders.md)) | notification ถึงผู้ซื้อ |
| 2 | Buyer | ของถึง → กด "ได้รับแล้ว" | `POST /orders/:id/confirm` → `confirmed_at = now()`, `status='delivered'` |
| 3 | ระบบ | (ถ้าผู้ซื้อไม่กดภายใน 7 วันนับจาก `shipped_at`) | engine ตั้ง `delivered` ให้อัตโนมัติ แต่ **ไม่ตั้ง `confirmed_at`** — สถิติยังแยกได้ว่าใครยืนยันเอง · ใบที่มีเคสปัญหาเปิดค้างถูกข้าม |

> ทำไมต้องมีขั้นนี้: `delivered` ร้านกดเองได้ ฉะนั้นมันพิสูจน์อะไรไม่ได้ — `confirmed_at` เป็นคอลัมน์เดียวที่ร้านเขียนไม่ได้เลย (**ไม่มี endpoint ไหนของร้านแตะฟิลด์นี้** + CHECK `orders_confirm_after_ship` + trigger `guard_order_update`)

## Flow C: ของไม่ถึง/ผิด → แจ้งปัญหา

| # | ผู้กระทำ | การกระทำ | ระบบทำอะไร |
|---|---|---|---|
| 1 | Buyer | หน้าออเดอร์ → "แจ้งปัญหา" → เลือกประเภท + รายละเอียด | `POST /orders/:id/issues` → insert `order_issues` (status `open`) + notification ถึงเจ้าของร้าน ในทรานแซกชันเดียว |
| 2 | Seller | แท็บ "ปัญหา" → เปิดเคส → ตอบ + เลือกผล | `POST /seller/issues/:id/resolve` (`resolved`\|`rejected` + note) → ปิดเคส + `resolved_by` จาก token + notification ถึงผู้ซื้อ |
| 3 | Seller | (ถ้าตกลงคืนเงิน) | ใช้ Flow A ยกเลิกออเดอร์นั้น — คืนเงินจำลองอัตโนมัติ |
| 4 | Admin | หน้า moderation | เห็นเคสทั้งระบบ + อัตรายกเลิก/เคสค้างต่อร้าน → ใช้ตัดสินใจระงับร้าน ([W10](w10-admin.md) Flow C) |

## Alternate / Error Flows

- **E1 ร้านพยายามยกเลิกออเดอร์ที่ `shipped`:** ปุ่มไม่แสดง; ถ้ายิง endpoint ตรง → 409 `ORDER_NOT_CANCELLABLE`
- **E2 ร้านพยายามตั้ง `confirmed_at` หรือข้ามไป `cancelled` เอง:** ไม่มี endpoint ให้ทำ และ trigger `guard_order_update` ปฏิเสธการเปลี่ยนสถานะนอกลำดับที่อนุญาต (การยกเลิกจึงมาพร้อมการคืนเงินเสมอ)
- **E3 buyer กด "ได้รับแล้ว" ซ้ำ:** ไม่ error (idempotent) — คืนค่าเดิม
- **E4 แจ้งปัญหาซ้ำบนออเดอร์เดิม:** unique (order_id) บล็อก → UI พาไปดูเคสเดิมแทน
- **E5 ร้านหายไปไม่ตอบเคส:** เคสค้าง > 7 วันถูกไฮไลต์ในหน้า admin — admin ระงับร้านได้

## Postcondition
- ทุกออเดอร์มีปลายทางที่ชัดเจนเสมอ: `delivered` (+ยืนยันหรือไม่) หรือ `cancelled` (+คืนเงินจำลอง) — ไม่มีออเดอร์ค้าง `pending` ตลอดกาลอีก
- แพลตฟอร์มมีสัญญาณคุณภาพร้านที่วัดได้: อัตรายกเลิก, อัตราเคสปัญหา, อัตราการยืนยันรับของ
