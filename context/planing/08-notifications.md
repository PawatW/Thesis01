# Feature 08: Notifications — แจ้งเตือน

> เฟส: 3 (ทำจริง 2026-08-19) | ฝั่ง: Buyer + Seller | สถานะ: **เสร็จแล้ว** — ยกเว้น push จริง (out of scope เดิม) | Workflows: [W06](../workflows/w06-recurring-cycle.md)

## ทำอะไรได้

**Buyer:** แจ้งล่วงหน้า 3 วันก่อนถึงรอบ (พร้อมลิงก์ไป skip/pause — สำคัญสุด สร้างความไว้ใจ) · ออเดอร์รอบใหม่สร้างแล้ว · สถานะจัดส่งเปลี่ยน
**Seller:** subscriber ใหม่ / ยกเลิก · สรุปออเดอร์ใหม่ประจำวันจาก engine

## หน้าจอ & Routes

| Route | หน้าจอ |
|---|---|
| `(buyer)/notifications.tsx` | กล่องของผู้ซื้อ — **แท็บที่ 4** พร้อมตัวนับที่ยังไม่อ่านบนแท็บ "ยังไม่อ่าน" และ badge บนเมนู |
| `(seller)/notifications.tsx` | **กล่องของคอนโซลร้าน** (เพิ่ม 2026-08-19) — เรื่องของร้านเท่านั้น ไม่ปนกับของผู้ซื้ออีกต่อไป |

> ทั้งสองหน้าใช้ component เดียวกัน (`src/features/notifications/NotificationFeed.tsx`) ต่างกันที่ `scope` ที่ส่งขึ้น API และ `idPrefix` ของ DOM id (`noti-*` / `seller-noti-*`)

## Components หลัก

- `NotificationBell` — icon + badge จำนวนยังไม่อ่าน (query count where read_at is null)
- `NotificationItem` — icon ตาม type, ข้อความ, เวลา (relative), จุดน้ำเงินถ้ายังไม่อ่าน; กด → mark read + `router.push(link_path)`
- types และข้อความอยู่กลางที่ `src/features/notifications/templates.ts`:
  `upcoming_cycle · order_created · order_status · new_subscriber · subscriber_cancelled · engine_summary`
  + (เพิ่ม 2026-07-25) `price_changed` · `subscription_frozen` · `subscription_resumed` — สามตัวนี้ถูก insert โดย **trigger/RPC ฝั่ง DB** ไม่ใช่ engine

## Data & Queries (API)

| Endpoint | ใช้ที่ |
|---|---|
| `GET /notifications?filter=all\|unread&scope=buyer\|seller` | รายการ (เพดาน 50 ใบ) + `unreadCount` มาในคำขอเดียว — หน้าจอต้องใช้ทั้งคู่พร้อมกันเสมอ · **`scope` = กล่องของคอนโซลที่เปิดอยู่** (ไม่ส่ง = ทั้งหมด เหมือนเดิม) |
| `POST /notifications/:id/read` | กด 1 ใบ — **idempotent**: กดซ้ำไม่เขียนทับเวลาที่อ่านครั้งแรก |
| `POST /notifications/read?scope=buyer\|seller` | อ่านทั้งหมด**ในกล่องนั้น** → คืนจำนวนที่เพิ่งถูกทำเครื่องหมาย · กดในกล่องร้านต้องไม่ล้างของค้างในกล่องผู้ซื้อ |

- **ไม่มี endpoint ให้ "สร้าง" แจ้งเตือนเลย** — ทุกใบถูกเขียนโดย service อื่นในทรานแซกชันเดียวกับเหตุการณ์ที่ทำให้มันเกิด (สมัคร · ถึงรอบ · ร้านส่งของ · ขึ้นราคา · ยกเลิก+คืนเงิน · จ่ายซ้ำสำเร็จ · แจ้งปัญหา · ปิดเคส · ระงับ/คืนสถานะร้าน) · ถ้า client สร้างเองได้ = ปลอมข้อความหลอกตัวเองหรือทำ phishing ในแอปได้
- ownership อยู่ใน `where` ทุกคำสั่ง — ของคนอื่นตอบ 404 และ "อ่านทั้งหมด" ไม่แตะแถวของใครนอกจากเจ้าของ token
- `link_path` มี CHECK บังคับให้เป็น in-app path (`^/...`) — กันการฝัง URL ภายนอกลงในแจ้งเตือน
- **ยังไม่มี realtime และ push** — หน้าจอโหลดใหม่ตอนเข้าแท็บ (พอสำหรับเดโม่ · push เป็น out of scope เดิมอยู่แล้ว)

## Validation & Edge cases

- กดแจ้งเตือนที่ link ไปของที่ถูกลบ/ยกเลิก → ไปหน้านั้นแล้วให้หน้าปลายทางจัดการ empty เอง
- แจ้งเตือนสะสมเยอะ → โหลด 50 ล่าสุด + "อ่านทั้งหมด" (update read_at ทีเดียว)
- ผู้ใช้เป็นทั้ง buyer+seller → **แต่ละคอนโซลเห็นเฉพาะ type ของบทบาทตัวเอง** (ทำจริง 2026-08-19)
  - ฝั่งร้าน = `new_subscriber` · `subscriber_cancelled` · `engine_summary` (engine ส่งสรุปให้เจ้าของร้าน ไม่ใช่ผู้ซื้อ)
  - ฝั่งผู้ซื้อ = **ที่เหลือทั้งหมด** — จงใจแบ่งด้านเดียว ชนิดใหม่ที่ลืมจัดหมวดจะไปโผล่ในกล่องผู้ซื้อ (เห็นแล้วรู้ว่าลืม) ดีกว่าหายไปจากทุกกล่อง
  - การกรองอยู่ที่ API เสมอ — ถ้ากรองบนหน้าจอ เพดาน 50 แถวจะเต็มไปด้วยของอีกฝั่งจนกล่องดูเหมือนว่าง

## Acceptance Criteria

- [x] Engine รันแล้ว buyer ได้แจ้งล่วงหน้า T-3 พร้อมลิงก์ไปหน้าจัดการ กดแล้วไปถูกที่ (**TC-082** + e2e ของ engine)
- [x] ร้านอัปเดตสถานะ → buyer ได้แจ้งเตือน (เห็นเมื่อเปิดแท็บ — **ยังไม่มี realtime**, ยอมรับไว้สำหรับเดโม่)
- [x] ตัวนับที่ยังไม่อ่านถูกต้อง · กดอ่านแล้วจุดหาย และ `read_at` ถูกบันทึกใน DB (TC-082)
- [x] มีคน subscribe ร้าน → seller ได้แจ้งเตือน (เขียนตั้งแต่ Phase 2 · ตอนนี้มีหน้าให้อ่านแล้ว)
- [x] อ่านของคนอื่นหรือกดอ่านแทนคนอื่นไม่ได้ (404) และไม่มี endpoint ให้สร้างแจ้งเตือนเอง (e2e API 6 เคส)

## ข้อมูลที่เกี่ยวข้อง

`notifications` + triggers (migration 0002) — engine insert ผ่าน service role

## Out of scope

- อีเมล/SMS/LINE, ตั้งค่าเปิดปิดรายประเภท
