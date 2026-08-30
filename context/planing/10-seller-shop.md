# Feature 10: Seller Shop — จัดการร้านค้า

> เฟส: 4 | ฝั่ง: Seller | สถานะ: ✅ เสร็จ (2026-08-17) · ช่องโลโก้ + หน้าร้านสาธารณะเพิ่ม 2026-08-19 · **กำลังเพิ่มแถบสถิติหน้าร้านสาธารณะ (2026-08-30 — ดู Acceptance Criteria)** | Workflows: [W02](../workflows/w02-open-shop.md), [W08](../workflows/w08-seller-orders.md)

## ทำอะไรได้

- เปิดร้านจากหน้าโปรไฟล์ (ชื่อ + คำอธิบาย + โลโก้) — ไม่มีขั้นอนุมัติใน demo
- สลับโหมด buyer ↔ seller ในแอพเดียว
- หน้าร้านสาธารณะ (buyer เข้าดูได้จากหน้าสินค้า) — รอบนี้เพิ่มแถบสถิติ (จำนวนสินค้า / สมาชิกที่สมัครอยู่ / คะแนนรีวิว / เข้าร่วมเมื่อ)
- Dashboard: **subscriber active, MRR จำลอง, ยกเลิกเดือนนี้ (churn)** — จุดขายฝั่งร้าน: รายได้คาดการณ์ได้

## หน้าจอ & Routes

| Route | หน้าจอ |
|---|---|
| `(seller)/_layout.tsx` | tab ฝั่งร้าน: Dashboard / สินค้า / ออเดอร์ / โปรไฟล์ร้าน |
| `(seller)/dashboard.tsx` | ตัวเลข 3 ใบ + รายการเหตุการณ์ล่าสุด (subscriber ใหม่/ยกเลิก) |
| `(seller)/shop-settings.tsx` | แก้ชื่อ/โลโก้/คำอธิบาย/ปิดร้านชั่วคราว |
| `shop/[id].tsx` | หน้าร้านสาธารณะ (สร้างใน feature 03 — reuse) · path จริงคือ `anan/app/shop/[id].tsx` วางนอกกลุ่ม `(buyer)` เหมือน `compare.tsx`/`product/[id]` เพราะเป็นหน้าที่ push ทับ ไม่ใช่แท็บ (สเปกเดิมในไฟล์นี้และ [03-product-detail.md](03-product-detail.md) เขียนเป็น `(buyer)/shop/[id].tsx` ไว้ผิด — แจ้งผู้ใช้แล้วให้ตัดสินใจว่าจะแก้ไฟล์ 03 ด้วยหรือไม่) |

## Components หลัก

- `ModeSwitcher` — ปุ่มในโปรไฟล์ทั้งสองฝั่ง (แสดงเมื่อ `is_seller`)
- `StatCard` ×3 — subscriber / MRR (+DemoBadge) / ยกเลิกเดือนนี้
- `OpenShopForm` — ฟอร์มเปิดร้าน (ครั้งเดียว)

## Data & Queries (API ของเราเอง — ทำแล้วใน Phase 4)

```ts
POST  /api/v1/seller/shop        { name, description?, logoUrl? }  → 409 SHOP_EXISTS ถ้ามีร้านแล้ว
GET   /api/v1/seller/shop
PATCH /api/v1/seller/shop        { name?, description?, logoUrl?, isActive? }
GET   /api/v1/seller/dashboard   → { activeSubscribers, monthlyRevenue, cancelledThisMonth, activeProducts, pendingOrders, recentEvents[] }
```

- **`POST /seller/shop` เป็น endpoint เดียวของฝั่งร้านที่ไม่ต้องมี role seller** — คนกดเปิดร้านยังเป็นผู้ซื้ออยู่ · `users.isSeller` ถูกตั้งใน **ทรานแซกชันเดียวกับการสร้างร้าน** (แทน trigger `sync_is_seller` เดิม) และไม่มีฟิลด์นี้ใน DTO ที่ไหนเลย
- **dashboard เป็น aggregate ล้วน** — ไม่มี `buyerId`/`addressId`/`paymentMethodId` และไม่มีรายชื่อผู้ซื้อในเหตุการณ์ล่าสุด (S-07) · MRR normalize ด้วย `cyclesPerMonth()` ตัวเดียวกับที่ผู้ซื้อเห็น
- **`suspendedAt` / `suspendedReason` ไม่มีใน DTO** — ร้านปลดระงับตัวเองไม่ได้ทุกช่องทาง และ `PATCH` มี `suspendedAt: null` อยู่ใน `where` ของคำสั่งเขียน (ถูกระงับ = 409 `SHOP_SUSPENDED`)
- โลโก้/รูปสินค้า → `POST /api/v1/uploads/signature` แล้วอัปตรงไป Cloudinary · **folder ผูกกับ `shopId` จาก token** · `api_secret` อยู่ใน `.env` ของ API เท่านั้น · เครื่องที่ยังไม่ตั้งค่าตอบ 503 `UPLOADS_NOT_CONFIGURED` แล้วหน้าจอให้ใส่ลิงก์รูปแทน

## Validation & Edge cases

- มีร้านแล้ว → ปุ่มเปลี่ยนเป็น "ไปที่ร้านของฉัน" (unique owner_id กันชั้น DB อีกชั้น)
- ชื่อร้านบังคับ 2-80 ตัวอักษร (CHECK ที่ DB ด้วย); โลโก้อัปโหลดล้ม → สร้างต่อได้ ใช้อักษรย่อแทน
- ปิดร้านชั่วคราว (`is_active=false`) → สินค้าหายจาก catalog แต่ subscriber เดิม + ออเดอร์ค้างยังเดินต่อ (ยึดหลักเดียวกับปิดแผน)
- **ถูกแอดมินระงับ (`suspended_at`) ต่างจากปิดเอง** — seller เขียนคอลัมน์นี้ไม่ได้ ปลดเองไม่ได้ หน้า shop-settings ต้องแสดงป้าย "ถูกระงับโดยผู้ดูแล" และซ่อน toggle เปิดร้าน
  - ปิดร้านเอง = subscriber เดิมยังได้รับของต่อ (เจตนาเดิม) · **ถูกระงับ = subscription ทั้งหมดถูกหยุดชั่วคราวและไม่มีการตัดเงิน** จนกว่าจะปลดระงับ ([14](14-admin.md))
  - **ถูกระงับแล้วออเดอร์ที่ผู้ซื้อจ่ายไปก่อนหน้ายังต้องส่งให้จบ** (ตัดสินใจตอน Phase 4): ร้านยังกดไล่สถานะออเดอร์เดิมได้และเห็นที่อยู่ของออเดอร์เหล่านั้น — แต่แก้ข้อมูลร้าน/สินค้า/ราคา และดูที่อยู่ในประวัติที่ปิดไปแล้ว ทำไม่ได้ (ไม่งั้นออเดอร์ที่จ่ายเงินแล้วค้างถาวรโดยผู้ซื้อไม่มีช่องทางขอคืนเงินจนกว่าจะถึง feature 15)
- dashboard ร้านใหม่ = 0 ทั้งหมด → empty state ชวนลงสินค้าแรก

## Acceptance Criteria

- [x] เปิดร้าน → is_seller = true → toggle โหมดโผล่และสลับได้สองทาง (TC-054)
- [x] เปิดร้านซ้ำไม่ได้ทั้ง UI และ DB (unique `owner_id` + 409 `SHOP_EXISTS`)
- [x] ตัวเลข dashboard ตรงกับข้อมูลจริง — เทสเพิ่ม subscriber 1 → +1, ยกเลิก 1 → churn +1, MRR ขยับตาม (`seller.e2e-spec.ts`)
- [x] **ร้านที่ถูกระงับ ยิง API ตั้ง `suspendedAt = null` เองไม่ได้** — ฟิลด์ไม่อยู่ใน DTO (400) และการแก้อื่น ๆ ได้ 409 (TC-061)
- [x] หน้าร้านสาธารณะ (`anan/app/shop/[id].tsx`) — **ตัวหน้ามีอยู่แล้ว** (ทำต่อยอดจาก catalog ใน Phase 7 ตอนโพลิช, 2026-08-19) **รอบนี้ (2026-08-30) เพิ่มแถบสถิติ**: จำนวนสินค้า / สมาชิกที่สมัครอยู่ (`activeSubscribers`) / คะแนนรีวิว+จำนวนรีวิว / เข้าร่วมเมื่อ ต่อยอดจาก `GET /catalog/shops/:id` ที่เพิ่ม 4 ฟิลด์นี้ ([02-catalog.md](02-catalog.md)) — **ยืนยันแล้ว 2026-08-30: TC-121 เทียบ `#shop-stat-products` กับ `count(*)` ใน DB จริง (Playwright 123/123 เขียว)**

## ข้อมูลที่เกี่ยวข้อง

`shops`, `profiles.is_seller` (derived ด้วย trigger), RPC `shop_dashboard()` (migration `..._secure_read_apis`)

## Out of scope

- KYC/อนุมัติร้าน, หลายร้านต่อบัญชี, staff หลายคนต่อร้าน, กราฟรายงานย้อนหลัง
- **ปุ่ม "ติดตาม" / "พูดคุย" บนหน้าร้านสาธารณะ — ไม่ทำ** เพราะระบบนี้ไม่มี follow/chat เลย (ไม่ใช่แค่ยังไม่ทำ UI — ไม่มีตารางเก็บข้อมูลรองรับ) เหตุผลเต็มว่าทำไมใช้ `activeSubscribers` แทน "ผู้ติดตาม" อยู่ที่ [02-catalog.md](02-catalog.md) หัวข้อ "ทำไมไม่มี ผู้ติดตาม / อัตราตอบแชท / ป้าย Mall แบบ Shopee"
- **คูปองร้านค้าแบบแถบชมพูบนหน้าร้าน — ไม่ทำรอบนี้** เช่นเดียวกับที่ระบุไว้ใน [02-catalog.md](02-catalog.md) Out of scope
