# W04 — Subscribe (Checkout จนสำเร็จ) ⭐ core loop

> Actor: Buyer | Features: [03](../planing/03-product-detail.md), [05](../planing/05-subscribe-checkout.md), [09](../planing/09-payment-demo.md)

## Precondition
- ล็อกอินแล้ว, plan ที่เลือกยัง `is_active`

## Trigger
- กด "Subscribe" จากหน้าสินค้า / ตารางเทียบ พร้อม `plan_id`

## Main Flow

| # | ผู้กระทำ | การกระทำ | ระบบทำอะไร |
|---|---|---|---|
| 1 | ระบบ | เปิดหน้า checkout `checkout/[planId]` | โหลด plan + product + shop, ที่อยู่ของ user, บัตร demo ของ user |
| 2 | ผู้ใช้ | เลือกที่อยู่จัดส่ง (default ถูกเลือกไว้) | — |
| 3 | ผู้ใช้ | เลือกบัตร demo | — |
| 4 | ผู้ใช้ | เลือกจำนวน (default 1) + วันเริ่มรอบแรก (default พรุ่งนี้, เลือกได้ภายใน 14 วัน) | คำนวณ amount = price_per_cycle × quantity แสดงสด |
| 5 | ระบบ | แสดงสรุปก่อนยืนยัน | ข้อความชัดเจน: "ระบบจะสร้างออเดอร์ทุก {รอบ} และตัดเงินจำลอง ฿{amount} ต่อรอบ — ยกเลิกได้ทุกเมื่อ" + ป้าย **DEMO** |
| 6 | ผู้ใช้ | กด "ยืนยัน Subscribe" | เรียก RPC `subscribe_to_plan(...)` — transaction เดียว (ดูด้านล่าง) |
| 7 | ระบบ | สำเร็จ → ไปหน้า "Subscription ของฉัน" + toast "สมัครสำเร็จ 🎉" | — |

### สิ่งที่ RPC `subscribe_to_plan` ทำใน transaction เดียว

0. **ตรวจว่า `address_id` และ `payment_method_id` เป็นของ `auth.uid()` จริง** (ไม่งั้นผูกที่อยู่/บัตรคนอื่นได้ — [S-04](../../docs/security-design.md)) และคำนวณ amount จาก `price_per_cycle` ใน DB (ไม่รับยอดจาก client)
1. ตรวจ plan ยัง `is_active` + สินค้า/ร้านไม่ถูกระงับ (กันแผนถูกปิดระหว่างทำรายการ)
2. insert `subscriptions` — status `active`, start_date, **next_order_date = start_date + cycle** (รอบแรกไม่ผ่าน engine)
3. insert `orders` รอบแรก — cycle_date = start_date, amount, **address_snapshot** (ก็อปที่อยู่เป็น jsonb)
4. insert `payments` — status `paid` (ตัดเงินจำลอง), paid_at = now
5. insert `subscription_events` — event `created`
6. คืน subscription_id

> ใช้ Postgres function (security definer + validate ข้างใน) แทน insert ทีละตารางจาก client — ได้ 2 อย่าง: **atomicity** (พังขั้นไหน rollback หมด) และ **ความปลอดภัย** (client ไม่มีสิทธิ์ insert `subscriptions`/`orders`/`payments` ตรงเลย ไม่งั้นปลอมออเดอร์และประกาศว่าจ่ายแล้วได้เอง)

## Alternate / Error Flows

- **A1 ยังไม่มีที่อยู่:** ขั้น 2 → ฟอร์มเพิ่มที่อยู่โผล่ inline (W01 Flow C) แล้วกลับมา checkout ต่อ ไม่หลุด flow
- **A2 ยังไม่มีบัตร demo:** ขั้น 3 → ฟอร์มเพิ่มบัตร inline — กรอกเลขอะไรก็ได้ ระบบเก็บแค่ last4 (insert `payment_methods`, kind = card_demo)
- **E1 plan ถูกปิดระหว่างทำรายการ:** RPC ตรวจเจอ → error "แผนนี้เพิ่งปิดรับสมาชิกใหม่" → กลับหน้าสินค้า refresh แผนที่เหลือ
- **E2 กดยืนยันซ้ำ (double tap):** ปุ่ม disable ทันทีที่กด + ออเดอร์รอบแรกชน UQ (subscription_id, cycle_date) ไม่ได้เพราะเป็น subscription ใหม่ — กันด้วย idempotency key ฝั่ง client (disable ปุ่มพอสำหรับ demo)

## Postcondition
- `subscriptions` 1 แถว (active) + `orders` รอบแรก (pending) + `payments` (paid) + event `created`
- ร้านค้าเห็นออเดอร์ใหม่ใน [W08](w08-seller-orders.md) และ subscriber +1 บน dashboard
- รอบถัดไปเป็นหน้าที่ของ engine → [W06](w06-recurring-cycle.md)
