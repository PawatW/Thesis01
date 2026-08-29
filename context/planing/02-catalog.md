# Feature 02: Catalog — เลือกดูสินค้าตามหมวด

> เฟส: 2 | ฝั่ง: Buyer | สถานะ: ✅ เสร็จ (Phase 2) — คะแนนรีวิวบนการ์ดเพิ่มใน Phase 4.5 | Workflows: [W03](../workflows/w03-browse-compare.md)

## ทำอะไรได้

- หน้าแรก: หมวดทั้งหมด + สินค้าแนะนำ
- ดูสินค้าตามหมวด (10 หมวดตาม proposal), ค้นหาจากชื่อ, เรียงราคา/ความนิยม
- การ์ดสินค้า: รูป, ชื่อ, ร้าน, **ราคาต่อรอบต่ำสุด**, % ส่วนลดเทียบซื้อครั้งเดียว, รอบส่งที่มี, **คะแนนรีวิว** ([17](17-reviews.md)), ปุ่ม "เทียบ"

## หน้าจอ & Routes

| Route | หน้าจอ |
|---|---|
| `(buyer)/index.tsx` | หน้าแรก — แถบหมวด (horizontal scroll) + grid สินค้าแนะนำ + ช่องค้นหา |
| `(buyer)/category/[id].tsx` | สินค้าในหมวด — grid + sort + ปุ่มเทียบ + แถบถาดเทียบลอยล่าง |

## Components หลัก

- `ProductCard` — ใช้ทั้งหน้าแรก/หมวด/ร้านค้า; props: product + onCompareToggle
- `CategoryChip`, `SearchBar`, `SortSelect` (ราคาต่ำ-สูง / ยอดนิยม)
- `CompareTrayBar` — แถบลอยล่างเมื่อถาดเทียบมีของ (state จาก feature 04)

## Data & Queries (API)

| Endpoint | ใช้ที่ |
|---|---|
| `GET /catalog/categories` | แถบหมวดบนหน้าแรก |
| `GET /catalog/products?category=&q=&sort=&limit=` | กริดสินค้า · ค้นหา · เรียงลำดับ (public — ไม่ต้องล็อกอิน) |
| `GET /catalog/shops/:id` | หน้าร้านสาธารณะ (กดจากชื่อร้านบนหน้าสินค้า) |

- **`VISIBLE_PRODUCT` คือนิยามเดียวของ "สินค้าที่ลูกค้าเห็นได้"** (`is_active` + ร้านเปิด + ทั้งสินค้าและร้านไม่ถูกระงับ) ใช้ร่วมกันทั้ง catalog · checkout · หน้าร้าน — ลืมใส่ที่ไหนสักที่แล้วของที่ถูกระงับจะโผล่ทันที จึงห้ามเขียน where เองซ้ำ
- **ตัวเลข aggregate มาพร้อมสินค้าในคำขอเดียว** — `activeSubscribers`, `rating`, `reviewCount` คำนวณฝั่ง API (ของเดิมต้องยิง 3 request แล้ว join กันเองในเครื่องผู้ใช้) · เป็น count/avg ล้วน ไม่มีข้อมูลรายคนออกไป
- ฝั่งแอปคำนวณต่อการ์ดจากข้อมูลที่ได้มา: `cheapestPlan()` · `discountPercent()` · `pricePerUnit()` — สูตรทั้งหมดอยู่ที่ `anan/src/features/catalog/api.ts` ที่เดียว (ใช้ร่วมกับ features 03/04/11)
- สินค้าแนะนำหน้าแรก = เรียงตามจำนวนสมาชิกที่ยังใช้งานอยู่

## Validation & Edge cases

- หมวดว่าง → empty state "ยังไม่มีสินค้าในหมวดนี้"
- ร้านถูกระงับโดย admin ([14](14-admin.md)) หรือปิดร้านเอง → สินค้าทั้งร้านหายให้อัตโนมัติ เพราะทุก query ของ catalog ผ่าน `VISIBLE_PRODUCT` ตัวเดียวกัน · เปิด URL ของสินค้านั้นตรง ๆ ก็ได้ 404 เหมือนไม่มีอยู่ (ไม่บอกว่า "มีแต่โดนแบน")
- สินค้าที่ทุกแผน inactive → ไม่แสดงปุ่ม subscribe บนการ์ด (แสดง "ปิดรับชั่วคราว")
- รูปเสีย/ไม่มี → placeholder สีหมวด
- ค้นหา: debounce 300ms, ผลว่าง → "ไม่พบ 'คำค้น'"
- grid: มือถือ 2 คอลัมน์ / web ≥3 คอลัมน์ (responsive — กฎ CLAUDE.md ข้อ 3)

## Acceptance Criteria

- [ ] เปิดหน้าแรกเห็น 10 หมวด + สินค้าแนะนำเรียงตาม subscriber
- [ ] เข้าหมวด → เห็นเฉพาะสินค้า active หมวดนั้น การ์ดโชว์ราคาต่อรอบต่ำสุด + ส่วนลดถูกต้อง
- [ ] ค้นหา/เรียงลำดับทำงาน, ผลว่างมี empty state
- [ ] แสดงผลถูกทั้ง mobile (2 คอลัมน์) และ web (≥3 คอลัมน์)

## ข้อมูลที่เกี่ยวข้อง

`categories`, `products`, `product_plans`, view `product_stats` (migration 0002) — ดู [database-schema](../../docs/database-schema.md)

## Out of scope

- รีวิว/เรตติ้ง, personalized recommendation, filter ขั้นสูง (ช่วงราคา/แบรนด์)
