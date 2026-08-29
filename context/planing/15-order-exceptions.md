# Feature 15: Order Exceptions — ร้านยกเลิกออเดอร์ + คืนเงินจำลอง

> เฟส: 4.5 | ฝั่ง: Seller (+ Buyer เห็นผล) | สถานะ: **เสร็จแล้ว** (2026-08-18) | Workflows: [W11](../workflows/w11-order-exception.md)
> เพิ่ม 2026-07-25 — ปิดช่องโหว่ของ state machine เดิม: ออเดอร์ที่ร้านส่งไม่ได้ **ไม่มีทางออก** ค้าง `pending` ถาวรทั้งที่ตัดเงิน (จำลอง) ไปแล้ว

## ทำอะไรได้

- ร้านกด "ยกเลิกออเดอร์รอบนี้" ได้เมื่อสถานะยัง `pending` หรือ `preparing` พร้อมระบุเหตุผล (ของหมด / ปิดร้านชั่วคราว / อื่น ๆ)
- ระบบคืนเงินจำลองอัตโนมัติในทรานแซกชันเดียว (`payments.status = 'refunded'`) + แจ้งเตือนผู้ซื้อ
- **subscription ไม่ถูกแตะ** — รอบถัดไปยังเดินตามปกติ (ผู้ซื้อจะ pause/cancel เองก็ได้)
- ผู้ซื้อเห็นออเดอร์สถานะ "ยกเลิกโดยร้าน" + เหตุผล + ป้ายคืนเงิน DEMO ในประวัติ
- ร้านที่ยกเลิกบ่อยเห็นได้จากหน้า admin (อัตราการยกเลิกต่อร้าน)

## หน้าจอ & Routes

| Route | หน้าจอ | หมายเหตุ |
|---|---|---|
| `(seller)/orders/[id].tsx` | เพิ่มปุ่ม "ยกเลิกออเดอร์" (แสดงเฉพาะ pending/preparing) | เปิด `CancelOrderDialog` |
| `(buyer)/orders/[id].tsx` | แสดง banner ยกเลิก + เหตุผล + ใบคืนเงินจำลอง | stepper หยุดที่ขั้นที่ยกเลิก |
| `(admin)/moderation.tsx` | คอลัมน์ "ยกเลิก 30 วัน" ต่อร้าน | ใช้ตัดสินใจระงับร้าน |

## Components หลัก

- `CancelOrderDialog` — เลือกเหตุผล (chips) + ช่องรายละเอียด (บังคับ ≥5 ตัวอักษร) + คำเตือนชัด: "ผู้ซื้อจะได้รับเงินคืน (จำลอง) ทันที และรอบถัดไปยังเดินตามปกติ"
- `OrderStatusPill` (reuse จาก 07) — เพิ่มสถานะ `cancelled` สีแดง
- `RefundBadge` — "คืนเงินจำลองแล้ว ฿X" + `DemoBadge`

## Data & Queries (API)

| Endpoint | ใช้ที่ |
|---|---|
| `POST /seller/orders/:id/cancel` (body: `{ reason }`) | ปุ่ม "ยกเลิกออเดอร์" ในแท็บค้างส่งของร้าน |
| `GET /orders/:id` | ฝั่งผู้ซื้ออ่าน `status` / `cancelReason` / `cancelledAt` / `paymentStatus` / `refundedAt` จาก response เดียว |

- **ไม่มี `amount` ในคำขอ** — ยอดคืนอ่านจาก `orders.amount` ในฐานข้อมูล (CLAUDE.md ข้อ 7)
- ทั้งการยกเลิก · คืนเงินจำลอง · `subscription_events.order_cancelled` · แจ้งเตือนผู้ซื้อ อยู่ใน `prisma.$transaction` เดียว
- **client ยิง PATCH ตั้ง `status='cancelled'` เองไม่ได้** — ไม่มี endpoint ให้ทำ และ trigger `guard_order_update` (migration `20260817160000`) ปฏิเสธการเปลี่ยนสถานะที่ไม่ใช่ลำดับที่อนุญาต ดู [security-design §5](../../docs/security-design.md)

## Validation & Edge cases

- ยกเลิกได้เฉพาะ `pending`/`preparing` — `shipped` แล้วต้องใช้ flow คืนสินค้า (out of scope, บอกในเล่มเป็น future work)
- `cancelled` เป็นสถานะสุดท้าย — แก้อะไรต่อไม่ได้ (trigger บังคับ)
- เหตุผลบังคับกรอก ≥5 ตัวอักษร (กัน "." ลอย ๆ) — เก็บ ≤200 ตัว
- ออเดอร์ที่ถูกยกเลิกไม่นับใน MRR / ไม่นับเป็น "ส่งสำเร็จ" ในสถิติร้าน
- ถ้าคืนเงินแล้ว payment เดิมไม่ใช่ `paid` (เช่น `failed` จากเฟส 5) → ข้ามการคืน ไม่ error
- ยกเลิกไม่กระทบ `next_order_date` — ตั้งใจ (เขียนเหตุผลในเล่ม: ปัญหาสต๊อกรอบเดียวไม่ควรทำให้ผู้ใช้เสีย subscription)

## Acceptance Criteria

- [x] ร้านยกเลิกออเดอร์ `pending` → สถานะเป็น `cancelled`, `payments.status = 'refunded'`, buyer ได้ notification ครบใน 1 ทรานแซกชัน (**TC-066** + e2e API)
- [x] ยิงคำสั่งเปลี่ยนสถานะข้ามขั้นตรง ๆ → ถูก trigger `guard_order_update` ปฏิเสธ (ชั้น L3 ใน `db-invariants.e2e-spec.ts`)
- [x] ยกเลิกออเดอร์ที่ `shipped` แล้ว → ปุ่มไม่แสดง และ API ตอบ 409 ถ้าเรียกตรง
- [x] รอบถัดไปของ subscription นั้นยังเกิดตามกำหนด — **TC-066 เทียบ `next_order_date` ก่อน/หลังว่าไม่ขยับ**
- [x] หน้า buyer แสดงเหตุผล + ป้ายคืนเงิน DEMO ชัดเจน (TC-067)
- [x] timeline ของ subscription มี event `order_cancelled` (TC-066)

## ข้อมูลที่เกี่ยวข้อง

`orders` (+`cancelled_at`, `cancel_reason`, status `cancelled`), `payments` (+`refunded_at`, status `refunded`), `subscription_events` (event `order_cancelled`), RPC `seller_cancel_order` — migration `20260725000003`

## Out of scope

- คืนสินค้า/คืนเงินหลังส่งแล้ว, คืนเงินบางส่วน, ระบบชดเชยผู้ซื้อ (ส่วนลดรอบหน้า), ยกเลิกโดยผู้ซื้อกลางรอบ (ใช้ skip/cancel subscription แทน)
