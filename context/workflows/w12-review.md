# W12 — รีวิวสินค้า (verified subscriber)

> Actor: Buyer (เขียน) + ทุกคน (อ่าน) | Features: [17](../planing/17-reviews.md), แสดงผลใน [02](../planing/02-catalog.md)/[03](../planing/03-product-detail.md)/[04](../planing/04-compare.md)
> **ทำจริงแล้ว 2026-08-18 (Phase 4.5)** — ยกเว้นแถวคะแนนในตารางเทียบที่รอหน้า compare ใน Phase 7

## Precondition
- ผู้ซื้อมี subscription ที่มีออเดอร์ **delivered หรือยืนยันรับแล้วอย่างน้อย 1 รอบ** ([W11](w11-order-exception.md) Flow B)

## Main Flow: เขียนรีวิว

| # | ผู้กระทำ | การกระทำ | ระบบทำอะไร |
|---|---|---|---|
| 1 | ระบบ | ออเดอร์แรกถึงสถานะ delivered | การ์ดในหน้า "รายการของฉัน" เปลี่ยนจากข้อความ "รีวิวได้หลังได้รับสินค้ารอบแรก" เป็นปุ่ม "ให้คะแนนสินค้านี้" (`GET /subscriptions` ส่ง `cyclesReceived` มาให้) |
| 2 | Buyer | กดดาว 1-5 + คอมเมนต์ (ไม่บังคับ) → บันทึก | `POST /subscriptions/:id/review` — ตรวจว่า subscription เป็นของตัวเอง, **นับออเดอร์ที่ delivered จริงเป็น `cycles_received`**, upsert `reviews` + event `reviewed` ในทรานแซกชันเดียว |
| 3 | ระบบ | ทันที | คะแนนเฉลี่ยบนหน้าสินค้า/การ์ดคำนวณจาก `reviews` ใน `CatalogService` (aggregate ตอนอ่าน) |
| 4 | คนอื่น | เปิดหน้าสินค้า | `GET /catalog/products/:id` คืน `reviews[]`: ดาว, คอมเมนต์, **"รับมาแล้ว N รอบ"**, ชื่อ mask (`ส****`), วันที่ — **ไม่มี `buyerId`/`subscriptionId` ใน response** |

## Flow B: แก้ไขรีวิว

| # | ผู้กระทำ | การกระทำ | ระบบทำอะไร |
|---|---|---|---|
| 1 | Buyer | ใช้ไปอีก 3 รอบ → กลับมากดปุ่ม "แก้รีวิว ★N" | `GET /subscriptions/:id/review` โหลดค่าเดิมมาใส่ในกล่อง |
| 2 | Buyer | เปลี่ยนดาว/ข้อความ → บันทึก | endpoint เดิม → upsert บน `UNIQUE(subscription_id)` + `cycles_received` คำนวณใหม่ (เช่น 1 → 4 รอบ) + `updated_at` |
| 3 | ระบบ | แสดงผล | รีวิวขึ้นป้าย "(แก้ไขแล้ว)" และป้ายจำนวนรอบเปลี่ยนตาม |

## Alternate / Error Flows

- **E1 ยังไม่เคยรับของแล้วยิง endpoint ตรง:** 422 `NOTHING_RECEIVED_YET` (ป้องกัน 2 ชั้น: ปุ่มถูกล็อกที่หน้าจอ + กฎจริงที่ service)
- **E2 รีวิวสินค้าเดียวกันจาก 2 subscriptions:** ทำได้ (คนละ subscription = คนละประสบการณ์) — unique อยู่ที่ subscription ไม่ใช่ product
- **A1 ยกเลิก subscription แล้วอยากรีวิว:** ทำได้ตามปกติ — **ตั้งใจ** เพราะคนที่เลิกใช้คือคนที่มีข้อมูลสำคัญที่สุดสำหรับผู้ซื้อคนอื่น (และเป็นข้อมูล churn ที่อธิบายได้ในเล่ม: ดูคู่กับ event `cancelled`)
- **E3 สินค้าถูกระงับ/ปิดขาย:** รีวิวเดิมยังอยู่ในฐานข้อมูล แต่หน้าสินค้าสาธารณะเข้าไม่ได้

## Postcondition
- ตารางเปรียบเทียบ ([W03](w03-browse-compare.md)) เทียบได้ทั้ง **ราคาต่อหน่วย** และ **คุณภาพจากผู้ใช้จริง** ครบตาม objective ของ proposal
- ได้ข้อมูลวิเคราะห์เพิ่มในเล่ม: ความสัมพันธ์ระหว่างคะแนนรีวิวกับอัตราการยกเลิก (rating × churn) ซึ่งเป็นข้อมูลที่ต้องมี subscription เท่านั้นถึงจะเก็บได้
