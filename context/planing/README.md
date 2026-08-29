# ANAN — Feature Planning

> อัปเดต: 2026-07-25 | หนึ่งไฟล์ = หนึ่ง feature
> **ข้อตกลงสำคัญ 1: Payment เป็น demo จำลองเท่านั้น ไม่เชื่อม payment gateway จริง** (Stripe/Opn เป็น future work)
> **ข้อตกลงสำคัญ 2: สิทธิ์ทุกอย่างบังคับที่ฐานข้อมูล** — ตารางที่ client เขียนตรงไม่ได้ (`subscriptions`, `subscription_events`, `orders` insert, `payments`, `notifications` insert) ต้องผ่าน RPC ดู [security-design.md](../../docs/security-design.md) ก่อนเขียน query ใด ๆ

แผนภาพรวมโปรเจกต์อยู่ที่ [docs/project-plan.md](../../docs/project-plan.md)

## รายการ Feature

### ฝั่งผู้ซื้อ (Buyer)

| # | Feature | เฟส |
|---|---|---|
| 01 | [Auth — สมัคร/ล็อกอิน/บทบาท](01-auth.md) | 1 (ลืมรหัสผ่าน ทำจริง 7.2) |
| 02 | [Catalog — เลือกดูสินค้าตามหมวด](02-catalog.md) | 2 |
| 03 | [Product Detail — หน้าสินค้า + เลือกแผนรอบส่ง](03-product-detail.md) | 2 |
| 04 | [Compare — เปรียบเทียบสินค้าข้ามร้าน](04-compare.md) | 2 (ทำจริง 7) |
| 05 | [Subscribe Checkout — สมัคร subscription](05-subscribe-checkout.md) | 2 |
| 06 | [My Subscriptions — จัดการ subscription ของฉัน](06-my-subscriptions.md) | 2 |
| 07 | [Orders — ประวัติและสถานะออเดอร์](07-orders-history.md) | 4.5 |
| 08 | [Notifications — แจ้งเตือน](08-notifications.md) | 3 (ทำจริง 7) |
| 09 | [Payment (Demo) — ระบบจ่ายเงินจำลอง](09-payment-demo.md) | 2, 5 |

### ฝั่งร้านค้า (Seller)

| # | Feature | เฟส |
|---|---|---|
| 10 | [Seller Shop — จัดการร้านค้า](10-seller-shop.md) | 4 |
| 11 | [Seller Products — ลงสินค้า + กำหนดแผนรอบส่ง](11-seller-products.md) | 4 |
| 12 | [Seller Orders — ออเดอร์รอบถัดไป](12-seller-orders.md) | 4 |

### ระบบหลังบ้าน (System)

| # | Feature | เฟส |
|---|---|---|
| 13 | [Recurring Engine — สร้างออเดอร์อัตโนมัติตามรอบ](13-recurring-engine.md) | 3 |
| 14 | [Admin — ดูแลแพลตฟอร์ม (minimal)](14-admin.md) | 6 |

### ความน่าเชื่อถือของ marketplace (เพิ่ม 2026-07-25 — Phase 4.5)

| # | Feature | เฟส |
|---|---|---|
| 15 | [Order Exceptions — ร้านยกเลิกออเดอร์ + คืนเงินจำลอง](15-order-exceptions.md) | 4.5 |
| 16 | [Delivery Confirmation & Issue Report — ยืนยันรับของ / แจ้งปัญหา](16-delivery-confirmation.md) | 4.5 |
| 17 | [Reviews — รีวิวจากผู้ใช้จริงที่รับของมาแล้วหลายรอบ](17-reviews.md) | 4.5 |

### ส่วนลด (เพิ่ม 2026-08-24 — Phase 8)

| # | Feature | เฟส |
|---|---|---|
| 18 | [Coupons — คูปองส่วนลดรายรอบ **2 ระดับ** (แพลตฟอร์ม + ร้านค้า · ซ้อนกันได้)](18-coupons.md) | 8 ✅ |

## หลักการเขียนไฟล์ feature (ขยายแล้ว 2026-07-11)

แต่ละไฟล์มีโครง: **ทำอะไรได้** → **หน้าจอ & Routes** (expo-router) → **Components หลัก** → **Data & Queries** (endpoint จริงของ API) → **Validation & Edge cases** → **Acceptance Criteria** (เช็คลิสต์ก่อนปิดงาน) → **ข้อมูลที่เกี่ยวข้อง** → **Out of scope**

ลำดับขั้นตอนแบบ step-by-step ของแต่ละ use case อยู่ที่ [../workflows/](../workflows/README.md) (W01-W09) — feature บอก "มีอะไร" / workflow บอก "ไหลยังไง" อ่านคู่กันตอน implement
