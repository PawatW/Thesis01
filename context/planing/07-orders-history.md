# Feature 07: Orders — ประวัติและสถานะออเดอร์

> เฟส: 4.5 | ฝั่ง: Buyer | สถานะ: **เสร็จแล้ว** (2026-08-18) | Workflows: [W06](../workflows/w06-recurring-cycle.md)

## ทำอะไรได้

- รายการออเดอร์ทั้งหมดจากทุก subscription (ใหม่→เก่า) แยกแท็บ "กำลังดำเนินการ / สำเร็จ"
- สถานะ 4 ขั้น: `pending → preparing → shipped → delivered` แสดงเป็น progress stepper (+ ทางออก `cancelled` เมื่อร้านยกเลิก — [feature 15](15-order-exceptions.md))
- ปุ่ม **"ได้รับแล้ว"** และ **"แจ้งปัญหา"** บนออเดอร์ที่ส่งแล้ว ([feature 16](16-delivery-confirmation.md))
- รายละเอียด: สินค้า, รอบวันที่, ที่อยู่จาก **address_snapshot**, ยอดจ่าย (จำลอง), เลขพัสดุ (tracking_note), ใบเสร็จจำลอง (จาก 09)

## หน้าจอ & Routes

| Route | หน้าจอ |
|---|---|
| `(buyer)/orders/index.tsx` | รายการออเดอร์ (2 แท็บ) |
| `(buyer)/orders/[id].tsx` | รายละเอียด + stepper + ใบเสร็จ |

## Components หลัก

- `OrderCard` — สินค้า, วันที่รอบ, ยอด, `OrderStatusPill` (pending เทา / preparing เหลือง / shipped ฟ้า / delivered เขียว / **cancelled แดง**)
- `OrderStatusStepper` — 4 ขั้น แนวนอน
- `AddressBlock` — เรนเดอร์จาก snapshot (jsonb) **ไม่ query ตาราง addresses** — นี่คือประเด็นออกแบบที่ต้องเล่าในเล่ม
- `ReceiptModal` — ใบเสร็จจำลอง + ป้าย DEMO (จาก feature 09)

## Data & Queries (API)

| Endpoint | ใช้ที่ |
|---|---|
| `GET /orders?tab=open\|done` | หน้ารายการ 2 แท็บ (`open` = ยังไม่ถึงมือ · `done` = delivered/cancelled) |
| `GET /orders/:id` | หน้ารายละเอียด |
| `POST /orders/:id/confirm` | ปุ่ม "ได้รับแล้ว" ([16](16-delivery-confirmation.md)) |
| `POST /orders/:id/issues` | ปุ่ม "แจ้งปัญหา" ([16](16-delivery-confirmation.md)) |

- **ไม่มี `buyerId` ในคำขอเลย** — service กรองด้วย `where: { id, buyerId: <จาก token> }` ออเดอร์ของคนอื่นจึงตอบ 404 ไม่ใช่ 403 (ไม่บอกว่ามีอยู่จริง)
- response DTO ไม่มี `buyerId` / `subscription.paymentMethodId` — `shipTo` มาจาก `address_snapshot` ตรง ๆ ไม่ได้ join ตาราง `addresses`
- ยังไม่มี realtime: หน้าจอโหลดใหม่ตอนเข้าแท็บ (พอสำหรับเดโม่ — ยกไป future work)

## Validation & Edge cases

- ออเดอร์จาก subscription ที่ cancel ไปแล้ว → ยังแสดงปกติ (ประวัติไม่หาย) + ป้าย "subscription ยกเลิกแล้ว"
- แก้ที่อยู่ใน subscription หลังมีออเดอร์ → ออเดอร์เก่ายังแสดงที่อยู่เดิมจาก snapshot (ทดสอบชัดๆ)
- ไม่มีออเดอร์ → empty state ชวนไปเลือกสินค้า
- tracking_note เป็นข้อความอิสระ — แสดงตรงๆ ไม่ลิงก์ไปขนส่ง
- **ข้อจำกัดที่รู้อยู่:** `quantity` กับ `cycle` บนการ์ดออเดอร์อ่านจาก subscription/แผน **ปัจจุบัน** ไม่ใช่ค่า ณ วันที่ออเดอร์เกิด — ผู้ซื้อที่เปลี่ยนรอบส่งทีหลังจะเห็นออเดอร์เก่าแสดงรอบใหม่ (ยอดเงินยังถูกเสมอเพราะ `orders.amount` เป็น snapshot จริง) · แก้ให้ครบต้องเพิ่มคอลัมน์ snapshot ในตาราง `orders` — ยกไป Phase 7 ถ้าเวลาพอ

## Acceptance Criteria

- [x] ออเดอร์จาก checkout (รอบแรก) และจาก engine (รอบถัดไป) แสดงเหมือนกัน
- [x] Stepper ตรงสถานะจริง อัปเดตเมื่อร้านเปลี่ยนสถานะ (โหลดใหม่ตอนเปิดหน้า)
- [x] ที่อยู่มาจาก snapshot — แก้ที่อยู่ทีหลังออเดอร์เก่าไม่เปลี่ยน · **TC-062** เปลี่ยนชื่อผู้รับใน DB จริงแล้วยืนยันว่าออเดอร์เก่าไม่ขยับ
- [x] แท็บกำลังดำเนินการ/สำเร็จ กรองถูก (TC-062)
- [x] **ออเดอร์จากร้านที่ถูกระงับ/สินค้าที่ถูกปิด ยังแสดงชื่อสินค้าและร้านครบ** — `GET /orders` ไม่ผ่าน `VISIBLE_PRODUCT` โดยตั้งใจ (ประวัติต้องไม่หายเพราะร้านโดนระงับ)
- [x] ออเดอร์ของผู้ใช้คนอื่นเปิดไม่ได้ — หน้าจอขึ้น "ไม่พบออเดอร์นี้" (TC-070)

## ข้อมูลที่เกี่ยวข้อง

`orders`, `payments`, `subscriptions` — สถานะอัปเดตโดย seller ([12](12-seller-orders.md)); สร้างโดย checkout ([05](05-subscribe-checkout.md)) และ engine ([13](13-recurring-engine.md))

## Out of scope

- เชื่อม API ขนส่งจริง, คืนเงิน/คืนสินค้า, ใบกำกับภาษี
