# Project Plan: ANAN — Subscription Marketplace (Thesis)

> อัปเดตล่าสุด: 2026-08-15
> สถานะ: **เปลี่ยนสถาปัตยกรรม** — ย้ายจาก Supabase (BaaS) มาเป็น NestJS API + PostgreSQL ที่คุมเอง
> เอกสารอ้างอิง: Thesis Proposal v1.2 (Advisor Draft) — "Design and Development of a Multi-Vendor Subscription Commerce Platform for Physical Consumer Products", B.Sc. CS, Kasetsart University

## คอนเซปต์ (ไม่เปลี่ยน)

**ANAN** — marketplace สินค้าจริงแบบ subscription หรือ "Shopee แบบ recurring" ผู้ซื้อสั่งสินค้าที่ใช้ซ้ำเป็นวงจรเป็นรอบอัตโนมัติ (ราย 2 สัปดาห์ / เดือน / 2 เดือน) แทนการกดซื้อครั้งเดียว

**หมวดสินค้าเป้าหมาย:** ยาสีฟัน สกินแคร์ แชมพู วิตามิน กาแฟ อาหารสัตว์เลี้ยง ผ้าอ้อม ชุดชั้นใน ถุงเท้า ของใช้ในบ้าน

**จุดขายหลัก 3 ข้อ:**
1. ถูกกว่า — ราคา subscribe ต่ำกว่าซื้อครั้งเดียว
2. สะดวก — ของมาเองตามรอบ ไม่ต้องนึกจะสั่ง
3. ยืดหยุ่น — pause / skip รอบ / เลื่อนวันส่ง / ยกเลิก ได้ในคลิกเดียว

ไอเดียที่พักไว้: [subscription tracker](future-ideas/subscription-tracker.md)

---

## การตัดสินใจเชิงสถาปัตยกรรม (2026-08-15) — เขียนลงเล่มบทที่ 3

### เดิม: Supabase (BaaS)
แอปคุย Postgres ตรงผ่าน PostgREST ไม่มี backend ของเราคั่นกลาง → authorization ทั้งหมดต้องอยู่ในฐานข้อมูล (GRANT + RLS + RPC + trigger)

### ใหม่: NestJS API + PostgreSQL
มี API layer ของเราคั่นกลาง → **client ไม่แตะฐานข้อมูลโดยตรงอีกต่อไป**

**เหตุผลที่เปลี่ยน:**
1. **คุม business logic ได้เต็มที่ใน TypeScript** — logic ที่เคยอยู่ใน plpgsql (state machine, cycle math, engine) เขียน/อ่าน/refactor/test ได้ง่ายกว่ามาก
2. **ไม่ผูกกับ vendor** — ย้าย host ได้ทุกที่ที่รัน Node + Postgres ได้
3. **สถาปัตยกรรมแบบ layered เป็นสิ่งที่อธิบายและปกป้องได้ในเชิงวิศวกรรมซอฟต์แวร์** — controller / service / repository เป็นรูปแบบมาตรฐานที่กรรมการคุ้นเคย
4. **ไม่ต้องพึ่ง Docker หรือ cloud** — Postgres ติดตั้งบนเครื่องอยู่แล้ว จัดการผ่าน pgAdmin

**ต้นทุนที่ยอมรับ:** ต้องเขียน auth เอง, storage เอง, API ทุก endpoint เอง — งานเพิ่มขึ้นราว 40–60% แลกกับการควบคุมและความเป็นเจ้าของโค้ดทั้งหมด

**สิ่งที่ยกมาใช้ต่อได้ทั้งหมด:** schema (15 ตาราง + constraint + index), business logic ทุกกฎ, feature spec 17 ไฟล์, workflow 12 ไฟล์, design system, UI ทุกหน้าจอ, ข้อมูล seed

---

## Tech Stack

| ส่วน | เลือกใช้ | เหตุผล |
|---|---|---|
| **Frontend** | Expo (React Native + TypeScript, expo-router) | โค้ดชุดเดียว build Android + iOS + Web — **ไม่เปลี่ยน** |
| **Backend** | **NestJS (TypeScript)** | โครงสร้าง module/controller/service ชัดเจน · DI + guard + pipe มาให้ครบ · เป็นมาตรฐานที่อธิบายในเล่มได้ |
| **Database** | **PostgreSQL 17** (ติดตั้งบนเครื่อง จัดการผ่าน pgAdmin) | relational เต็มรูป · มีอยู่แล้วไม่ต้องติดตั้ง · ไม่ต้อง Docker ไม่ต้องเน็ต |
| **ORM** | **Prisma** | type-safe จาก schema · migration tooling ครบ · เอกสารดีที่สุด · `$queryRaw` สำหรับ query ซับซ้อน (forecast/MRR/churn) |
| **Auth** | **JWT (access + refresh) + bcrypt** ผ่าน `@nestjs/jwt` + Passport | มาตรฐาน · อธิบายกลไกได้ทุกขั้นในเล่ม |
| **Recurring engine** | **`@nestjs/schedule` cron** รันรายวัน 01:00 (Asia/Bangkok) | หัวใจของระบบ — logic เดิมทั้งหมด ย้ายจาก SQL มา TypeScript |
| **File storage** | **Cloudinary** (free tier) | ไม่ต้องจัดการ disk/CDN เอง · มี transform + resize อัตโนมัติ |
| **Payment** | **Demo จำลอง 100%** | ห้ามเชื่อม gateway จริงทุกกรณี — `PaymentProvider` interface เผื่อ future work |
| **Realtime** | **ยังไม่ทำ** — ใช้ pull-to-refresh + polling | WebSocket เป็น optional ปลายเฟส ถ้าเวลาเหลือ |
| **Demo/Deploy** | API: Railway/Render · Web: Vercel · Mobile: Expo Go + APK | ตัดสินใจตอน Phase 7 |

---

## สถาปัตยกรรม

```
[Expo app — mobile + web]
        │  HTTPS + JSON, Authorization: Bearer <access token>
        ▼
┌─────────────────────────────────────────────┐
│ NestJS API — ชั้นที่บังคับกฎทุกอย่าง          │
│                                             │
│  Guard      JwtAuthGuard → RolesGuard       │
│  Pipe       ValidationPipe (DTO whitelist)  │
│  Controller รับ/ตอบ HTTP เท่านั้น            │
│  Service    business logic + ownership check│
│  Prisma     data access ที่เดียว             │
│  Cron       recurring engine (รายวัน)        │
└─────────────────────────────────────────────┘
        │  Prisma Client (connection pool)
        ▼
[PostgreSQL 17]  CHECK / FK / UNIQUE / index — ด่านสุดท้ายของความถูกต้อง
        
[Cloudinary]  รูปสินค้า + โลโก้ร้าน
```

รายละเอียดเต็ม: [architecture.md](architecture.md)

## Data Model

15 ตาราง — โครงเดิมทั้งหมด ย้ายมาเขียนเป็น `schema.prisma`
รายละเอียด + เหตุผลการออกแบบ: [database-schema.md](database-schema.md)

`users` · `addresses` · `payment_methods` · `shops` · `categories` · `products` · `product_plans` · `subscriptions` · `subscription_events` · `orders` · `payments` · `notifications` · `order_issues` · `reviews` · `engine_runs`

**Logic หลัก (ไม่เปลี่ยน):** cron รายวัน → หา subscription ที่ `active` และ `next_order_date <= วันนี้` → สร้าง order + ตัดเงินจำลอง + เลื่อน `next_order_date` + แจ้งเตือน — ต้อง **idempotent** (unique `subscription_id + cycle_date`)

## ความปลอดภัย

โมเดลเปลี่ยนจาก "บังคับในฐานข้อมูล" เป็น **"บังคับใน API layer พร้อม constraint ที่ DB เป็นด่านสุดท้าย"** — ดู [security-design.md](security-design.md)

| ชั้น | บังคับอะไร |
|---|---|
| L1 Transport | HTTPS · CORS allowlist · helmet · rate limit |
| L2 Authentication | JWT access (15 นาที) + refresh (7 วัน, rotate) · bcrypt cost 12 |
| L3 Authorization | `JwtAuthGuard` → `RolesGuard` → **ownership check ใน service ทุกครั้ง** |
| L4 Input validation | DTO + `class-validator` + `whitelist: true` (ตัด field ที่ไม่ได้ประกาศทิ้ง) |
| L5 Data integrity | CHECK / FK / UNIQUE ใน Postgres — ยกมาจาก schema เดิมครบ |

**กฎที่ไม่เปลี่ยน:** เงิน สถานะการจ่าย และสิทธิ์ ห้ามมาจาก client · ราคาอ่านจาก DB เสมอ · ห้ามเก็บเลขบัตรเต็ม

## Roadmap (รีเซ็ตใหม่)

- [x] **Phase 0 — วางรากฐาน API** _(เสร็จ 2026-08-16)_
  - [x] scaffold NestJS 11 + Prisma 6 + เชื่อม Postgres บนเครื่อง (`anan`, role `anan_app` ไม่ใช่ superuser)
  - [x] `schema.prisma` 16 models (15 ตารางเดิม + `refresh_tokens`) + migration `init`
  - [x] migration `check_constraints` เขียนมือ — 52 CHECK + partial index 2 ตัวที่ Prisma เขียนเองไม่ได้
  - [x] `prisma/seed.ts` แปลงจาก `seed.sql` เดิม (5 บัญชี · 3 ร้าน · 12 สินค้า · 18 แผน · 3 subscription · 4 ออเดอร์)
  - [x] โครง common: exception filter รูปแบบเดียว · `@Public()` / `@CurrentUser()` / `@Roles()` · RolesGuard · env validation (zod) · `configureApp()` ที่ main.ts และ e2e ใช้ร่วมกัน
  - [x] helmet + CORS เจาะจง origin + ValidationPipe (`whitelist` + `forbidNonWhitelisted`) + throttler
  - [x] `GET /api/v1/health` + e2e ชุดแรก 3 เคส · `npm run check` ผ่านครบ
- [x] **Phase 1 — Auth + ผู้ใช้** _(เสร็จ 2026-08-16)_
  - [x] register / login / refresh / logout · bcrypt cost 12 · JWT strategy · refresh token rotation + reuse detection
  - [x] profile · addresses (CRUD + ที่อยู่หลัก) · payment methods (บัตรจำลอง เก็บ last4)
  - [x] Expo ย้ายมาใช้ API client (`src/lib/api/`) + เก็บ token — **ยกเว้น catalog/checkout/subscriptions ที่ย้ายพร้อมกันใน Phase 2**
  - [x] รีวิวขนาน 2 agent (security + correctness) → แก้ race condition ของ refresh token, unique index ที่อยู่หลัก, throttle gate ที่ fail-open, และอีก 12 ข้อ
  - [x] test 95 เคส (unit 34 + e2e 61) · ไล่กดจริงบนเว็บครบ: login → โปรไฟล์ → ที่อยู่ → รีเฟรชหน้ายังล็อกอินอยู่ → logout
- [x] **Phase 2 — Catalog + Checkout** _(เสร็จ 2026-08-17)_
  - [x] categories / products / plans (public) · ค้นหา · กรองหมวด · เรียงลำดับ · product detail + รีวิว (ชื่อผู้รีวิวถูก mask)
  - [x] `VISIBLE_PRODUCT` — นิยามเดียวของ "สินค้าที่ลูกค้าเห็นได้" ใช้ร่วมกันทั้ง catalog และ checkout
  - [x] `POST /subscriptions` — transaction เดียว: subscription + order + payment + event + แจ้งเตือนร้าน · ราคาอ่านจาก DB · กันสมัครซ้ำที่ server
  - [x] **ถอด Supabase ออกจากแอปหมดแล้ว** (ลบ `lib/supabase.ts`, `types/database.ts`, ถอน dependency) · **ลบไฟล์ที่เหลือทั้งหมดออกจากโปรเจกต์เมื่อ 2026-08-19** — CLI config, migration ชุดเดิม, pgTAP, สคริปต์ `run-sql/run-tests` และ devDependency 4 ตัว · SQL ที่ใช้อ้างอิงในเล่มย้ายไป [docs/archive/supabase-sql/](archive/supabase-sql/)
  - [x] ไล่กดจริงบนเว็บครบ: login → หน้าแรก → สินค้า → checkout → กดยืนยันรัว 3 ครั้งได้ subscription เดียว → เห็นในรายการของฉัน
- [x] **Phase 3 — จัดการ subscription + Engine** _(เสร็จ 2026-08-17)_
  - [x] 7 actions ของ [W05](../context/workflows/w05-manage-subscription.md) เป็น endpoint — `POST /subscriptions/:id/skip|pause|resume|reschedule|plan|address|cancel` · ทุกตัวเขียน subscription + event ในทรานแซกชันเดียว · เงื่อนไขสถานะอยู่ใน `where` ของคำสั่งเขียน (กดปุ่มรัวแล้วไม่ข้าม 2 รอบ)
  - [x] **คอลัมน์ใหม่ `subscriptions.cycle_anchor_date`** — หมุดของกริดรอบ ทำให้วันตัดเงินไม่ยุบเป็นวันที่ 28 ถาวรหลังผ่านกุมภาพันธ์ (ดู [database-schema.md](database-schema.md))
  - [x] recurring engine: `@Cron('0 1 * * *', Asia/Bangkok)` · idempotent ด้วย `UNIQUE(subscription_id, cycle_date)` · เก็บตกรอบที่พลาด · แจ้งล่วงหน้า T-3 · สรุปให้ร้าน · ล้าง refresh token หมดอายุ · log ลง `engine_runs`
  - [x] `BILLABLE_PRODUCT` — นิยามเดียวของ "ยังเรียกเก็บเงินได้" (ร้านที่ถูก admin ระงับถูกกรองออก แต่ร้านที่ปิดรับสมาชิกเองยังส่งของให้คนเดิม)
  - [x] endpoint time-travel `POST /admin/engine/run` — role admin **และ** `DEMO_MODE=true` **และ** NODE_ENV อยู่ใน allowlist (fail closed) + `GET /admin/engine/runs`
  - [x] แก้ A-8 ที่ค้างจาก Phase 1: `refresh_tokens.revoked_reason` — ใบที่ logout แล้วถูกใช้ซ้ำไม่ถือว่า token รั่วอีกต่อไป (เลิกเตะเจ้าของออกทุกเครื่อง)
  - [x] ฝั่ง Expo: แทน stub 7 ตัวด้วย endpoint จริง + เพิ่มปุ่ม "เปลี่ยนรอบส่ง"
  - [x] test 288 เคส (unit 49 + e2e API 178 · 10 suites + Playwright L4 61 เคส) · ไล่กดจริงบนเว็บ: ข้ามรอบ → เลื่อนวัน → เปลี่ยนรอบส่ง → หยุด → กลับมาใช้งาน → ยกเลิก
- [x] **Phase 4 — ฝั่งร้านค้า** _(เสร็จ 2026-08-17)_
  - [x] เปิดร้านจากโปรไฟล์ — `POST /seller/shop` ตั้ง `users.isSeller` ในทรานแซกชันเดียวกับการสร้างร้าน · 1 บัญชี = 1 ร้าน (unique `owner_id` เป็นด่านจริง)
  - [x] ตั้งค่าร้าน + ปิดร้านเอง · **ร้านที่ถูก admin ระงับแก้อะไรไม่ได้และปลดระงับตัวเองไม่ได้** (`ShopService.requireOperableShop`)
  - [x] dashboard: สมาชิก · MRR (normalize ด้วย `cyclesPerMonth` ตัวเดียวกับฝั่งผู้ซื้อ) · ยกเลิกเดือนนี้ · เหตุการณ์ล่าสุด — **aggregate ล้วน ไม่มีแถวของผู้ซื้อ**
  - [x] ลงสินค้า + แผนรอบส่งในคำขอเดียว · เปิดรอบเพิ่ม · ปิดแผน (สมาชิกเดิมยังได้ของ — พิสูจน์ด้วย engine ใน test) · ปิดการขาย
  - [x] **ขึ้นราคาแล้วสมาชิกทุกคนได้ notification + `subscription_events.price_changed` ในทรานแซกชันเดียวกับการแก้ราคา** (consumer protection — เขียนในเล่มได้)
  - [x] ออเดอร์ของร้าน: ค้างส่ง/กำลังส่ง/ประวัติ · ไล่สถานะทีละขั้นผ่าน `POST /seller/orders/:id/advance` (server เป็นคนบอกขั้นถัดไป — ไม่รับ status จาก client) + เลขพัสดุ + แจ้งผู้ซื้อทุกขั้น
  - [x] forecast 7/14/30 วัน เป็น aggregate รายสินค้า (ไม่มีข้อมูลผู้ซื้อ) + ป้ายบอกว่าเป็นค่าประมาณ
  - [x] `POST /uploads/signature` — signed upload ของ Cloudinary ผูก folder กับ `shopId` จาก token · `api_secret` ไม่เคยออกจากเซิร์ฟเวอร์ · เครื่องที่ยังไม่ตั้งค่าตอบ 503 พร้อมรหัสที่หน้าจอแตกเคสได้
  - [x] หน้าจอฝั่งร้านครบ 4 แท็บ + ModeSwitcher ในโปรไฟล์ · ไล่กดจริงบนเว็บ: เปิดร้าน → ลงสินค้า → ขึ้นราคา → ไล่สถานะออเดอร์ → forecast → ปิด/เปิดร้าน
  - [x] รีวิวขนาน 2 agent → แก้ 12 ข้อ: **forecast นับหัวละ 1 ออเดอร์ไม่ว่าช่วงกี่วัน** (รอบ 2 สัปดาห์ใน 30 วันต้องเป็น 2-3 ใบ) · **ขอบเดือนของ churn เพี้ยน 7 ชม.** · MRR/forecast รวมร้านที่ถูกระงับ · **ลดจำนวนชิ้นโดยคงราคา = ขึ้นราคาต่อชิ้นแต่ไม่แจ้งใคร** · ลายเซ็น Cloudinary ไม่ครอบชนิดไฟล์ · **trigger `guard_order_update` ที่สเปกอ้างไว้แต่ไม่มีอยู่จริง** · ownership ไม่อยู่ใน where ของ 2 คำสั่งเขียน · ปุ่มลงขายไม่มี re-entrancy guard · ปุ่มแท็บเล็กกว่า 44px · คีย์บอร์ดทับปุ่มในกล่องกรอกเลขพัสดุ · แท็บไม่โหลดใหม่ตอนกลับมา · เทสที่ assert อ่อนจนบั๊ก forecast รอด
  - [ ] **ยังไม่ได้ทำในเฟสนี้ (ยกไป Phase 7 ตอนโพลิช)** — เลือกรูปจากเครื่อง/กล้อง (`expo-image-picker` + เรียก `POST /uploads/signature` จริง · ตอนนี้กรอกลิงก์ https ได้ 1 รูป), หน้าแก้ไขสินค้าเต็มรูป (`products/[id].tsx` — ตอนนี้แก้ได้เฉพาะราคา/เปิด-ปิดขายจากหน้ารายการ), ช่องโลโก้ร้าน, หน้าร้านสาธารณะ `(buyer)/shop/[id].tsx`
- [x] **Phase 4.5 — ความน่าเชื่อถือ** _(เสร็จ 2026-08-18)_
  - [x] ประวัติออเดอร์ของผู้ซื้อ ([07](../context/planing/07-orders-history.md)) — `GET /orders?tab=open|done` + `GET /orders/:id` · stepper 4 ขั้น · ที่อยู่มาจาก `address_snapshot` ไม่ใช่ตาราง `addresses` (ประวัติไม่เปลี่ยนย้อนหลัง)
  - [x] **ยืนยันรับของ ([16](../context/planing/16-delivery-confirmation.md))** — `POST /orders/:id/confirm` เป็น **จุดเดียวในทั้งระบบที่เขียน `orders.confirmed_at` ได้** ร้านไม่มี endpoint ไหนแตะฟิลด์นี้เลย · กดซ้ำได้ไม่พัง (idempotent) · ปิดช่องโหว่เดิมที่ร้านกด `delivered` เองได้ทั้งที่ยังไม่ส่ง
  - [x] แจ้งปัญหา + ร้านตอบเคส — 1 ออเดอร์ = 1 เคส บังคับด้วย `UNIQUE(order_id)` ที่ DB (ดัก P2002 ไม่ใช่เช็คก่อนเขียน) · `reporter_id`/`resolved_by` มาจาก token เสมอ · แท็บ "ปัญหา" ของร้าน + ไฮไลต์เคสค้างเกิน 3 วัน
  - [x] **ร้านยกเลิกออเดอร์ + คืนเงินจำลอง ([15](../context/planing/15-order-exceptions.md))** — ยกเลิก + `payments.status = 'refunded'` + `subscription_events.order_cancelled` + แจ้งเตือนผู้ซื้อ ในทรานแซกชันเดียว · **subscription ไม่ถูกแตะ** (ปัญหาสต๊อกรอบเดียวไม่ควรทำให้ผู้ใช้เสียทั้งรายการ) · ผู้ซื้อเห็นเหตุผล + ป้ายคืนเงิน DEMO
  - [x] **รีวิว verified ([17](../context/planing/17-reviews.md))** — เขียนได้เมื่อมีออเดอร์ `delivered` อย่างน้อย 1 ใบ (ไม่งั้น 422) · `cycles_received` นับจากออเดอร์จริงทุกครั้งที่บันทึก ไม่ใช่ค่าที่ client ส่งมา · รีวิวที่ 2 บนรายการเดิม = การแก้ · การ์ด subscription พก `cyclesReceived`/`myRating` มาให้หน้าจอล็อกปุ่มด้วยเงื่อนไขเดียวกับ API
  - [x] engine งานที่ 4: auto-close ออเดอร์ที่ `shipped` เกิน 7 วัน (นับจาก **`orders.shipped_at` คอลัมน์ใหม่** ไม่ใช่ `cycle_date`) — ปิดเป็น `delivered` แต่ **ไม่แตะ `confirmed_at`** · ข้ามเฉพาะใบที่ยังมีเคสปัญหา**เปิดค้าง** (ปิดเคสแล้วเดินต่อได้ ไม่งั้นออเดอร์ค้าง `shipped` ตลอดกาล)
  - [x] **`payments_lifecycle`** — CHECK เดิมบังคับให้ `paid` ต้องมี `paid_at` จนคืนเงินไม่ได้เลย เปลี่ยนเป็นกฎเดียวที่ครอบทั้ง paid/refunded/failed (migration `20260817180000`)
  - [x] test 325 เคส (unit 49 + e2e API 206 · 11 suites + Playwright L4 70 เคส · 8 specs) · ไล่กดจริงบนเว็บ: ร้านไล่สถานะ → ผู้ซื้อกดได้รับแล้ว → แจ้งปัญหา → ร้านตอบเคส → ให้คะแนน → กล่องยกเลิกออเดอร์
- [x] **Phase 5 — Payment demo โพลิช** _(เสร็จ 2026-08-18)_
  - [x] **`PaymentProvider` + `DemoPaymentProvider`** ([09](../context/planing/09-payment-demo.md)) — checkout · engine · การจ่ายซ้ำ เรียกผ่าน interface เดียวกันหมด ไม่มีที่ไหนเขียน `status: 'paid'` เองอีกแล้ว (จุดที่จะเปลี่ยนเป็น gateway จริงได้ในอนาคตโดยไม่ไล่แก้ทั้งระบบ)
  - [x] **จำลองตัดเงินไม่ผ่านแบบทำซ้ำได้: บัตรที่ลงท้าย `0000` ถูกปฏิเสธเสมอ** — เลือกแทน fail rate แบบสุ่มเพราะการนำเสนอต้องเกิดเหมือนกันทุกครั้ง และเขียนเป็นเทสอัตโนมัติได้
  - [x] รอบแรกจ่ายไม่ผ่าน → **rollback ทั้งก้อน** (402 `PAYMENT_FAILED`) ไม่เหลือสมาชิกที่ไม่เคยจ่ายสำเร็จ · รอบถัดไปจ่ายไม่ผ่าน → ออเดอร์ยังอยู่ให้กดจ่ายซ้ำ และ `next_order_date` ยังเลื่อนตามปกติ
  - [x] **ออเดอร์ที่ยังจ่ายไม่สำเร็จไม่ถึงตาร้านเลย** — ไม่อยู่ในรายการ ไม่ถูกนับใน dashboard และยิง `advance` ตรงได้ 404 (ร้านต้องไม่จัดของให้รอบที่ยังไม่ได้เงิน)
  - [x] `POST /orders/:id/retry-payment` — ไม่มี body เลย ยอดกับบัตรอ่านจากออเดอร์ · สำเร็จแล้วร้านถึงได้ notification · กดซ้ำหลังจ่ายแล้วได้ 409
  - [x] ใบเสร็จจำลองในหน้าออเดอร์ — เลขที่ `RC-XXXXXXXX` คำนวณจาก id ออเดอร์ (ไม่เพิ่มคอลัมน์) · ออกได้เฉพาะรอบที่จ่ายสำเร็จ
  - [x] test 338 เคส (unit 49 + e2e API 215 · 12 suites + Playwright L4 74 เคส · 9 specs)
- [x] **Phase 6 — Admin** _(เสร็จ 2026-08-19)_
  - [x] dashboard 9 ตัวเลข ([14](../context/planing/14-admin.md)) — aggregate ล้วนทั้งหมด · MRR ใช้สูตร `cyclesPerMonth` ตัวเดียวกับ dashboard ของร้าน (ถ้าคนละสูตรจะไม่มีทางรู้ว่าฝั่งไหนผิด)
  - [x] จัดการหมวดสินค้า — เพิ่ม/แก้/ลบ · **ลบหมวดที่มีสินค้าให้ FK เป็นคนบล็อก** แล้วค่อยนับไปบอกผู้ใช้ (นับก่อนลบมีช่องให้สินค้าใหม่แทรกกลางทาง)
  - [x] **moderation: ระงับร้าน/สินค้า = หยุดเงินจริง** — ทรานแซกชันเดียวที่เขียน `suspended_at` + แช่แข็ง subscription ทุกใบเป็น `paused/shop_suspended` + audit event + แจ้งเตือนผู้ซื้อ · ผู้ซื้อปลดเองไม่ได้ · engine ข้ามร้านนั้นทันที
  - [x] คืนสถานะ → subscription กลับมา `active` เอง โดย `next_order_date = max(เดิม, พรุ่งนี้)` — ปลดระงับแล้วต้องไม่ตัดเงินย้อนหลัง
  - [x] คิวเคสปัญหาทั้งแพลตฟอร์ม + สัญญาณคุณภาพต่อร้าน (เคสค้าง · อัตรายกเลิก 30 วัน) — **สิ่งที่ทำให้หน้า moderation มีข้อมูลให้ตัดสินใจจริง** ไม่ใช่มีแค่ปุ่มระงับ
  - [x] หน้าจอ 4 หน้าแบบ web-first (sidebar) + ทางเข้าจากโปรไฟล์ · guard เป็น UX ส่วนกฎจริงคือ `@Roles('admin')` ที่ทุก controller
  - [x] test 365 เคส (unit 49 + e2e API 237 · 13 suites + Playwright L4 79 เคส · 10 specs) · ไล่กดจริงบนเว็บ: ระงับร้าน → คืนสถานะ → ลบหมวดที่มีสินค้า → รัน engine
  - [ ] **ยังไม่ได้ทำโดยตั้งใจ** — ปุ่ม reset demo ในหน้า engine (ใช้ `npm run db:seed` แทน · endpoint ที่ล้างข้อมูลได้จากหน้าเว็บเสี่ยงเกินกว่าที่ควรมี)
- [ ] **Phase 7 — Polish + Deploy** _(งานโพลิชเสร็จ 2026-08-19 · **ยังไม่ deploy**)_
  - [x] **feature 04 เปรียบเทียบสินค้าข้ามร้าน** — ถาดเทียบ (client state ล้วน) + ตารางเทียบราคาต่อรอบทุก cycle · **ราคาต่อหน่วย** · ส่วนลด · คะแนนรีวิว · จำนวนสมาชิก พร้อมไฮไลต์ค่าที่ดีที่สุด · สมัครตรงจากคอลัมน์ได้ — **ปิดช่องว่างกับ objective ในเล่ม** ("compare and manage subscriptions from multiple brands")
  - [x] **feature 08 หน้าแจ้งเตือน** — module `notifications` (list + unreadCount + mark read/all, idempotent) + แท็บที่ 4 ของผู้ซื้อ · แจ้งเตือนที่ทุก flow เขียนไว้ตั้งแต่ Phase 2 เพิ่งมีที่ให้ผู้ใช้อ่านในรอบนี้
  - [x] หน้าจัดการบัตร (`profile/payment-methods`) · ช่องโลโก้ร้าน · หน้าแก้ไขสินค้าเต็มรูป (`(seller)/products/[id]`) · **หน้าร้านสาธารณะ** (`shop/[id]` + `GET /catalog/shops/:id`)
  - [x] **คอนโซลแยกตามบทบาท (2026-08-19)** — ล็อกอินแล้วเข้าคอนโซลของบทบาทตัวเอง (`landingHref`) แทนที่จะโยนทุกคนไปหน้าผู้ซื้อ · แต่ละโหมดมีเปลือกของตัวเอง (สีแถบนำทาง · ชื่อร้านจริงบนหัว · badge แจ้งเตือน) · ตัวสลับโหมด + ออกจากระบบติดอยู่ทุกคอนโซล · **กล่องแจ้งเตือนแยกฝั่งผู้ซื้อ/ร้าน** ด้วย `?scope=` ที่ API — เหตุผลและตารางสีอยู่ที่ [design-system §5.1](design-system.md)
  - [x] **ฟอร์มผูกบัตรแบบของจริง (2026-08-20)** — จำลองเฉพาะ *การตัดเงิน* ส่วน *การผูกบัตร* ทำงานเหมือนของจริงทุกขั้น: Luhn · อ่านเครือข่ายจาก BIN (Visa/Mastercard/JCB/Amex/UnionPay) · วันหมดอายุ ดด/ปป · CVV · หน้าบัตรตัวอย่างที่ขยับตามที่พิมพ์ · กันผูกบัตรซ้ำด้วย UNIQUE ที่ DB · หน้าจอผูกบัตรไม่มีคำว่า "จำลอง/สมมติ" แล้ว
        · DB เพิ่ม `brand`/`exp_month`/`exp_year` (migration `card_details`) และยังไม่เก็บเลขบัตรเต็มหรือ CVV เหมือนเดิม (กฎเหล็กข้อ 1) · เหตุผลและขอบเขตอยู่ที่ [feature 09](../context/planing/09-payment-demo.md)
  - [x] test 480 เคส (unit 64 + e2e API 311 · 15 suites + Playwright L4 105 เคส · 14 specs)
  - [x] **รื้อทิศทางภาพทั้งชุด (2026-08-19)** — จาก violet/gradient ที่ยกมาจาก mockup NovaShop เป็น "ชั้นของใช้ในบ้าน": เขียวสน + สีประจำหมวดบนพื้นกระดาษ · เหตุผลและค่าจริงอยู่ที่ [design-system.md](design-system.md) · แก้ของที่วัดได้เป็นตัวเลข: contrast อักษรแทนรูปสินค้า 1.11:1 → ไอคอนหมวดที่อ่านออก · `textFaint` 2.56:1 → 5.0:1 (ผ่าน AA) · กริดเดสก์ท็อปที่ได้ 3 คอลัมน์ทั้งที่สั่ง 4 (สูตรคิดจากความกว้างหน้าต่างแต่กริดอยู่ใน ScrollView) → วัดจริงด้วย `onLayout` · เว็บที่เป็น UI มือถือยืดพร้อม bottom tab bar 1280px → sidebar ตาม design-system §4
  - [x] **ลืมรหัสผ่าน + ผู้ดูแลสลับดูได้ทุกโหมด (2026-08-22)** — ผู้ใช้สั่งให้เพิ่ม (ของเดิมอยู่ใน Out of scope ของ [feature 01](../context/planing/01-auth.md))
    - **ลืมรหัสผ่านส่งอีเมลจริงผ่าน SMTP** (`MailService` + `nodemailer` — dependency ใหม่ตัวเดียวของรอบนี้) ไม่ใช่โหมดเดโม่ที่คืน token ให้หน้าจอ · ตาราง `password_reset_tokens` ใช้แบบเดียวกับ `refresh_tokens` ทุกข้อ: เก็บ sha256, CHECK บังคับ hex 64 ตัว, อายุ 30 นาที, ใช้ได้ครั้งเดียว, ขอใบใหม่แล้วใบเก่าตาย
    - **ตั้งรหัสใหม่ = เพิกถอน session ทุกเครื่อง** (`revoked_reason = 'password_reset'`) — ถ้าไม่ทำ คนที่แอบเข้าบัญชีอยู่ยังอยู่ต่อได้อีก 7 วันทั้งที่เจ้าของเพิ่งเปลี่ยนรหัส การรีเซ็ตก็ไม่มีความหมาย
    - **ตอบ 204 เหมือนกันทุกกรณี** ไม่ว่าอีเมลมีในระบบหรือไม่ · ปลายทางของลิงก์มาจาก `APP_WEB_URL` ของ API เท่านั้น (DTO ไม่มี `redirectTo` โดยตั้งใจ) · การส่งเมลไม่ถูก `await` เพื่อไม่ให้เวลาตอบกลับบอกว่าเส้นทางไหนส่งเมลจริง
    - **`rolesOf()` คืนครบ 3 โหมดให้บัญชี admin** — คนที่ต้องตอบเคสว่า "ผู้ซื้อเห็นหน้านี้เป็นยังไง" ต้องเปิดดูของจริงได้ · **ไม่ได้แตะ `RolesGuard` หรือ ownership ใน service เลย**: หลังร้านยังอ่านจาก `shop.ownerId` เสมอ ผู้ดูแลจึงเห็นแค่ร้านของตัวเอง (seed ให้ `admin.demo` มีร้านตัวอย่างที่ไม่มีสินค้า) ไม่ใช่ทางลัดเข้าไปดูร้านคนอื่น
  - [x] **ปิดความเสี่ยงที่เก็บ refresh token (2026-08-22)** — ผู้ใช้สั่งให้แก้ ความเสี่ยงตัวนี้เคยเขียนไว้เป็น accepted risk ในคอมเมนต์ของ `tokens.ts` (ตอนนี้เป็น [security-design §5 · A-9](security-design.md) ที่ขีดฆ่าแล้ว)
    - **ปัญหา:** ชั้น L2 ทำเรื่องหมุน/เพิกถอน/ตรวจจับการใช้ซ้ำไว้ครบ แต่ทั้งหมดตอบว่า "หลุดแล้วจำกัดความเสียหายยังไง" ไม่มีชั้นไหนกันไม่ให้หลุด · บนเว็บ `localStorage.getItem('anan.refreshToken')` บรรทัดเดียวคือกุญแจบัญชีที่ใช้ได้อีก 7 วันจากเครื่องไหนก็ได้ และการหมุน token ไม่ช่วยเลยเพราะผู้โจมตีหมุนต่อเองได้
    - **เว็บ → httpOnly cookie** (`anan_rt` · `SameSite=Lax` · `Path=/api/v1/auth`) — JavaScript อ่านค่าไม่ได้ · **มือถือ → `expo-secure-store`** (Keychain / EncryptedSharedPreferences) แทน `AsyncStorage` ที่เป็นไฟล์ธรรมดา · **dependency ใหม่ตัวเดียวของรอบนี้** (ไม่ลง `cookie-parser` — เขียน/อ่าน cookie ใบเดียวทำเองได้ใน 8 บรรทัด)
    - **ตัวแยกว่าใครได้ token ลง body คือ header `Origin`** ซึ่งเป็น forbidden header name — JavaScript ตั้งเองหรือลบทิ้งไม่ได้ · ทางที่ดูง่ายกว่า (ให้ client ส่ง `X-Client: native` บอกเอง) **ผิด** เพราะโค้ด XSS ก็ใส่ header นั้นแล้วขอ token ลง body ได้ ทำให้ httpOnly ไร้ความหมาย
    - **หนี้ที่ตามมาคือ CSRF** — cookie ถูกแนบให้เองอัตโนมัติ และ `POST /auth/refresh` โหมด cookie ไม่มีทั้ง body และ header พิเศษ จึงเป็น simple request ที่ไม่มี preflight มากรอง · กันด้วย `SameSite=Lax` + `AllowedOriginGuard` (ชั้นหลังมีไว้เผื่อวันที่ deploy คนละโดเมนแล้วต้องใช้ `SameSite=None`)
    - **ล้างของเก่าด้วย** — ผู้ใช้ที่ล็อกอินค้างไว้ก่อนอัปเดตมี token ตัวจริงนอนอยู่ใน `localStorage`/`AsyncStorage` และใช้ได้จริงจนครบ 7 วัน · ถ้าไม่ลบก็เท่ากับย้ายไป cookie แล้วแต่ทิ้งกุญแจสำรองไว้ที่เดิม
  - [x] **ตั้งค่าเมลจากหน้าจอ + log ระบบ (2026-08-22)** — ผู้ใช้สั่งให้เพิ่ม · คอนโซลผู้ดูแลจาก 4 หน้าเป็น 6 หน้า
    - **`(admin)/settings` — โหมด DEV ของอีเมล**: เปิดแล้วอีเมลทุกฉบับของระบบไปเข้ากล่องเดียวแทนผู้รับจริง พร้อมแถบบอกผู้รับตัวจริงในเนื้อเมลและหัวเรื่อง · แก้ host/port/secure/ผู้ส่งของ SMTP ได้ (ค่าที่เว้นว่าง = ใช้ของ `.env`) แต่ **ชื่อผู้ใช้/รหัสผ่านไม่มีในหน้าจอและไม่มีใน DTO** (กฎข้อ 7)
    - **ด่านอยู่ที่ env ไม่ใช่ที่ role** — เปิดโหมดได้เฉพาะเมื่อ `MAIL_UAT_MODE_AVAILABLE=true` และไม่ใช่ production เพราะเปิดบนระบบจริง = ใครก็กด "ลืมรหัสผ่าน" แทนบัญชีไหนก็ได้แล้วรับลิงก์เอง (account takeover ทั้งระบบ)
    - **`(admin)/logs` — 2 แท็บ**: `audit_logs` (ใครทำอะไร — **ปิดความเสี่ยง A-3 ที่ค้างมาตั้งแต่ Phase 6**) กับ `email_logs` (เมลไปถึงใครจริง ๆ) · อ่านอย่างเดียว ไม่มี endpoint ลบ · 50 แถว/หน้า
    - ความถูกต้องบังคับที่ DB: `mail_settings` มีแถวเดียว (CHECK `id=1`) · เปิดโหมดโดยไม่มีปลายทางไม่ได้ · ธง `email_logs.redirected` โกหกไม่ได้ · ชื่อผู้ส่งขึ้นบรรทัดใหม่ไม่ได้ (SMTP header injection)
  - [ ] **อัปโหลดรูปจากเครื่อง** — ค้างที่ 2 อย่างที่ต้องตัดสินใจ/ให้ค่า: เพิ่ม dependency `expo-image-picker` และเติม `CLOUDINARY_CLOUD_NAME/_API_KEY/_API_SECRET` ใน `anan-api/.env` (ตอนนี้มีบรรทัดแต่ค่าว่าง → API ตอบ 503 อย่างถูกต้อง) · ระหว่างนี้ทุกที่ที่ใส่รูปกรอกลิงก์ https ได้
  - [ ] **ยังไม่ได้ deploy** — ดู §"สถานะการ deploy" ด้านล่าง
  - [ ] ซ้อมตาม [W09](../context/workflows/w09-demo-script.md) เต็มรอบ · รันชุดทดสอบความปลอดภัย §G เก็บผลลงเล่ม
- [x] **Phase 8 — คูปองส่วนลดรายรอบ (รอบแรก)** _(ผู้ใช้สั่งให้เพิ่ม 2026-08-24 · **ทำเสร็จแล้ว 2026-08-24**)_
  - สเปก: [feature 18](../context/planing/18-coupons.md) · [W13](../context/workflows/w13-coupon.md) — ของเดิมอยู่ใน Out of scope ของ [feature 05](../context/planing/05-subscribe-checkout.md)
  - **โมเดลที่เลือก: คูปอง "ต่อรอบ" แบบผู้ซื้อเลือกใช้ก่อนวันตัดเงิน** ไม่ใช่คูปองที่ผูกตอน checkout แล้วลดอัตโนมัติ N รอบ
    - **ทำไม** — รอบที่ 2 เป็นต้นไป engine เป็นคนสร้างออเดอร์ตอนตี 1 โดยผู้ซื้อไม่อยู่ คูปองจึงต้องถูก *จอง* ไว้กับรอบใดรอบหนึ่งล่วงหน้า แล้ว engine เป็นคนใช้จริง · หน้าต่างจองคือช่วงเดียวกับที่กด "ข้ามรอบ" ได้ (ถึงสิ้นวันก่อน `next_order_date`) จึงเป็น **action ที่ 8 ของ [W05](../context/workflows/w05-manage-subscription.md)** ไม่ใช่ระบบใหม่ทั้งก้อน
    - **เขียนลงเล่มได้ว่าเป็นกลไกที่มีได้เฉพาะในระบบ recurring** — e-commerce ไม่มี "รอบหน้า" ให้ผู้ซื้อวางแผนล่วงหน้า
  - **3 ชั้นของ actor ตอบคำถามว่าใครรับภาระส่วนลด**: admin ออกคูปอง (แคมเปญแพลตฟอร์ม) → ร้านติ๊กสินค้าเข้าร่วมเอง (**สมัครใจ = ร้านรับภาระ**) → ผู้ซื้อจองกับรอบ · แบบนี้ไม่ต้องมีโมเดลส่วนแบ่งรายได้/ค่าคอมมิชชันซึ่งระบบยังไม่มี
  - [x] DB: 3 ตารางใหม่ (`coupons` · `coupon_products` · `coupon_redemptions`) + `orders.discount_amount`/`coupon_redemption_id` + 2 enum ใหม่ + partial unique 2 ตัวที่เป็นหัวใจ (1 รอบ 1 ใบ · 1 คน 1 ครั้งต่อคูปอง)
  - [x] API: 10 endpoint (admin 4 · seller 2 · buyer 3 · catalog 1) — **`POST /subscriptions` เพิ่มได้แค่ `couponId?` ห้ามรับยอดเงินจาก client เด็ดขาด**
  - [x] Engine: หักส่วนลดตอนสร้างออเดอร์ + mark `consumed` ใน tx เดียวกัน · **แจ้งเตือน T-3 ต้องบอกว่ารอบนี้มีคูปองใช้ได้** (ถ้าไม่ทำข้อนี้ ไม่มีใครรู้ว่ามีคูปอง)
  - [x] UI: หน้า `(admin)/coupons` (หน้าที่ 7 ของคอนโซล) · ส่วน "คูปองที่ร่วมรายการ" ในหน้าแก้สินค้า · ปุ่ม + modal ในหน้าของฉัน · แถวเลือกคูปองใน checkout
  - [x] Test: **81 เคสใหม่** — unit 15 · e2e API 46 (2 suite ใหม่) · DB invariant 10 · **Playwright TC-106 … TC-115** · ชุดรวมเป็น unit 79 + e2e API 367 (17 suites) + L4 115 (15 specs) เขียวทั้งหมด
  - [x] เดินจริงบนเว็บครบทั้ง 4 หน้าจอ (admin ออกคูปอง → ร้านติ๊กเข้าร่วม → ผู้ซื้อจองกับรอบ → engine ตัดเงินยอดหลังลด → ใบเสร็จ) และไล่ [security-rules.md](security-rules.md) ก่อนปิดงาน
- [x] **Phase 8.1 — คูปองระดับร้านค้า + ซ้อน 2 ระดับ** _(ผู้ใช้สั่งต่อ 2026-08-24 · **ทำเสร็จแล้ว 2026-08-24**)_
  - **ร้านออกโค้ดของตัวเองได้ แยกคนละใบกับโค้ดของแพลตฟอร์ม และใช้ซ้อนกันได้ 1+1 ต่อรอบ** (โมเดลเดียวกับ Shopee) — `coupons.tier` = `platform` | `shop`
    - **ทำไมต้องแยก tier ไม่ใช่แค่ใส่ `shop_id`** — เพดาน "ซ้อนได้ไม่เกิน 2 ใบ" ต้องเป็นโครงสร้าง ไม่ใช่การนับในโค้ด: `orders` มีช่อง FK ตายตัว 2 ช่อง (`platform_redemption_id` · `shop_redemption_id`) และ partial unique `coupon_one_per_cycle_tier` คุม 1 ใบต่อรอบต่อระดับ → **ยิง API ตรงกี่ครั้งก็ซ้อนใบที่ 3 ไม่ได้** (ดูเหตุผลข้อ 26 ใน [database-schema.md](database-schema.md))
    - **ร้านประกาศแคมเปญกลางไม่ได้** — `tier`/`shopId` ไม่มีใน DTO ของ `POST /seller/coupons` เลย service เขียนเองตายตัวจาก token
  - **สูตรเมื่อซ้อน: คิดจากยอดเต็มทั้งคู่แล้วรวม** (ผู้ใช้เลือก) — ฿255 → แพลตฟอร์ม 20% ฿51 + ร้าน 10% ฿25.50 = ลด ฿76.50 จ่าย ฿178.50 · ถ้ารวมเกินยอด **หนีบที่ใบของร้าน** เพื่อให้ผลรวมสองใบ = `orders.discount_amount` เป๊ะเสมอ (ใบเสร็จบวกลง)
  - **นโยบายอยู่ที่สินค้า ไม่ใช่ที่คูปอง** — `products.coupon_policy` (`both` / `platform_only` / `shop_only` / `none`) ร้านตั้งเองรายชิ้น ตอบโจทย์ "อาจใช้ได้บางสินค้าหรืออย่างใดอย่างหนึ่ง" โดยไม่ต้องถอนสินค้าออกจากแคมเปญทั้งใบ
  - [x] DB: migration `20260824140000_shop_coupons` — **เขียนมือทั้งไฟล์** เพราะ generator เสนอ `DROP COLUMN coupon_redemption_id` + `ADD platform_redemption_id` ซึ่งจะทำให้ส่วนลดของออเดอร์เก่ากำพร้า → ใช้ `RENAME COLUMN`/`RENAME CONSTRAINT` แทน · เพิ่ม enum `coupon_tier`/`coupon_policy` · เปลี่ยน partial unique เป็น `coupon_one_per_cycle_tier` · trigger `guard_order_update` คุมทั้งสองช่อง
  - [x] API: seller ออก/แก้/ปิดคูปองของร้าน (`/seller/coupons`) · `PUT /seller/products/:id/coupons` รับ `couponPolicy` มาด้วยใน tx เดียว · `DELETE /subscriptions/:id/coupon/:tier` · `POST /subscriptions` รับ `couponIds[]` สูงสุด 2 ใบ (ระดับละ 1) · ร้านที่ถูกระงับแก้คูปองไม่ได้
  - [x] UI: หน้า `(seller)/coupons` ใหม่ · sheet ผู้ซื้อแยก 2 ช่องตามระดับ · `ProductCouponPicker` มีแถบนโยบาย + 2 กลุ่ม · checkout เลือกได้ระดับละใบ · ใบเสร็จแจกแจงทีละใบ
  - [x] Test: **59 เคสใหม่** — unit 4 · e2e API 45 (suite ใหม่ `coupon-stacking`) · **Playwright TC-116 … TC-120** · ชุดรวมเป็น unit 83 + e2e API 391 (18 suites) + L4 120 (15 specs) เขียวทั้งหมด
  - [x] เดินจริงบนเว็บ: ร้านออก BEAN10 → ผู้ซื้อจองซ้อนกับ NEWROUND20 → การ์ดขึ้น "รวมลด ฿76.50" → engine ตัดเงิน ฿178.50 พร้อม redemption 2 ใบสถานะ `consumed` → ใบเสร็จแจกแจงถูกทั้งสองบรรทัด · ไล่ [security-rules.md](security-rules.md) แล้วไม่พบประเด็นใหม่
- [x] **Phase 8.2 — ค้นหาร้านค้า + หน้าร้านสาธารณะ (สถิติ)** _(ผู้ใช้สั่งให้เพิ่ม 2026-08-30 · **เสร็จ 2026-08-30**)_
  - สเปก: [feature 02](../context/planing/02-catalog.md) (หน้าค้นหา) · [feature 10](../context/planing/10-seller-shop.md) (สถิติหน้าร้านสาธารณะ) — ของเดิมอยู่ใน Out of scope ของทั้งสองไฟล์
  - **ทำไม** — Catalog (feature 02) มีแค่ค้นหา "สินค้า" อย่างเดียวมาตั้งแต่ Phase 2 ทั้งที่เป็น marketplace หลายร้าน การหาร้านที่เจาะจง (เช่นเคยซื้อจากร้านนี้แล้วอยากดูของอื่น) ต้องไล่ผ่านสินค้าทีละชิ้นเท่านั้น — เพิ่มช่องทางค้นร้านตรง ๆ + ทำให้หน้าร้านสาธารณะ (มีอยู่แล้วตั้งแต่ Phase 7) น่าเชื่อถือขึ้นด้วยตัวเลขสถิติ
  - **ช่องค้นหาอยู่แค่หน้าแรก (hero) + หน้า `/search` เอง** ไม่แตะ topbar ของคอนโซล · ค้นชื่อร้านแล้วกริดสินค้าโชว์ของร้านนั้นด้วย (`GET /catalog/products?q=` ขยายเป็น match ชื่อสินค้า OR ชื่อร้าน — ร้านที่ถูกระงับยังถูก AND กรองไว้เหมือนเดิม)
  - **"ผู้ติดตาม"/อัตราตอบแชท/ป้าย Mall แบบ Shopee → ไม่ทำ ใช้ `activeSubscribers` แทน** (aggregate ล้วน ไม่หลุดข้อมูลรายคน) เพราะระบบนี้ไม่มี follow/chat/merchant-tier เลย — เหตุผลเต็มอยู่ที่ [02-catalog.md](../context/planing/02-catalog.md)
  - [x] DB/API: `GET /catalog/shops?q=&limit=` (endpoint ใหม่) คืน `ShopCardResponse[]` แบบ aggregate · `GET /catalog/shops/:id` เพิ่ม 4 ฟิลด์ (`productCount`/`activeSubscribers`/`rating`/`reviewCount`) · `GET /catalog/products?q=` match ชื่อร้านด้วย
  - [x] UI: หน้า `app/search.tsx` ใหม่ (แถบ "ร้านค้าที่เกี่ยวข้อง" + sort chips ส่งค่าไป API + กริดสินค้า) · component ใหม่ `SearchBar`/`ShopCard` · หน้าร้านสาธารณะ (`shop/[id].tsx`, มีอยู่แล้วจาก Phase 7) เพิ่มแถบสถิติ 4 ตัว
  - [x] Test: L2 `catalog.e2e-spec.ts` 22 เคส (รวม regression guard: ระงับร้าน/ปิดร้านเอง + ค้นด้วยชื่อร้าน → สินค้าต้องไม่หลุดทาง `where.OR`) · Playwright TC-121 (P0) / TC-122 (P2) / TC-123 (P1) — **วัดจริง 2026-08-30: unit 83 · L2+L3 402 · L4 123 เขียวทั้งหมด** ดู [testing.md §5](testing.md)
  - [x] ไม่ทำรอบนี้ (ตามสเปก) — filter sidebar (ช่วงราคา/ส่งจาก), คูปองร้านบนหน้าร้าน, ปุ่มติดตาม/พูดคุย, index `pg_trgm` สำหรับ ILIKE (ข้อมูลระดับ demo ยังไม่จำเป็น)
  - [x] ไล่ [security-rules.md](security-rules.md) ก่อนปิดงาน (endpoint ใหม่ที่เป็น public)

## สถานะการ deploy (ณ 2026-08-19)

**ยังไม่ได้ deploy ที่ไหนทั้งสิ้น** — ทั้งระบบรันบนเครื่องพัฒนาเท่านั้น:

| ส่วน | สถานะ | รันยังไง |
|---|---|---|
| API (NestJS) | ยังไม่ deploy | `cd anan-api && npm run start:dev` → `http://localhost:3000/api/v1` |
| Web (Expo) | ยังไม่ deploy | `cd anan && npm run web` → `http://localhost:8081` |
| ฐานข้อมูล | PostgreSQL 17 บนเครื่อง (ไม่ใช่ cloud) | service `postgresql-x64-17` · ไม่มี backup/monitoring |
| APK (Android) | ยังไม่ build | ต้องใช้ EAS Build หรือ local build |

**สิ่งที่ต้องมีก่อน deploy จริง** (เขียนไว้เพื่อไม่ให้ลืมตอนกลับมาทำ):

1. **ความลับชุดใหม่** — `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` ของ production ต้องสุ่มใหม่ ห้ามใช้ค่าเดียวกับ dev ([security-rules G-5](security-rules.md))
2. **DATABASE_URL ของ production** + ตัดสินใจว่าโฮสต์ DB ที่ไหน (ยังไม่ได้เลือก) · role `anan_app` ต้องไม่ใช่ superuser
3. **`EXPO_PUBLIC_API_URL`** ของ web/APK ต้องชี้ไปโดเมนจริง ไม่ใช่ `localhost` — และ CORS ของ API ต้องอนุญาตโดเมนนั้น (`configureApp({ corsOrigins })`)
4. **`DEMO_MODE`** — ถ้าเปิดไว้ time-travel ของ engine จะใช้ได้ · สำหรับเดโม่ให้กรรมการลองควรเปิด แต่ต้องรู้ตัวว่าเปิดอยู่
5. **cron ของ engine** — บนเครื่องเดียวเท่านั้น (ถ้ารันหลาย instance จะชนกัน · idempotency กันออเดอร์ซ้ำได้ แต่ notification อาจซ้ำ)
6. รัน `npx prisma migrate deploy` (ไม่ใช่ `migrate dev`) แล้ว seed เฉพาะครั้งแรก

## Metric ที่ควรพูดถึงในเล่ม

- **Churn rate** — metric หลักของ subscription commerce (จาก `subscription_events`)
- **MRR** ฝั่งร้านค้า (normalize 2w×2 / 1m×1 / 2m×0.5)
- ความต่างจาก e-commerce ปกติ: ความสัมพันธ์ระยะยาว ไม่ใช่ transaction ครั้งเดียว
- **คุณภาพการส่งมอบ:** อัตรายกเลิกออเดอร์ต่อร้าน · อัตราเคสปัญหา · **อัตราที่ผู้ซื้อยืนยันรับของเอง** (ต่างจาก `delivered` ที่ร้านกดเอง) · ความสัมพันธ์ **คะแนนรีวิว × churn**
- **ผลทดสอบ authorization** — ยิง API ตรงข้าม UI ด้วย token ผิดคน/ผิด role แล้วถูกปฏิเสธที่ guard ชั้นไหน พร้อมหลักฐาน (ไม่ใช่คำอธิบาย)
- **Idempotency ของ engine** — รันซ้ำ 3 ครั้งวันเดียวกัน ออเดอร์ไม่ซ้ำ พิสูจน์ด้วย automated test
- **ประสิทธิผลของคูปองรายรอบ** _(Phase 8)_ — อัตราที่ผู้ซื้อกลับมาจองคูปองซ้ำในรอบถัดไป · churn ของคนที่เคยใช้คูปอง เทียบกับคนที่ไม่เคยใช้ · สัดส่วน `released` ต่อ `consumed` (คนจองแล้วเปลี่ยนใจ) — ข้อมูลอยู่ครบใน `coupon_redemptions` + `subscription_events`
