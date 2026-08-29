# Feature 11: Seller Products — ลงสินค้า + กำหนดแผนรอบส่ง

> เฟส: 4 | ฝั่ง: Seller | สถานะ: ✅ เสร็จ (2026-08-17) · หน้าแก้ไขสินค้าเต็มรูปเพิ่ม 2026-08-19 — **เหลืออัปโหลดรูปจากเครื่อง** (ต้องเพิ่ม `expo-image-picker` + ค่า Cloudinary) | Workflows: [W07](../workflows/w07-seller-products.md)

## ทำอะไรได้

- เพิ่มสินค้า (ฟอร์ม 2 ขั้น: ข้อมูลสินค้า → แผนรอบส่ง), แก้ไข, เปิด/ปิดการขาย
- กำหนดแผนต่อสินค้า: เปิด cycle ที่ต้องการ (2w/1m/2m อย่างน้อย 1), ราคาต่อรอบ + ชิ้นต่อรอบ — เห็น % ส่วนลดสด
- ปิดแผนชั่วคราว: subscriber เดิมอยู่ต่อ รับใหม่ไม่ได้ | **ไม่มีปุ่มลบ** ถ้ามี subscriber (FK restrict)

## หน้าจอ & Routes

| Route | หน้าจอ |
|---|---|
| `(seller)/products.tsx` | สินค้าของฉัน — list + สถานะ + subscriber ต่อชิ้น + **ฟอร์มเพิ่ม (2 ขั้น) แบบพับได้** + แก้ราคา/เปิด-ปิดแผนในการ์ดเดียวกัน |

> เดิมออกแบบเป็น 3 route (`index` / `new` / `[id]`) · รวมเป็นหน้าเดียวตอนทำจริงเพราะทุก action
> ของร้านต้องจบใน ≤2 คลิกเหมือนฝั่งผู้ซื้อ และการแก้ราคาต้องเห็น "จำนวนสมาชิกที่กระทบ"
> อยู่ข้างช่องราคาตอนกด ไม่ใช่ต้องข้ามหน้าไปดู

## Components หลัก

- `ProductForm` ขั้น 1 — ชื่อ, หมวด (dropdown), คำอธิบาย, `ImageUploader` (1-5 รูป, expo-image-picker → Storage `product-images`), net_amount + unit, one_time_price
- `PlanEditor` ขั้น 2 — 3 แถวตาม cycle: toggle เปิด/ปิด + ช่องราคา + ชิ้นต่อรอบ + `DiscountPreview` (สูตรกลาง `pricing.ts` — ติดลบโชว์เตือนส้ม "แพงกว่าซื้อปกติ")
- `SellerProductCard` — รูป, ชื่อ, จำนวนแผน active, subscriber, toggle ปิดการขาย

## Data & Queries (API)

| Endpoint | ใช้ที่ |
|---|---|
| `POST /seller/products` | ลงขาย — **สินค้า + แผนรอบส่งในคำขอเดียว** (ทรานแซกชันเดียว ไม่มีสินค้าที่ไม่มีแผนค้างไว้) |
| `GET /seller/products` | รายการของร้าน + จำนวนสมาชิกต่อชิ้น/ต่อแผน |
| `PATCH /seller/products/:id` | แก้ชื่อ/คำอธิบาย/รูป/หมวด/ขนาดบรรจุ/เปิด-ปิดขาย |
| `POST /seller/products/:id/plans` · `PATCH /seller/plans/:id` | เปิดรอบส่งเพิ่ม / แก้ราคา-จำนวน / ปิดรับสมาชิกใหม่ |
| `POST /uploads/signature` | ขอลายเซ็นอัปโหลด Cloudinary — folder ถูกผูกกับ `shopId` จาก token (ยังไม่ได้ตั้งค่าบนเครื่องนี้ → ตอบ 503) |

- **ไม่มี endpoint ไหนรับ `shopId` จาก client** — ทุก query ผูกร้านจาก token ผ่าน `ShopService.requireShop()` / `requireOperableShop()`
- **ฟิลด์ที่ร้านแก้ไม่ได้เลย** (ไม่มีใน DTO): `shopId`, `suspendedAt`, `productId` ของแผน, `cycle` ของแผน — ย้ายสินค้าข้ามร้านหรือเปลี่ยนรอบของแผนเดิมทำไม่ได้ ต้องสร้างแผนใหม่
- ร้านที่ถูกผู้ดูแลระงับ **ลงสินค้าใหม่/แก้ของเดิมไม่ได้** (`requireOperableShop` → 409) แต่ยังส่งออเดอร์ที่จ่ายเงินมาแล้วได้จนจบ
- `api_secret` ของ Cloudinary ไม่เคยออกจากเซิร์ฟเวอร์ — แอปได้แค่ลายเซ็นที่ครอบ folder/ชนิดไฟล์/เวลาหมดอายุ

## Validation & Edge cases

- บังคับ: ชื่อ, หมวด, ราคาซื้อครั้งเดียว > 0, รูป ≥ 1, แผน active ≥ 1 (ปุ่มลงขาย disabled จนครบ)
- ราคาต่อรอบ ≤ 0 → error; ส่วนลดติดลบ → เตือนแต่ไม่บล็อก (แสดง 0% ฝั่ง buyer)
- **แก้ราคาแผนที่มี subscriber:** dialog เตือน "subscriber n คนจะจ่ายราคาใหม่ตั้งแต่รอบหน้า **และระบบจะแจ้งเตือนทุกคนทันที** — ยืนยัน?" (จำนวนที่ API นับมาให้กับสินค้า/แผนนั้น)
  - `PATCH /seller/plans/:id` ส่ง notification ให้สมาชิกทุกคน **ในทรานแซกชันเดียวกับการแก้ราคา** (ราคาเก่า→ใหม่ + วันที่มีผล + ลิงก์ไป pause/cancel) และบันทึก event `price_changed` — **ผู้ซื้อต้องไม่มีวันถูกตัดเงินเพิ่มโดยไม่รู้ตัว** (ประเด็น consumer protection ที่เขียนในเล่มได้)
- เปิด cycle ซ้ำ → ฟอร์มแสดงเฉพาะ cycle ที่ยังไม่มี (UQ กันชั้น DB อีกที)
- อัปโหลดรูปล้มบางรูป → เก็บรูปที่สำเร็จ แจ้งรายรูป ไม่ทิ้งทั้งฟอร์ม
- ขนาดรูป: resize ฝั่ง client ก่อนอัป (กว้างสุด 1080px) กัน storage บวม — bucket บังคับ ≤ 2 MB และรับเฉพาะ jpeg/png/webp อยู่แล้ว
- รูปสูงสุด 5 รูป (CHECK ที่ DB), ชื่อ 2-120 ตัว, คำอธิบาย ≤ 2000 ตัว — client validate ก่อนเพื่อ error ที่อ่านง่าย

## Acceptance Criteria

- [ ] ลงสินค้าครบ 2 ขั้น → ขึ้น catalog ฝั่ง buyer ทันที ข้อมูล/ส่วนลดตรง
- [ ] ปิดแผน → หายจากตัวเลือกฝั่ง buyer แต่ engine ยังสร้างออเดอร์ให้ subscriber เดิม (ทดสอบร่วม 13)
- [ ] แก้ราคา → รอบถัดไปของ subscriber เดิมใช้ราคาใหม่ + มี dialog เตือนร้านก่อน + **subscriber ทุกคนได้ notification ทันทีพร้อมราคาเก่า/ใหม่**
- [ ] ลบสินค้า/แผนที่มี subscriber ไม่ได้ — UI ไม่มีปุ่ม, DB ก็บล็อก
- [ ] รูปอัปโหลดจากทั้ง mobile (camera roll) และ web (file picker)

## ข้อมูลที่เกี่ยวข้อง

`products`, `product_plans`, Storage `product-images`, view `product_stats`

## Out of scope

- ระบบสต๊อกนับจำนวน, CSV import, โปรโมชัน/flash sale
