# ANAN — Workflows (Use Cases)

> อัปเดต: 2026-07-25 | หนึ่งไฟล์ = หนึ่ง use case (บาง use case ครอบหลาย feature)
> คู่กับสเปกราย feature ใน [../planing/](../planing/README.md) — feature บอก "มีอะไร" / workflow บอก "ไหลยังไงทีละขั้น"

## รายการ Use Cases

| # | Use Case | Actor | Features ที่เกี่ยว | ความสำคัญ |
|---|---|---|---|---|
| [W01](w01-signup-login.md) | สมัครสมาชิก / ล็อกอิน / ตั้งค่าโปรไฟล์ | ผู้ใช้ | 01 | พื้นฐาน |
| [W02](w02-open-shop.md) | เปิดร้านค้า | Buyer → Seller | 01, 10 | พื้นฐาน |
| [W03](w03-browse-compare.md) | หาสินค้า + เปรียบเทียบข้ามร้าน | Buyer | 02, 03, 04 | สูง |
| [W04](w04-subscribe-checkout.md) | **Subscribe (checkout จนสำเร็จ)** | Buyer | 03, 05, 09 | **สูงสุด — core loop** |
| [W05](w05-manage-subscription.md) | จัดการ subscription (pause/skip/cancel/…) | Buyer | 06 | **สูงสุด — จุดขาย** |
| [W06](w06-recurring-cycle.md) | **วงจรรอบอัตโนมัติ** (engine → order → ส่งถึงมือ) | System/ทุกคน | 07, 08, 09, 12, 13 | **สูงสุด — หัวใจเทคนิค** |
| [W07](w07-seller-products.md) | ร้านลงสินค้า + กำหนดแผนรอบส่ง | Seller | 11 | สูง |
| [W08](w08-seller-orders.md) | ร้านจัดการออเดอร์รายวัน + ดู forecast | Seller | 12 | สูง |
| [W09](w09-demo-script.md) | สคริปต์เดโม่ต่อกรรมการ (time-travel) | ทีม thesis | ทั้งหมด | สำหรับ defend |
| [W10](w10-admin.md) | Admin ดูแลแพลตฟอร์ม | Admin | 14 | กลาง |
| [W11](w11-order-exception.md) | **รอบที่ไม่เป็นไปตามแผน** (ร้านยกเลิก / ยืนยันรับของ / แจ้งปัญหา) | Seller + Buyer + Admin | 15, 16 | สูง — ปิดช่องโหว่ของ W06 |
| [W12](w12-review.md) | รีวิวสินค้าจากผู้ใช้จริง | Buyer | 17 | กลาง — เติม objective "เทียบข้ามแบรนด์" |
| [W13](w13-coupon.md) | **คูปองส่วนลดรายรอบ 2 ระดับ** (แพลตฟอร์ม + ร้านค้า · ซ้อนกันได้ระดับละ 1 ใบต่อรอบ) | Admin + Seller + Buyer + System | 18 | สูง — ทำจริงแล้ว 2026-08-24 (Phase 8) |

## รูปแบบของแต่ละไฟล์

- **Precondition / Trigger** — ต้องมีอะไรก่อน อะไรเป็นตัวจุด
- **Main Flow** — ตาราง: ลำดับ → ผู้กระทำ → การกระทำ → **ระบบทำอะไร (DB writes / side effects)** — คอลัมน์สุดท้ายอ้างชื่อตาราง/field จริงจาก [database-schema](../../docs/database-schema.md)
- **Alternate / Error Flows** — ทางแยกและกรณีพัง (A = ทางเลือก, E = error)
- **Postcondition** — จบแล้วสถานะระบบเป็นยังไง

รูปแบบนี้ตรงกับ use case description มาตรฐาน เอาไปใส่บทที่ 3 ของเล่ม thesis ได้เลย
