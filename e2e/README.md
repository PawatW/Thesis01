# ANAN — Playwright e2e (ชั้น L4)

ยิงผ่านเบราว์เซอร์จริงบนแอป Expo web + API ของเราเอง + PostgreSQL จริง
ตอบคำถามที่ supertest ตอบไม่ได้: **"ผู้ใช้กดจนจบเส้นทางแล้วได้ผลตามที่ตั้งใจไหม"**

คู่กับ [docs/testing.md](../docs/testing.md) — ชั้น L1-L3 อยู่ใน `anan-api`

---

## รันยังไง

ครั้งแรกครั้งเดียว:

```bash
cd e2e && npm install && npx playwright install chromium && cp .env.example .env
```

จากนั้น:

```bash
cd e2e && npm run test:e2e
```

| คำสั่ง | ใช้ตอนไหน |
|---|---|
| `npm run test:e2e` | รันทั้งชุด (headless) |
| `npm run test:e2e:ui` | โหมด UI — ไล่ดูทีละ step ย้อนเวลาได้ |
| `npm run test:e2e:headed` | เปิดเบราว์เซอร์ให้เห็นจริง ๆ |
| `npm run test:e2e:report` | เปิด HTML report ของรอบล่าสุด |
| `npm run test:e2e -- specs/checkout.spec.ts` | รันเฉพาะไฟล์ |
| `npm run test:e2e -- --grep TC-019` | รันเฉพาะเคส |

รอบแรกใช้เวลา 3-5 นาที เพราะต้อง `nest build` และให้ Metro bundle หน้าเว็บ
ตั้ง `E2E_SKIP_API_BUILD=true` ใน `.env` ได้ถ้า `anan-api/dist` ยังใหม่อยู่

> **ไม่ต้องเปิด server เองก่อน** — `globalSetup` ยกให้ทั้ง API และ web แล้วปิดให้ตอนจบ
> ถ้ามี server อยู่ที่ port นั้นแล้ว จะใช้ตัวเดิม (แต่ยังต้องผ่านด่านตรวจ DB)

---

## ฐานข้อมูล: แยกคนละตัวและกันพลาดไว้ 3 ชั้น

ชุดนี้ **ล้างและ seed ใหม่ทุกครั้งที่รัน** ถ้าเผลอชี้ไป `anan` ของงานจริง
ข้อมูลที่กดสะสมไว้ตอนพัฒนาจะหายหมด — จึงกันไว้แบบ fail-closed:

| ชั้น | ตรวจอะไร | อยู่ที่ |
|---|---|---|
| 1 | `E2E_DATABASE_URL` ต้องมีค่า — ไม่มีค่า default ให้เดา | `setup/env.ts` |
| 2 | ชื่อ database ต้องลงท้าย `_test` และต้องไม่ใช่ตัวเดียวกับใน `anan-api/.env` | `setup/env.ts` |
| 3 | **ล็อกอินผ่าน API จริงแล้วอ่านชื่อ canary กลับมาเทียบ** | `setup/global-setup.ts` |

ชั้น 1-2 พิสูจน์แค่ว่า "ตั้งค่าไว้ถูก" — **ชั้น 3 พิสูจน์ว่า process ที่กำลังรับ
request อยู่ต่อกับฐานข้อมูลทดสอบจริง ๆ** โดยเขียนชื่อพิเศษลง `users` ของ DB ทดสอบ
แล้วเรียก `/auth/login` เทียบชื่อที่ได้กลับมา ไม่ตรงเมื่อไหร่หยุดทันทีก่อนเทสแตะข้อมูล

ตัวอย่างเวลาชนด่าน:

```
ปฏิเสธการรัน: ฐานข้อมูล "anan" ไม่ได้ลงท้ายด้วย _test
```

**ไม่มี `webServer` block ใน config โดยตั้งใจ** — block นั้นสั่งได้แค่ "รันคำสั่งนี้"
ซึ่งคำสั่งจะไปอ่าน `anan-api/.env` เองแล้วชี้ไป DB งานจริง `globalSetup` จึงประกอบ
env ของ process ลูกเองทีละตัว และยืมจาก `.env` ของ API เฉพาะ `JWT_*` เท่านั้น

---

## โครงไฟล์

```
e2e/
├── playwright.config.ts     workers:1 · artifact เฉพาะตอนพัง
├── setup/
│   ├── env.ts               อ่าน env + ด่านกัน DB งานจริง
│   ├── database.ts          สร้าง / migrate / seed / ประทับ canary
│   ├── servers.ts           ยก API + Expo web · ปิด process tree ตอนจบ
│   └── global-setup.ts      ลำดับทั้งหมด + ด่านตรวจ canary ผ่าน API
├── helpers/
│   ├── selectors.ts         DOM id ทุกตัว พร้อมไฟล์ต้นทางกำกับ
│   ├── login.ts             loginAs() / loginThroughUi() / gotoApp()
│   ├── test-data.ts         ค่าคงที่จาก seed (UUID ตายตัว)
│   ├── test-case.ts         testCase({id,priority,feature}, title, fn)
│   └── fixtures.ts          ดัก pageerror ที่หลุดจากแอป
├── reporters/
│   └── markdown-reporter.ts เขียน reports/report.md — 1 แถวต่อ 1 TC
└── specs/                   auth · catalog · checkout · profile · addresses · subscriptions · seller · orders · payments · admin · compare · notifications · console
```

---

## กติกาการเขียนเคส

**1. selector ใช้ `#id` จริงจาก component เท่านั้น**
ห้ามจับด้วยข้อความหรือลำดับปุ่ม — ข้อความ UI เป็นภาษาไทยและแก้บ่อย
ทุก id ประกาศรวมไว้ที่ `helpers/selectors.ts` พร้อมชื่อไฟล์ต้นทาง
ต้องการ id ใหม่ → เพิ่ม prop `id` ที่ component ก่อน แล้วค่อยมาลงทะเบียนที่นี่

**2. ทุกเคสห่อด้วย `testCase()` และแบ่งเป็น Arrange / Act / Assert**

```ts
testCase(
  { id: 'TC-0xx', priority: 'P0', feature: '04/09 — Checkout' },
  'สิ่งที่ทดสอบ เขียนเป็นผลลัพธ์ที่ผู้ใช้ได้',
  async ({ page }) => {
    await test.step('Arrange — …', async () => { … });
    await test.step('Act — …',     async () => { … });
    await test.step('Assert — …',  async () => { … });
  },
);
```

รหัส TC ห้ามซ้ำ — `testCase()` โยน error ตั้งแต่ตอน collect ถ้าซ้ำ

**3. เคสที่เขียนข้อมูลต้องไม่ทำให้เคสอื่นพัง**
`workers: 1` และเรียงไฟล์ตามตัวอักษร ข้อมูลจึงไหลข้ามไฟล์ได้
เคสที่เปลี่ยนสภาพร่วม (ที่อยู่หลัก, ชื่อผู้ใช้) ต้องคืนค่าเดิมด้วย `test.afterAll`
หรือ step ชื่อ `Cleanup` — ดูตัวอย่างที่ `specs/addresses.spec.ts`

**4. ยืนยันผลที่ฐานข้อมูลด้วยเมื่อเป็นเรื่องเงินหรือสิทธิ์**
`queryTestDatabase()` ใน `setup/database.ts` — หน้าจอบอกได้แค่ว่า "แสดงถูก"
แต่ TC-020 ต้องพิสูจน์ว่า **ยอดที่บันทึกมาจากราคาใน DB ไม่ใช่ค่าที่ client ส่งขึ้นไป**

---

## มี feature ใหม่ → ต้องเพิ่มอะไรที่นี่

ดูตารางบังคับใน [docs/testing.md §6](../docs/testing.md) — สรุปสั้น ๆ:

1. เพิ่ม `id` ที่ component/หน้าจอใหม่ แล้วลงทะเบียนใน `helpers/selectors.ts`
2. เพิ่มอย่างน้อย **1 เคสเส้นทางสำเร็จ (P0/P1)** ต่อ 1 flow ที่ผู้ใช้กดได้
3. flow ที่แตะเงินหรือสถานะ ต้องมีเคสที่ยืนยันผลใน DB ด้วย
4. รหัส TC ต่อจากเลขสุดท้ายที่มี — ห้ามใช้เลขซ้ำแม้เคสเก่าจะถูกลบไปแล้ว
5. commit `reports/report.md` ที่ได้จากรอบที่เขียวไปพร้อมกัน

---

## ที่ค้างไว้โดยตั้งใจ

| # | เรื่อง | ทำเมื่อไหร่ |
|---|---|---|
| TC-044, TC-045 | ล็อกพฤติกรรม "ยังไม่เปิด" ของ 7 actions ใน W05 ไว้ชั่วคราว | Phase 3 — เขียนใหม่ให้ยืนยันผลจริง (ข้ามรอบแล้ววันเปลี่ยน, หยุดแล้วสถานะเป็น paused) |
| — | ยังไม่มีเคสของ seller / admin | Phase 4 / 6 เมื่อมีหน้าจอให้กด |
| — | รันบน Chromium อย่างเดียว | เพิ่ม project ของ mobile viewport ได้ถ้าต้องการหลักฐานเรื่อง responsive ในเล่ม |
