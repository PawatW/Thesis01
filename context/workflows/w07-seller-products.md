# W07 — ร้านลงสินค้า + กำหนดแผนรอบส่ง

> Actor: Seller | Features: [11-seller-products](../planing/11-seller-products.md)

## Precondition
- มีร้านแล้ว ([W02](w02-open-shop.md)), อยู่ในโหมดร้าน

## Trigger
- กด "เพิ่มสินค้า" ใน `(seller)/products`

## Main Flow: เพิ่มสินค้าใหม่ (ฟอร์ม 2 ขั้น)

| # | ผู้กระทำ | การกระทำ | ระบบทำอะไร |
|---|---|---|---|
| 1 | Seller | **ขั้น 1 — ข้อมูลสินค้า:** ชื่อ, หมวด (dropdown จาก `categories`), คำอธิบาย, รูป 1-5 รูป, ขนาดสุทธิ+หน่วย (เช่น 250 g), ราคาซื้อครั้งเดียว | รูป → upload Storage bucket `product-images` → เก็บ path ลง `images[]` |
| 2 | Seller | **ขั้น 2 — แผนรอบส่ง:** เปิดรอบที่ต้องการ (2w/1m/2m — อย่างน้อย 1), ใส่ราคาต่อรอบ + จำนวนชิ้นต่อรอบของแต่ละอัน | ระบบโชว์ % ส่วนลดเทียบราคาซื้อครั้งเดียวสดๆ: `1 − (price_per_cycle ÷ qty_per_cycle) ÷ one_time_price` |
| 3 | Seller | กด "ลงขาย" | insert `products` + insert `product_plans` (1 แถวต่อ cycle ที่เปิด) |
| 4 | ระบบ | สินค้าขึ้น catalog ทันที | ผู้ซื้อเห็นใน [W03](w03-browse-compare.md) |

## Main Flow: แก้ไข / ปิดการขาย

| Action | ระบบทำอะไร | ผลกับ subscriber เดิม |
|---|---|---|
| แก้ข้อมูลสินค้า (ชื่อ รูป คำอธิบาย) | update `products` | เห็นข้อมูลใหม่ ไม่กระทบรอบ |
| แก้ราคาแผน | update `product_plans.price_per_cycle` | **มีผลออเดอร์รอบถัดไปของ subscriber เดิมด้วย** — แสดงคำเตือนชัดๆ ก่อนบันทึก: "subscriber ปัจจุบัน n คนจะจ่ายราคาใหม่ตั้งแต่รอบหน้า" |
| ปิดแผนชั่วคราว | `product_plans.is_active = false` | subscriber เดิมอยู่ต่อ engine ยังสร้างออเดอร์ให้ — แค่รับคนใหม่ไม่ได้ |
| ปิดสินค้าทั้งตัว | `products.is_active = false` | หายจาก catalog — subscriber เดิมยังอยู่ต่อเช่นกัน |
| ลบสินค้า/แผน | ❌ ไม่มีปุ่มลบถ้ามี subscriber (FK restrict บล็อกที่ DB อยู่แล้ว) — ใช้ปิดการขายแทน | — |

## Alternate / Error Flows

- **E1 เปิด cycle ซ้ำที่มีอยู่แล้ว:** ชน UQ (product_id, cycle) → ฟอร์มกันไว้ก่อนโดยแสดงเฉพาะ cycle ที่ยังไม่มี
- **E2 ราคาต่อรอบสูงกว่าซื้อครั้งเดียว×จำนวน:** เตือน (ไม่บล็อก): "ราคานี้แพงกว่าซื้อปกติ — ผู้ซื้อจะไม่เห็นส่วนลด" (ส่วนลดติดลบให้แสดง 0%)
- **E3 ไม่ใส่แผนเลย:** ปุ่ม "ลงขาย" disabled จนกว่าจะมีแผน ≥1

## Postcondition
- `products` + `product_plans` พร้อมขาย ปรากฏใน catalog/เทียบราคา และร้านเริ่มเห็นตัวเลขบน dashboard เมื่อมีคน subscribe
