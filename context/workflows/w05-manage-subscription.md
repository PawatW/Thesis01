# W05 — จัดการ Subscription ⭐ จุดขายของแอพ

> Actor: Buyer | Features: [06-my-subscriptions](../planing/06-my-subscriptions.md)
> ทุก action ต้องจบใน ≤2 คลิกจากหน้ารายละเอียด — ความยืดหยุ่นตรงนี้คือเหตุผลที่คนกล้า subscribe

## Precondition
- มี subscription อย่างน้อย 1 รายการ (จาก [W04](w04-subscribe-checkout.md))

## State Machine

```
active ──pause──▶ paused ──resume──▶ active
active ──cancel──▶ cancelled (ถาวร ห้าม resume)
paused ──cancel──▶ cancelled

active ──[admin ระงับร้าน]──▶ paused (paused_reason = 'shop_suspended')
        ผู้ซื้อ resume เองไม่ได้ — ระบบ resume ให้เมื่อร้านถูกปลดระงับ
```

`paused` มี 2 แบบ แยกด้วย `paused_reason`: `'user'` (ผู้ซื้อกดเอง) และ `'shop_suspended'` (ระบบแช่แข็งตอนแอดมินระงับร้าน — [W10](w10-admin.md) Flow C) แบบหลัง trigger ระดับ DB บล็อกการ resume ไว้จนกว่าร้านจะกลับมา

> **ทุก action ทำผ่าน endpoint ตัวของมันเอง** — `POST /api/v1/subscriptions/:id/{skip|pause|resume|reschedule|plan|address|cancel}`
> (เดิมออกแบบไว้เป็น RPC ของ Postgres · เจตนาเดิมไม่เปลี่ยน) client เขียน `subscriptions`/`subscription_events` ตรงไม่ได้เลย ทำให้ update + event อยู่ในทรานแซกชันเดียวเสมอ และผู้ใช้ปลอม event เองไม่ได้ ([security-design.md §5](../../docs/security-design.md))
>
> ### หมุดของกริดรอบ (`subscriptions.cycle_anchor_date`) — เพิ่มใน Phase 3
> ทุกวันตัดรอบคือ **หมุด + k×cycle** ไม่ใช่การบวกรอบทบจากวันรอบก่อนหน้า (ไม่งั้นรายการที่สมัครวันที่ 31 จะถูกตัดเงินวันที่ 28 ถาวรหลังผ่านกุมภาพันธ์ครั้งเดียว)
>
> | Action | หมุดขยับไหม |
> |---|---|
> | Skip | **ไม่ขยับ** — เลื่อนไป 1 ช่องบนกริดเดิม |
> | เลื่อนวันส่ง · กลับมาใช้งาน (เมื่อถูกดันเป็นพรุ่งนี้) · เปลี่ยนรอบส่ง | **ขยับไปที่วันรอบใหม่** เพราะทั้งสามอย่างคือการนิยามตารางส่งใหม่ |
>
> ### กฎเพิ่มเติมที่บังคับใน API (ไม่ได้อยู่ในตารางเดิม)
> - **เลื่อนวันส่งได้ไม่เกิน 180 วัน** — ปล่อยให้เลื่อนไปปี 9999 เท่ากับยกเลิกแบบไม่ทิ้งร่องรอย ทำให้สถิติ churn ในเล่มเพี้ยน · อยากหยุดนานกว่านั้นให้ใช้ pause
> - **เปลี่ยนรอบส่ง/เปลี่ยนที่อยู่ ห้ามทำให้เกิดคู่ (แผน + ที่อยู่) ซ้ำกับรายการที่ยังมีชีวิตอยู่** — ไม่งั้นสองปุ่มนี้กลายเป็นทางลัดเลี่ยงกฎกันสมัครซ้ำ (บังคับด้วย partial unique index ที่ DB ด้วย)
> - **ทุก action ที่ทำให้ `next_order_date` เปลี่ยนโดยไม่เกิดออเดอร์ ต้องคืนคูปองที่จองไว้กับรอบนั้น** (skip · pause · เลื่อนวันส่ง · เปลี่ยนรอบส่ง · cancel) — อยู่ในทรานแซกชันเดียวกับ action นั้นเสมอ · กฎข้อเดียวนี้แทนการไล่เขียนเคสพิเศษทีละอัน และกันไม่ให้คูปองค้างอยู่กับรอบที่ไม่มีวันเกิด ([W13](w13-coupon.md) Flow E · Phase 8)

## Actions ทั้งหมด (แต่ละอันคือ mini-flow: กดปุ่ม → confirm สั้นๆ → มีผลทันที + toast)

| Action | อนุญาตเมื่อ | ระบบทำอะไร (DB) | ผลกับรอบถัดไป |
|---|---|---|---|
| **Pause** | active | `status = paused`, `paused_at = now`, `paused_reason = 'user'` + event `paused` | engine ข้ามตลอดจนกว่าจะ resume |
| **Resume** | paused **และ** `paused_reason = 'user'` | `status = active`, `paused_at = null`, `paused_reason = null`, **`next_order_date = max(next_order_date, พรุ่งนี้)`** + event `resumed` | กันเคสหยุดไว้นานจน next_order_date เลยมาแล้ว — ไม่งั้น engine จะยิงออเดอร์ย้อนหลังทันที · ถ้า `paused_reason = 'shop_suspended'` ปุ่มถูกซ่อนและ DB ปฏิเสธ |
| **Skip รอบถัดไป** | active | `next_order_date` = ช่องถัดไปบนกริดของหมุด (หนีบกับวันนี้ถ้ารอบเดิมเลยมาแล้ว) + event `skipped` (detail: {from, to}) | ข้าม 1 รอบ ไม่ตัดเงิน |
| **เลื่อนวันส่ง** | active | `next_order_date = วันที่เลือก` (ต้อง > วันนี้) + event `rescheduled` | รอบถัดๆ ไปนับจากวันใหม่ |
| **เปลี่ยนรอบส่ง** | active | หา plan ของ product เดียวกันใน cycle ใหม่ที่ active → `plan_id = ใหม่` + event `cycle_changed` — next_order_date เดิมคงไว้ | รอบหน้าวันเดิม แต่ราคา/ความถี่ใหม่หลังจากนั้น |
| **เปลี่ยนที่อยู่** | active, paused | `address_id = ใหม่` + event `address_changed` | ออเดอร์ใหม่ใช้ที่อยู่ใหม่ — ออเดอร์เก่าไม่กระทบ (มี snapshot) |
| **Cancel** | active, paused | `status = cancelled`, `cancelled_at = now`, `next_order_date = null` + event `cancelled` | ไม่มีรอบอีก — ออเดอร์ที่ค้างส่งอยู่ยังส่งจนจบ |
| **ใช้คูปองกับรอบถัดไป** _(Phase 8 — [W13](w13-coupon.md))_ | active **และ** ยังไม่ถึงวัน `next_order_date` | insert `coupon_redemptions` (`reserved`, `cycle_date = next_order_date`) + `coupons.in_use_count` +1 + event `coupon_applied` | รอบนั้นถูกตัดเงินที่ยอดหลังลด — รอบอื่นไม่กระทบ |

## Main Flow ตัวอย่าง: Skip

| # | ผู้กระทำ | การกระทำ | ระบบทำอะไร |
|---|---|---|---|
| 1 | ผู้ใช้ | แท็บ "ของฉัน" → กดรายการกาแฟ | โหลด subscription + ประวัติออเดอร์ + events |
| 2 | ผู้ใช้ | กด "ข้ามรอบถัดไป" | dialog: "ข้ามรอบวันที่ 15 ส.ค. — รอบถัดไปจะเป็น 15 ก.ย. ยืนยัน?" |
| 3 | ผู้ใช้ | ยืนยัน | update ตามตาราง + insert event |
| 4 | ระบบ | toast "ข้ามรอบแล้ว — รอบถัดไป 15 ก.ย." + การ์ดอัปเดตทันที | — |

## หน้า Dashboard รวม (แท็บ "ของฉัน")

- แยกกลุ่ม: กำลังใช้งาน / หยุดชั่วคราว / ยกเลิกแล้ว — เรียงตาม next_order_date
- การ์ดสรุปบนสุด: **"เดือนนี้จ่ายรวม ฿X จาก Y รอบ ใน Z รายการ"** + **ปฏิทินว่ารอบไหนตัดวันไหน**
  - เป็น**ยอดที่จะถูกตัดจริงในเดือนปฏิทินปัจจุบัน** ไม่ใช่ค่าเฉลี่ยต่อเดือน (เปลี่ยนเมื่อ 2026-08-30 — สูตรเดิม normalize 2w = ×2, 1m = ×1, 2m = ×0.5 ทำให้รายการที่ยังไม่ถึงรอบในเดือนนี้ถูกนับเข้ามาด้วย ซึ่งไม่ตรงกับคำถามที่ผู้ใช้ถามเมื่อเห็นการ์ดนี้)
  - นับรอบโดยเดินบนกริดของ `cycle_anchor_date` เหมือน engine — รอบ 2 สัปดาห์จึงตกในเดือนเดียวกัน 2 หรือ 3 ครั้งตามปฏิทินจริง
  - `paused` ไม่นับ · รายการที่ค้าง (`next_order_date < วันนี้`) นับเป็นของวันนี้ เพราะ engine ใช้ `<=` แล้วเก็บตกให้
  - รอบถัดไปที่จองคูปองไว้ใช้ยอดหลังหักส่วนลด (`couponNetAmount`) รอบที่เหลือในเดือนเดียวกันเป็นราคาเต็ม

## Alternate / Error Flows

- **E1 เปลี่ยนรอบแต่ product ไม่มีแผน cycle นั้น:** ตัวเลือกโชว์เฉพาะ cycle ที่มีแผน active จริง — ไม่มีทางกดผิด
- **E2 กด action บน subscription ที่ cancelled:** ปุ่มทั้งหมดซ่อน เหลือแค่ "ดูประวัติ" — บังคับ 3 ชั้น: UI → RPC ตรวจสถานะ → DB (CHECK `subs_state_consistent` + trigger `guard_subscription_update` ห้ามออกจาก cancelled)
- **A1 Cancel แล้วเปลี่ยนใจ:** ต้อง subscribe ใหม่เท่านั้น (บอกชัดใน dialog ยืนยันก่อนยกเลิก)

## Postcondition
- ทุก action ทิ้งรอยใน `subscription_events` — เป็นข้อมูลดิบสำหรับกราฟ churn ในเล่ม thesis
