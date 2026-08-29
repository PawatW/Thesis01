# ANAN — Security Rules & Checklist (ใช้ตรวจทุกครั้ง)

> อัปเดต: 2026-08-16 · เขียนใหม่สำหรับสถาปัตยกรรม NestJS — เหตุผลเบื้องหลังแต่ละข้ออยู่ใน [security-design.md](security-design.md)
> **วิธีใช้:** ก่อนปิดงานทุก feature ที่แตะ DB / auth / payment / upload / endpoint ใหม่ → รัน `/sec-check` (หรือไล่เอกสารนี้ด้วยมือ)
> เวอร์ชัน Supabase ของเอกสารนี้ (RLS/GRANT/RPC) เก็บไว้เทียบในเล่มได้ที่ประวัติ git

---

## กฎ 10 ข้อ (จำให้ได้ ไม่ต้องเปิดเอกสาร)

1. **UI ไม่ใช่ security** — ปุ่มที่ซ่อน / route guard ในแอปคือ UX; กฎจริงอยู่ที่ guard + service ของ API
2. **ทุก request ถือว่าเขียนด้วยมือ** — โค้ด Expo ผู้ใช้แก้ได้และยิง `curl` ตรงเข้า endpoint ได้เสมอ
3. **ownership อยู่ใน `where` ไม่ใช่ใน `if` ทีหลัง** — `findFirst({ where: { id, buyerId } })` ไม่ใช่ `findUnique({ where: { id } })` แล้วค่อยเทียบ
4. **เงิน สถานะการจ่าย และสิทธิ์ ห้ามมาจาก client** — ราคาอ่านจาก DB เสมอ ห้ามมี `amount` / `price` / `status` เป็นฟิลด์ใน DTO
5. **หลายคำสั่งที่ต้องสำเร็จพร้อมกัน = `prisma.$transaction` เดียว** ไม่ใช่หลาย request จาก client
6. **`JwtAuthGuard` เป็น global guard** เปิดเป็นรายจุดด้วย `@Public()` — ห้ามใส่ guard ทีละ controller
7. **ห้ามส่ง entity ดิบกลับ client** — map เป็น response DTO เสมอ ไม่งั้น `passwordHash`, `buyerId`, `paymentMethodId` หลุด
8. **ข้อมูลผู้ซื้อให้ร้านค้าเห็นเท่าที่ต้องส่งของ** — forecast/dashboard เป็น aggregate เสมอ
9. **ทุกฟิลด์ที่ client ป้อน ต้องมีทั้ง validator ใน DTO และ CHECK ใน DB** — ชั้นเดียวไม่พอ
10. **ห้ามเก็บเลขบัตรเต็มแม้เป็นเลขปลอม + ห้าม gateway จริงทุกกรณี** (กฎเหล็กข้อ 1 ของโปรเจกต์)

---

## A. ตรวจตอนออกแบบ (ก่อนเขียนโค้ด feature ใหม่)

- [ ] A-1 เขียนตารางไว้ว่า **actor ไหน อ่าน/เขียนอะไรได้** ก่อนลงมือ (buyer / seller / admin / ไม่ล็อกอิน / engine)
- [ ] A-2 ถามทุกครั้ง: "ถ้า client โกหกฟิลด์นี้ จะเกิดอะไร" — ฟิลด์ที่โกหกแล้วเสียหาย ต้องไม่อยู่ใน DTO เลย
- [ ] A-3 ฟีเจอร์นี้ทำให้ actor ไหนเห็นข้อมูลส่วนตัวของคนอื่นเพิ่มขึ้นไหม ถ้าใช่ ทำเป็น aggregate ได้ไหม
- [ ] A-4 มี state machine ไหม ถ้ามี → บังคับด้วย CHECK ใน DB ด้วย ไม่ใช่แค่ `if` ใน service
- [ ] A-5 **feature นี้ตอบต่างกันตาม "มีข้อมูลนี้ในระบบไหม" หรือเปล่า** — ถ้าใช่ ต้องทำให้ status, ข้อความ และเวลาตอบกลับ **เท่ากันทั้งสองเส้นทาง** (ลืมรหัสผ่านเป็นตัวอย่าง: 204 เสมอ + ไม่ `await` การส่งเมล) · รวมถึงข้อความบนหน้าจอด้วย ไม่ใช่แค่ที่ API
- [ ] A-6 **feature นี้ออก token/ลิงก์ที่ใช้ทำอะไรได้ไหม** — ถ้าใช่ ต้องครบ 4 อย่าง: เก็บ hash ไม่เก็บตัวจริง · มีวันหมดอายุ · ใช้ได้ครั้งเดียว · ขอใบใหม่แล้วใบเก่าตาย
- [ ] A-8 **feature นี้เพิ่มความสามารถให้ผู้ดูแลไหม** — ถ้าใช่ ถามต่อว่า "ถ้าบัญชี admin ถูกยึด อันนี้ทำอะไรได้บ้าง" · ความสามารถที่เสียหายระดับทั้งระบบ (เปลี่ยนปลายทางอีเมล, time-travel) ต้องมี **ด่านที่ env ของเครื่อง** ทับอีกชั้น ไม่ใช่พึ่ง role อย่างเดียว
- [ ] A-9 **การกระทำนี้ต้องมีร่องรอยไหม** — ทุกอย่างที่ผู้ดูแลทำกับข้อมูลของคนอื่นหรือกับตั้งค่าระบบ ต้องลง `audit_logs` **ในทรานแซกชันเดียวกับการกระทำ** และ `summary` ต้องมีชื่อของสิ่งที่ถูกกระทำ (ของนั้นอาจถูกลบไปแล้วตอนเปิดอ่าน)
- [ ] A-7 **feature นี้สั่งให้ระบบส่งอะไรออกไปข้างนอกไหม** (อีเมล/SMS) — ถ้าใช่ ปลายทางต้องมาจาก env ของ server เท่านั้น ห้ามมาจาก DTO และต้องมี `@Throttle()` ที่เข้มกว่าปกติ (ไม่งั้นเป็นเครื่องยิงเมลกวนฟรี)

## B. ตรวจฝั่ง API (NestJS) — ชั้นที่สำคัญที่สุด

- [ ] B-1 endpoint ใหม่ **ไม่ได้ใส่ `@Public()` โดยไม่ตั้งใจ** — ลองยิงโดยไม่มี token ต้องได้ 401
- [ ] B-2 ทุก query ที่แตะข้อมูลของผู้ใช้ มี `userId` / `buyerId` / เงื่อนไขเจ้าของร้าน **อยู่ใน `where`**
- [ ] B-3 ของที่ "มีจริงแต่ไม่ใช่ของผู้เรียก" ตอบ **404 ไม่ใช่ 403** (403 = ยืนยันว่า id นี้มีอยู่)
- [ ] B-4 DTO ไม่มีฟิลด์ต้องห้าม: `amount`, `price`, `status` ของ payment, `isAdmin`, `isSeller`, `suspendedAt`, `buyerId`, `shopId`, `confirmedAt`
- [ ] B-5 ทุก id ที่รับเข้ามาเป็น FK (addressId, paymentMethodId, subscriptionId) ถูก**ตรวจว่าเป็นของผู้เรียกจริง** ก่อนใช้
- [ ] B-6 flow ที่เขียนหลายตารางอยู่ใน `prisma.$transaction` เดียว ([architecture.md §5](architecture.md))
- [ ] B-7 response ผ่าน DTO/mapper — ไม่ `return user` / `return order` ดิบ ๆ
- [ ] B-8 error ไม่หลุด stack trace, ชื่อ constraint, หรือชื่อตาราง (ผ่าน `AllExceptionsFilter` เสมอ)
- [ ] B-9 endpoint ที่ต้องใช้ role ใส่ `@Roles('seller' | 'admin')` **และ** service ยังเช็ค ownership ซ้ำ (role ≠ เจ้าของ)
- [ ] B-10 endpoint ที่อ่อนไหว (login, register, refresh, upload) มี `@Throttle()` ที่เข้มกว่าค่ากลาง
- [ ] B-11 endpoint ที่คืนรายการ มี pagination + เพดานจำนวนแถว (กันดูดข้อมูลทั้งตารางในคำขอเดียว)
- [ ] B-12 ไม่มี `$queryRawUnsafe` ที่ประกอบสตริงจาก input ผู้ใช้ — ถ้าต้อง raw ใช้ `$queryRaw` แบบ tagged template
- [ ] B-17 **ตาราง log ต้องไม่มี endpoint แก้หรือลบ** — log ที่ผู้ถูกตรวจสอบลบได้ไม่ใช่ log · ถ้าตารางโตเกินไป ทางแก้คือ retention job ฝั่ง DB ไม่ใช่ปุ่มในหน้าจอ
- [ ] B-18 **log ต้องไม่กลายเป็นแหล่งข้อมูลรั่วเสียเอง** — ห้ามเก็บเนื้อเมล/token/รหัสผ่าน · ส่งออก API เป็นชื่อที่แสดง ไม่ใช่ uuid ของผู้ใช้
- [ ] B-13 **การเปลี่ยนรหัสผ่าน/กู้บัญชี ต้องเพิกถอน refresh token ทุกใบของบัญชีนั้นในทรานแซกชันเดียวกัน** — ไม่งั้นคนที่แอบเข้าอยู่ยังอยู่ต่อได้เต็มอายุ token ทั้งที่เจ้าของเพิ่งเปลี่ยนรหัส
- [ ] B-14 **ตัวแยกที่ตัดสินเรื่องความปลอดภัย ห้ามเป็นค่าที่ฝั่งที่ถูกกันเป็นคนกรอกเอง** — เช่น "client นี้ได้ refresh token ลง body ไหม" ต้องดูจาก `Origin` (forbidden header name · JS ปลอมไม่ได้) ไม่ใช่ header ที่ client ตั้งเองอย่าง `X-Client: native` ซึ่ง XSS ก็ใส่ได้
- [ ] B-15 **endpoint ที่กิน cookie ต้องมีด่าน CSRF ของตัวเอง** — `SameSite` อย่างเดียวไม่พอเมื่อวันหนึ่งต้องตั้งเป็น `none` (deploy คนละโดเมน) · ใช้ `AllowedOriginGuard`: มี `Origin` แล้วต้องอยู่ใน allowlist · ระวังเป็นพิเศษกับ request ที่**ไม่มีทั้ง body และ header พิเศษ** เพราะไม่มี preflight มากรองให้
- [ ] B-16 **ทุกเส้นทางที่ทำให้ token ใน cookie ใช้ไม่ได้ ต้องสั่งลบ cookie ด้วย** (refresh ล้มเหลว · logout · reset password) — httpOnly แปลว่าผู้ใช้ล้างเองไม่ได้ ถ้าไม่ลบให้ เบราว์เซอร์จะส่งใบที่ตายแล้วกลับมาเรื่อย ๆ แล้วผู้ใช้ติดวง 401 ถาวร

## C. ตรวจฝั่ง Client (Expo)

- [ ] C-1 ไม่มี JWT secret / DB URL / Cloudinary secret ที่ไหนใน `anan/` — `EXPO_PUBLIC_*` มีได้แค่ API base URL
- [ ] C-2 **เลขบัตรเต็มกับ CVV** ไม่ถูก log / ไม่เข้า state ที่ persist / ไม่ถูกส่งใน request ใด ๆ — มีแค่ใน state ของ `CardForm`
      แล้วถูกแปลงเป็น `{brand, last4, expMonth, expYear, holderName}` ที่ `features/payment/card.ts#toCardPayload` และล้างทิ้งทุกเส้นทาง
- [ ] C-3 ไม่มี import จาก `stripe` / `omise` / `2c2p` / `promptpay`
- [ ] C-4 ไม่ส่งราคา/ยอดเงิน/สถานะ payment เป็น body ของ request
- [ ] C-5 access token เก็บใน memory · refresh token ใน `expo-secure-store` (native) / **httpOnly cookie ที่ API ตั้งให้ (web)** — ไม่ log token ลง console
      **ห้ามเก็บ refresh token ลง `localStorage` / `AsyncStorage` เด็ดขาด** ทั้งสองที่นี้ JavaScript อ่านได้ = XSS ครั้งเดียวได้กุญแจบัญชีไป 7 วัน (ดู [security-design §5 · A-9](security-design.md))
- [ ] C-6 error จาก API ไม่ถูกโชว์ดิบให้ผู้ใช้ (แสดง `message` ภาษาไทยจาก API)
- [ ] C-6c **endpoint ใหม่ที่ใช้เมธอดนอกเหนือ GET/POST/PATCH/DELETE ต้องเติมใน `enableCors({ methods })` ด้วย** — ไม่งั้นเบราว์เซอร์ตัดตั้งแต่ preflight แล้วหน้าจอขึ้น "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" โดยที่ log ฝั่ง API เงียบสนิท (ไล่หาสาเหตุผิดทางได้ง่ายมาก)
- [ ] C-6b **หน้าจอไม่เติมข้อมูลที่ API ตั้งใจไม่บอก** — หน้า "ลืมรหัสผ่าน" ห้ามขึ้น "ไม่พบอีเมลนี้", หน้ารีเซ็ตห้ามแยก "ลิงก์หมดอายุ" ออกจาก "ลิงก์ไม่มีจริง" (ด่านที่ทำไว้ฝั่ง API เสียได้ด้วยข้อความบรรทัดเดียวบนจอ)
- [ ] C-7 ข้อความจากผู้ใช้ (ชื่อร้าน, ชื่อสินค้า, tracking note) render เป็น `<Text>` ธรรมดา ไม่มี `dangerouslySetInnerHTML` / `WebView` ที่รับ HTML จากข้อมูลผู้ใช้
- [ ] C-8 route guard มีครบ **และ** ทดสอบแล้วว่าถ้าข้าม guard ไปได้ API ก็ยังปฏิเสธ (ป้องกัน 2 ชั้น) — รวมหน้าอย่าง `checkout/`
- [ ] C-9 **ปุ่มที่สร้างข้อมูล/ตัดเงิน ต้องมี re-entrancy guard ด้วย `useRef`** ไม่ใช่แค่ `disabled` จาก state — state อัปเดตหลัง re-render จึงกันการกดรัวในเฟรมเดียวกันไม่ได้ · **ทดสอบด้วยการยิง click 5 ครั้งติดกันแล้วนับแถวใน DB** _(เดิม B-11)_
- [ ] C-10 **ห้ามใช้ `toISOString()` เพื่อสร้างวันที่ปฏิทิน** — ใช้ helper ที่อิง Asia/Bangkok เสมอ _(เดิม B-12)_
- [ ] C-11 การเรียก API ต้อง typed — ห้าม `as never` / `as any` ปิด type บนเส้นทางที่เกี่ยวกับเงิน _(เดิม B-13)_

## D. ตรวจฝั่ง Database (ทุก migration)

- [ ] D-1 คอลัมน์ text/numeric ที่ client ป้อน มี CHECK จำกัดความยาว/รูปแบบ/ช่วง (ใน migration `check_constraints`)
- [ ] D-2 การกระทำที่ห้ามซ้ำ มี UNIQUE รองรับ — `orders(subscription_id, cycle_date)`, `payments(order_id)`, `reviews(subscription_id)`, `order_issues(order_id)`
- [ ] D-3 state machine ที่เป็นข้อเท็จจริงของข้อมูล อยู่ใน CHECK — เช่น `subs_state_consistent` ที่ทำให้ "cancelled คือถาวร" เป็นกฎของ DB
- [ ] D-4 คอลัมน์ที่ denormalize ไว้ ต้องมีอะไรบังคับให้ตรงกับต้นทาง — เช่น `orders.buyer_id` เป็นส่วนหนึ่งของ FK คู่ `(subscription_id, buyer_id)`
- [ ] D-5 role ที่แอปใช้ (`anan_app`) **ไม่ใช่ superuser** และเป็นเจ้าของเฉพาะฐาน `anan`
- [ ] D-6 migration ที่เขียนมือ (CHECK / partial index) ไม่ถูกลบทิ้งตอนรัน `migrate dev` ครั้งถัดไป — ตรวจด้วย §F-2
- [ ] D-7 ไม่แก้ DB ตรงผ่าน pgAdmin โดยไม่มี migration

## E. ตรวจ Engine / งานเบื้องหลัง

- [ ] E-1 engine ตรวจสถานะร้าน/สินค้า (`suspendedAt`) ทุกครั้ง ไม่ใช่ดูแค่สถานะ subscription
- [ ] E-2 idempotency มาจาก UNIQUE ที่ DB ไม่ใช่จากการเช็คใน service
- [ ] E-3 ใช้เงื่อนไข `nextOrderDate <= runDate` (เก็บตกรอบที่พลาด) ไม่ใช่ `=`
- [ ] E-4 endpoint time-travel (`runDate` กำหนดเอง) ใช้ได้เฉพาะ role admin **และ** เมื่อ `NODE_ENV !== 'production'`
- [ ] E-5 engine ไม่ทำงานทับกันเอง — รอบที่รันอยู่ต้องไม่ถูกยิงซ้อน

---

## F. คำสั่งตรวจอัตโนมัติ

### F-1 สแกน codebase (PowerShell — รันที่ `c:\Users\pavat\Thesis`)

```powershell
# ความลับหลุดเข้าฝั่งแอป — ต้องได้ 0 แถว
Get-ChildItem anan\src, anan\app, anan\app.json, anan\.env* -Recurse -File |
  Select-String -Pattern 'JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|DATABASE_URL|CLOUDINARY_API_SECRET'

# gateway จริง — ต้องได้ 0 แถว
# ★ ต้องมี \b ★ ไม่งั้น `omise` ไปแมตช์กับคำว่า `Promise` แล้วได้ผลลัพธ์ปลอมเป็นร้อยแถว
# (เจอตอนปิด Phase 3 — สแกนที่ส่งเสียงดังทุกครั้งเท่ากับไม่มีสแกน)
Get-ChildItem anan\src, anan-api\src -Recurse -File |
  Select-String -Pattern '\bstripe\b|\bomise\b|2c2p|promptpay' -CaseSensitive:$false

# controller ห้ามรู้จัก Prisma — ต้องได้ 0 แถว
Get-ChildItem anan-api\src -Recurse -Filter *.controller.ts |
  Select-String -Pattern 'PrismaService|prisma\.'

# raw SQL ที่ประกอบสตริง — ต้องได้ 0 แถว (ยกเว้น seed/สคริปต์ตรวจ)
Get-ChildItem anan-api\src -Recurse -Filter *.ts |
  Select-String -Pattern '\$queryRawUnsafe|\$executeRawUnsafe'

# findUnique ที่อาจลืม ownership — ดูด้วยตาทุกจุดว่ามี userId/buyerId ใน where
Get-ChildItem anan-api\src -Recurse -Filter *.service.ts |
  Select-String -Pattern 'findUnique'
```

### F-2 ตรวจว่าชั้น DB ยังครบ

```powershell
cd anan-api
npx prisma migrate status                                  # ต้องขึ้น "Database schema is up to date!"
npx prisma migrate diff --from-schema-datasource prisma\schema.prisma `
                        --to-schema-datamodel  prisma\schema.prisma --script
# ↑ อ่านอย่างเดียว ไม่แก้อะไร · ต้องได้ "-- This is an empty migration."
#   ถ้ามีคำสั่ง DROP INDEX/CONSTRAINT โผล่มา = Prisma กำลังจะลบของที่เราเขียนมือ
#   (ตรวจครั้งล่าสุด 2026-08-17: partial index กับ CHECK ทั้งหมดไม่ถูกมองว่าเป็น drift)
npm run test:e2e -- db-invariants                          # CHECK/FK/UNIQUE ยังปฏิเสธข้อมูลเสียจริง
```

### F-3 ยิง API ตรงเพื่อพิสูจน์ (ทำอย่างน้อย 1 รอบต่อเฟส)

ใช้ JWT ของบัญชีธรรมดา ยิงตรงด้วย curl/REST client — **ทุกข้อต้องถูกปฏิเสธ** และควรมีเป็น e2e test คู่กัน:

| # | ทดสอบ | ต้องได้ |
|---|---|---|
| T-1 | `PATCH /me` body `{"isAdmin":true}` | 400 (ฟิลด์ไม่อยู่ใน DTO → `forbidNonWhitelisted`) |
| T-2 | `POST /subscriptions` body แนบ `{"amount":0}` | 400 · และยอดที่บันทึกต้องมาจากราคาใน DB |
| T-3 | `POST /subscriptions` ด้วย `addressId` ของคนอื่น | 404 (ownership check) |
| T-4 | `POST /subscriptions` บนแผนที่ `isActive = false` | 409 |
| T-5 | `GET /subscriptions/:id` ของผู้ซื้อคนอื่น | 404 (ไม่ใช่ 403) |
| T-6 | `POST /subscriptions/:id/resume` บนรายการที่ `cancelled` | 409 |
| T-7 | `POST /subscriptions/:id/resume` บนรายการที่ `pausedReason = 'shop_suspended'` | 409 — ผู้ซื้อปลดแช่แข็งเองไม่ได้ |
| T-8 | `PATCH /seller/orders/:id` ของออเดอร์ร้านอื่น | 404 |
| T-9 | `PATCH /seller/orders/:id` body `{"status":"delivered"}` จาก `pending` | 409 (ข้ามขั้นไม่ได้) |
| T-10 | `PATCH /seller/orders/:id` body `{"confirmedAt":"..."}` หรือ `{"amount":0}` | 400 — ร้านยืนยันรับของแทนผู้ซื้อไม่ได้ |
| T-11 | `GET /admin/stats` ด้วย JWT ธรรมดา | 403 |
| T-12 | `PATCH /admin/shops/:id` (ปลดระงับร้าน) ด้วย JWT ของเจ้าของร้าน | 403 |
| T-13 | `GET /seller/orders` ด้วย JWT ร้าน B | ไม่มีออเดอร์ร้าน A ปน และ response ไม่มี `buyerId` / `paymentMethodId` |
| T-14 | `GET /seller/forecast` | เป็นตัวเลขรวม ไม่มีรายชื่อผู้ซื้อ |
| T-15 | `POST /orders/:id/confirm` บนออเดอร์ของคนอื่น | 404 |
| T-16 | `POST /reviews` บน subscription ที่ยังไม่เคยได้รับของ | 422 |
| T-17 | `GET /catalog/products/:id` — ส่วนรีวิว | ไม่มี `buyerId` / `subscriptionId` และชื่อผู้รีวิวถูก mask |
| T-18 | ระงับร้าน → รัน engine | ไม่มีออเดอร์/`payments` เกิดให้ร้านนั้นเลย และ subscription ทุกใบเป็น `paused` + `pausedReason='shop_suspended'` |
| T-19 | รัน engine ซ้ำวันเดิม | จำนวนออเดอร์เท่าเดิม (unique `subscription_id + cycle_date`) |
| T-20 | `POST /engine/run` ด้วย JWT ธรรมดา | 403 |
| T-21 | กดปุ่ม "ยืนยันสมัคร" 5 ครั้งรวดเดียว | เกิด subscription **1 รายการ** order 1 ใบ payment 1 แถว — นับใน DB ไม่ใช่ดูหน้าจอ |
| T-22 | เปิด `/checkout/<planId>` ตรง ๆ ขณะยังไม่ล็อกอิน | เด้งไป login ทันที ไม่แสดงฟอร์มกรอกเลขบัตร |
| T-23 | ยิง `POST /auth/login` รหัสผิดรัว ๆ 20 ครั้ง | โดน 429 · และข้อความ error ต้องไม่บอกว่า "อีเมลนี้ไม่มีในระบบ" (user enumeration) |
| T-24 | ใช้ refresh token เดิมซ้ำหลังจาก refresh ไปแล้ว | 401 — token ต้องถูก rotate และตัวเก่าใช้ไม่ได้ |
| T-25 | ยิง endpoint ใด ๆ ด้วย access token ที่หมดอายุ / เซ็นด้วย secret อื่น | 401 |

> เก็บผลการทดสอบชุดนี้เป็น **ตารางในเล่ม thesis** — เป็นหลักฐานเชิงประจักษ์ว่า authorization ทำงานจริง ไม่ใช่แค่เขียนไว้

## G. ตรวจก่อนเดโม่ / ก่อนส่งเล่ม

- [ ] G-1 บัญชี demo ทุกใบใช้รหัสผ่านที่ไม่ใช่ของจริงของใคร และไม่มี PII จริงใน seed
- [ ] G-2 `isAdmin` ตั้งผ่าน seed เท่านั้น — ไม่มี endpoint ไหนสร้าง admin ได้
- [ ] G-3 repo ไม่มี `.env` ที่มีค่าจริง commit ติดไป (`.gitignore` ครอบ `.env*` ยกเว้น `.env.example`)
- [ ] G-4 ป้าย "DEMO — ไม่มีการตัดเงินจริง" ครบทุกจุดที่มี**ตัวเลขเงิน** — **ยกเว้นหน้าจอผูกบัตร** ที่ไม่มียอดเงินอยู่บนจอ
      และตั้งใจให้ทำงานเหมือนฟอร์มบัตรจริง (CLAUDE.md กฎข้อ 1)
- [ ] G-5 JWT secret ของ production สุ่มใหม่ ไม่ใช่ค่าเดียวกับตอน dev
- [ ] G-6 รัน F-1, F-2, F-3 ครบรอบสุดท้าย

---

## เมื่อไหร่ต้องรันอะไร

| สถานการณ์ | ต้องทำ |
|---|---|
| เพิ่ม endpoint ใหม่ | B ทั้งหมด + T ข้อที่เกี่ยว + e2e 3 เคสตาม [testing.md §3](testing.md) |
| เขียน migration ใหม่ | D ทั้งหมด + F-2 |
| แตะ auth / token | B-1, B-10, T-23, T-24, T-25 |
| แตะเรื่อง payment / บัตร | C-2, C-3, C-4, G-4 + กฎเหล็กข้อ 1 |
| แตะ engine | E ทั้งหมด + T-18, T-19, T-20 |
| เขียนหน้าจอที่ยิง API ใหม่ | C-4, C-6, C-8, C-9 |
| ปิดเฟส | A–G ทั้งหมด (F-3 เต็มชุด) |
