# W08 — ร้านจัดการออเดอร์รายวัน + ดู Forecast

> Actor: Seller | Features: [12-seller-orders](../planing/12-seller-orders.md), [10-seller-shop](../planing/10-seller-shop.md)

## Precondition
- ร้านมีสินค้าที่มี subscriber, engine เคยสร้างออเดอร์แล้ว ([W06](w06-recurring-cycle.md))

## Trigger
- Seller ได้รับแจ้งเตือนสรุปตอนเช้า หรือเปิดแท็บออเดอร์เอง

## Main Flow: จัดการออเดอร์วันนี้

| # | ผู้กระทำ | การกระทำ | ระบบทำอะไร |
|---|---|---|---|
| 1 | Seller | เปิด `(seller)/orders` แท็บ "ค้างส่ง" | query `orders` (pending/preparing) ของร้าน เรียงเก่าสุดก่อน — RLS seller read ผ่าน join plan→product→shop |
| 2 | Seller | กดออเดอร์ → เห็นสินค้า, จำนวน, ที่อยู่จาก **address_snapshot** | — |
| 3 | Seller | กด "เริ่มจัดของ" | `status = preparing` → insert `notifications` buyer (type `order_status`) |
| 4 | Seller | แพ็คเสร็จ กด "ส่งแล้ว" + กรอกเลขพัสดุ | `status = shipped`, `tracking_note` → notification buyer พร้อมเลขพัสดุ |
| 5 | Seller | ของถึงแล้ว กด "จัดส่งสำเร็จ" | `status = delivered` → notification buyer |

## Main Flow: ดู Forecast (จุดขายฝั่งร้าน)

| # | ผู้กระทำ | การกระทำ | ระบบทำอะไร |
|---|---|---|---|
| 1 | Seller | แท็บ "ออเดอร์ล่วงหน้า" เลือกช่วง 7 / 14 / 30 วัน | query `subscriptions` active ของร้าน ที่ next_order_date อยู่ในช่วง — group ฝั่ง client ตามสินค้า |
| 2 | ระบบ | แสดงสรุปรายสินค้า | "กาแฟคั่วกลาง 250g — 18 ออเดอร์ / 22 ชิ้น ภายใน 30 วัน" → ร้านใช้วางแผนสต๊อก |
| 3 | Seller | (บน dashboard) เห็น subscriber รวม, MRR จำลอง, ยกเลิกเดือนนี้ | คำนวณจาก subscriptions + events (`cancelled` ในเดือนนี้) |

## Alternate / Error Flows

- **E1 กดข้ามสถานะ (pending → delivered):** UI บังคับปุ่มทีละขั้นตามลำดับ pending→preparing→shipped→delivered — ไม่มีทางลัด
- **E2 buyer ยกเลิก subscription ระหว่างมีออเดอร์ค้าง:** ออเดอร์ที่สร้างแล้วส่งต่อจนจบตามปกติ (cancel มีผลแค่ "ไม่มีรอบใหม่") — forecast อัปเดตลดลงทันที
- **A1 ออเดอร์ตกค้างนานผิดปกติ:** แถวแดงถ้า pending เกิน 2 วัน (แค่ visual ไม่มี auto-action)

## Postcondition
- ออเดอร์ไหลจนจบ delivered, buyer รับแจ้งเตือนทุกจังหวะ, forecast สะท้อนรอบถัดไปเสมอ
