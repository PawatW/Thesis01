# ย้ายจาก Docker ไป Supabase Cloud

> อัปเดต: 2026-08-15 · ทำครั้งเดียว หลังจากนี้ไม่ต้องเปิด Docker อีก

## ทำไมต้องย้าย

Docker local เร็วและ reset ได้ตลอด แต่กิน RAM ~5 GB และ **มือถือเชื่อม `localhost` ของคอมไม่ได้** ซึ่งจำเป็นตอนทดสอบด้วย Expo Go และตอนเดโม่ Cloud ยังเปิดใช้ leaked-password protection ได้ (เป็นฟีเจอร์ฝั่ง cloud เท่านั้น)

ของที่เตรียมไว้แล้วให้ทำงานได้โดยไม่มี Docker:

| เดิม (ผูกกับ Docker) | ใหม่ (ต่อ DB ตรง) |
|---|---|
| `supabase test db` | `npm run test:db` → `scripts/run-tests.mjs` (pg driver + parse TAP เอง) |
| `docker exec … psql < audit.sql` | `npm run audit:security` → `scripts/run-sql.mjs` |
| `supabase db reset` (มี seed ให้) | `npm run db:push` แล้ว `npm run db:seed` |
| `supabase gen types --local` | `npm run db:types` (ใช้ `--linked`) |

---

## 3 ขั้นตอนที่ต้องทำเอง

### 1. สร้าง project

ไปที่ **supabase.com** → Sign in with GitHub → **New project**

| ช่อง | ใส่อะไร |
|---|---|
| Name | `anan` |
| Database Password | **กดสุ่มแล้วเก็บไว้** — ใช้ในขั้นที่ 3 และกู้คืนไม่ได้ ต้อง reset ใหม่ถ้าลืม |
| Region | **Southeast Asia (Singapore)** — ใกล้ไทยที่สุด latency ต่ำสุด |
| Plan | Free |

รอสร้างเสร็จ ~2 นาที

### 2. เชื่อม CLI เข้ากับ project (รันเองในเทอร์มินัล เพราะมันจะถามรหัสผ่าน)

```bash
cd C:\Users\pavat\Thesis\anan
npx supabase link --project-ref <project-ref>
```

`<project-ref>` คือรหัสใน URL ของ dashboard: `https://supabase.com/dashboard/project/`**`abcdefghijklm`**

มันจะถาม database password → วางที่เก็บไว้จากขั้นที่ 1

### 3. ใส่ค่าลง `.env`

คัดลอก `.env.example` เป็น `.env` แล้วเติม 3 ค่า จาก dashboard:

| ตัวแปร | หาที่ไหน |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Project Settings → **API** → Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → **API** → anon **public** key |
| `SUPABASE_DB_URL` | Project Settings → **Database** → Connection string → **URI** (แล้วแทน `[YOUR-PASSWORD]` ด้วยรหัสจริง) |

> ⚠️ `SUPABASE_DB_URL` มีรหัสผ่านฐานข้อมูลอยู่ — `.gitignore` กัน `.env` ไว้แล้ว อย่า commit และอย่าเอาไปใส่ในตัวแปรที่ขึ้นต้น `EXPO_PUBLIC_`
>
> ⚠️ **service_role key ห้ามอยู่ในโฟลเดอร์นี้เลย** — ใช้เฉพาะใน Edge Function secrets ([security-design §2](security-design.md))

---

## หลังจากนั้น (ผมรันให้ได้)

```bash
npm run db:push        # ส่ง migration ทั้ง 6 ไฟล์ขึ้น cloud
npm run db:seed        # ข้อมูลเดโม่ + บัญชีสาธิต 5 บัญชี
npm run db:types       # generate types จาก schema บน cloud
npm run check          # typecheck + pgTAP 94 ข้อ (รันผ่าน SUPABASE_DB_URL)
npm run web            # เปิดแอพ
```

## ตั้งค่าเพิ่มใน Dashboard (ทำครั้งเดียว)

**Authentication → Providers → Email**
- Confirm email: **ปิด** (โหมด demo — บันทึกเป็นข้อจำกัดไว้แล้วใน [security-design §8 A-2](security-design.md))
- Minimum password length: **10**
- **Leaked password protection: เปิด** ← ทำได้เฉพาะบน cloud ปิดช่องว่างที่ค้างอยู่ใน roadmap

**Authentication → URL Configuration**
- Site URL: `http://localhost:8081`
- Redirect URLs: เพิ่ม `http://localhost:8081/**`

---

## ข้อควรรู้เมื่อใช้ cloud

| เรื่อง | สิ่งที่ต่างจาก local |
|---|---|
| **Project pause** | free tier จะหยุดเองถ้าไม่มีใครเรียกใช้ 7 วัน — **เข้า dashboard กด Restore ก่อนวันสอบล่วงหน้า 1 วัน** |
| **ล้าง DB** | ไม่มี `db reset` ที่ปลอดภัยแล้ว — แก้ schema ต้องเขียน migration ใหม่เสมอ (ซึ่งเป็นกฎข้อ 4 อยู่แล้ว) |
| **ทดสอบมือถือ** | `npm start` แล้วสแกน QR ด้วย Expo Go — ใช้ได้ทันทีเพราะ DB อยู่บนเน็ต |
| **ยังเปิด Docker ได้อยู่** | ถ้าอยากได้ DB เปล่าไว้ลองอะไรเสี่ยง ๆ `npm run db:start` ยังทำงาน แค่เปลี่ยน `SUPABASE_DB_URL` กลับเป็น local |
