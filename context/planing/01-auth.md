# Feature 01: Auth — สมัครสมาชิก / ล็อกอิน / บทบาท

> เฟส: 1 | ฝั่ง: ทุกคน | สถานะ: ✅ เสร็จ (Phase 1) | Workflows: [W01](../workflows/w01-signup-login.md), [W02](../workflows/w02-open-shop.md)

## ทำอะไรได้

- สมัครสมาชิกด้วยอีเมล + รหัสผ่าน / ล็อกอิน / ล็อกเอาท์ / จำ session
- บัญชีเดียวเป็นได้ทั้ง buyer และ seller (กด "เปิดร้าน" เพื่อเพิ่ม role — เหมือน Shopee)
- แก้ไขโปรไฟล์: ชื่อ, รูป, เบอร์โทร
- จัดการที่อยู่จัดส่งหลายรายการ + ตั้งที่อยู่หลัก

## หน้าจอ & Routes (expo-router)

| Route | หน้าจอ | หมายเหตุ |
|---|---|---|
| `app/_layout.tsx` | root layout | auth gate: ไม่มี session → redirect `(auth)/login`; โหลด profile เข้า context |
| `app/index.tsx` · `(auth)/_layout.tsx` | ประตูทางเข้า | **หน้าแรกตามบทบาท** — `landingHref()` ที่ `src/features/auth/roles.ts`: ผู้ดูแล → `(admin)` · เจ้าของร้าน → `(seller)` · ที่เหลือ → `(buyer)` |
| `(auth)/login.tsx` | ล็อกอิน | ลิงก์ไปสมัคร |
| `(auth)/register.tsx` | สมัครสมาชิก | ชื่อ + อีเมล + รหัสผ่าน |
| `(auth)/forgot-password.tsx` | ลืมรหัสผ่าน — ขอลิงก์ | กรอกอีเมล → ข้อความยืนยัน **เหมือนกันทั้งกรณีที่มีบัญชีและไม่มี** |
| `(auth)/reset-password.tsx` | ตั้งรหัสผ่านใหม่ | ปลายทางของลิงก์ในอีเมล (`/reset-password?token=…`) · ไม่มี token → หน้าอธิบาย ไม่ใช่จอขาว |
| `(buyer)/profile/index.tsx` | โปรไฟล์ | แก้ข้อมูล, ปุ่มเปิดร้าน/สลับโหมด, ล็อกเอาท์ — ตัวสลับโหมด + ออกจากระบบ มีที่ท้ายแถบนำทางของทุกคอนโซลด้วย |
| `(buyer)/profile/addresses.tsx` | ที่อยู่ของฉัน | list + เพิ่ม/แก้/ลบ/ตั้งหลัก |

## Components หลัก

- `AuthProvider` (context) — ถือ session + profile, expose `useAuth()`
- `roles.ts` — `rolesOf(profile)` (คอนโซลที่บัญชีนี้เข้าได้) · `landingHref(profile)` (หน้าแรกหลังล็อกอิน) · `ROLE_META` (ชื่อ/ไอคอน/ปลายทางของแต่ละโหมด) — **ที่เดียวที่ตัดสินเรื่องบทบาทฝั่งหน้าจอ**
- `ConsoleShell` (`src/components/console/`) — เปลือกของคอนโซลแต่ละบทบาท: สีประจำโหมด · ตัวตนบนหัว · ตัวสลับโหมด · ออกจากระบบ (ดู [design-system §5.1](../../docs/design-system.md))
- `AddressForm` — reuse ทั้งหน้าที่อยู่และ inline ใน checkout ([W04](../workflows/w04-subscribe-checkout.md) A1)
- `AddressCard` — แสดงที่อยู่ + ป้าย "หลัก"

## Data & Queries (API)

| Endpoint | ใช้ที่ |
|---|---|
| `POST /auth/register` · `POST /auth/login` | สมัคร/เข้าสู่ระบบ — คืน `accessToken` + โปรไฟล์ในคำขอเดียว · `refreshToken` มาใน body **เฉพาะ client ที่ไม่ใช่เบราว์เซอร์** (เว็บได้เป็น httpOnly cookie แทน) |
| `POST /auth/refresh` · `POST /auth/logout` | ต่ออายุ (หมุน token ทุกครั้ง) / ออกจากระบบ — รับ token จาก cookie หรือ body ก็ได้ |
| `POST /auth/forgot-password` | ขอลิงก์ตั้งรหัสผ่านใหม่ — **204 เสมอ** ไม่ว่าอีเมลจะมีในระบบหรือไม่ · 3 ครั้ง/5 นาที/IP |
| `POST /auth/reset-password` | ตั้งรหัสผ่านใหม่ด้วย token จากอีเมล — 204 แล้วต้องล็อกอินใหม่ |
| `GET /me` · `PATCH /me` | โปรไฟล์ — DTO รับได้แค่ `displayName` / `phone` / `avatarUrl` |
| `GET/POST /me/addresses` · `PATCH/DELETE /me/addresses/:id` | ที่อยู่ของตัวเอง (เพดาน 20 รายการ) |

- **`isSeller` / `isAdmin` ไม่มีใน DTO ไหนเลย** — `isSeller` ถูกตั้งในทรานแซกชันเดียวกับการเปิดร้าน ส่วน `isAdmin` ตั้งผ่าน seed/SQL เท่านั้น (ไม่มี endpoint ไหนยกระดับสิทธิ์ได้)
- **access token อยู่ใน memory · refresh token อยู่ใน `expo-secure-store` (native) / httpOnly cookie ที่ API ตั้งให้ (web)** — ไม่มีฝั่งไหนเก็บไว้ในที่ที่ JavaScript อ่านได้ · จัดการที่ `anan/src/lib/api/tokens.ts` และ `client.ts` ต่ออายุให้อัตโนมัติแบบ single-flight
- **ตัวแยกว่า client ไหนได้ token ลง body คือ header `Origin`** ซึ่ง JavaScript ปลอมไม่ได้ (forbidden header name) — มี Origin = เบราว์เซอร์ → cookie เท่านั้น · ไม่มี = native → body · เหตุผลเต็มอยู่ใน [security-design.md §5 · A-9](../../docs/security-design.md)
- **refresh token ถูกหมุนทุกครั้งที่ใช้** และเก็บเป็น sha256 hash ไม่ใช่ตัว token · ใบที่ถูกหมุนแล้วถูกใช้ซ้ำ = ตีความว่ารั่ว → เพิกถอนทั้งบัญชี (ส่วนใบที่ logout ไปแล้วตอบ 401 เฉย ๆ — `revoked_reason`)
- ตั้งที่อยู่หลัก: ส่ง `isDefault: true` อันเดียวพอ — partial unique index ที่ DB บังคับให้เหลือหลักอันเดียวเสมอ

### ลืมรหัสผ่าน (เพิ่ม 2026-08-22)

- **ตั๋วอยู่ในตาราง `password_reset_tokens`** เก็บเป็น sha256 ไม่ใช่ตัว token (เหมือน refresh token) · CHECK `password_reset_tokens_hash_fmt` บังคับว่าคอลัมน์นั้นต้องเป็น hex 64 ตัว → เขียน token ดิบลงไปไม่ได้แม้จะพลาด
- **อายุ 30 นาที · ใช้ได้ครั้งเดียว · ขอใบใหม่ = ใบเก่าตายทันที** (`used_at` ครอบทั้ง "ใช้แล้ว" และ "ถูกแทนที่")
- **ตั้งรหัสใหม่สำเร็จ = เพิกถอน refresh token ทุกใบของบัญชีนั้น** (`revoked_reason = 'password_reset'`) — ถ้าไม่ตัด คนที่แอบเข้าบัญชีอยู่ยังอยู่ต่อได้อีก 7 วันทั้งที่เจ้าของเพิ่งเปลี่ยนรหัส · ใบที่ปิดด้วยเหตุนี้ถูกใช้ซ้ำแล้ว**ไม่**ถือว่ารั่ว (เหมือน `logout` — ดู A-8)
- **ส่งด้วย SMTP จริงผ่าน `MailService`** (`nodemailer`) · ตั้งค่าที่ `SMTP_*` + `MAIL_FROM` + `APP_WEB_URL` ใน `.env` ของ API — ปล่อยว่างบนเครื่องพัฒนาได้ ระบบจะพิมพ์ลิงก์ลง log แทน แต่ `NODE_ENV=production` แล้ว `SMTP_HOST`/`MAIL_FROM` ต้องมีค่าไม่งั้น API ไม่บูต
- **ปลายทางของลิงก์มาจาก `APP_WEB_URL` ของ API เท่านั้น** — DTO ไม่มี `redirectTo`/`callbackUrl` โดยตั้งใจ ไม่งั้นใครก็สั่งให้ระบบส่งเมลที่ดูน่าเชื่อถือพร้อมลิงก์ไปเว็บของตัวเองได้
- **การส่งเมลไม่ถูก `await`** — เวลาตอบกลับต้องไม่ผูกกับความเร็วของ SMTP ไม่งั้นจับเวลาแล้วแยกได้ว่าเส้นทางไหนมีการส่งเมลจริง
- ตั๋วที่หมดอายุถูกลบทิ้งโดย engine รอบเดียวกับที่เก็บกวาด refresh token (`purgeExpiredTokens`)

## Validation & Edge cases

- รหัสผ่าน ≥ 10 ตัว + อีเมล format — validate ทั้งใน DTO ของ API (ด่านจริง) และฝั่งแอปเพื่อให้ error อ่านง่าย · **ไม่มี leaked-password protection แล้ว** หลังเลิกใช้ Supabase Auth (บันทึกเป็นข้อจำกัดในเล่ม)
- ที่อยู่: รหัสไปรษณีย์ 5 หลัก, เบอร์ 6-20 ตัว, ชื่อผู้รับ ≤ 100 ตัว — DB มี CHECK บังคับซ้ำ ให้ client validate ก่อนเพื่อ error ที่อ่านง่าย
- อีเมลซ้ำ → "อีเมลนี้ถูกใช้แล้ว" + ลิงก์ไป login
- ล็อกอินผิด → ข้อความรวม "อีเมลหรือรหัสผ่านไม่ถูกต้อง" (ไม่บอกว่าผิดช่องไหน)
- ลิงก์รีเซ็ตที่ใช้ไม่ได้ (ไม่มีจริง / ใช้ไปแล้ว / หมดอายุ) → **ข้อความเดียวกันทั้งสามกรณี** `INVALID_RESET_TOKEN` — การแยก "หมดอายุ" ออกจาก "ไม่มีใบนี้" คือการยืนยันว่าเคยมีใบนั้นจริง
- หน้า "ลืมรหัสผ่าน" ห้ามขึ้นข้อความว่า "ไม่พบอีเมลนี้" เด็ดขาด — ด่านที่ทำไว้ฝั่ง API จะเสียไปกับข้อความบรรทัดเดียวบนหน้าจอ
- ลบที่อยู่ที่ subscription ใช้อยู่ → **บล็อกโดย FK restrict** — แสดง "ที่อยู่นี้ถูกใช้ใน subscription — เปลี่ยนที่อยู่ใน subscription ก่อน"
- ลบที่อยู่หลักอันสุดท้ายได้ แต่ checkout ครั้งหน้าจะบังคับเพิ่มใหม่

## Acceptance Criteria

- [ ] สมัคร → ปิดแอพ → เปิดใหม่ → ยังล็อกอินอยู่ (ทั้ง web และ mobile)
- [ ] สมัครแล้วมีแถว `profiles` เกิดอัตโนมัติ display_name ถูกต้อง
- [ ] เพิ่มที่อยู่ 2 อัน สลับตัวหลักได้ default เดิมถูกปลด
- [ ] อีเมลซ้ำ/รหัสผิด แสดง error ถูกต้อง ไม่ crash
- [ ] ล็อกเอาท์แล้วกลับหน้า login และกด back ไม่หลุดเข้าแอพ
- [ ] **ยิง `PATCH /rest/v1/profiles` ตรงด้วย `{"is_admin":true}` แล้วถูกปฏิเสธ** ([security-rules.md T-1](../../docs/security-rules.md))
- [x] กด "ลืมรหัสผ่าน?" → กรอกอีเมล → เปิดลิงก์ → ตั้งรหัสใหม่ → ล็อกอินด้วยรหัสใหม่ได้ (TC-094/TC-096)
- [x] อีเมลที่ไม่มีในระบบได้ข้อความเดียวกันเป๊ะ และไม่มีตั๋วเกิดใน DB (TC-095)
- [x] ลิงก์ที่ใช้ไปแล้ว/หมดอายุ ขึ้นข้อความเดียวกันและไม่เปลี่ยนรหัสผ่าน (TC-097)
- [x] ตั้งรหัสใหม่แล้ว refresh token ทุกใบของบัญชีนั้นถูกเพิกถอนใน DB (TC-096)

## ข้อมูลที่เกี่ยวข้อง

`profiles`, `addresses` — ดู [database-schema](../../docs/database-schema.md); trigger `handle_new_user` อยู่ใน migration แรก

## Out of scope

- Social login (Google/Facebook), ยืนยันอีเมล/OTP ตอนสมัคร, ระบบ admin กลาง
- ~~ลืมรหัสผ่าน~~ → **ทำแล้ว 2026-08-22** (ผู้ใช้สั่งให้เพิ่ม · เลือกทาง SMTP จริง ไม่ใช่โหมดเดโม่)
- **การเปลี่ยนรหัสผ่านจากในแอปตอนที่ล็อกอินอยู่** ยังไม่มี — คนละ flow กัน (ต้องยืนยันรหัสเดิมก่อน) ทำเมื่อถูกสั่ง
