# W06 — วงจรรอบอัตโนมัติ ⭐ หัวใจทางเทคนิคของ thesis

> Actor: System (engine) + Buyer + Seller | Features: [07](../planing/07-orders-history.md), [08](../planing/08-notifications.md), [09](../planing/09-payment-demo.md), [12](../planing/12-seller-orders.md), [13](../planing/13-recurring-engine.md)
> ครอบคลุมชีวิตของ 1 รอบ: แจ้งล่วงหน้า → สร้างออเดอร์+ตัดเงินจำลอง → ร้านส่ง → ถึงมือ

## Precondition
- มี subscription active ที่ `next_order_date` ใกล้ถึง (จาก [W04](w04-subscribe-checkout.md))

## Trigger
- **pg_cron รันทุกวัน 01:00 น. ไทย** (ตั้ง cron เป็น `0 18 * * *` UTC) เรียก Edge Function `recurring-engine`
- หรือกดปุ่ม "Run engine now" ในหน้า dev (สำหรับ demo — ส่ง `run_date` ปลอมได้ = time-travel)

## Main Flow

| # | ผู้กระทำ | การกระทำ | ระบบทำอะไร |
|---|---|---|---|
| 1 | Engine | เริ่มรัน (service role — bypass RLS) | log เริ่มงาน |
| 2 | Engine | **แจ้งล่วงหน้า:** หา subs active ที่ next_order_date = อีก 3 วัน | insert `notifications` (type `upcoming_cycle`) — "อีก 3 วันจะตัดเงิน ฿X — skip ได้ถึงวันที่ Y" + ลิงก์ไปหน้าจัดการ |
| 3 | Engine | **สร้างออเดอร์:** หา subs active ที่ `next_order_date <= วันนี้` (เก็บตกรอบที่พลาดด้วย) | ต่อ 1 sub ในทรานแซกชันเดียว: insert `orders` (ชน `UNIQUE(subscription_id, cycle_date)` = รอบนี้สร้างไปแล้ว จึงข้าม — idempotent), **ตัดเงินผ่าน `PaymentProvider`** แล้ว insert `payments` (`paid` หรือ `failed` ตามผล), **เลื่อน `next_order_date` ไปช่องถัดไปบนกริดของ `cycle_anchor_date`**, insert `notifications` ให้ผู้ซื้อ |
| 4 | Engine | **สรุปให้ร้าน:** group ออเดอร์ใหม่ตามร้าน | insert `notifications` seller (type `engine_summary`) — "วันนี้มีออเดอร์ใหม่ 5 รายการ" |
| 5 | Engine | จบงาน | insert `engine_runs` (run_date, orders_created, notifications_created, detail) |
| 6 | Seller | เห็นแจ้งเตือน → เข้าแท็บออเดอร์ → รับออเดอร์ → จัดของ | update `orders.status = preparing` → notification buyer (type `order_status`) |
| 7 | Seller | ส่งของ + กรอกเลขพัสดุ | `status = shipped`, `tracking_note` → notification buyer |
| 8 | Seller | (เมื่อของถึง) กด delivered | `status = delivered` → notification buyer |
| 9 | Buyer | เปิดดูออเดอร์/แจ้งเตือนได้ตลอดทาง | mark `notifications.read_at` เมื่อกดอ่าน |

## Alternate / Error Flows

- **A1 ผู้ใช้ skip หลังได้รับแจ้งล่วงหน้า (ขั้น 2→3):** next_order_date เลื่อนไปแล้ว → วันจริง engine ไม่เจอ sub นี้ → ไม่มีออเดอร์ ไม่ตัดเงิน ✓ (นี่คือ flow ที่ต้อง demo ให้กรรมการดู)
- **A1b ผู้ใช้จองคูปองกับรอบนี้หลังได้รับแจ้งล่วงหน้า** _(Phase 8 — [W13](w13-coupon.md))_**:** ขั้น 3 หักส่วนลดก่อนตัดเงิน → `orders.amount` = ยอดหลังลด, `orders.discount_amount` = ส่วนลด, redemption เป็น `consumed` **ในทรานแซกชันเดียวกัน** → รันซ้ำวันเดิมชน `UNIQUE(subscription_id, cycle_date)` แล้ว rollback ทั้งก้อน คูปองจึงไม่ถูกใช้ซ้ำโดยไม่ต้องเขียนกลไกกันซ้ำเพิ่ม · ถ้าผู้ใช้ skip รอบที่จองไว้ คูปองถูกคืนตาม A1
- **A2 sub ถูก pause ก่อนถึงรอบ:** เงื่อนไข status = active กรองออกเอง
- **E1 engine รันซ้ำ (กดปุ่ม demo หลายครั้ง):** ออเดอร์ไม่ซ้ำเพราะ on conflict do nothing — แต่ **ระวัง: ต้องเลื่อน next_order_date เฉพาะแถวที่ insert สำเร็จจริง** (ทำใน SQL function เดียวกัน ไม่แยกสอง statement)
- **E2 cron ไม่รันบางวัน (เครื่องปิด/process ล่ม):** วันถัดมาเงื่อนไข `<=` เก็บตกให้ — ออเดอร์ `cycle_date` เป็นวันเดิมที่ควรเกิด ไม่ใช่วันที่รันจริง · ถ้าหยุดไปหลายเดือนจะได้ออเดอร์ค้าง 1 ใบแล้วเดินต่อจากปัจจุบัน (ไม่ไล่ตัดเงินย้อนหลังทุกงวด)
- **E3 จำลองตัดเงินไม่ผ่าน (ทำแล้วในเฟส 5):** บัตรที่ลงท้าย `0000` ถูกปฏิเสธเสมอ → `payments.status = 'failed'` + notification "ตัดเงินรอบนี้ไม่สำเร็จ" ที่ลิงก์ตรงไปหน้าออเดอร์ซึ่งมีปุ่ม "จ่ายอีกครั้ง"
  - **ออเดอร์ยังอยู่และ `next_order_date` ยังเลื่อนตามปกติ** — รอบนั้นเกิดขึ้นจริงแล้ว ถ้าไม่เลื่อนรายการจะค้างที่รอบเดิมตลอดไป
  - **ร้านยังไม่เห็นออเดอร์ใบนั้นเลย** จนกว่าจะจ่ายสำเร็จ (ไม่งั้นร้านจัดของให้รอบที่อาจไม่ได้เงิน) และร้านได้ notification ตอนที่ผู้ซื้อจ่ายซ้ำสำเร็จ
- **E4 ร้านส่งไม่ได้ (ของหมด) หรือของไม่ถึงมือผู้ซื้อ:** ออกจาก flow นี้ไปที่ [W11](w11-order-exception.md) — ร้านยกเลิก+คืนเงินจำลอง หรือผู้ซื้อแจ้งปัญหา; รอบถัดไปยังเดินตามปกติ
- **E5 ผู้ซื้อไม่กด "ได้รับแล้ว":** engine ปิดออเดอร์ที่ `shipped` เกิน 7 วันให้เป็น `delivered` (งานที่ 4 ของ engine) โดยไม่ตั้ง `confirmed_at`

## Postcondition
- ออเดอร์ครบทุก sub ที่ถึงรอบ, ไม่มีซ้ำ, next_order_date ขยับแล้ว, ทุกฝ่ายได้รับแจ้งเตือน, มี log ใน `engine_runs` ตรวจย้อนได้
