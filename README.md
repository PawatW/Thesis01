# ANAN — Multi-Vendor Subscription Commerce Platform

Marketplace สินค้าจริงแบบ subscription ("Shopee แบบ recurring") — ผู้ซื้อสมัครรับสินค้าใช้ประจำเป็นรอบอัตโนมัติ
(2 สัปดาห์ / เดือน / 2 เดือน) จากหลายร้านในแพลตฟอร์มเดียว · โปรเจกต์ปริญญานิพนธ์ B.Sc. CS, Kasetsart University

**Stack:** Expo (React Native + expo-router) · NestJS + Prisma · PostgreSQL 17 บนเครื่อง · Cloudinary (ยังไม่ตั้งค่า)
**การจ่ายเงินเป็นการจำลองทั้งหมด** — ไม่มีการเชื่อมต่อ payment gateway จริงทุกกรณี

> **สถานะ:** ฟีเจอร์ครบทุกเฟสแล้ว (test 378 เคส เขียวทั้งหมด) · **ยังไม่ได้ deploy ที่ไหน** — รันบนเครื่องเท่านั้น
> รายละเอียดอยู่ที่ [docs/project-plan.md](docs/project-plan.md) §สถานะการ deploy

---

## สิ่งที่ต้องมีก่อน

| ของ | เวอร์ชันที่ใช้อยู่ | หมายเหตุ |
|---|---|---|
| Node.js | 22.x (npm 10) | |
| PostgreSQL | **17 ติดตั้งบนเครื่อง** | ไม่ใช้ Docker · service ชื่อ `postgresql-x64-17` port 5432 |
| Git Bash / PowerShell | — | คำสั่งด้านล่างเขียนแบบรันได้ทั้งสองแบบ |

> ไม่ต้องต่ออินเทอร์เน็ตเพื่อรัน (ยกเว้นตอน `npm install` ครั้งแรก)

---

## ติดตั้งครั้งแรก (ทำครั้งเดียว)

### 1. ติดตั้ง dependency ทั้ง 3 แพ็กเกจ

```bash
cd anan-api && npm install
cd ../anan && npm install
cd ../e2e && npm install && npx playwright install chromium
```

### 2. เตรียมฐานข้อมูล

สร้าง database `anan` กับ role `anan_app` (ผ่าน pgAdmin หรือ psql) — role นี้ **ไม่ต้องเป็น superuser**
แต่ต้องมีสิทธิ์ `CREATEDB` เพื่อให้ชุดทดสอบสร้าง `anan_test` เองได้

```sql
CREATE ROLE anan_app LOGIN PASSWORD 'ตั้งรหัสเอง' CREATEDB;
CREATE DATABASE anan OWNER anan_app;
```

### 3. ตั้งค่า env (3 ไฟล์)

```bash
cp anan-api/.env.example anan-api/.env
cp anan/.env.example      anan/.env
cp e2e/.env.example       e2e/.env
```

จากนั้นเปิด `anan-api/.env` แล้วเติม:

- `DATABASE_URL` — ใส่รหัสผ่านของ `anan_app` (ถ้ามีอักขระพิเศษต้อง URL-encode เช่น `@` → `%40`)
- `JWT_ACCESS_SECRET` และ `JWT_REFRESH_SECRET` — **ใช้คนละค่ากัน** สร้างด้วย

  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```

`anan/.env` กับ `e2e/.env` ใช้ค่า default ได้เลย (แก้เฉพาะรหัสผ่าน DB ใน `e2e/.env`)

### 4. สร้างตารางและใส่ข้อมูลเดโม่

```bash
cd anan-api
npx prisma migrate deploy
npm run db:seed
```

---

## รันแอป (ใช้ทุกวัน — เปิด 2 terminal)

**Terminal 1 — API**

```bash
cd anan-api && npm run start:dev
```

→ `http://localhost:3000/api/v1` (watch mode · เช็คว่าขึ้นด้วย `curl http://localhost:3000/api/v1/health`)

**Terminal 2 — เว็บ**

```bash
cd anan && npm run web
```

→ `http://localhost:8081` (bundle ครั้งแรกใช้เวลา 2-5 นาที)

### ทดสอบบนมือถือจริง (Expo Go)

1. หา IP ของเครื่องในวง LAN — `ipconfig` (Windows) แล้วดู IPv4 Address
2. แก้ `anan/.env` → `EXPO_PUBLIC_API_URL=http://192.168.x.x:3000/api/v1`
3. `cd anan && npm start` แล้วสแกน QR ด้วยแอป Expo Go (API bind `0.0.0.0` ไว้แล้ว)

---

## บัญชีเดโม่

รหัสผ่านเดียวกันทุกบัญชี: **`DemoPass2026!`**

| อีเมล | บทบาท | มีอะไรอยู่แล้วหลัง `db:seed` |
|---|---|---|
| `buyer.demo@anan.local` | ผู้ซื้อ | 2 ที่อยู่ (บ้าน = หลัก · ที่ทำงาน) · บัตรจำลอง `**** 4242` · 3 subscription |
| `seller.demo@anan.local` | ร้าน **Bean Story** (กาแฟ) | มีสมาชิกแล้ว → dashboard/MRR/forecast มีตัวเลขให้ดูทันที |
| `seller2.demo@anan.local` | ร้าน **Herbal Care** | ร้านเปิดอยู่ |
| `seller3.demo@anan.local` | ร้าน **Pet & Home** | ร้านเปิดอยู่ |
| `admin.demo@anan.local` | ผู้ดูแลระบบ | dashboard · จัดการหมวด · ระงับร้าน/สินค้า · คิวเคสปัญหา · หน้าคุม engine |

> **ไม่มีคอลัมน์ `role`** — สิทธิ์มาจากธง `is_seller` / `is_admin` ในตาราง `users` และ **ตั้งได้จาก seed/SQL เท่านั้น**
> ไม่มี UI ไหนให้ยกระดับตัวเองเป็น admin ได้ (ตั้งใจ) · ส่วนการ "เปิดร้าน" ผู้ซื้อทุกคนทำเองได้จากในแอป

**3 subscription ของ buyer.demo** ตั้งใจให้ครบทุกสถานะที่ต้องเดโม่:

| สินค้า | สถานะ | รอบ | รอบถัดไป |
|---|---|---|---|
| กาแฟคั่วกลาง Arabica | `active` | ทุกเดือน | วันที่ seed (ใช้ทดสอบ engine ได้ทันที) |
| ยาสีฟันสมุนไพร | `active` | ทุกเดือน | +1 เดือน |
| อาหารแมวเกรดพรีเมียม | `paused` | ทุกเดือน | ใช้ทดสอบปุ่ม "กลับมาใช้งาน" |

**บัตรจำลอง:** กรอกเลข 16 หลักอะไรก็ได้ (ต้องผ่าน Luhn · ระบบเก็บแค่ 4 ตัวท้าย) · **ลงท้ายด้วย `0000` = จำลองบัตรถูกปฏิเสธ**

---

## ลองใช้งานตามนี้จะเห็นภาพเร็วที่สุด

1. ล็อกอินเป็น **buyer** → หน้าแรก → เลือกหมวด → กด **“+ เทียบ”** 2 ชิ้น → **ดูตาราง** (เทียบราคาต่อหน่วยข้ามยี่ห้อ)
2. เข้าหน้าสินค้า → เลือกรอบส่ง → **สมัคร** → ดูรายการที่ **“ของฉัน”** (ข้ามรอบ / เลื่อนวัน / หยุด / เปลี่ยนรอบส่ง)
3. ล็อกอินเป็น **seller** → แท็บ **ออเดอร์** → ไล่สถานะ *เริ่มจัดของ → ส่งแล้ว* (ใส่เลขพัสดุ)
4. กลับเป็น **buyer** → แท็บ **ออเดอร์** → **ได้รับแล้ว** / **แจ้งปัญหา** → ดู **ใบเสร็จ (จำลอง)**
5. ล็อกอินเป็น **admin** → โปรไฟล์ → **โหมดผู้ดูแลระบบ** → หน้า **Engine** กด *รัน engine เดี๋ยวนี้* (กดซ้ำวันเดิมออเดอร์ไม่ซ้ำ)
   และหน้า **ดูแลร้าน** ลองระงับร้าน (สินค้าหายจาก catalog + รายการของผู้ซื้อถูกหยุด ไม่มีการตัดเงิน)

> ข้อมูลเลอะจากการกดเล่น → `cd anan-api && npm run db:seed` เพื่อคืนสภาพเดิม

---

## ตรวจงาน / รันเทส

```bash
cd anan-api && npm run check     # typecheck + lint + unit (49) + e2e API (245)
cd anan     && npm run typecheck
cd e2e      && npm run test:e2e  # Playwright 84 เคส — ยก API + web ให้เองบน anan_test
```

ชุด e2e ใช้ฐานข้อมูล `anan_test` (ล้าง+seed ใหม่ทุกครั้ง) และ port 3100/8082 จึงเปิด dev server ค้างไว้พร้อมกันได้
รายงานผลล่าสุดอยู่ที่ [e2e/reports/report.md](e2e/reports/report.md)

---

## โครงโปรเจกต์

```
anan-api\   NestJS + Prisma — ด่านเดียวที่แตะฐานข้อมูลได้ (client ไม่เคยต่อ DB ตรง)
anan\       Expo app — โค้ดชุดเดียว build ได้ทั้ง web / Android / iOS
e2e\        Playwright (ชั้น L4) — ยิงจริงผ่านหน้าจอแล้วยืนยันผลในฐานข้อมูล
docs\       เอกสาร thesis (สถาปัตยกรรม · schema · security · testing · แผนงาน)
context\    สเปกราย feature (17 ตัว) + use case workflow (W01-W12)
```

---

## กับดักที่เจอบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `psql` ใช้ไม่ได้ | ไม่ได้อยู่ใน PATH — อยู่ที่ `C:\Program Files\PostgreSQL\17\bin\psql.exe` หรือใช้ pgAdmin / `npx prisma studio` แทน |
| API ขึ้น `P1000` / ต่อ DB ไม่ได้ | รหัสผ่านใน `DATABASE_URL` ผิด หรือมีอักขระพิเศษที่ยังไม่ได้ URL-encode |
| เว็บขึ้นแต่ยิง API ไม่ได้ | ยังไม่ได้เปิด API (terminal 1) หรือ `EXPO_PUBLIC_API_URL` ชี้ผิด — แก้ `.env` แล้วต้อง **restart** expo |
| มือถือเข้าไม่ได้ | ยังใช้ `localhost` อยู่ ต้องเปลี่ยนเป็น IP ในวง LAN และเครื่องต้องอยู่ Wi-Fi เดียวกัน |
| อัปโหลดรูปแล้วได้ 503 | ยังไม่ได้ตั้งค่า `CLOUDINARY_*` ใน `anan-api/.env` (ตั้งใจให้ fail closed) — ระหว่างนี้กรอกลิงก์รูป https แทนได้ |
| แก้ `schema.prisma` แล้วของไม่เปลี่ยน | ต้อง `npx prisma migrate dev --name <ชื่อ>` เสมอ — ห้ามแก้ DB ตรงผ่าน pgAdmin |

---

## เอกสารที่ควรอ่านต่อ

| ไฟล์ | เนื้อหา |
|---|---|
| [CLAUDE.md](CLAUDE.md) | กฎของโปรเจกต์ (payment demo · security · การทดสอบ) |
| [docs/working-agreement.md](docs/working-agreement.md) | ตอนนี้ทำถึงไหน · ลำดับการทำงาน 1 feature · กับดักของเครื่องนี้ |
| [docs/project-plan.md](docs/project-plan.md) | ภาพรวม · roadmap 8 เฟส · **สถานะการ deploy** |
| [docs/architecture.md](docs/architecture.md) | ชั้นของโค้ด · รายการ endpoint · flow ที่ต้องอยู่ในทรานแซกชันเดียว |
| [docs/database-schema.md](docs/database-schema.md) | ER + เหตุผลการออกแบบ 20 ข้อ |
| [docs/security-design.md](docs/security-design.md) · [docs/security-rules.md](docs/security-rules.md) | threat model + checklist ที่ต้องไล่ก่อนปิดงาน |
| [docs/testing.md](docs/testing.md) | กฎการทดสอบ 4 ชั้น + สารบัญเทสทั้งหมด |
