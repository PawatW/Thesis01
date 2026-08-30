# ANAN — วิธีทำงาน (อ่านก่อนเริ่มทุกเซสชันใหม่)

> อัปเดต: 2026-08-19 (รื้อทิศทางภาพ UI) · ไฟล์นี้คือ "บันทึกส่งต่อ" ระหว่างเซสชัน
> กฎของโปรเจกต์อยู่ที่ [CLAUDE.md](../CLAUDE.md) — ไฟล์นี้บอก **สถานะ** กับ **วิธีลงมือ**

---

## 1. ตอนนี้อยู่ตรงไหน

| Phase | สถานะ | ของที่มีจริงแล้ว |
|---|---|---|
| 0 — รากฐาน API | ✅ | NestJS 11 + Prisma 6 + Postgres บนเครื่อง · 16 ตาราง · 52 CHECK · seed · exception filter · guards |
| 1 — Auth + ผู้ใช้ | ✅ | register/login/refresh/logout · profile · addresses · payment methods · Expo ใช้ API client แล้ว |
| 2 — Catalog + Checkout | ✅ | catalog public · `POST /subscriptions` transaction เดียว · **ถอด Supabase ออกจากแอปหมดแล้ว** |
| 3 — จัดการ subscription + Engine | ✅ | 7 actions ของ [W05](../context/workflows/w05-manage-subscription.md) · recurring engine (cron 01:00 + time-travel ของ admin) · `cycle_anchor_date` · แก้ A-8 |
| 4 — ฝั่งร้านค้า | ✅ | เปิดร้าน · dashboard (MRR/churn) · สินค้า+แผน · ขึ้นราคาแล้วแจ้งสมาชิก · ออเดอร์ 4 แท็บ + forecast · signed upload |
| 4.5 — ความน่าเชื่อถือ | ✅ | ประวัติออเดอร์ผู้ซื้อ + stepper · **ยืนยันรับของ (จุดเดียวที่เขียน `confirmed_at` ได้)** · แจ้งปัญหา + ร้านตอบเคส · ร้านยกเลิกออเดอร์ + คืนเงินจำลอง · รีวิว verified · engine auto-close 7 วัน |
| 5 — Payment demo โพลิช | ✅ | `PaymentProvider` + `DemoPaymentProvider` (บัตรลงท้าย `0000` = ถูกปฏิเสธ) · จ่ายซ้ำ · ใบเสร็จจำลอง · ออเดอร์ที่ยังไม่ได้เงินไม่ถึงตาร้าน |
| 6 — Admin | ✅ | dashboard 9 ตัวเลข · จัดการหมวด · **ระงับร้าน/สินค้า = แช่แข็ง subscription + หยุดเงินทันที** · คิวเคสปัญหา + สัญญาณคุณภาพร้าน · หน้าคุม engine |
| 7 — Polish | ✅ งานโพลิชเสร็จ | feature 04 เทียบสินค้า · feature 08 แจ้งเตือน · หน้าบัตร · โลโก้ร้าน · หน้าแก้สินค้า · หน้าร้านสาธารณะ · **คอนโซลแยกตามบทบาท (2026-08-19)** |
| 7.1 — ฟอร์มผูกบัตร | ✅ | **ผูกบัตรทำงานเหมือนของจริง** (Luhn · BIN → เครือข่าย · วันหมดอายุ · CVV · กันบัตรซ้ำ) · จำลองเฉพาะการตัดเงิน · หน้าจอผูกบัตรไม่มีคำว่า "จำลอง" แล้ว (2026-08-20) |
| 7.2 — ลืมรหัสผ่าน + ผู้ดูแลดูได้ทุกโหมด | ✅ | **ส่งอีเมลจริงผ่าน SMTP** (`MailService` + `nodemailer`) · ตาราง `password_reset_tokens` (sha256 · 30 นาที · ใช้ครั้งเดียว · ขอใหม่แล้วใบเก่าตาย) · ตั้งรหัสใหม่ = เพิกถอนทุก session · `rolesOf()` คืนครบ 3 โหมดให้ admin + seed ร้านตัวอย่างให้ `admin.demo` (2026-08-22) |
| 7.3 — ตั้งค่าเมล + log ระบบ | ✅ | **คอนโซลผู้ดูแล 6 หน้า** · `(admin)/settings` เปิดโหมด DEV ให้อีเมลทุกฉบับเข้ากล่องเดียว (ด่านอยู่ที่ `MAIL_UAT_MODE_AVAILABLE` ไม่ใช่ที่ role) + แก้ host/port/ผู้ส่งของ SMTP · `(admin)/logs` 2 แท็บ: `audit_logs` (**ปิด A-3**) + `email_logs` · ทั้งคู่อ่านอย่างเดียว (2026-08-22) |
| **7 — Deploy** | ⛔ **ยังไม่ได้ทำ** | ทุกอย่างรันบนเครื่องเท่านั้น — เงื่อนไขก่อน deploy อยู่ที่ [project-plan §สถานะการ deploy](project-plan.md) |
| **8 — คูปองรายรอบ 2 ระดับ** | ✅ | [feature 18](../context/planing/18-coupons.md) + [W13](../context/workflows/w13-coupon.md) (2026-08-24) — คูปองที่ผู้ซื้อ **จองกับรอบใดรอบหนึ่งก่อนวันตัดเงิน** · **2 ระดับซ้อนกันได้: แพลตฟอร์ม (admin ออก · ร้านกดเข้าร่วม) + ร้านค้า (ร้านออกเอง)** ระดับละ 1 ใบต่อรอบ · **ร้านตั้งนโยบายรายสินค้า** ว่าชิ้นไหนรับระดับไหน · ส่วนลดคิดจากยอดเต็มทั้งคู่แล้วรวม (หนีบที่ใบของร้านเมื่อเกินยอด) · 3 ตาราง + partial unique 2 ตัว · หน้า `(admin)/coupons` + `(seller)/coupons` · **114 เคสใหม่ (TC-106…120)** |

**ตัวเลขล่าสุด:** test 594 เคส (unit 83 + e2e API 391 · 18 suites · **Playwright L4 120 เคส · 15 specs**) · `npm run check` และ `cd e2e && npm run test:e2e` เขียวทั้งคู่ _(อัปเดต 2026-08-24 · รอบคูปอง 2 ระดับ feature 18)_

**ของที่ยังไม่มีให้กด (เหลือเท่านี้):**
- **อัปโหลดรูปจากเครื่อง** — ต้องเพิ่ม `expo-image-picker` (dependency ใหม่ ต้องถามก่อน) และเติมค่า `CLOUDINARY_*` 3 ตัวใน `anan-api/.env` ที่ตอนนี้ยังว่าง · ทุกที่ที่ใส่รูปกรอกลิงก์ https แทนได้
- **realtime/push ของแจ้งเตือน** — หน้าจอโหลดใหม่ตอนเข้าแท็บ (out of scope เดิมของ feature 08)
- **อีเมลจริงจากเครื่องนี้** — `SMTP_*` + `MAIL_FROM` ใน `anan-api/.env` ยังว่าง ระบบจึง**พิมพ์ลิงก์รีเซ็ตลง log ของ API แทนการส่ง** (ใช้เดโม่ได้ครบ) · ใส่ค่า SMTP เมื่อไหร่ก็ส่งจริงทันทีโดยไม่ต้องแก้โค้ด — และเมื่อ `NODE_ENV=production` สองค่านี้**บังคับ** ไม่มีก็ไม่บูต
- **เปลี่ยนรหัสผ่านจากในแอปตอนล็อกอินอยู่** — ยังไม่มี (คนละ flow กับลืมรหัสผ่าน ต้องยืนยันรหัสเดิมก่อน)
- **ปุ่ม "ส่งเมลทดสอบ" ในหน้าตั้งค่าเมล** — ยังไม่มี · ตอนนี้ยืนยันว่าตั้งค่าถูกได้จากหน้า log (แท็บ "อีเมลที่ส่งออก") ว่าฉบับล่าสุดสถานะอะไร
- **retention ของตาราง log** — `audit_logs`/`email_logs` โตขึ้นเรื่อย ๆ ไม่มีอะไรลบให้ · ตั้งใจไม่ทำปุ่มลบ (ดู security-design §5) ถ้าจะทำต้องเป็น job ฝั่ง DB
- **การ deploy ทั้งหมด** — ดูเงื่อนไขใน [project-plan §สถานะการ deploy](project-plan.md)
- **อัปโหลดรูปจริงยังไม่ได้ทดสอบ** — `POST /uploads/signature` เสร็จแล้วแต่ `.env` ยังไม่มีค่า Cloudinary
  (ตอบ 503 `UPLOADS_NOT_CONFIGURED` และหน้าจอให้ใส่ลิงก์รูปแทน) · ใส่ 3 ค่าใน `.env` ของ API แล้วใช้ได้ทันที

---

## 2. ลำดับการทำงาน 1 feature (ทำแบบนี้ทุกครั้ง)

```
อ่านสเปก → เขียน API → test → ให้ agent รีวิวขนาน → แก้ → ต่อฝั่ง Expo → เขียน Playwright → กดจริงบนเว็บ → อัปเดต docs
```

1. **อ่านสเปกก่อนเขียนโค้ด** — `context/planing/XX-*.md` ของ feature นั้น + `context/workflows/wXX-*.md` ที่เกี่ยว
   สิ่งที่อยู่ใน "Out of scope" ห้ามทำเองโดยไม่ถาม
2. **ดูก่อนว่าหน้าจอเดิมต้องการข้อมูลรูปร่างไหน** แล้วออกแบบ response ให้ตรง — ประหยัดการรื้อ UI รอบสอง
3. **เขียน API** ตามชั้น: controller (ไม่มี logic) → service (ownership อยู่ใน `where`) → Prisma
4. **เขียน e2e อย่างน้อย 3 เคสต่อ endpoint** (สำเร็จ · คนอื่นเรียก 404 · สถานะผิด 409) ตาม [testing.md §3](testing.md)
5. **`npm run check` ต้องเขียวก่อนเรียก agent** — อย่าให้ agent เสียเวลารีวิวโค้ดที่ยัง compile ไม่ผ่าน
6. **spawn agent รีวิวขนาน 2 ตัว** (ดู §3) → แก้ตามที่เจอ → เขียน test ที่จับบั๊กนั้นให้แดงก่อนแก้
7. **ต่อฝั่ง Expo** แล้ว `npx tsc --noEmit` ในโฟลเดอร์ `anan`
8. **เขียน Playwright ชั้น L4** — ใส่ `id` ที่หน้าจอใหม่ → ลงทะเบียนใน `e2e/helpers/selectors.ts` → เพิ่มเคสตามตารางบังคับใน [testing.md §3.1](testing.md) → `cd e2e && npm run test:e2e` ต้องเขียว
9. **ไล่กดจริงบนเว็บ** (ดู §5) — ทุก flow ที่มีเงินหรือเปลี่ยนสถานะต้องกดเอง 1 รอบ (Playwright จับได้แค่สิ่งที่เรานึกออกว่าจะ assert)
10. **อัปเดตเอกสารใน commit เดียวกัน**: สารบัญ test ใน [testing.md §5](testing.md) · `e2e/reports/report.md` ของรอบที่เขียว · checkbox ใน [project-plan.md](project-plan.md) · ถ้าแตะ auth/payment/upload ให้ไล่ [security-rules.md](security-rules.md)

---

## 3. การใช้ agent รีวิว (ผู้ใช้สั่งให้ทำทุกเฟส)

spawn **2 ตัวขนานกัน** ตอนโค้ดนิ่งแล้ว ตัวหนึ่งดู security อีกตัวดูความถูกต้อง + คุณภาพ test

**model/effort: `opus` · `medium`** สำหรับ agent รีวิวขนานทั้ง 2 ตัว — รวมถึง agent ที่ใช้รีวิว/เขียน Playwright (ชั้น L4) ด้วย (ตั้งค่าเดียวกันทั้งหมด 2026-08-29)

สิ่งที่ทำให้รายงานมีประโยชน์จริง (จากรอบที่ผ่านมา):
- บอกให้ **อ่าน `docs/security-rules.md` + `docs/testing.md` ก่อน** — ไม่งั้นจะได้คำแนะนำทั่วไปที่ไม่เข้ากับกฎโปรเจกต์
- ระบุไฟล์ที่ต้องรีวิวเป็นรายชื่อ ไม่ใช่ "ดูโค้ดใหม่ทั้งหมด"
- ตั้งคำถามเจาะจง เช่น "ยิง refresh พร้อมกัน 2 ครั้งจะเกิดอะไร"
- สั่ง **"อย่าแต่งปัญหาให้ครบจำนวน ถ้าส่วนไหนดีอยู่แล้วบอกสั้น ๆ ว่าผ่าน"**
- สั่ง **"ห้ามแก้ไฟล์ — รายงานอย่างเดียว"**

รอบที่ผ่านมา agent จับได้ของจริงที่ test มองไม่เห็น: race condition ของ refresh token · ที่อยู่หลักซ้อนกัน 2 อัน · สวิตช์ปิด rate limit ที่ fail-open

---

## 4. คำสั่งที่ใช้จริง

**Backend** (`anan-api`)
```powershell
npm run start:dev      # API http://localhost:3000/api/v1
npm run check          # typecheck + lint + unit + e2e ← ก่อนปิดงานทุกครั้ง
npm run db:seed        # คืนข้อมูลเดโม่ (รันหลังกดเล่นบนเว็บจนข้อมูลเลอะ)
                       # ★ ล้าง audit_logs/email_logs และปิดโหมดเปลี่ยนเส้นทางอีเมลให้ด้วย ★
npx prisma migrate dev --name <ชื่อ>
npx prisma studio
```

**Frontend** (`anan`)
```powershell
npm run web            # http://localhost:8081
npx tsc --noEmit
```

**บัญชีเดโม่** (รหัสเดียวกันหมด: `DemoPass2026!`)
`buyer.demo@anan.local` · `seller.demo@anan.local` · `admin.demo@anan.local`

---

## 5. การรัน server และกดทดสอบ

ใช้ `preview_start` เท่านั้น (มี config อยู่ใน `.claude/launch.json` ชื่อ `anan-api` กับ `anan-web`) — **ห้ามรัน dev server ผ่าน Bash**

Expo web bundle ครั้งแรกนานมาก (2-5 นาที) รอด้วย:
```bash
until curl -s -m 5 http://localhost:8081/ | grep -qi "<html"; do sleep 5; done
```

**เครื่องมือที่ใช้ได้จริงตอนกดทดสอบ** (รอบ Phase 4.5 ลองครบแล้ว):
- `read_page` อ่านเนื้อหาได้ปกติ และเป็นทางเดียวที่ได้ `ref_N` ของ input/button — ปุ่มของ react-native-web ไม่มี accessible name จึงต้องนับลำดับเอา (ปุ่มในการ์ดเรียงตามลำดับที่อยู่ในโค้ด)
- `get_page_text` เร็วกว่าเมื่ออยากเช็คข้อความล้วน ๆ
- `javascript_tool` ใช้ตอนต้องดูของที่ตาไม่เห็น เช่น id ที่ render จริง / computed style:
  ```js
  [...document.querySelectorAll('[id^="order-"]')].map(e => e.id)
  ```
- **`computer{action:"screenshot"}` ใช้ไม่ได้ถ้า Browser pane ไม่ได้ถูกแสดง** (ตอบ "not compositing frames") · การคลิกด้วย `coordinate` ก็ต้องมี screenshot ก่อน → **ให้คลิกด้วย `ref` เสมอ**

**ปิด server ทุกครั้งที่ทำเสร็จ** — ผู้ใช้ไม่อยากให้มี process ค้าง

---

## 6. กับดักของเครื่องนี้ (เสียเวลามาแล้วทุกข้อ)

| เรื่อง | สิ่งที่ต้องทำ |
|---|---|
| **ภาษาไทยกับ PowerShell** | ห้ามใช้ `Get-Content`/`Set-Content` กับไฟล์ที่มีภาษาไทย — PowerShell 5.1 อ่านเป็น ANSI แล้วทำเพี้ยนทั้งไฟล์ · ใช้เครื่องมือแก้ไฟล์โดยตรง |
| **path มีวงเล็บเหลี่ยม** | `app\(buyer)\product\[id].tsx` ต้องใช้ `-LiteralPath` ไม่งั้น `[id]` ถูกตีความเป็น wildcard แล้วคำสั่งไปโดนไฟล์ผิดตัว (เคยลบไฟล์ตัวเองมาแล้ว) |
| **jest output ถูก buffer** | `npx jest ... \| Select-Object -Last 40` จะไม่แสดงอะไรเลยจนจบ — ดูเหมือนค้าง · ให้รัน `run_in_background: true` แบบไม่ pipe แล้วอ่านไฟล์ output |
| **e2e hook timeout** | `testTimeout: 60000` ใน `test/jest-e2e.json` แล้ว · bcryptjs cost 12 ≈ 400ms ต่อครั้ง test ที่สมัครหลายบัญชีจึงช้าเป็นธรรมดา |
| **HTTP header ใส่ภาษาไทยไม่ได้** | supertest `.set()` รับได้เฉพาะ latin-1 · token ปลอมใน test ต้องเป็น ASCII |
| **pgAdmin Query Tool** | รันทุกคำสั่งในหน้าต่างเป็น transaction เดียว → `CREATE DATABASE` พัง (25001) ต้องลากเลือกทีละคำสั่ง |
| **`prisma migrate reset`** | Prisma กันไม่ให้ AI รันเอง ต้องขอคำยืนยันจากผู้ใช้ก่อน แล้วส่งข้อความยินยอมผ่าน env `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` |
| **Prisma ล็อกไว้ที่ v6** | v7 บังคับ `prisma.config.ts` + driver adapter + ESM ซึ่งยังไม่เข้ากับ build ของ Nest · `npm update` แล้วจะพัง |
| **migration ที่เขียนมือ** | `*_check_constraints`, `*_one_default_address`, `*_avatar_url_bounds`, `*_phase3_engine`, `*_no_duplicate_subscription`, `*_cycle_anchor_check` — Prisma มองไม่เห็น CHECK จึงไม่ลบทิ้ง แต่ **partial index ต้องคอยดูทุกครั้งที่รัน `migrate dev`** (เขียนใน schema.prisma ไม่ได้ Prisma จึงอาจ generate คำสั่ง DROP ให้) |
| **เพิ่มคอลัมน์ที่ NOT NULL กับตารางที่มีข้อมูล** | Prisma generate `ADD COLUMN ... NOT NULL` ตรง ๆ ซึ่งรันไม่ได้ · ใช้ `migrate dev --create-only` แล้วแก้ SQL เป็น 3 ขั้น (เพิ่มแบบ nullable → backfill → `SET NOT NULL`) |
| **rate limit ตอน test** | `AppThrottlerGuard` ปิดได้เฉพาะ `NODE_ENV=test` + `THROTTLE_DISABLED=true` · `createTestApp({ throttle: true })` เมื่อจะทดสอบ 429 · Playwright ก็ตั้ง 2 ตัวนี้ให้ API ที่ยกขึ้นเอง ไม่งั้นโดน 429 ตั้งแต่เคสที่ 11 |
| **`nest build` ออกที่ `dist/src/main.js`** | ไม่ใช่ `dist/main.js` เพราะ `prisma/seed.ts` ถูก compile ด้วย tsc เลยยก rootDir ขึ้นมาชั้นหนึ่ง → **`npm run start:prod` ที่เขียนว่า `node dist/main` พังอยู่** (e2e หาไฟล์เองทั้งสองที่) |
| **`id` ซ้ำใน DOM ของ expo-router** | หน้าเดิมยังคาอยู่ในต้นไม้ตอน `router.push()` — การ์ดสินค้าชิ้นเดียวกันจึงอยู่ทั้งหน้าแรกและหน้าหมวดพร้อมกัน · `id` ต้อง scope ตามหน้าจอ (`home-product-…` / `category-product-…`) ไม่ใช่ตามรหัสสินค้าอย่างเดียว |
| **เวลาข้ามเที่ยงคืนไทย** | เซสชันยาว ๆ วันที่จะเปลี่ยนระหว่างทาง · ก่อนสรุปว่า "วันที่เพี้ยน" ให้เช็ค `/health` เทียบกับ `Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'})` ก่อน |
| **`ConfigModule.forRoot()` แช่แข็ง env ตั้งแต่โหลดไฟล์** | `@Module({ imports: [ConfigModule.forRoot(...)] })` ถูก evaluate ครั้งเดียวตอนโหลด `AppModule` — สร้างแอปใหม่ใน jest ไฟล์เดิมก็ยังได้ค่า env ชุดเดิม · **สวิตช์ที่เทสต้องสลับ (DEMO_MODE, THROTTLE_DISABLED) ต้องอ่าน `process.env` ตอนเรียกจริง** เหมือน `AppThrottlerGuard` ไม่ใช่ผ่าน ConfigService |
| **เพดาน 20 ที่อยู่ต่อบัญชี** | เทสที่ต้องการ subscription ใหม่หลายรายการต้องมีที่อยู่ใหม่ทุกครั้ง (กฎกันสมัครซ้ำ = แผนเดิม+ที่อยู่เดิม) พอเกิน 20 จะได้ 409 แบบงง ๆ กลางไฟล์ · สร้างที่อยู่ผ่าน Prisma ตรงในเทสแบบนั้น |
| **Playwright เคสที่เปลี่ยนสถานะ seed** | รันเรียงลำดับใน worker เดียว — เคสที่ pause/cancel/เปลี่ยนแผนต้องอยู่ท้ายไฟล์ และต้องเลี่ยงรายการที่ spec ก่อนหน้าสร้างไว้ (เทส checkout สมัครกาแฟไว้ทั้งสองที่อยู่ ทำให้ย้ายที่อยู่ของรายการกาแฟชนกฎสมัครซ้ำ) |
| **`pg` แปลงคอลัมน์ `date` เป็นเที่ยงคืน local** | `select next_order_date::text` เสมอในเทส Playwright — ไม่งั้น `.toISOString()` ให้วันก่อนหน้าเพราะเครื่องอยู่ Asia/Bangkok |
| **`Link asChild` ห้ามส่ง style เป็น array** | expo-router โยน error ทันที ("passing an array of styles") แล้วหน้าเป็นจอขาว · ใช้ `StyleSheet.flatten([...])` ที่ลูกของ `Link` เสมอ (เจอตอนทำหน้า admin) |
| **`onLayout` ไม่ยิงบน react-native-web 0.21** | ใส่ `onLayout` ที่ `<View>` แล้วคอลแบ็ก**ไม่ถูกเรียกเลยแม้แต่ครั้งเดียว** (พิสูจน์ด้วย `console.log` แล้ว) · อย่าออกแบบอะไรที่ต้องพึ่งการวัดขนาดตอน runtime บนเว็บ — คำนวณจากค่าคงที่ของ layout แทน (ดู `useProductGrid.ts`) |
| **`useWindowDimensions()` ค้างที่ค่าตอน mount** | ปัญหาตระกูลเดียวกัน — ย่อจอจาก 1280 → 900 แล้วค่าที่ hook คืนไม่ขยับ **แม้จะยิง `resize` event เองก็ตาม** · ผลคือ sidebar/rail ของจอกว้างค้างอยู่บนจอแคบจนบีบคอลัมน์สินค้าจนล้น · **ใช้ `useWindowWidth()` จาก `src/lib/useWindowWidth.ts` เท่านั้น** (ฟัง `window.resize` เองบนเว็บ · `Dimensions.change` บน native ผ่าน `useSyncExternalStore`) |
| **`resize_window` ของเครื่องมือทดสอบไม่ยิง `resize` event** | CDP เปลี่ยนขนาด viewport ได้แต่หน้าเว็บไม่รู้ตัว → layout ไม่สลับ **ทั้งที่โค้ดถูก** · เวลาจะตรวจ responsive ให้ **reload หลัง resize** หรือยิง `window.dispatchEvent(new Event('resize'))` เอง ไม่งั้นจะสรุปผิดว่าเป็นบั๊ก |
| **แถบลอยทับปุ่มที่อยู่ท้ายหน้า** | `position: absolute` + `bottom` ไม่กันที่ให้ตัวเอง — ต้องใส่ spacer สูงเท่าแถบไว้ท้ายเนื้อหา ไม่งั้นปุ่มสุดท้ายกดไม่โดน (Playwright ฟ้องว่า "subtree intercepts pointer events") |
| **Modal ของ react-native-web ตอน pane ไม่ render** | `animationType="fade"` ใช้ CSS animation + `animationend` เพื่อ unmount · แท็บที่ไม่ได้ถูกแสดงไม่ compose frame → event ไม่ยิง กล่องที่ปิดไปแล้วจึงยังค้างใน DOM (แต่ `pointer-events: none`) · **อย่าตีความว่าเป็นบั๊ก** — ดูที่ `pointerEvents` ไม่ใช่ที่ข้อความใน `get_page_text` |
| **ขอบเดือนของ churn** | `subscription_events.created_at` เป็น `timestamptz` → ต้นเดือนตามไทยคือวันสุดท้ายของเดือนก่อน 17:00Z · ใช้ `startOfThaiMonth()` ใน `common/date.ts` ห้ามใช้ `Date.UTC(y, m, 1)` ตรง ๆ |
| **ตัว token จริงไม่มีใน DB** | `password_reset_tokens` เก็บแค่ sha256 — เทสจะ "อ่านลิงก์จากอีเมล" ไม่ได้ · L2 ดักที่ `MailService.sendPasswordReset` (spy) ส่วน L4 หว่านตั๋วที่รู้ค่าเองลง DB แล้วเปิด `/reset-password?token=…` · **ดันวันหมดอายุอย่างเดียวไม่ได้** CHECK `expires_at > created_at` บังคับให้ต้องดัน `created_at` ถอยไปด้วย |
| **เพิ่ม endpoint ที่ใช้เมธอดใหม่ (PUT/PUT-like)** | ต้องเติมใน **3 ที่**: `bootstrap.ts` → `enableCors({ methods })` · `anan/src/lib/api/client.ts` → union ของ `method` · ตัว `call()` ของ feature นั้น · **ลืมที่แรกแล้วเบราว์เซอร์ตัดตั้งแต่ preflight** อาการคือหน้าจอขึ้น "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" ส่วน log ฝั่ง API เงียบสนิทเพราะ request ไม่เคยมาถึง (เสียเวลาไปแล้วตอนทำหน้าตั้งค่าเมล) |
| **โหมด DEV ของอีเมลเป็นสภาพร่วมของทั้งระบบ** | `mail_settings` มีแถวเดียว — เปิดค้างไว้แล้วเมลของ **ทุก** เทส/ทุกคนจะไปเข้ากล่องเดียว · เทส Playwright ที่เปิดโหมดต้องปิดคืนใน step `Cleanup` เสมอ · e2e ตั้ง `MAIL_UAT_MODE_AVAILABLE=true` ให้ API ที่ยกขึ้นเอง (`setup/servers.ts`) ไม่งั้นสวิตช์ถูกล็อกแล้ว TC-102/103 แดงทั้งที่โค้ดถูก |
| **ลิงก์รีเซ็ตตอนกดเล่นเอง** | ยังไม่ได้ตั้ง SMTP → ลิงก์ถูกพิมพ์ลง log ของ API (`MailService` level warn) · ดูใน terminal ที่รัน `npm run start:dev` แล้วก๊อป URL ไปเปิดในเบราว์เซอร์ได้เลย |
| **engine แตะข้อมูลทั้งฐาน** | `test/engine.e2e-spec.ts` ต้องถ่ายรูป `nextOrderDate`/`cycleAnchorDate` ของ subscription ที่ไม่ใช่ของเทสไว้ก่อน แล้วคืนค่าใน `afterAll` ไม่งั้นข้อมูล seed ของงานพัฒนาจะขยับทุกครั้งที่รันเทส |
| **ฝัง session ให้ Playwright ด้วย localStorage ไม่ได้แล้ว** | refresh token ฝั่งเว็บอยู่ใน httpOnly cookie — `addInitScript` เขียนค่านั้นไม่ได้ (ซึ่งเป็นประเด็นทั้งหมดของการย้าย) · ใช้ `seedSession(page, refreshToken)` จาก `e2e/helpers/login.ts` ที่เรียก `context.addCookies()` แทน · ข้อดีที่ตามมา: ธง `__e2e_session_seeded` ที่เคยต้องมีกันการยัด token ซ้ำทุก navigate หายไปเลย เพราะ cookie ใส่ครั้งเดียวต่อ context แล้ว server หมุนให้เองเหมือนผู้ใช้จริง |
| **`getRefreshToken()` คืน `null` เสมอบนเว็บ** | ไม่ได้แปลว่า "ยังไม่ล็อกอิน" แต่แปลว่า "token ไม่ได้อยู่ฝั่งนี้" · โค้ดที่อยากรู้ว่ามี session ไหมต้องยิง `restoreSession()` หรือดู `useAuth().profile` ไม่ใช่เช็คค่านี้ · จุดที่เคยพลาดมาแล้ว: `signOut()` ข้ามการเรียก API เมื่อเห็น `null` → หน้าจอออกจากระบบแต่ session ฝั่ง server ยังอยู่ |
| **`supertest` ไม่ส่ง header `Origin`** | จึงถูกนับเป็น "ไม่ใช่เบราว์เซอร์" แล้วได้ `refreshToken` ลง body เหมือนเดิม — เทส e2e API เก่าทั้งหมดจึงไม่ต้องแก้ตอนย้ายไป cookie · เคสที่ตั้งใจทดสอบฝั่งเว็บต้อง `.set('Origin', 'http://localhost:8081')` เองให้ชัด และค่านั้นต้องอยู่ใน `CORS_ORIGINS` ของ `.env` ไม่งั้น `AllowedOriginGuard` ตอบ 403 ก่อน |

---

## 6.1 UI — สิ่งที่รื้อไปเมื่อ 2026-08-19 (อ่านก่อนแตะหน้าจอ)

ทิศทางภาพเปลี่ยนทั้งชุดจาก violet/gradient เป็น "ชั้นของใช้ในบ้าน" — เหตุผลและค่าจริงอยู่ที่ [design-system.md](design-system.md) สิ่งที่ต้องรู้ตอนเขียนโค้ดต่อ:

| เรื่อง | กฎ |
|---|---|
| **สี "เวลา"** (`timeUrgent/timeSoon/timeCalm/timeIdle`) | สงวนไว้ให้การนับถอยหลังเท่านั้น ห้ามหยิบไปตกแต่ง ไม่งั้นการกวาดตาหา "อะไรจะมาก่อน" พัง |
| **`marigold`** | แท่ง/จุด/พื้นเท่านั้น **ห้ามเป็นตัวอักษร** (2.2:1) |
| **`letterSpacing`** | ห้ามใส่กับข้อความที่มีอักษรไทย — สระบน/วรรณยุกต์ผูกตำแหน่งกับฐาน จะลอยหลุด · ใส่ได้เฉพาะละตินล้วน |
| **`radius.pill`** | เฉพาะ status badge กับชิปหมวด · ปุ่ม action ใช้ `radius.md` |
| **`textFaint`** | `#6E675E` คือค่าต่ำสุดที่ยอมให้ใช้กับตัวอักษร (5.0:1) — จางกว่านี้ตก AA |
| **กริดสินค้า** | `useProductGrid({ rail, inCard })` — หน้าที่มีคอลัมน์ขวา (ตอนนี้มีแค่หน้าแรก) ต้องส่ง `rail: true` ไม่งั้นการ์ดล้นออกนอกคอลัมน์ · กริดที่วางไว้**ใน `<Card>`** ต้องส่ง `inCard: true` ด้วย (padding 16×2 + เส้นขอบ 1×2) ส่งเกินมาก็เสียที่ฟรี 34px ส่งขาดก็ล้น |
| **ย้ายกริดเข้า/ออกจาก `<Card>` หรือแก้ `<Screen wide>`** | ต้องแก้ argument ของ `useProductGrid` ในหน้านั้นด้วยเสมอ — สูตรมองไม่เห็น DOM จริง ผิดเมื่อไหร่การ์ดใบสุดท้ายตกบรรทัดเงียบ ๆ โดยไม่มี error (วิธีตรวจ: วัด `getBoundingClientRect()` ของ `#home-featured` เทียบกับ `cardWidth × คอลัมน์ + 12 × (คอลัมน์−1)`) |
| **การ์ดซ้อนการ์ด** | `<Card variant="plain">` มีไว้ให้กลุ่มเป็นแค่หัวข้อ+รายการ โดย **`id` ยังอยู่บน element เดิม** — `#subs-group-*` ต้องเป็นพ่อของ `#subs-item-*` ตาม descendant selector ของ e2e |

**เส้นแบ่งความเสี่ยงกับ Playwright ที่วัดแล้ว:**
- ✅ **สไตล์ล้วนปลอดภัย 100%** — ไม่มี spec ไหน assert สี ฟอนต์ เงา หรือ CSS เลยสักเคส
- ✅ **แถบนำทางเปลี่ยนได้** — e2e เดินหน้าด้วย URL ทั้งหมด (`gotoApp(page, '/subscriptions')`) ไม่มี spec ไหนคลิก bottom tab bar และไม่มี selector ของแถบนั้น
- ⛔ **ข้อความถูกล็อก 86 จุด** (`toHaveText` 47 · `toContainText` 37 · `getByText` 2) — `#subs-status-*` ใช้ `toHaveText` ตรงตัว **เติมจุดสีต้องเป็น `<View>` ไม่ใช่ `<Text>`** (นี่คือที่มาของ prop `dot` บน `Pill`)
- ⛔ **ปุ่ม `#subs-action-*` ทั้ง 8 ตัวต้อง mount อยู่เสมอ** — ยุบเข้าเมนู "⋯" ไม่ได้ · จัดลำดับด้วย `tone` prop แทน (DOM ไม่ขยับ)

**เรื่องรูปสินค้า — ทางเดินต่อครบแล้ว เหลือแค่ตัวรูป**

`ProductImage` / `ShopLogo` ใน [`src/components/ProductImage.tsx`](../anan/src/components/ProductImage.tsx) เป็นทางเดียวที่แสดงรูปในแอป · ใช้ `expo-image` จริง (เดิมติดตั้งไว้แต่ถูกใช้ 0 ไฟล์) และมีทางสำรองสองชั้น: ลิงก์เสีย (`onError`) → กลับไปใช้ไอคอนหมวด · ไม่มีลิงก์ → ไอคอนหมวดเช่นกัน

- **`usableUrl()` รับเฉพาะ `https://`** — ห้ามลดเงื่อนไขเป็น "ขึ้นต้นด้วย http" เพราะ `<Image>` ที่ได้ uri ใช้ไม่ได้จะขึ้นกล่องว่างเงียบ ๆ แทนที่จะ error ให้เห็น
- **`seed.ts` ตั้ง `images: []` โดยตั้งใจ** — ของเดิมเก็บชื่อไฟล์เปล่า (`coffee-medium.jpg`) ซึ่งเป็นข้อมูลที่สร้างผ่าน API เองไม่ได้ (`CreateProductDto` บังคับ `@IsUrl({ protocols: ['https'] })`) แล้วก็ไม่มีวัน render ได้จริง
- **อยากได้รูปจริงในเดโม่:** ใส่ลิงก์ https ผ่านหน้าแก้สินค้าของร้าน แล้วรูปขึ้นทันทีโดยไม่ต้องแก้โค้ด · หรือเติม `CLOUDINARY_*` 3 ตัวใน `anan-api/.env` เพื่อเปิดการอัปโหลด

## 7. รูปแบบโค้ดที่ยึดไว้แล้ว (ทำตามของเดิม)

- **ownership อยู่ใน `where`** — `updateMany({ where: { id, userId } })` แล้วเช็ค `count === 0` · ไม่ใช่ `findUnique` แล้ว `if`
- ของคนอื่นตอบ **404 ไม่ใช่ 403**
- **เงื่อนไขที่ต้องแข่งกับ request อื่นต้องอยู่ใน `where` ของคำสั่งเขียน** ไม่ใช่ `if` ก่อนหน้า (บทเรียนจาก refresh token)
- **ไม่ return entity ดิบ** — ผ่าน mapper ใน `dto/*-response.dto.ts` เสมอ · `Prisma.Decimal` ต้อง `.toNumber()`
- DTO ไม่มีฟิลด์เงิน/สถานะ/สิทธิ์ · ฟิลด์ที่คอลัมน์เป็น NOT NULL ใช้ `@ValidateIf((_o, v) => v !== undefined)` ไม่ใช่ `@IsOptional()`
- **เงื่อนไขที่ใช้หลายที่ต้องมีตัวแปรเดียว** เช่น `VISIBLE_PRODUCT` ใน `catalog.service.ts` — ห้ามเขียน where ซ้ำเอง
- วันที่ปฏิทินใช้ `src/common/date.ts` เท่านั้น · ค่าจาก client ใช้ `tryParseISODate` (คืน `null`) ไม่ใช่ `parseISODate` (โยน error → 500)
- **`addMonths` ห้ามเรียกต่อกันเป็นทอด ๆ** — ทุกวันตัดรอบคิดจาก `cycleAnchorDate` ด้วย `addCycles(anchor, cycle, k)` / `nextCycleAfter(...)` ไม่งั้นวันตัดเงินยุบเป็นวันที่ 28 ถาวร
- **action ที่แข่งกับ request อื่นใช้รูปแบบ `commit()` ใน `SubscriptionsService`** — ค่าที่อ่านมาตอนตรวจสิทธิ์ (สถานะ, วันรอบ, แผน) ถูกใส่กลับเข้า `where` ของ `updateMany` แล้วเช็ค `count === 0` → 409 ให้ผู้ใช้รีเฟรช
- **นิยามที่ใช้ร่วมกันต้องมีตัวเดียว** — `VISIBLE_PRODUCT` (ลูกค้าเห็นได้) · `BILLABLE_PRODUCT` (ยังเรียกเก็บเงินได้ — ไม่ดู `isActive`) · `EngineService.dueSubscriptions()` (ถึงรอบ)

---

## 8. ที่ค้างไว้โดยตั้งใจ

| # | เรื่อง | ทำเมื่อไหร่ |
|---|---|---|
| ~~A-8~~ | ~~ยิง refresh token ที่ logout ไปแล้วซ้ำ → เตะเจ้าของออกทุกเครื่อง~~ | ✅ แก้แล้วใน Phase 3 (`revoked_reason` + CHECK + เทส A-8 ใน `auth.e2e-spec.ts`) |
| ~~—~~ | ~~`refresh_tokens` ที่หมดอายุไม่มีใครลบ~~ | ✅ engine ลบให้ทุกวัน (`purgeExpiredTokens`) |
| — | หน้าจอ admin คุม engine (Run now / time-travel / ตาราง `engine_runs`) | Phase 6 — endpoint พร้อมแล้ว เหลือหน้าจอ |
| ~~—~~ | ~~auto-confirm ออเดอร์ที่ `shipped` เกิน 7 วัน~~ | ✅ ทำแล้วใน Phase 4.5 — นับจาก `orders.shipped_at` และ **ไม่แตะ `confirmed_at`** |
| ~~—~~ | ~~ประวัติออเดอร์, ยืนยันรับของ, แจ้งปัญหา, รีวิว~~ | ✅ ทำแล้วใน Phase 4.5 |
| — | หน้า moderation ของ admin ที่รวมเคสปัญหา + อัตรายกเลิกต่อร้าน | Phase 6 — ข้อมูลพร้อมแล้วใน `order_issues` / `orders.cancelled_at` |
| A-7 | register บอกได้ว่าอีเมลมีในระบบ (ปิดช่องทาง timing แล้ว เหลือ status code) | ยอมรับความเสี่ยง — แก้จริงต้องมี email verification |

รายละเอียดและวิธีแก้ของแต่ละข้ออยู่ใน [security-design.md §5](security-design.md)

---

## 9. Phase 3 ทิ้งอะไรไว้ให้ (อ่านก่อนแตะ subscription/engine)

- **7 actions** อยู่ใน `SubscriptionsService` ท้ายไฟล์ ทุกตัวผ่านเมธอด `commit()` ตัวเดียว (transaction + event + optimistic where) — action ใหม่ให้เขียนตามรูปแบบนั้น อย่าเขียน `update` เองแยก
- **`cycle_anchor_date`** คือหมุดของกริดรอบ · ห้ามคำนวณวันรอบด้วยการบวกทบจาก `nextOrderDate` เดิม ใช้ `nextCycleAfter(anchor, cycle, after)` เท่านั้น
- **engine** อยู่ที่ `EngineService.run(runDate)` · `dueSubscriptions()` เป็นนิยามเดียวของ "ถึงรอบ" · ออเดอร์ + payment + การเลื่อนวัน อยู่ในทรานแซกชันเดียวกันเพื่อให้ "เลื่อนเฉพาะที่ insert สำเร็จ" เป็นจริงโดยอัตโนมัติ
- **cron ข้ามการทำงานเมื่อ `NODE_ENV=test`** — ถ้าจะทดสอบตัว cron เองต้องเรียก `run()` ตรง
- **time-travel** ต้องครบ 3 อย่าง: role admin + `DEMO_MODE=true` + `NODE_ENV` อยู่ใน allowlist (`.env` ของเครื่องนี้ตั้ง `DEMO_MODE=true` ไว้แล้ว)

## 10. Phase 4 ทิ้งอะไรไว้ให้ (อ่านก่อนแตะฝั่งร้าน)

- **`ShopService.requireShop()` / `requireOperableShop()`** คือคำตอบเดียวของ "ร้านไหนคือร้านของคนนี้ และยังทำงานได้ไหม" — service ฝั่งร้านทุกตัวเรียกผ่านสองเมธอดนี้ ห้าม query `shops` เอง
- **ownership ของฝั่งร้านอยู่ใน `where` ผ่านความสัมพันธ์** เช่น `where: { id, shop: { ownerId } }` และ `subscription: { plan: { product: { shop: { ownerId } } } }` — ไม่มี endpoint ไหนรับ `shopId` จาก client
- **ร้านเห็นข้อมูลผู้ซื้อเท่าที่ต้องส่งของ** — dashboard/forecast เป็น aggregate · ออเดอร์ส่งเฉพาะ `recipient` ที่อ่านจาก `address_snapshot` ทีละคีย์
- **`advance` ไม่รับ status จาก client** — เพิ่มสถานะใหม่เมื่อไหร่ให้แก้ที่ `NEXT_STATUS` ตัวเดียว
- **ขึ้นราคา = แจ้งสมาชิก** อยู่ในทรานแซกชันเดียวกันเสมอ (ราคาเปลี่ยนแล้วแจ้งไม่สำเร็จต้องไม่เกิดขึ้น)
- Cloudinary: ใส่ `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` ใน `anan-api/.env` แล้ว `POST /uploads/signature` ใช้ได้ทันที (อ่าน env ตอนเรียกจริง ไม่ต้องรีสตาร์ต)

## 10.1 ข้อตกลงที่ตัดสินใจตอน Phase 4 (อย่าเปลี่ยนโดยไม่คุยกัน)

- **ระงับร้าน = ห้ามรับเงินใหม่ แต่ของที่รับเงินไปแล้วต้องส่งให้จบ** — `advance` ใช้ `requireShop`
  ส่วนการแก้ร้าน/สินค้า/ราคา ใช้ `requireOperableShop` · ที่อยู่ผู้ซื้อถูกปิดบังเฉพาะออเดอร์ที่ปิดไปแล้ว
- **"เสียเปรียบ" ไม่ได้มีแค่ราคาขึ้น** — ลดจำนวนชิ้นต่อรอบโดยคงราคาก็ต้องแจ้งสมาชิก (เทียบราคาต่อชิ้น)
- **ตัวเลขที่ร้านเห็นต้องใช้ตัวกรองเดียวกับ engine** (`BILLABLE_PRODUCT`) — ไม่งั้น dashboard โชว์รายได้ที่ไม่มีวันเกิด
- **forecast นับ "จำนวนรอบที่จะเกิด" ไม่ใช่ "จำนวนสมาชิก"** — รอบ 2 สัปดาห์ในช่วง 30 วันคือ 2-3 ออเดอร์

## 11. Phase 4.5 ทิ้งอะไรไว้ให้ (อ่านก่อนแตะออเดอร์/เคสปัญหา/รีวิว)

- **`orders.confirmed_at` มีทางเขียนทางเดียวคือ `POST /orders/:id/confirm` ของผู้ซื้อ** — ห้ามเพิ่มฟิลด์นี้ลง DTO ฝั่งร้านหรือให้ engine ตั้งค่าเด็ดขาด (นี่คือสิ่งที่ feature 16 มีไว้เพื่อแก้) · engine ปิดออเดอร์ได้แค่ `status = 'delivered'`
- **"ได้รับของแล้ว" = `orders.status = 'delivered'`** ใช้เป็นเงื่อนไขเดียวกันทั้งที่ `upsertReview()` และที่ `_count` บนการ์ด subscription — เปลี่ยนที่หนึ่งต้องเปลี่ยนอีกที่ ไม่งั้นหน้าจอเปิดปุ่มแล้ว API ตอบ 422
- **1 ออเดอร์ = 1 เคส** บังคับที่ DB (`UNIQUE(order_id)`) และ service ดัก P2002 → 409 `ISSUE_EXISTS` · ห้ามเปลี่ยนเป็น "เช็คก่อนเขียน"
- **ยกเลิกออเดอร์ไม่แตะ subscription** — ตั้งใจ (เขียนเหตุผลในเล่มแล้ว) · ถ้าจะเพิ่มการหยุดรายการต้องเป็นการตัดสินใจของผู้ซื้อเอง
- **`payments_lifecycle`** เป็น CHECK เดียวที่คุมทั้ง paid/refunded/failed — เพิ่มสถานะการจ่ายเงินใหม่ต้องแก้ที่นี่ด้วย ไม่ใช่แค่ enum
- `orders.shipped_at` คือฐานของการนับ 7 วัน — **ห้ามใช้ `cycle_date`** (ร้านส่งช้าจะโดนปิดออเดอร์ก่อนของถึง)
- **ลำดับเคสใน `e2e/specs/orders.spec.ts` มีความหมาย** — TC-063 (รีวิวถูกล็อก) ต้องอยู่ก่อน TC-064 (กดยืนยันรับของใบนั้น)

## 12. Phase 5 ทิ้งอะไรไว้ให้ (อ่านก่อนแตะเรื่องเงิน)

- **`PaymentProvider` เป็นทางเดียวที่เปลี่ยนสถานะการจ่ายได้** — checkout · engine · `retry-payment` เรียกผ่านตัวนี้หมด · ห้ามเขียน `status: 'paid'` ตรงในโค้ดใหม่เด็ดขาด (ไม่งั้นจุดที่ต่อ gateway จริงในอนาคตจะกระจายไปทั่ว)
- **บัตรลงท้าย `0000` = ถูกปฏิเสธเสมอ** (`DEMO_DECLINE_LAST4`) — เป็นค่าที่เทสอัตโนมัติและสคริปต์เดโม่พึ่งพา อย่าเปลี่ยนโดยไม่แก้ทั้ง `payments.e2e-spec.ts` และ `specs/payments.spec.ts`
- **ออเดอร์ที่ `payments.status = 'failed'` ต้องไม่ถึงตาร้านทุกเส้นทาง** — `PAID_ONLY` ใน `SellerOrdersService` คือด่านนั้น · เพิ่ม query ใหม่ฝั่งร้านเมื่อไหร่ต้องใส่ตัวกรองนี้ด้วย
- **checkout ที่จ่ายไม่ผ่าน rollback ทั้งก้อน แต่ engine ไม่** — คนละเจตนากัน (ดูเหตุผลใน [feature 09](../context/planing/09-payment-demo.md)) อย่าทำให้เหมือนกันเพราะเห็นว่า "ไม่สม่ำเสมอ"
- เลขที่ใบเสร็จคำนวณจาก id ออเดอร์ ไม่ได้เก็บในตาราง — ถ้าวันหนึ่งต้องรันเลขตามกฎหมาย นั่นคือคอลัมน์ใหม่ + sequence ไม่ใช่แก้ฟังก์ชันเดิม

## 13. Phase 6 ทิ้งอะไรไว้ให้ (อ่านก่อนแตะส่วนผู้ดูแล)

- **`@Roles('admin')` อยู่ที่ระดับ class ของทั้ง `AdminController` และ `ModerationController`** — endpoint ใหม่ในสองไฟล์นี้ถูกปิดโดยปริยาย ห้ามย้ายไปใส่ทีละเมธอด (ลืมเมื่อไหร่คือรูรั่วทันที)
- **การระงับต้องผ่าน `ModerationService.applySuspension()` เท่านั้น** — มันคือที่เดียวที่รับประกันว่า "ระงับแล้วเงินหยุด": เขียน `suspended_at` + แช่แข็ง subscription + event + แจ้งเตือน อยู่ในทรานแซกชันเดียว · อย่าเพิ่มทางลัดที่ `update shops set suspended_at` ตรง ๆ
- **`is_active` (ร้านปิดเอง) กับ `suspended_at` (แอดมินระงับ) คนละความหมาย** — ห้ามยุบเป็นคอลัมน์เดียว ไม่งั้นร้านที่ถูกระงับปลดแบนตัวเองได้
- คืนสถานะใช้กฎเดียวกับปุ่ม "กลับมาใช้งาน" ของผู้ซื้อ: `next_order_date = max(เดิม, พรุ่งนี้)` และขยับ `cycle_anchor_date` ตามเมื่อวันรอบถูกเลื่อน
- **เทส Playwright ของ admin สร้างร้านของตัวเองขึ้นมาใหม่** ไม่แตะร้านของ seed — เพราะการระงับร้านกระทบ subscription ของ spec อื่นที่รันทีหลัง (`admin.spec.ts` เรียงเป็นไฟล์ที่ 2 ตามตัวอักษร)
- ตัวเลข MRR ของ admin กับของร้านต้องมาจาก `cyclesPerMonth` ตัวเดียวกันเสมอ

## 14. Phase 7 เริ่มยังไง (Polish + Deploy)

1. อ่าน [W09](../context/workflows/w09-demo-script.md) (สคริปต์เดโม่) แล้วไล่ซ้อมจริงหนึ่งรอบก่อน — จะเห็นเองว่าหน้าไหนยังขาด
2. งานที่ค้างไว้โดยตั้งใจและควรทำในเฟสนี้: หน้ารวมการแจ้งเตือน ([08](../context/planing/08-notifications.md)) · แถวคะแนนในตารางเทียบ ([04](../context/planing/04-compare.md)) · หน้าจัดการบัตร ([09](../context/planing/09-payment-demo.md)) · เลือกรูปจากเครื่องด้วย Cloudinary จริง ([11](../context/planing/11-seller-products.md))
3. ก่อนส่ง: ไล่ [security-rules.md](security-rules.md) §G ให้ครบ (G-1…G-6) แล้วเก็บผลตาราง F-3 ลงเล่มเป็นหลักฐาน
