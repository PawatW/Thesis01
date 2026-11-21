# ANAN — Multi-Vendor Subscription Commerce Platform (Thesis)

Marketplace สินค้าจริงแบบ subscription ("Shopee แบบ recurring") — ผู้ซื้อสมัครรับสินค้าใช้ประจำเป็นรอบอัตโนมัติ (2 สัปดาห์ / เดือน / 2 เดือน) จากหลายร้านในแพลตฟอร์มเดียว เป้าหมายคือ prototype ที่ใช้งานได้จริงทั้ง mobile + web สำหรับ thesis (B.Sc. CS, Kasetsart University)

## เอกสารที่ต้องอ่านก่อนทำงาน

| เอกสาร | ใช้เมื่อไหร่ |
|---|---|
| **[docs/working-agreement.md](docs/working-agreement.md)** | **★ อ่านก่อนทุกเซสชันใหม่ ★ — ตอนนี้ทำถึงไหน, ลำดับการทำงาน 1 feature, คำสั่งที่ใช้จริง, กับดักของเครื่องนี้, Phase ถัดไปเริ่มยังไง** |
| [docs/project-plan.md](docs/project-plan.md) | ภาพรวม, stack, roadmap 8 phases — อ่านก่อนเริ่มงานทุกครั้ง |
| [docs/architecture.md](docs/architecture.md) | **โครงสร้าง API, ชั้นของโค้ด, ข้อตกลง endpoint, transaction, engine** — อ่านก่อนเขียนโค้ด backend |
| [context/planing/README.md](context/planing/README.md) | สารบัญ 17 features |
| `context/planing/XX-*.md` | **สเปกราย feature — อ่านไฟล์ของ feature นั้นก่อนลงมือเขียนโค้ดเสมอ** (หัวข้อ "Data & Queries" เป็น endpoint จริงทั้งหมดแล้ว) |
| `context/workflows/wXX-*.md` | **Use case workflows (W01-W12)** — ลำดับขั้นตอน + การเขียนข้อมูลของแต่ละ flow; state machine ของ subscription อยู่ W05, engine logic อยู่ W06 |
| [docs/database-schema.md](docs/database-schema.md) | ER + เหตุผลการออกแบบ DB — schema จริงอยู่ `anan-api/prisma/schema.prisma` |
| [docs/security-design.md](docs/security-design.md) | **Threat model + ชั้นป้องกัน 5 ชั้นของ API** — อ่านก่อนแตะ auth / payment / upload |
| [docs/security-rules.md](docs/security-rules.md) | **Checklist ความปลอดภัยที่ต้องไล่ทุกครั้งก่อนปิดงาน** (`/sec-check`) |
| [docs/testing.md](docs/testing.md) | **กฎการทดสอบ + สารบัญ test** — feature ใหม่ต้องเพิ่ม test ที่ไฟล์ไหนบ้าง (4 ชั้น: unit · e2e API · DB invariant · Playwright) |
| [e2e/README.md](e2e/README.md) | **Playwright ชั้น L4** — วิธีรัน, ด่านกันยิงใส่ DB งานจริง, กติกาการเขียนเคส |
| [docs/design-system.md](docs/design-system.md) | Design token + การแปลงจาก mockup — token จริงอยู่ `anan/src/lib/theme.ts` |
| [docs/future-ideas/](docs/future-ideas/) | ไอเดียที่พักไว้ — อย่าหยิบมาทำเองโดยไม่ถูกสั่ง |

## Tech Stack (ห้ามเปลี่ยนโดยไม่ถามผู้ใช้)

- **Frontend:** Expo (React Native + TypeScript) + expo-router — โค้ดชุดเดียว build Android/iOS/Web
- **Backend:** **NestJS + Prisma** — API ของเราเอง client ไม่แตะ DB ตรง
- **Database:** **PostgreSQL 17 ติดตั้งบนเครื่อง** (จัดการผ่าน pgAdmin, ไม่ใช้ Docker/cloud)
- **Storage:** Cloudinary (รูปสินค้า/โลโก้ร้าน)
- **Payment:** demo จำลองเท่านั้น (ดูกฎข้อ 1)

> เปลี่ยนจาก Supabase มาเมื่อ 2026-08-15 · **ลบของ Supabase ออกจากโปรเจกต์หมดแล้ว 2026-08-19** — เหตุผลอยู่ใน [project-plan.md](docs/project-plan.md) และ SQL ชุดเดิมเก็บไว้อ้างอิงในเล่มที่ [docs/archive/supabase-sql/](docs/archive/supabase-sql/)

## โครงสร้างโปรเจกต์

```
c:\Thesis\
├── CLAUDE.md               # ไฟล์นี้
├── docs\                   # เอกสาร thesis
├── context\planing\        # สเปกราย feature (01-17)
├── context\workflows\      # use case W01-W12
│
├── anan-api\               # NestJS backend
│   ├── prisma\
│   │   ├── schema.prisma   # ★ source of truth ของ schema — แก้ที่นี่เท่านั้น
│   │   ├── migrations\     # generate ด้วย prisma migrate dev
│   │   └── seed.ts         # ข้อมูลเดโม่
│   ├── src\
│   │   ├── common\         # guards, decorators, filters, pipes (ใช้ข้าม module)
│   │   ├── prisma\         # PrismaService
│   │   ├── auth\  users\  addresses\  payment-methods\
│   │   ├── catalog\  subscriptions\  orders\  notifications\
│   │   ├── payments\        # PaymentProvider (จำลอง) — ทุกการตัดเงินผ่านที่นี่
│   │   ├── seller\  admin\  engine\  uploads\
│   │   └── main.ts
│   └── test\               # e2e (supertest)
│
└── anan\                   # Expo app
    ├── app\                # expo-router routes เท่านั้น — ไฟล์ route บาง แค่ประกอบ component
    │   ├── (auth)\         # login, register
    │   ├── (buyer)\        # แท็บผู้ซื้อ: home, subscriptions, orders, notifications, profile
    │   ├── (seller)\       # โหมดร้านค้า (Phase 4)
    │   ├── (admin)\        # admin web-first (sidebar)
    │   └── product\ category\ shop\ checkout\ compare.tsx   # หน้าที่ push ทับ ไม่ใช่แท็บ
    ├── src\
    │   ├── components\     # UI component กลาง
    │   ├── features\       # โค้ดหลักแยกตาม feature — ชื่อโฟลเดอร์ตรงกับ context\planing
    │   ├── lib\            # api client, theme, date, utils
    │   └── types\          # types ที่แชร์กับ API
    └── assets\
```

## กฎของโปรเจกต์

### 1. Payment = demo เท่านั้น (กฎเหล็ก)
- **ห้ามเชื่อม payment gateway จริงทุกกรณี** (Stripe/Opn/2C2P/PromptPay) แม้จะเป็น test mode ของ gateway ก็ห้าม — ใช้ระบบจำลองใน `src/features/payment` เท่านั้น
- โค้ด payment ต้องผ่าน interface `PaymentProvider` เสมอ (ปัจจุบันมีแค่ `DemoPaymentProvider`)
- ห้ามเก็บเลขบัตรเต็มหรือ CVV แม้เป็นเลขปลอม — เก็บได้แค่ **เครือข่ายบัตร · 4 ตัวท้าย · เดือน/ปีหมดอายุ · ชื่อบนบัตร** (ชุดเดียวกับที่ผู้ให้บริการจริงเก็บหลัง tokenization)
- UI ทุกจุดที่เกี่ยวกับ**ยอดเงิน**ต้องมีป้าย "DEMO — ไม่มีการตัดเงินจริง"
- **ยกเว้นหน้าจอผูกบัตร** (หน้า "บัตรของฉัน" + ฟอร์มผูกบัตรในหน้าจ่ายเงิน) — ตั้งใจให้ทำงานเหมือนฟอร์มบัตรจริง
  ทุกอย่าง (Luhn · อ่านเครือข่ายจาก BIN · วันหมดอายุ · CVV) และ**ไม่มีคำว่า "จำลอง/สมมติ" ในหน้านั้น**
  เพราะสิ่งที่ถูกบันทึกกับด่านที่ผ่านเป็นของจริงทั้งหมด มีแค่ "การตัดเงิน" เท่านั้นที่จำลอง
  (ตัดสินใจ 2026-08-20 · ดู [context/planing/09-payment-demo.md](context/planing/09-payment-demo.md))

### 2. ยึดสเปก อย่าให้ scope บาน
- ทำตาม `context/planing/XX-*.md` ของ feature นั้น — สิ่งที่อยู่ใน **Out of scope** ห้ามทำเองโดยไม่ถามผู้ใช้ก่อน
- ตัดสินใจอะไรที่กระทบ scope/stack/data model → อัปเดต docs/project-plan.md และไฟล์ feature ที่เกี่ยวข้องใน session เดียวกัน

### 3. Cross-platform ต้องครบ
- ทุกหน้าต้องใช้ได้ทั้ง **mobile และ web** — ห้ามใช้ API เฉพาะ platform โดยไม่มี fallback (ตรวจด้วย `Platform.OS` ให้ครบ)
- ก่อนปิดงาน UI: เปิดดูอย่างน้อยบน web (`npx expo start --web`) เสมอ

### 4. Database
- **แก้ schema ที่ `anan-api/prisma/schema.prisma` เท่านั้น** แล้ว `npx prisma migrate dev` — ห้ามแก้ DB ตรงผ่าน pgAdmin โดยไม่มี migration
- ชื่อตาราง/คอลัมน์ใน DB เป็น `snake_case` (ใช้ `@map`/`@@map` ใน Prisma), ชื่อใน TypeScript เป็น camelCase
- **ข้อจำกัดที่เป็นความถูกต้องของข้อมูลต้องอยู่ใน DB** — CHECK, FK, UNIQUE, index ไม่ใช่แค่เช็คใน service
- **Prisma อยู่ใน service layer เท่านั้น** — controller ห้าม import PrismaService, แอป Expo ห้ามรู้จัก schema ของ DB
- ทุก flow ที่เขียนหลายตารางต้องอยู่ใน `prisma.$transaction` เดียว (ดูตารางใน [architecture.md §5](docs/architecture.md))

### 5. Recurring Engine (หัวใจของระบบ)
- ต้อง **idempotent** — รันซ้ำวันเดียวกันห้ามสร้างออเดอร์ซ้ำ (unique: `subscription_id + cycle_date`)
- ใช้เงื่อนไข `next_order_date <= วันนี้` (เก็บตกรอบที่พลาด) ไม่ใช่ `=`
- Timezone เดียว: Asia/Bangkok
- สถานะ subscription มีแค่ `active / paused / cancelled` — cancelled คือถาวร ห้าม resume

### 6. โค้ด
- TypeScript `strict: true` — ห้ามใช้ `any` ถ้าเลี่ยงได้
- Logic อยู่ใน `src/features/<feature>/` — ไฟล์ route ใน `app/` เป็นแค่ตัวประกอบหน้า
- ชื่อไฟล์ component เป็น PascalCase, hooks ขึ้นต้น `use`, ไฟล์ route ตาม convention ของ expo-router
- ข้อความ UI เป็น**ภาษาไทย** (กลุ่มเป้าหมายคนไทย) / ชื่อตัวแปร-comment ในโค้ดเป็นอังกฤษ
- อย่าเพิ่ม dependency ใหม่โดยไม่จำเป็น — ถ้าจะเพิ่ม บอกเหตุผลให้ผู้ใช้รู้ก่อน

### 7. Security (กฎเหล็กข้อ 2 — รายละเอียดใน [docs/security-rules.md](docs/security-rules.md))
ตอนนี้ API ของเราเป็นด่านเดียวที่เข้าถึง DB ได้ → **ทุกกฎต้องบังคับใน API ไม่ใช่ในแอป** เพราะโค้ดฝั่ง Expo ผู้ใช้แก้ได้และยิง endpoint ตรงด้วย curl ได้เสมอ
- **UI ไม่ใช่ security** — ปุ่มที่ซ่อน / route guard ในแอป คือ UX; กฎจริงอยู่ที่ guard + service ของ API
- **เงิน สถานะการจ่าย และสิทธิ์ ห้ามมาจาก client** — ราคาอ่านจาก DB เสมอ, ห้ามรับ `amount`/`price`/`status:'paid'` เป็น field ใน DTO
- **ทุก endpoint ที่แตะข้อมูลของผู้ใช้ต้องเช็ค ownership ใน service** — `WHERE id = :id AND userId = :currentUser` ไม่ใช่แค่ `findUnique(id)`
- **DTO ต้องมี `whitelist: true` + `forbidNonWhitelisted: true`** — field ที่ไม่ได้ประกาศต้องถูกตัดทิ้ง ไม่ใช่ส่งต่อไป Prisma
- **ห้ามส่ง entity ดิบกลับ client** — ต้อง map เป็น response DTO เสมอ (ไม่งั้น `password_hash`, `buyer_id`, `payment_method_id` หลุด)
- **JWT secret / DB URL / Cloudinary secret อยู่ใน `.env` ของ API เท่านั้น** — ห้ามอยู่ในโฟลเดอร์ `anan/` (ทุกอย่างที่ขึ้นต้น `EXPO_PUBLIC_` ถูก inline เข้า bundle)
- **ร้านค้าเห็นข้อมูลผู้ซื้อเท่าที่ต้องส่งของ** — forecast/dashboard เป็น aggregate เสมอ
- ทุกฟิลด์ที่ client ป้อนต้องมีทั้ง validator ใน DTO **และ** CHECK ใน DB

### 8. การตรวจงานก่อนส่ง
- **`cd anan-api && npm run check`** (typecheck + lint + test) และ **`cd anan && npm run typecheck`** ต้องผ่าน
- Feature ที่มี flow (checkout, pause/skip) ต้องไล่กดจริงบน web อย่างน้อย 1 รอบ
- **แตะ auth / payment / upload / endpoint ใหม่ เมื่อไหร่ → ไล่ [security-rules.md](docs/security-rules.md) (สั่ง `/sec-check`) ก่อนปิดงานเสมอ**
- **endpoint ใหม่ต้องมี e2e test อย่างน้อย 3 เคส**: สำเร็จ · ไม่ใช่เจ้าของ (403) · สถานะผิด (409) — ตามตารางใน [testing.md §3](docs/testing.md) มิฉะนั้นถือว่ายังไม่เสร็จ
- **Playwright (ชั้น L4) บังคับเฉพาะ flow ที่แตะเงินหรือเปลี่ยนสถานะ** (สมัคร/จ่าย/คูปอง/pause/cancel/ยืนยันรับของ ฯลฯ) — อย่างน้อย 1 เคสเส้นทางสำเร็จ **ที่ยืนยันผลใน DB** ไม่ใช่แค่ตัวเลขบนจอ · หน้าจออื่นไม่บังคับ ([testing.md §3.1](docs/testing.md))
  - **อย่าเขียน L4 ซ้ำกับ L2** — validation ของฟอร์ม, 403/404/409, ยิง API ตรงข้าม UI, กัน enumeration พิสูจน์ที่ supertest พอ (ลดลงจาก 131 → 92 เคสเมื่อ 2026-11-21)
  - selector ใช้ `#id` จริงจาก component เท่านั้น (ห้ามจับด้วยข้อความไทยหรือลำดับปุ่ม) — เพิ่ม prop `id` ที่ component ก่อน แล้วลงทะเบียนใน `e2e/helpers/selectors.ts`
  - ทุกเคสห่อด้วย `testCase({ id, priority, feature }, …)` · รหัส TC ห้ามซ้ำแม้เคสเก่าถูกลบไปแล้ว
  - ระหว่างทำงานรันเฉพาะ spec ที่แก้ (`npm run test:e2e -- specs/<feature>.spec.ts`) · **รันทั้งชุดให้เขียว + commit `e2e/reports/report.md`** เมื่อปิด phase หรือแก้ของที่หลาย flow ใช้ร่วม (auth, layout, seed)
- แก้ schema: `npx prisma migrate dev --name <ชื่อ>` แล้วรัน test ใหม่ทั้งชุด
- เสร็จ feature ไหน → ติ๊ก checkbox ใน roadmap ของ project-plan.md

### 9. การสื่อสาร
- ตอบผู้ใช้เป็น**ภาษาไทย** ศัพท์เทคนิคเป็นอังกฤษได้
- ผู้ใช้มีพื้น React/Flutter/Python — อธิบายเชิงเทคนิคได้เลย แต่การตัดสินใจ architecture ให้บอกเหตุผลประกอบเสมอ

## คำสั่งที่ใช้บ่อย (หลัง scaffold แล้ว)

**Backend** (`c:\Users\pavat\Thesis\anan-api`)
```powershell
npm run start:dev            # API ที่ http://localhost:3000/api/v1 (watch mode)
npm run check                # typecheck + lint + test ← ก่อนปิดงานทุกครั้ง
npm run test:e2e             # e2e ทั้งชุด (supertest)
npx prisma migrate dev       # แก้ schema.prisma แล้วรันอันนี้
npx prisma studio            # ดู/แก้ข้อมูลผ่าน GUI (ทางเลือกแทน pgAdmin)
npm run db:seed              # ใส่ข้อมูลเดโม่
```

**Frontend** (`c:\Users\pavat\Thesis\anan`)
```powershell
npm run web                  # เปิดบน web (http://localhost:8081)
npm start                    # QR สำหรับ Expo Go บนมือถือ
npm run typecheck
```

**e2e ชั้น L4** (`c:\Users\pavat\Thesis\e2e`) — ยก API + web ให้เอง ไม่ต้องเปิด server ก่อน
```powershell
npm run test:e2e             # ทั้งชุดบน anan_test (ล้าง+seed ใหม่ทุกครั้ง)
npm run test:e2e:ui          # โหมด UI ไล่ดูทีละ step
npm run test:e2e -- --grep TC-019
```

> **PostgreSQL 17 ติดตั้งบนเครื่องแล้ว** (service `postgresql-x64-17`, port 5432) ไม่ต้องเปิด Docker และไม่ต้องต่อเน็ต
>
> `psql` ไม่อยู่ใน PATH — อยู่ที่ `C:\Program Files\PostgreSQL\17\bin\psql.exe` หรือใช้ pgAdmin / `npx prisma studio` แทน
>
> ทดสอบบนมือถือ: API ต้อง bind `0.0.0.0` แล้วให้แอปชี้ไปที่ IP ของเครื่องในวง LAN (เช่น `http://192.168.1.x:3000`)
