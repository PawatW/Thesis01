# W03 — หาสินค้า + เปรียบเทียบข้ามร้าน

> Actor: Buyer (ล็อกอินหรือยังไม่ล็อกอินก็ดูได้ — controller ของ catalog เป็น `@Public()`) | Features: [02-catalog](../planing/02-catalog.md), [03-product-detail](../planing/03-product-detail.md), [04-compare](../planing/04-compare.md)
> **ทำจริงครบทั้ง flow แล้ว 2026-08-19** (ขั้นเทียบเป็นส่วนสุดท้ายที่เพิ่งทำ)

## Precondition
- มีสินค้า active ในระบบ (จาก seed หรือ [W07](w07-seller-products.md))

## Trigger
- ผู้ใช้เปิดแท็บหน้าแรก

## Main Flow: browse → เทียบ → ตัดสินใจ

| # | ผู้กระทำ | การกระทำ | ระบบทำอะไร |
|---|---|---|---|
| 1 | ผู้ใช้ | เปิดหน้าแรก | โหลด `categories` (เรียง sort_order) + สินค้าแนะนำ |
| 2 | ผู้ใช้ | กดหมวด "กาแฟ" | query `products` where category_id + is_active, join `shops(name)` + `product_plans` → การ์ดโชว์ราคาต่อรอบต่ำสุด + % ส่วนลด |
| 3 | ผู้ใช้ | (ทางเลือก) พิมพ์ค้นหา / เปลี่ยน sort | `.ilike('name', %q%)` / sort ราคา-ความนิยม ฝั่ง client |
| 4 | ผู้ใช้ | กด "เทียบ" บนการ์ดสินค้า 2-4 ชิ้น | เพิ่มเข้า compare state (client เท่านั้น ไม่แตะ DB) — จำกัดหมวดเดียวกัน, สูงสุด 4 |
| 5 | ผู้ใช้ | กดแถบ "ดูตารางเทียบ (n)" ที่ลอยด้านล่าง | หน้าตารางเทียบ: ราคาต่อรอบทุก cycle, **ราคาต่อหน่วย** (price_per_cycle ÷ qty_per_cycle ÷ net_amount), % ส่วนลด, รอบส่งที่มี |
| 6 | ผู้ใช้ | กด "Subscribe" ใต้คอลัมน์ที่ถูกใจ | ไป [W04](w04-subscribe-checkout.md) พร้อม plan ที่เลือก |

## Alternate / Error Flows

- **A1 เข้าหน้าสินค้าเดี่ยวก่อน:** ขั้น 4 → กดการ์ดเข้า product detail → เห็นแผนทุก cycle → Subscribe ตรงจากที่นั่นได้ (ข้ามการเทียบ)
- **A2 เทียบต่างหมวด:** กด "เทียบ" สินค้าคนละหมวดกับที่อยู่ในถาด → toast "เทียบได้เฉพาะสินค้าหมวดเดียวกัน" พร้อมปุ่ม "ล้างถาดแล้วเริ่มใหม่"
- **A3 สินค้าไม่มี net_amount/unit:** ช่องราคาต่อหน่วยแสดง "—" (ไม่คำนวณมั่ว)
- **E1 หมวดว่าง:** empty state "ยังไม่มีสินค้าในหมวดนี้"

## Postcondition
- ไม่มีการเขียน DB — จบที่ผู้ใช้ถือ `plan_id` ที่จะ subscribe เข้าสู่ W04
