# ANAN — Architecture (NestJS + PostgreSQL)

> อัปเดต: 2026-08-15 · แทนสถาปัตยกรรม Supabase เดิมทั้งหมด
> คู่กับ: [project-plan.md](project-plan.md) · [security-design.md](security-design.md) · [database-schema.md](database-schema.md)

---

## 1. ภาพรวม

```
┌──────────────────────────────────────────────────────────┐
│  Expo app (React Native + Web)                           │
│  src/lib/api/           ← HTTP client + token storage    │
│  src/features/*/api.ts  ← เรียก endpoint ของ feature นั้น  │
└───────────────────────┬──────────────────────────────────┘
                        │ HTTPS + JSON
                        │ Authorization: Bearer <access>
                        ▼
┌──────────────────────────────────────────────────────────┐
│  NestJS API (anan-api)                                   │
│                                                          │
│  main.ts        helmet · CORS · ValidationPipe · prefix  │
│      ↓                                                   │
│  Guard          JwtAuthGuard → RolesGuard                │
│      ↓                                                   │
│  Controller     รับ HTTP + แปลง DTO เท่านั้น (ห้ามมี logic) │
│      ↓                                                   │
│  Service        business logic + ownership + transaction │
│      ↓                                                   │
│  PrismaService  data access ที่เดียวของทั้งระบบ            │
│                                                          │
│  EngineService  @Cron รายวัน 01:00 Asia/Bangkok          │
└───────────────────────┬──────────────────────────────────┘
                        │ Prisma Client
                        ▼
              [PostgreSQL 17 · localhost:5432]
              CHECK · FK · UNIQUE · index

              [Cloudinary] ← รูปสินค้า / โลโก้ร้าน
```

**กฎเหล็กของชั้น:** client ไม่รู้จัก SQL · controller ไม่รู้จัก Prisma · service ไม่รู้จัก HTTP

---

## 2. โครงสร้างโปรเจกต์

```
c:\Thesis\
├── anan-api\                    # NestJS backend (ใหม่)
│   ├── prisma\
│   │   ├── schema.prisma        # 15 models — source of truth ของ schema
│   │   ├── migrations\          # generate ด้วย `prisma migrate dev`
│   │   └── seed.ts              # ข้อมูลเดโม่ (แปลงจาก seed.sql เดิม)
│   ├── src\
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── common\              # ใช้ข้ามทุก module
│   │   │   ├── guards\          # JwtAuthGuard, RolesGuard
│   │   │   ├── decorators\      # @CurrentUser() @Roles() @Public()
│   │   │   ├── filters\         # exception → รูปแบบ error เดียวกันทั้งระบบ
│   │   │   └── dto\             # pagination ฯลฯ
│   │   ├── prisma\              # PrismaService (onModuleInit / $transaction)
│   │   ├── config\              # env validation (zod / joi)
│   │   ├── auth\                # register/login/refresh/logout + strategies
│   │   ├── users\               # profile
│   │   ├── addresses\
│   │   ├── payment-methods\     # บัตรจำลอง — เก็บ last4 เท่านั้น
│   │   ├── catalog\             # categories, products, plans, reviews (public)
│   │   ├── subscriptions\       # สมัคร + 7 actions ของ W05
│   │   ├── orders\              # ประวัติ + ยืนยันรับของ + แจ้งปัญหา + จ่ายซ้ำ
│   │   ├── payments\            # PaymentProvider + DemoPaymentProvider (จำลองล้วน)
│   │   ├── admin\               # stats · หมวดสินค้า · moderation (ระงับ/คืนสถานะ)
│   │   ├── notifications\       # อ่าน + ทำเครื่องหมายว่าอ่าน (ไม่มีทางสร้างเอง)
│   │   ├── seller\              # ร้าน สินค้า ออเดอร์ forecast dashboard
│   │   ├── admin\               # stats, moderation, engine control
│   │   ├── engine\              # recurring engine (cron + service)
│   │   └── uploads\             # Cloudinary signed upload
│   └── test\                    # e2e (supertest) — ที่มาแทน pgTAP
│
├── anan\                        # Expo app (เดิม — เปลี่ยนแค่ data layer)
│   └── src\lib\api\             # แทนที่ src/lib/supabase.ts
│
├── context\planing\             # 17 feature specs — ใช้ต่อ แก้เฉพาะส่วน queries
├── context\workflows\           # 12 workflows — ใช้ต่อได้ทั้งหมด
└── docs\
```

---

## 3. ข้อตกลงของ API

### รูปแบบ URL
```
/api/v1/auth/register        POST
/api/v1/auth/login           POST
/api/v1/auth/refresh         POST
/api/v1/auth/forgot-password POST                    (public · 204 เสมอ · 3 ครั้ง/5 นาที/IP)
/api/v1/auth/reset-password  POST                    (public · 204 · เพิกถอนทุก session ของบัญชีนั้น)
/api/v1/me                   GET  PATCH
/api/v1/me/addresses         GET  POST
/api/v1/me/addresses/:id     PATCH DELETE
/api/v1/catalog/categories   GET                     (public)
/api/v1/catalog/products     GET  ?category=&q=&sort= (public)
/api/v1/catalog/products/:id GET                     (public)
/api/v1/catalog/shops/:id    GET                     (public · หน้าร้าน — ร้านที่ถูกระงับตอบ 404)
/api/v1/subscriptions        GET  POST
/api/v1/subscriptions/:id    GET
/api/v1/subscriptions/:id/skip|pause|resume|reschedule|plan|address|cancel   POST
/api/v1/subscriptions/:id/review   GET POST   (POST = เขียนหรือแก้ก็เส้นเดียวกัน)
/api/v1/orders               GET  ?tab=open|done
/api/v1/orders/:id           GET
/api/v1/orders/:id/confirm   POST             (★ จุดเดียวที่เขียน confirmed_at ได้)
/api/v1/orders/:id/issues    POST             (1 ออเดอร์ = 1 เคส · UNIQUE ที่ DB)
/api/v1/orders/:id/retry-payment   POST       (จ่ายรอบที่ถูกปฏิเสธอีกครั้ง · ไม่มี body)
/api/v1/notifications        GET  ?filter=all|unread   (คืน items + unreadCount ในคำขอเดียว)
/api/v1/notifications/read   POST             (อ่านทั้งหมด)
/api/v1/notifications/:id/read     POST       (idempotent — ไม่เขียนทับเวลาที่อ่านครั้งแรก)
/api/v1/seller/shop          POST GET PATCH   (POST ไม่ต้องมี role — เปิดร้านครั้งแรก)
/api/v1/seller/dashboard     GET              (ต้อง role seller · aggregate ล้วน)
/api/v1/seller/products      GET POST
/api/v1/seller/products/:id  GET PATCH
/api/v1/seller/products/:id/plans  POST
/api/v1/seller/plans/:id     PATCH            (ขึ้นราคา = แจ้งสมาชิกทุกคนในทรานแซกชันเดียว)
/api/v1/seller/orders        GET ?tab=open|shipped|history
/api/v1/seller/orders/:id    GET
/api/v1/seller/orders/:id/advance  POST       (server เป็นคนบอกขั้นถัดไป)
/api/v1/seller/orders/:id/cancel   POST       (ยกเลิก + คืนเงินจำลอง ในทรานแซกชันเดียว)
/api/v1/seller/issues        GET ?status=open|closed
/api/v1/seller/issues/:id/resolve  POST       (resolved|rejected + note · เป็นสถานะสุดท้าย)
/api/v1/seller/forecast      GET ?days=7|14|30
/api/v1/uploads/signature    POST             (ต้อง role seller · ลายเซ็น Cloudinary)
/api/v1/admin/stats          GET              (aggregate ล้วน — ไม่มีแถวของผู้ใช้)
/api/v1/admin/categories     GET POST
/api/v1/admin/categories/:id PATCH DELETE      (ลบหมวดที่มีสินค้าถูก FK บล็อก → 409)
/api/v1/admin/shops          GET ?q=&filter=   (+ สัญญาณคุณภาพต่อร้าน)
/api/v1/admin/products       GET ?q=
/api/v1/admin/shops/:id/suspension     POST    (ระงับ = แช่แข็ง subscription ในทรานแซกชันเดียว)
/api/v1/admin/products/:id/suspension  POST
/api/v1/admin/issues         GET ?status=open|closed
/api/v1/admin/engine/run     POST  (admin · runDate จำลองได้เฉพาะ DEMO_MODE)
/api/v1/admin/engine/runs    GET   (admin)
/api/v1/admin/mail-settings  GET  PUT              (ตั้งค่าเมล · เปิดโหมด DEV ได้เฉพาะเมื่อ env อนุญาต)
/api/v1/admin/logs/audit     GET  ?page=&action=   (log การกระทำ — ไม่มี DELETE)
/api/v1/admin/logs/email     GET  ?page=&status=   (log อีเมลขาออก — ไม่มี DELETE)
                             ↑ ทุกเส้นใต้ /admin ต้อง role admin (@Roles ที่ระดับ controller)
```

### รูปแบบ error เดียวทั้งระบบ
ทุก error ผ่าน exception filter ตัวเดียว → client แสดงข้อความไทยได้โดยไม่เห็น stack:

```json
{ "statusCode": 409, "code": "PLAN_CLOSED", "message": "แผนนี้เพิ่งปิดรับสมาชิกใหม่" }
```

`code` เป็นค่าคงที่สำหรับให้ client แตกเคส · `message` เป็นภาษาไทยพร้อมแสดงผล

### สถานะที่ใช้
`200` สำเร็จ · `201` สร้างแล้ว · `400` DTO ไม่ผ่าน · `401` ไม่มี/หมดอายุ token · `403` ไม่ใช่เจ้าของ/ผิด role · `404` ไม่พบ · `409` ขัดกับสถานะปัจจุบัน (เช่น ยกเลิกไปแล้ว) · `422` ผิดกฎธุรกิจ

---

## 4. Business logic ย้ายมาอยู่ที่ไหน

| เดิม (Postgres) | ใหม่ (NestJS) |
|---|---|
| RPC `subscribe_to_plan` | `SubscriptionsService.create()` ใน `prisma.$transaction` |
| RPC 7 actions ของ W05 | `SubscriptionsService.skip/pause/resume/reschedule/changePlan/changeAddress/cancel` |
| `run_recurring_engine()` + pg_cron | `EngineService.run(runDate)` + `@Cron('0 1 * * *', { timeZone: 'Asia/Bangkok' })` |
| trigger `guard_order_update` | `OrdersService` ตรวจลำดับสถานะก่อน update |
| trigger `notify_*` | service เรียก `NotificationsService.push()` ในทรานแซกชันเดียวกัน |
| trigger `sync_is_seller` | `ShopsService.create()` อัปเดต role พร้อมกัน |
| `enforce_single_default_address` | `AddressesService.setDefault()` ใน transaction |
| view `shop_dashboard` / `shop_forecast` | `$queryRaw` ใน `SellerService` (aggregate SQL เดิมยกมาได้) |
| RLS policies | guard + ownership check ใน service |
| CHECK / FK / UNIQUE | **คงไว้ใน Postgres เหมือนเดิม** — ด่านสุดท้าย |

> **หลักการ:** สิ่งที่เป็น *ความถูกต้องของข้อมูล* อยู่ใน DB · สิ่งที่เป็น *กฎธุรกิจ* อยู่ใน service

---

## 5. Transaction

ทุก flow ที่เขียนหลายตารางต้องอยู่ใน `prisma.$transaction` เดียว มิฉะนั้นข้อมูลจะขาดครึ่ง:

| Flow | ตารางที่แตะพร้อมกัน |
|---|---|
| สมัคร subscription | `subscriptions` + `orders` + `payments` + `subscription_events` + `notifications` |
| ทุก action ของ W05 | `subscriptions` + `subscription_events` (+ `notifications` เมื่อ cancel) |
| ร้านยกเลิกออเดอร์ | `orders` + `payments`(refund) + `subscription_events` + `notifications` |
| ผู้ซื้อแจ้งปัญหาออเดอร์ | `order_issues` + `notifications`(ถึงเจ้าของร้าน) |
| ร้านปิดเคสปัญหา | `order_issues` + `notifications`(ถึงผู้ซื้อ) |
| เขียน/แก้รีวิว | `reviews` + `subscription_events` |
| จ่ายเงินซ้ำหลังบัตรถูกปฏิเสธ | `payments` + `notifications`(ถึงร้าน — เพิ่งเห็นออเดอร์ตอนนี้) |
| engine ต่อ 1 subscription | `orders` + `payments` + `subscriptions.next_order_date` + `notifications` |
| admin ระงับร้าน/สินค้า | `shops` หรือ `products` + `subscriptions`(freeze) + `subscription_events` + `notifications` |
| admin คืนสถานะ | เหมือนข้างบน แต่ปลุก subscription กลับ + เลื่อน `next_order_date` ให้ไม่ย้อนหลัง |

---

## 6. Recurring engine

```ts
@Cron('0 1 * * *', { timeZone: 'Asia/Bangkok' })
async daily() { await this.run(todayInBangkok()); }
```

ลำดับงาน (เหมือนเดิมทุกข้อ — ดู [W06](../context/workflows/w06-recurring-cycle.md)):
1. แจ้งล่วงหน้า T-3
2. หา subscription ที่ `status = active` และ `next_order_date <= runDate` **และร้าน/สินค้าไม่ถูกระงับ**
3. ต่อรายการ: สร้าง order (ชน unique `subscription_id + cycle_date` = ข้าม) + payment + เลื่อน `next_order_date` + แจ้งเตือน
4. ปิดออเดอร์ `shipped` ที่เกิน 7 วันเป็น `delivered`
5. สรุปให้ร้าน + บันทึก `engine_runs`

**Idempotency มาจาก unique constraint ที่ DB** ไม่ใช่จากการเช็คใน service — รันซ้ำกี่ครั้งก็ได้ผลเดียว

---

## 7. Auth

| เรื่อง | ค่าที่ใช้ |
|---|---|
| Access token | JWT อายุ **15 นาที** — เก็บใน memory ฝั่ง client |
| Refresh token | อายุ **7 วัน**, rotate ทุกครั้งที่ใช้, เก็บ hash ไว้ใน DB (เพิกถอนได้) |
| Password | bcrypt cost 12 · ขั้นต่ำ 10 ตัวอักษร |
| Role | `is_seller` / `is_admin` บน `users` → `RolesGuard` |
| เก็บ token บนแอป | `expo-secure-store` (native) · `localStorage` (web) |

---

## 8. สิ่งที่ยกมาจากของเดิมได้ทั้งหมด

- **Schema** — 15 ตาราง, CHECK ทุกข้อ, FK, index, unique constraints
- **Business rules** — state machine ของ subscription, cycle math, การแช่แข็งเมื่อร้านถูกระงับ, การแจ้งเตือนเมื่อขึ้นราคา
- **Feature specs 17 ไฟล์ + workflows 12 ไฟล์** — แก้เฉพาะหัวข้อ "Data & Queries"
- **Design system + theme.ts + ทุก component + ทุกหน้าจอ**
- **บทเรียนด้านความปลอดภัย** — เปลี่ยนรูปจาก RLS เป็น guard แต่เจตนาเดิม (ดู [security-design.md](security-design.md))
