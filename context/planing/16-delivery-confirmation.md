# Feature 16: Delivery Confirmation & Issue Report — ยืนยันรับของ / แจ้งปัญหา

> เฟส: 4.5 | ฝั่ง: Buyer (+ Seller ตอบ, Admin ดูแล) | สถานะ: **เสร็จแล้ว** (2026-08-18) · คิวเคสในหน้า admin ทำแล้วใน Phase 6 | Workflows: [W11](../workflows/w11-order-exception.md)
> เพิ่ม 2026-07-25 — ปิด trust gap: เดิม **ร้านกด `delivered` เองได้ทั้งที่ยังไม่ได้ส่ง** และผู้ซื้อไม่มีช่องทางโต้แย้งเลย

## ทำอะไรได้

- ผู้ซื้อกด **"ได้รับแล้ว"** บนออเดอร์ที่ `shipped`/`delivered` → บันทึก `confirmed_at` (ตัวเลขเดียวที่เชื่อถือได้ว่าของถึงจริง)
- ผู้ซื้อกด **"แจ้งปัญหา"** → เลือกประเภท (ของไม่ถึง / ได้ของผิด / ของเสียหาย / อื่น ๆ) + รายละเอียด → เปิดเคสใน `order_issues`
- ร้านเห็นเคสในแท็บ "ปัญหา" → ตอบและปิดเคส (`resolved` / `rejected` + หมายเหตุ) → ผู้ซื้อได้รับแจ้งเตือน
- Admin เห็นเคสทั้งแพลตฟอร์มในหน้า moderation — **นี่คือสิ่งที่ทำให้หน้า moderation มีข้อมูลให้ตัดสินใจจริง** (เดิมมีปุ่มระงับร้านแต่ไม่มีสัญญาณว่าร้านไหนควรระงับ)

## หน้าจอ & Routes

| Route | หน้าจอ |
|---|---|
| `(buyer)/orders/[id].tsx` | ปุ่ม "ได้รับแล้ว" + "แจ้งปัญหา" + กล่องสถานะเคส (ถ้ามี) |
| `(seller)/orders.tsx` แท็บ "ปัญหา" | รายการเคส (รอตอบ / ปิดแล้ว) + ปุ่มตอบ — ทำเป็นแท็บในหน้าเดิม ไม่ได้แยกไฟล์ |
| `(admin)/moderation.tsx` | ตารางเคสทั้งระบบ (เปิด/ปิด, ต่อร้าน) + ลิงก์ไปออเดอร์ |

## Components หลัก

- `ConfirmReceiptButton` — ปุ่มหลักบนออเดอร์ `shipped`; กดแล้วเปลี่ยนเป็นป้าย "ยืนยันรับแล้ว {วันที่}"
- `ReportIssueSheet` — เลือกประเภท (chips) + รายละเอียด (5-1000 ตัว) + ปุ่มส่ง
- `IssueStatusCard` — แสดงสถานะเคส: เปิดอยู่ / ร้านตอบแล้ว + หมายเหตุ
- `IssueRow` (seller/admin) — ประเภท, ออเดอร์, ผู้แจ้ง(ชื่อผู้รับจาก snapshot), อายุเคส (แดงถ้า >3 วัน), ปุ่มตอบ

## Data & Queries (API)

| Endpoint | ใคร | หมายเหตุ |
|---|---|---|
| `POST /orders/:id/confirm` | buyer | **idempotent** — กดซ้ำได้ใบเดิม ไม่ error และไม่เขียนเวลาใหม่ทับ |
| `POST /orders/:id/issues` | buyer | body มีแค่ `{ type, detail }` — ออเดอร์มาจาก path ผู้แจ้งมาจาก token |
| `GET /orders/:id` | buyer | คืน `issue` (เคสของออเดอร์นั้น) มาพร้อมกันในคำขอเดียว |
| `GET /seller/issues?status=open\|closed` | seller | กรองด้วย "ออเดอร์ของร้านฉัน" ที่ service ไม่ใช่ที่ query string |
| `POST /seller/issues/:id/resolve` | seller | `{ status: resolved\|rejected, note }` — สถานะสุดท้าย เปิดใหม่ไม่ได้ |

- **ไม่มี endpoint ไหนในระบบให้ตั้ง `orders.confirmed_at`** นอกจาก `POST /orders/:id/confirm` ของผู้ซื้อเอง — ร้านตั้งแทนไม่ได้ (นี่คือหัวใจของฟีเจอร์) และมี e2e test ไล่ทุกเส้นทางของร้านเพื่อยืนยัน
- 1 ออเดอร์ = 1 เคส บังคับด้วย `UNIQUE(order_id)` ที่ DB — คำขอที่สองได้ 409 `ISSUE_EXISTS` จากการดัก P2002 ไม่ใช่การเช็คก่อนเขียน (กัน race)
- ผู้แจ้ง/ผู้ปิดเคสไม่เคยมาจาก body — `reporter_id` มาจาก token ของผู้ซื้อ, `resolved_by` มาจาก token ของร้าน

## Auto-confirm (งานที่ 4 ของ engine — [feature 13](13-recurring-engine.md))

ออเดอร์ที่ `shipped` เกิน **7 วัน** และยังไม่มีเคสปัญหา → engine ตั้ง `status = 'delivered'` (ไม่แตะ `confirmed_at` — ยังแยกได้ว่า "ผู้ซื้อยืนยันเอง" กับ "ระบบปิดให้") พร้อมแจ้งเตือนผู้ซื้อ

## Validation & Edge cases

- ยืนยันได้เฉพาะ `shipped`/`delivered` — ออเดอร์ `pending` ยังไม่มีอะไรให้ยืนยัน
- 1 ออเดอร์ = 1 เคส (unique) — ถ้าจะแจ้งเพิ่มให้พิมพ์ในเคสเดิม (แก้ไม่ได้ใน demo → บอกให้ติดต่อร้าน)
- แจ้งปัญหาได้ตั้งแต่ `preparing` ขึ้นไป (ยังไม่ส่ง = ยังไม่มีปัญหาการส่ง)
- ปิดเคสแล้วเปิดซ้ำไม่ได้ (`resolved`/`rejected` เป็นสถานะสุดท้าย)
- ออเดอร์ที่ถูกร้านยกเลิก ([15](15-order-exceptions.md)) → ปุ่มแจ้งปัญหา/ยืนยันหายไป
- เคสที่เปิดค้าง > 7 วัน → ไฮไลต์ในหน้า admin (ตัวชี้วัดคุณภาพร้าน)

## Acceptance Criteria

- [x] buyer กด "ได้รับแล้ว" → `confirmed_at` ถูกตั้ง และ status เป็น `delivered`; กดซ้ำไม่ error (**TC-064** + e2e API เคส idempotency)
- [x] **ร้านตั้ง `confirmed_at` เองไม่ได้** — ไม่มี endpoint ให้ทำ (e2e API ไล่ทุกเส้นทางของร้านแล้ว `confirmed_at` ยังเป็น null) และ engine auto-close ก็ไม่แตะฟิลด์นี้
- [x] แจ้งปัญหา → ร้านได้ notification ทันที + เคสโผล่ในแท็บปัญหาของร้าน (**TC-065**, **TC-068**) · หน้า admin รอ Phase 6
- [x] ร้านปิดเคส → ผู้ซื้อได้ notification + เห็นหมายเหตุบนหน้าออเดอร์ (TC-068)
- [x] ผู้ใช้คนอื่นอ่านเคส/ออเดอร์ของเราไม่ได้ (TC-070 + e2e API 2 บัญชี)
- [x] engine auto-confirm ออเดอร์ที่ shipped เกิน 7 วัน — ปิดเป็น `delivered` แต่ **ไม่แตะ `confirmed_at`** และข้ามใบที่มีเคสเปิดค้าง (e2e API time-travel)

## ข้อมูลที่เกี่ยวข้อง

`order_issues` (ตารางใหม่), `orders.confirmed_at`, RPC `confirm_order_received` / `report_order_issue` / `resolve_order_issue` — migration `20260725000003`

## Out of scope

- แชทโต้ตอบหลายข้อความในเคส, แนบรูปประกอบการแจ้ง, คืนเงินอัตโนมัติจากเคส (ร้านใช้ [15](15-order-exceptions.md) เองถ้าจะคืน), ระบบตัดสินข้อพิพาทโดย admin (admin ดูได้แต่ไม่ตัดสิน)
