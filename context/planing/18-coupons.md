# Feature 18: Coupons — คูปองส่วนลดรายรอบ 2 ระดับ

> เฟส: 8 | ฝั่ง: Admin (ออกคูปอง) + Seller (เลือกสินค้าที่ร่วม) + Buyer (จองใช้รายรอบ) | สถานะ: ✅ **เสร็จแล้ว (2026-08-24)** | Workflows: [W13](../workflows/w13-coupon.md)
> เพิ่ม 2026-08-24 — ผู้ใช้สั่งให้เพิ่ม (ของเดิมอยู่ใน Out of scope ของ [feature 05](05-subscribe-checkout.md) · บรรทัดนั้นแก้แล้ว)
> **รอบที่ 2 (2026-08-24):** เพิ่ม**คูปองระดับร้านค้า**ที่ซ้อนกับคูปองของแพลตฟอร์มได้ + **นโยบายคูปองรายสินค้า** ที่ร้านตั้งเอง

## หลักคิด — ทำไมไม่ใช่คูปองแบบ e-commerce

ใน e-commerce ปกติ คูปองคือ "ลดครั้งเดียว จบที่ checkout" เพราะการซื้อเกิดครั้งเดียว

ในระบบนี้ checkout สร้างแค่ **รอบแรก** — รอบที่ 2, 3, 4… `EngineService` เป็นคนสร้างตอนตี 1 **ตอนที่ผู้ซื้อไม่ได้อยู่ตรงนั้น** คูปองจึงต้องตอบสองคำถามที่ e-commerce ไม่ต้องตอบ:

1. **รอบไหนได้ลด** — ผู้ซื้อเลือกล่วงหน้าเอง ไม่ใช่ระบบลดให้อัตโนมัติทุกรอบ
2. **ระหว่างวันที่กดกับวันที่ตัดเงินจริง ถ้ามีอะไรเปลี่ยน คูปองไปไหน**

คำตอบของ feature นี้: **คูปองเป็นของที่ "จองไว้กับรอบ" ไม่ใช่ของที่ "ใช้แล้วจบ"** — ผู้ซื้อจองล่วงหน้าใน**หน้าต่างเวลาเดียวกับที่กด "ข้ามรอบ" ได้** (ถึงสิ้นวันก่อน `next_order_date`) แล้ว engine เป็นคนใช้จริงตอนสร้างออเดอร์

> กลไกนี้มีได้เฉพาะในระบบ recurring — e-commerce ไม่มี "รอบหน้า" ให้ผู้ซื้อวางแผนล่วงหน้า **เขียนลงเล่มบทที่ 3 ได้ตรง ๆ ว่าต่างจาก marketplace ทั่วไปยังไง**

## 3 ชั้นของ actor — ตอบว่าใครรับภาระส่วนลด

| ชั้น | ใคร | ทำอะไร |
|---|---|---|
| 1 | **Admin** | ออกคูปอง **ระดับแพลตฟอร์ม** (`tier = platform`) = ประกาศแคมเปญกลาง |
| 2 | **Seller** | ① ออกคูปอง **ระดับร้าน** (`tier = shop`) ของตัวเอง — ครอบทั้งร้านหรือเลือกสินค้าเอง<br>② กด **เข้าร่วม** แคมเปญของแพลตฟอร์มรายสินค้า<br>③ ตั้ง **นโยบายคูปองรายสินค้า** ว่าชิ้นไหนรับระดับไหนบ้าง |
| 3 | **Buyer** | เลือกใช้คูปอง **กับรอบใดรอบหนึ่ง** ก่อนวันตัดเงิน — **ซ้อนได้ระดับละ 1 ใบ** |

### ★ 2 ระดับซ้อนกัน — เพดานมาจาก DB ไม่ใช่จากโค้ด ★

partial unique `coupon_one_per_cycle_tier` บน `(subscription_id, cycle_date, tier)`
ทำให้ "1 รอบ ได้ระดับละ 1 ใบ" เป็นข้อเท็จจริงของฐานข้อมูล — เพดาน "ซ้อนได้ไม่เกิน 2 ใบ"
จึงเท่ากับจำนวนค่าใน enum `coupon_tier` เอง ไม่ใช่การนับใน service

**สูตรเมื่อซ้อนกัน: คิดจากยอดเต็มทั้งคู่ แล้วรวม** (ไม่ใช่ต่อยอด)

```
ยอด ฿255 · แพลตฟอร์ม 20% = ฿51 · ร้าน 10% = ฿25.50 → ลดรวม ฿76.50 → จ่าย ฿178.50
(ถ้าคิดต่อยอดจะได้ 51 + 20.40 = ฿71.40 ซึ่งไม่ตรงกับที่ป้ายคูปองแต่ละใบประกาศไว้)
```

เหตุผล: เลขบนหน้าจอต้องตรงกับที่แต่ละใบเขียนไว้เป๊ะ — "ลด 20%" ต้องลด 20% ของยอดจริง
ถ้าคิดต่อยอด ใบที่สองจะลดน้อยกว่าที่ประกาศเสมอ ซึ่งอธิบายบนใบเสร็จไม่ได้

**ถ้ารวมแล้วเกินยอด หนีบที่ใบของร้าน** (แพลตฟอร์มคิดก่อน) — ต้องมีลำดับที่แน่นอน
ไม่งั้นยอดของสองใบรวมกันจะไม่เท่ากับ `orders.discount_amount` พอดี แล้วใบเสร็จจะบวกไม่ลง

### ★ นโยบายคูปองรายสินค้า — ด่านที่ร้านคุมเอง ★

`products.coupon_policy` มี 4 ค่า: `both` (ซ้อนได้) · `platform_only` · `shop_only` · `none`

ด่านนี้อยู่ฝั่ง **สินค้า** ไม่ใช่ฝั่ง **คูปอง** — ต่อให้คูปองครอบสินค้าชิ้นนั้นไว้
ถ้านโยบายไม่รับระดับนั้นก็ใช้ไม่ได้ · มีไว้ให้ร้านกันสินค้ากำไรบางไม่ให้ถูกลดซ้อนสองชั้น
**โดยไม่ต้องถอนออกจากแคมเปญทั้งใบ**

**ร้านกดเองทั้งสองทาง = ร้านรับภาระส่วนลดเอง** — ทั้งการออกคูปองของตัวเองและการกดเข้าร่วมแคมเปญของแพลตฟอร์ม เป็นการตัดสินใจของร้าน โครงนี้ทำให้ไม่ต้องมีโมเดลส่วนแบ่งรายได้/ค่าคอมมิชชัน (ซึ่งระบบนี้ไม่มีและไม่อยู่ในขอบเขต thesis) และตรงกับโมเดลจริงของ marketplace ไทย

**คูปองเป็นรายการที่เลือกได้ ไม่ใช่โค้ดลับ** — เพราะ admin ประกาศแคมเปญและร้านเข้าร่วม ผู้ซื้อจึง "เห็นรายการแล้วเลือก" ไม่ใช่ "พิมพ์โค้ดที่รู้มาจากไหนสักที่" → ไม่มีปัญหาการยิงเดาโค้ด (enumeration) และไม่ต้องมี rate limit พิเศษ · คอลัมน์ `code` ยังมีอยู่เพื่ออ้างอิงบนใบเสร็จและหน้าจอ admin

## ทำอะไรได้

**Admin**
- ออกคูปอง: `code` · ชื่อ/คำอธิบาย · `percent` หรือ `fixed` · มูลค่า · เพดานส่วนลด (เฉพาะ percent) · ยอดขั้นต่ำ · ช่วงเวลา · โควตารวม · จำกัดต่อคน
- ปิดคูปอง (`is_active = false`) — **ไม่มีปุ่มลบ**: ใบที่ถูกใช้ไปแล้วต้องอ้างอิงกลับได้ตลอด
- ดูยอดใช้จริงต่อคูปอง (จองอยู่ / ใช้แล้ว / คืนแล้ว) และร้าน/สินค้าที่เข้าร่วม

**Seller**
- เห็นรายการคูปองที่ admin เปิดอยู่ + เงื่อนไข + ประมาณการภาระส่วนลดต่อรอบของสินค้าตัวเอง
- ติ๊กเลือกว่าสินค้าไหนเข้าร่วมคูปองใบไหน (เปิด/ปิดได้ตลอด) — **ปิดทีหลังไม่กระทบใบที่ผู้ซื้อจองไปแล้ว**

**Buyer**
- ในหน้ารายการของฉัน → ปุ่ม **"ใช้คูปองกับรอบถัดไป"** → เห็นเฉพาะคูปองที่ใช้ได้จริงกับรายการนั้น พร้อมยอดที่จะลด
- ยกเลิกการจองเองได้ก่อนถึงกำหนด (คืนโควตาให้คนอื่น)
- ใช้คูปองกับ **รอบแรก** ได้ในหน้า checkout
- แจ้งเตือน T-3 บอกว่ารอบนี้มีคูปองใช้ได้ / จองไว้แล้วลดเท่าไหร่

## หน้าจอ & Routes

| Route | หน้าจอ |
|---|---|
| `(admin)/coupons.tsx` | **หน้าใหม่ — หน้าที่ 7 ของคอนโซลผู้ดูแล** · ตารางคูปอง + ฟอร์มออก/แก้ + ปุ่มปิด |
| `(seller)/coupons.tsx` | **หน้าใหม่ (รอบ 2)** — คูปองที่ร้านออกเอง: ฟอร์มออกคูปอง + เลือกขอบเขต (ทั้งร้าน / เลือกสินค้า) + รายการพร้อมยอดใช้ |
| `(seller)/products/[id].tsx` | เพิ่มส่วน **"คูปองที่ร่วมรายการ"** ในหน้าแก้สินค้าเดิม — **นโยบายรายสินค้า + คูปองทั้งสองระดับ บันทึกพร้อมกัน** |
| `(buyer)/subscriptions.tsx` | เพิ่มปุ่มในการ์ด + `subs-coupon-modal` (แพตเทิร์นเดียวกับ `subs-plan-modal` / `subs-address-modal` ที่มีอยู่แล้ว) |
| `checkout/[planId].tsx` | แถวเลือกคูปองในสรุปยอด — สำหรับรอบแรก |

## Components หลัก

- `CouponForm` (admin) — ฟอร์มออก/แก้; สลับช่องตาม `discountType` (percent โชว์ช่องเพดาน · fixed ซ่อน)
- `CouponRow` (admin) — code, มูลค่า, ช่วงเวลา, `จองอยู่ n / ใช้แล้ว m / โควตา k`, ป้ายสถานะ (กำลังใช้ · ยังไม่เริ่ม · หมดอายุ · ปิดแล้ว)
- `ProductCouponPicker` (seller) — checkbox list ของคูปองที่เปิดอยู่ + บรรทัด "สินค้านี้จะถูกลดสูงสุด ฿X ต่อรอบ"
- `CouponSheet` (buyer · `src/features/coupons/CouponSheet.tsx`) — รายการคูปองที่ใช้ได้กับรอบนี้ + ยอดลดของแต่ละใบ + เหตุผลที่ใช้ไม่ได้ของใบที่เทาไว้ (สเปกร่างแรกเรียก `CouponPickerSheet`)
- `CouponAppliedRow` — บรรทัด "คูปอง {code} −฿{discount}" ในสรุปยอด checkout / การ์ด subscription / หน้าออเดอร์ / ใบเสร็จจำลอง

## โครงข้อมูล

### 3 ตารางใหม่

```prisma
model Coupon {                        // ชั้น 1 — ผู้ออกคูปอง
  id, code @unique                    // A-Z 0-9 และ - ตัวพิมพ์ใหญ่ 4-24 ตัว
  tier   CouponTier                   // ★ platform | shop — ตัวกำหนดว่าไปนั่งช่องไหนของรอบ
  shopId String?                      // null เมื่อ tier=platform · บังคับคู่กันด้วย CHECK
  appliesToAllProducts Boolean @default(false)  // ของร้าน: ครอบทั้งร้านรวมสินค้าที่เพิ่มทีหลัง
  title, description?
  discountType   CouponDiscountType   // percent | fixed
  discountValue      Decimal(10,2)
  maxDiscountAmount  Decimal(10,2)?   // เพดานของ percent (fixed ต้องเป็น null)
  minOrderAmount     Decimal(10,2)?
  startsAt, endsAt   Timestamptz
  maxRedemptions     Int?             // โควตารวมทั้งแคมเปญ (null = ไม่จำกัด)
  inUseCount         Int @default(0)  // ★ จองอยู่ + ใช้ไปแล้ว — ตัวเดียวที่คุมโควตา
  maxPerUser         Int @default(1)
  isActive           Boolean @default(true)
  createdBy          -> User
}

model CouponProduct {                 // ชั้น 2 — ร้าน opt-in สินค้าของตัวเอง
                                      // (คูปองร้านแบบ appliesToAllProducts ไม่ต้องมีแถวที่นี่)
  couponId, productId
  enabledBy -> User, enabledAt
  @@unique([couponId, productId])
}

model CouponRedemption {              // ชั้น 3 — ผู้ซื้อจองกับ "รอบ" หนึ่ง
  id, couponId, subscriptionId, buyerId
  cycleDate  Date                     // ★ จองไว้กับรอบวันไหน
  tier       CouponTier               // ★ คัดลอกจากคูปอง — 1 รอบได้ระดับละ 1 ใบ
  status     CouponRedemptionStatus   // reserved | consumed | released
  // snapshot เงื่อนไข ณ เวลาจอง — ร้าน/admin แก้ทีหลังต้องไม่ย้อนไปแก้ของที่จองแล้ว
  discountType, discountValue, maxDiscountAmount?, minOrderAmount?
  discountAmount Decimal(10,2)        // ตอนจอง = ประมาณการ · ตอน consume = ยอดจริง
  reservedAt, consumedAt?, releasedAt?, releasedReason?  // CouponReleaseReason
  // ★ ไม่มี orderId ★ ตัวเชื่อมกับออเดอร์อยู่ฝั่ง `orders` คอลัมน์เดียว (ดูใต้ตาราง)
}
```

### คอลัมน์ที่เพิ่มใน `orders`

```prisma
discountAmount        Decimal(10,2) @default(0)   // ส่วนลด "รวม" ของรอบนี้
platformRedemptionId  String?  @unique   // FK → coupon_redemptions · onDelete: Restrict
shopRedemptionId      String?  @unique   // FK → coupon_redemptions · onDelete: Restrict
// amount คงความหมายเดิม = ยอดที่ตัดจริง (หลังลด) · gross = amount + discountAmount
```

> **★ ช่อง FK ตายตัว 2 ช่อง = เพดาน "ซ้อนได้ไม่เกิน 2 ใบ" อยู่ในโครงสร้าง ★**
> ไม่ใช่ตาราง join ที่ต้องนับแถวในโค้ด — ยิง API ตรงกี่ครั้งก็ใส่ใบที่ 3 ไม่ได้
> เพราะ *ไม่มีที่ให้เก็บ* · เพิ่มระดับที่ 3 ในอนาคตต้องผ่าน migration ซึ่งเป็นการตัดสินใจโดยตั้งใจ

> **ตอนสร้างจริงตัด `coupon_redemptions.order_id` ออก** — สเปกร่างแรกมีคอลัมน์ผูกกันสองฝั่ง
> ซึ่งเป็นข้อมูลซ้ำที่ไม่มีอะไรบังคับให้ตรงกัน (ต่างจาก `orders.buyer_id` ที่มี FK คู่คุมอยู่)
> เหลือฝั่ง `orders` ฝั่งเดียวก็ได้ทั้งสองทิศทางใน Prisma และ CHECK
> `orders_discount_needs_redemption` ยังบังคับได้เหมือนเดิม · CHECK ของ `consumed`
> จึงเหลือแค่ `(status = 'consumed') = (consumed_at IS NOT NULL)`
>
> **FK เป็น `Restrict` ไม่ใช่ `SetNull`** (migration `20260824101500`) — ถ้าปล่อยให้ลบใบจอง
> แล้วคอลัมน์กลายเป็น NULL ออเดอร์จะเหลือส่วนลดที่ไม่มีที่มาแล้วผิด CHECK ทันที

> **`amount` ต้องคงความหมายเดิม** — ถ้าเปลี่ยนให้เป็นยอดก่อนลด ต้องไล่แก้ทั้ง `retryPayment` · การคืนเงินของร้าน · ใบเสร็จจำลอง · แท็บออเดอร์ของร้าน การเก็บ `discount_amount` แยกทำให้ท้ายน้ำทั้งหมดไม่ต้องแก้แม้แต่บรรทัดเดียว

### enum ที่เพิ่ม

| enum | ค่าที่เพิ่ม |
|---|---|
| `CouponTier` (ใหม่ · รอบ 2) | `platform` · `shop` — ระดับของคูปอง |
| `CouponPolicy` (ใหม่ · รอบ 2) | `both` · `platform_only` · `shop_only` · `none` — นโยบายของ **สินค้า** (`products.coupon_policy`) ร้านตั้งเองรายชิ้น |
| `CouponDiscountType` (ใหม่) | `percent` · `fixed` |
| `CouponRedemptionStatus` (ใหม่) | `reserved` · `consumed` · `released` |
| `CouponReleaseReason` (ใหม่ · เพิ่มตอนสร้างจริง) | `user_removed` · `cycle_changed` · `shop_suspended` · `min_order_not_met` — enum ไม่ใช่ text ด้วยเหตุผลเดียวกับ `AuditAction` และเพราะสองค่าท้ายคือการคืนที่ **ระบบ** ทำเอง จึงต้องแจ้งผู้ซื้อ |
| `SubscriptionEventType` | `coupon_applied` · `coupon_released` |
| `NotificationType` | `coupon_released` — แจ้งเมื่อ **ระบบ** เป็นคนคืน (ผู้ซื้อกดเองไม่ต้องแจ้ง) |
| `AuditAction` | `coupon_created` · `coupon_updated` · `coupon_deactivated` |

### Index / CHECK ที่เป็นความถูกต้องของข้อมูล (ต้องอยู่ที่ DB — กฎข้อ 4)

```sql
-- 1 รอบ ใช้คูปองได้ "ระดับละ" 1 ใบ · partial เพื่อให้ "คืนแล้วจองใหม่" ทำได้
CREATE UNIQUE INDEX coupon_one_per_cycle_tier
  ON coupon_redemptions (subscription_id, cycle_date, tier) WHERE status <> 'released';

-- 1 คน ใช้คูปองใบนี้ได้ครั้งเดียว — กันเปิด subscription หลายใบวนใช้ซ้ำ
-- (ใช้ได้เมื่อ max_per_user = 1 ซึ่งเป็นค่าเดียวที่เปิดใช้ในเฟสนี้ — ดู Out of scope)
CREATE UNIQUE INDEX coupon_once_per_user
  ON coupon_redemptions (coupon_id, buyer_id) WHERE status <> 'released';

ALTER TABLE coupons
  ADD CONSTRAINT coupons_value_positive     CHECK (discount_value > 0),
  ADD CONSTRAINT coupons_percent_range      CHECK (discount_type <> 'percent' OR discount_value <= 100),
  ADD CONSTRAINT coupons_fixed_no_cap       CHECK (discount_type <> 'fixed'   OR max_discount_amount IS NULL),
  ADD CONSTRAINT coupons_window             CHECK (ends_at > starts_at),
  ADD CONSTRAINT coupons_quota_nonneg       CHECK (in_use_count >= 0),
  ADD CONSTRAINT coupons_quota_within_max   CHECK (max_redemptions IS NULL OR in_use_count <= max_redemptions),
  ADD CONSTRAINT coupons_per_user_positive  CHECK (max_per_user >= 1),
  -- tier กับเจ้าของต้องตรงกันเสมอ: ของร้านต้องมี shop_id · ของแพลตฟอร์มต้องไม่มี
  ADD CONSTRAINT coupons_tier_shop_consistent
    CHECK ((tier = 'shop') = (shop_id IS NOT NULL)),
  -- "ครอบทั้งร้าน" มีความหมายเฉพาะกับคูปองของร้าน
  ADD CONSTRAINT coupons_all_products_shop_tier_only
    CHECK (tier = 'shop' OR applies_to_all_products = false);
-- coupons_code_format: บังคับรูปแบบโค้ดด้วย regex ^[A-Z0-9-]{4,24}$ (เขียนในไฟล์ migration)

ALTER TABLE coupon_redemptions
  ADD CONSTRAINT redemption_amount_nonneg   CHECK (discount_amount >= 0),
  ADD CONSTRAINT redemption_consumed_consistent
    CHECK ((status = 'consumed') = (consumed_at IS NOT NULL)),
  ADD CONSTRAINT redemption_released_consistent
    CHECK ((status = 'released') = (released_at IS NOT NULL AND released_reason IS NOT NULL));

ALTER TABLE orders
  ADD CONSTRAINT orders_discount_nonneg     CHECK (discount_amount >= 0),
  -- ส่วนลดกับใบจองต้องมาคู่กันเสมอ — ห้ามมีออเดอร์ที่ลดแล้วแต่ไม่รู้ว่าลดจากคูปองใบไหน
  ADD CONSTRAINT orders_discount_needs_redemption
    CHECK ((discount_amount > 0)
           = (platform_redemption_id IS NOT NULL OR shop_redemption_id IS NOT NULL));
```

## State machine ของการจอง

```
                    ┌── ผู้ซื้อกดยกเลิกการจอง ───┐
                    │   skip / pause / cancel    │
   [ ไม่มี ] ──จอง──▶ reserved ──เลื่อน/เปลี่ยนรอบส่ง──▶ released  (คืนโควตา)
                    │   ร้าน/สินค้าถูกระงับ       │
                    │                            │
                    └── engine สร้างออเดอร์ ─────▶ consumed  (ปลายทางถาวร)
```

**กฎเดียว ไม่มีข้อยกเว้น: อะไรก็ตามที่ทำให้ `next_order_date` เปลี่ยนโดยไม่เกิดออเดอร์ → คืนคูปอง**
(skip · pause · เลื่อนวันส่ง · เปลี่ยนรอบส่ง · cancel · ร้าน/สินค้าถูกระงับ) แล้วบอกผู้ซื้อว่า "คูปองถูกคืนแล้ว ใช้กับรอบใหม่ได้" — กฎข้อเดียวนี้แทนการไล่เขียนเคสพิเศษทีละอัน และทำให้ไม่มีทางที่คูปองจะค้างอยู่กับรอบที่ไม่มีวันเกิด

**สิ่งที่ไม่คืน** (ตั้งใจ):

| เหตุการณ์ | ทำไมไม่คืน |
|---|---|
| ตัดเงินไม่ผ่าน (บัตรถูกปฏิเสธ) | ออเดอร์เกิดแล้วที่ยอดหลังลด ผู้ซื้อกดจ่ายซ้ำได้ที่ยอดเดิม → `consumed` |
| คูปองหมดอายุหลังจองแล้ว | ล็อกไว้ตั้งแต่ตอนจองด้วย snapshot — ถ้าคืนเงียบ ๆ ผู้ซื้อจะโดนตัดเต็มโดยไม่รู้ตัว (และจองได้เฉพาะรอบที่ `cycle_date` ยังอยู่ก่อน `ends_at` อยู่แล้ว) |
| ร้านถอนสินค้าออกจากคูปองหลังจอง | เหตุผลเดียวกัน — ร้านถอนได้ แต่มีผลกับการจองครั้งถัดไป |
| ร้านยกเลิกออเดอร์ + คืนเงิน ([15](15-order-exceptions.md)) | `consumed` ไปแล้ว การคืนคูปองย้อนหลังเป็นนโยบายชดเชยคนละเรื่อง (Out of scope) |

## กฎเวลา — หน้าต่างจอง และการแข่งกับ engine

- **จองได้ถึงสิ้นวันก่อน `next_order_date`** (Asia/Bangkok) — เหมือน skip เป๊ะ เพราะ engine รันตี 1 ของวัน `cycle_date`
- **จองได้เฉพาะรอบที่ `cycle_date` อยู่ในช่วง `[starts_at, ends_at]` ของคูปอง**
- แต่ admin กด "Run now" (time-travel) ได้ตลอด → **ชนกันได้จริง** กันด้วยแพตเทิร์นเดียวกับที่ `SubscriptionsService.commit()` ใช้อยู่แล้ว คือ **เอาเงื่อนไขที่ต้องแข่งไปไว้ใน `where` ของคำสั่งเขียน ไม่ใช่ใน `if` ข้างบน**

| จังหวะ | เขียนยังไง |
|---|---|
| **จอง** | `coupon.updateMany` โดยมีเงื่อนไขโควตาอยู่ใน `where` (`isActive` + ยังไม่เต็ม) พร้อม `inUseCount: { increment: 1 }` → count 0 = 409 `COUPON_EXHAUSTED` · แล้ว insert redemption (ชน partial unique = 409) · guard `nextOrderDate: cycleDate` ที่ subscription |
| **คืน** | `redemption.updateMany({ where: { id, status: 'reserved' }, … })` → ได้ count 1 เท่านั้นถึงจะ `inUseCount: { decrement: 1 }` |
| **ใช้** | ใน **tx เดียวกับที่ engine สร้างออเดอร์** — `updateMany({ where: { subscriptionId, cycleDate, status: 'reserved' } })` → count 0 แปลว่าไม่มีคูปอง ก็ตัดเต็ม |

> **idempotency ได้ฟรีเหมือนเดิม** — engine รันซ้ำวันเดิมชน `orders UNIQUE (subscription_id, cycle_date)` แล้ว rollback ทั้ง tx → คูปองไม่ถูก consume ซ้ำ ไม่ต้องเขียนกลไกกันซ้ำเพิ่มเลย (กฎข้อ 5)

## สูตรคำนวณส่วนลด

อยู่ที่เดียว: `anan-api/src/coupons/discount.ts` — **pure function มี unit test ชั้น L1**

```
gross = pricePerCycle × quantity
d     = type === 'percent' ? gross × value / 100 : value
d     = min(d, maxDiscountAmount ?? d)
d     = min(d, gross)          // ยอดห้ามติดลบ
d     = floor2(d)              // ปัดลง 2 ตำแหน่ง → amount + discount = gross เป๊ะ ไม่มีเศษหาย
ใช้ไม่ได้ ถ้า gross < minOrderAmount
```

**คำนวณใหม่ตอนตัดเงินเสมอ จาก snapshot ของ *เงื่อนไข* ไม่ใช่จากยอดที่จองไว้** — เพราะ `gross` เปลี่ยนได้ระหว่างนั้น (ร้านขึ้น/ลดราคา · ผู้ซื้อเปลี่ยนแผนหรือจำนวน) ค่า `discountAmount` ที่บันทึกตอนจองคือ **ประมาณการที่โชว์ให้ผู้ซื้อเห็น** แล้วเขียนทับด้วยยอดจริงตอน `consumed`

ถ้าคำนวณใหม่แล้ว `minOrderAmount` ไม่ผ่าน → **คืนคูปอง + แจ้งผู้ซื้อ** ไม่ใช่ consume ที่ 0 บาท (ไม่งั้นคูปองหายไปฟรี ๆ)

## Data & Queries (API)

| Endpoint | ใคร | หมายเหตุ |
|---|---|---|
| `GET /admin/coupons?status=` | admin | + ยอด `reserved` / `consumed` / `released` ต่อใบ |
| `POST /admin/coupons` | admin | + `audit_logs` action `coupon_created` |
| `PATCH /admin/coupons/:id` | admin | แก้ได้เฉพาะ `title` / `description` / `endsAt` / `maxRedemptions` — **ชนิดกับมูลค่าแก้ไม่ได้** ให้ปิดใบเดิมแล้วออกใบใหม่ (ใบที่จองไปแล้วถือ snapshot อยู่ก็จริง แต่การแก้มูลค่ากลางแคมเปญทำให้ผู้ซื้อสองคนได้คนละดีลจากโค้ดเดียวกัน) |
| `POST /admin/coupons/:id/deactivate` | admin | `is_active = false` — **ไม่มี DELETE** |
| `GET /seller/products/:id/coupons` | seller | คูปองที่เปิดอยู่ + สินค้าชิ้นนี้เข้าร่วมใบไหน + ภาระส่วนลดต่อรอบ<br>_(สเปกเดิมเขียนไว้เป็น `GET /seller/coupons` — เปลี่ยนเป็นรายสินค้าเพราะหน้าจอต้องรู้ว่า "ชิ้นนี้ติ๊กใบไหนไว้" ซึ่งเป็นข้อมูลรายสินค้าอยู่แล้ว)_ |
| `PUT /seller/products/:id/coupons` | seller | body `{ couponIds: string[] }` — **แทนที่ทั้งชุด (idempotent)** · ownership ที่ service: `product.shop.ownerId = ผู้เรียก` |
| `GET /subscriptions/:id/coupons` | buyer | คูปองที่ใช้ได้กับ **รอบถัดไปของรายการนี้** + `discountAmount` ที่คำนวณจาก server + ใบที่ใช้ไม่ได้พร้อมเหตุผล |
| `POST /subscriptions/:id/coupon` | buyer | body มีแค่ `{ couponId }` → จองกับรอบถัดไป + event `coupon_applied` |
| `DELETE /subscriptions/:id/coupon` | buyer | ยกเลิกการจอง + คืนโควตา + event `coupon_released` |
| `GET /catalog/plans/:id/coupons?quantity=` | buyer | คูปองที่ใช้ได้ตอน checkout (ยังไม่มี subscription) |
| `POST /subscriptions` | buyer | body **เพิ่มได้แค่ `couponId?: string`** |

รวม **10 endpoint** (admin 4 · seller 2 · buyer 3 · catalog 1)

`GET /subscriptions` กับ `GET /subscriptions/:id` เพิ่มฟิลด์ `coupon` ในการ์ด (โค้ด · วันรอบ · ยอดลด · ยอดสุทธิ) — ดึงมาพร้อมการ์ดในคำขอเดียวแทนที่จะให้หน้าจอยิงเพิ่มรายรายการ · `GET /orders/:id` เพิ่ม `discountAmount` + `couponCode` ให้ใบเสร็จ

### endpoint ที่เพิ่มในรอบ 2

| Endpoint | ใคร | หมายเหตุ |
|---|---|---|
| `GET /seller/coupons` | seller | คูปองที่ร้านนี้ออกเอง (ของร้านอื่นไม่โผล่) |
| `POST /seller/coupons` | seller | ออกคูปองของร้าน — **`tier: 'shop'` เขียนตายตัวที่ service** |
| `PATCH /seller/coupons/:id` · `POST /seller/coupons/:id/deactivate` | seller | เฉพาะคูปองของร้านตัวเอง (`where: { tier: 'shop', shopId }`) |
| `GET /admin/coupons?tier=shop` | admin | ผู้ดูแลอ่านคูปองของร้านได้ (แก้ไม่ได้) — ต้องตอบได้ว่าแคมเปญไหนของใคร |

**⚠ ไม่มี endpoint ไหนรับ `discountAmount` / `amount` / ยอดสุทธิจาก client** — ทุกยอดคำนวณที่ service จาก `price_per_cycle` ใน DB ([security-design S-02](../../docs/security-design.md)) · `buyerId` มาจาก token เสมอ ไม่เคยมาจาก body

**⚠ `tier` กับ `shopId` ไม่มีใน DTO เลย** — ระดับของคูปองมาจาก **endpoint ที่ถูกเรียก** ไม่ใช่ค่าที่ client ส่ง ถ้ารับจาก body ร้านจะออกคูปองระดับแพลตฟอร์มได้ด้วย curl บรรทัดเดียว (มีเคส L4 TC-117 ยิงตรงพิสูจน์)

## Validation & Edge cases

- **จองซ้ำรอบเดิม** → 409 `COUPON_ALREADY_APPLIED` (มาจาก partial unique ไม่ใช่จากการ SELECT ก่อนเขียน)
- **คูปองใบนี้ผู้ซื้อคนนี้เคยใช้แล้ว** → 409 `COUPON_ALREADY_USED`
- **โควตาเต็มระหว่างกด** → 409 `COUPON_EXHAUSTED` (มาจาก `updateMany` count 0)
- **สินค้าไม่ได้เข้าร่วมคูปองนี้** → 404 (ไม่ใช่ 403 — ผู้ซื้อไม่ควรรู้ว่าคูปองมีอยู่แต่ร้านไม่ร่วม)
- **ยอดรอบนี้ต่ำกว่า `minOrderAmount`** → ใบนั้นเทาในรายการ พร้อมข้อความ "ใช้กับยอดตั้งแต่ ฿X"
- **เลยเวลาจองแล้ว** (วันนี้ = `next_order_date`) → 409 `CYCLE_TOO_CLOSE` "รอบนี้ใกล้ถึงกำหนดแล้ว ใช้กับรอบถัดไปได้"
- **subscription ไม่ใช่ `active`** → 409 (paused / cancelled จองไม่ได้)
- **คูปอง 100% → `amount = 0`** — `DemoPaymentProvider` ต้องรับยอด 0 ได้และคืน `paid` (CHECK `orders_amount_range` อนุญาต `>= 0` อยู่แล้ว) · ต้องมี unit test ของกรณีนี้
- **percent + เพดาน** — ลด 20% เพดาน ฿50 ยอด ฿400 → ลด ฿50 ไม่ใช่ ฿80
- **admin ปิดคูปองที่มีคนจองค้าง** → ใบที่จองแล้วยังใช้ได้ (snapshot) แค่ห้ามจองใหม่ · หน้า admin ต้องบอกจำนวนที่ค้างอยู่ก่อนกดปิด

## ผลกระทบต่อโค้ดเดิม (ต้องแก้ในรอบเดียวกัน)

| ไฟล์ | ต้องทำอะไร |
|---|---|
| `engine/engine.service.ts` (`createOneOrder`) | อ่าน redemption `reserved` ของรอบ → คำนวณใหม่ → หักจาก `amount` → เขียน `discount_amount` + mark `consumed` **ใน tx เดียวกัน** |
| `engine/engine.service.ts` (`notifyUpcoming`) | แจ้งเตือน T-3 ต้องบอกยอดหลังลดถ้าจองไว้ และบอกว่า "รอบนี้มีคูปองใช้ได้" ถ้ายังไม่จอง — **ถ้าไม่ทำข้อนี้ ไม่มีใครรู้ว่ามีคูปอง feature นี้จะไม่ถูกใช้เลย** |
| `subscriptions/subscriptions.service.ts` | `create()` รองรับ `couponId` · **ทุก action ที่ขยับ `next_order_date` (`skip` / `pause` / `reschedule` / `changeCycle` / `cancel`) ต้องคืนคูปองใน tx เดียวกัน** |
| `admin/moderation.service.ts` | ระงับร้าน/สินค้า → แช่แข็ง subscription **+ คืนคูปองที่จองค้าง** + แจ้งผู้ซื้อ |
| `orders/orders.service.ts` | response เพิ่ม `discountAmount` + `couponCode` เพื่อโชว์ในใบเสร็จ (**ไม่แตะ `retryPayment`**) |
| MRR / forecast 3 จุด — `admin.service.ts` · `seller/shop.service.ts` · `seller/orders.service.ts` | ทั้งสามคิดจาก `pricePerCycle` ตรง ๆ · **ตัดสินใจแล้ว: MRR คงเป็นยอดตามสัญญา (ก่อนลด)** เพราะเป็นตัวชี้วัดความสัมพันธ์ระยะยาว ส่วนส่วนลดโชว์เป็นบรรทัดแยก "ส่วนลดคูปองเดือนนี้ ฿X" ในหน้า dashboard ของร้าน |
| `anan/src/features/catalog/pricing.ts` | คำว่า **"ส่วนลด"** ถูกใช้ไปแล้วกับ % เทียบราคาซื้อครั้งเดียว → ใน UI ต้องแยกคำ: ของเดิมเรียก **"ถูกกว่าซื้อครั้งเดียว"** ของใหม่เรียก **"คูปอง"** เท่านั้น |
| `docs/database-schema.md` · [W05](../workflows/w05-manage-subscription.md) · [W06](../workflows/w06-recurring-cycle.md) | อัปเดต ER / ตารางทั้งหมด / ตาราง action ให้ตรง |

## Acceptance Criteria

- [x] admin ออกคูปองได้ → ขึ้นในรายการของร้าน · ร้านติ๊กสินค้าเข้าร่วม → ผู้ซื้อของสินค้านั้นเห็นคูปองในรายการที่ใช้ได้
- [x] ผู้ซื้อจองคูปองกับรอบถัดไป → การ์ดโชว์ "รอบ {วันที่} ลด ฿X" ทันที และ `coupon_redemptions` มีแถว `reserved` + `coupons.in_use_count` +1
- [x] **engine รันถึงรอบนั้น → `orders.amount` = ยอดหลังลด · `orders.discount_amount` ตรงกับสูตร · `payments.amount` ตรงกัน · redemption เป็น `consumed`** (ยืนยันใน DB ไม่ใช่แค่ตัวเลขบนจอ)
- [x] **engine รันซ้ำวันเดิม 3 ครั้ง → ออเดอร์ 1 ใบ · คูปองถูกใช้ 1 ครั้ง · `in_use_count` ไม่ขยับเพิ่ม**
- [x] ผู้ซื้อ skip รอบที่จองคูปองไว้ → redemption เป็น `released` · `in_use_count` −1 · จองใบเดิมกับรอบใหม่ได้อีก
- [x] admin ระงับร้าน → subscription ถูกแช่แข็ง **และคูปองถูกคืนพร้อมแจ้งเตือน**
- [x] คูปองใบเดิม ผู้ซื้อคนเดิม จองครั้งที่สอง → 409 (ยิง API ตรงข้าม UI ก็ต้องโดนปฏิเสธ)
- [x] โควตาเต็ม → คนถัดไปได้ 409 · ยิงพร้อมกัน 3 เส้นบนคูปองที่เหลือ 1 ใบ → สำเร็จ 1 เท่านั้น
- [x] แนบ `discountAmount` มาใน body ของ `POST /subscriptions` → 400 (ต่อจาก T-2)
- [x] ผู้ซื้อ A จองคูปองบน subscription ของ B → 404
- [x] seller ติ๊กคูปองให้สินค้าของร้านอื่น → 404
- [x] คูปอง 100% → ตัดเงิน ฿0 สำเร็จ ออเดอร์เกิดปกติ
- [x] ป้าย DEMO ยังอยู่ครบทุกจุดที่โชว์ยอดเงิน (กฎเหล็กข้อ 1)

## แผนการทดสอบ

ตาม [testing.md §3](../../docs/testing.md) — endpoint ใหม่ 10 ตัว × (สำเร็จ · ไม่ใช่เจ้าของ 404 · สถานะผิด 409) · **ผลรอบที่ปิดงาน: unit 15 · e2e API 46 · DB invariant 10 · Playwright 10 = 81 เคสใหม่**

| ชั้น | ต้องมี |
|---|---|
| **L1 unit** | ✅ 15 เคสที่ `src/coupons/discount.spec.ts` — ครบทุกกิ่ง: percent · percent + เพดาน · fixed · fixed > gross · minOrder ไม่ผ่าน · การปัดเศษ · 100% |
| **L2 e2e API** | ✅ `coupons.e2e-spec.ts` 22 เคส (admin/seller CRUD + ownership) · `coupon-redemption.e2e-spec.ts` 24 เคส (จอง / คืน / โควตา / ยิงพร้อมกัน / engine / checkout) |
| **L3 DB invariant** | ✅ 10 เคสใน `db-invariants.e2e-spec.ts` — **`buyer_id` ของใบจองต้องเป็นเจ้าของ subscription จริง (FK คู่ · D-4)** · โควตาเกินไม่ได้ · สถานะกับเวลาต้องมาคู่กัน · 1 รอบ 1 ใบ (คืนแล้วจองใหม่ได้) · 1 คน 1 ครั้ง · ออเดอร์ที่มีส่วนลดต้องชี้กลับไปหาใบจองได้ |
| **L4 Playwright** | ✅ **TC-106 … TC-120** ที่ `e2e/specs/coupons.spec.ts` (15 เคส) — ออกคูปองจากหน้าจอ · ร้านติ๊ก/ถอน · ผู้ซื้อเห็นยอดที่ server คำนวณ · จองแล้วยืนยันใน DB · ข้ามรอบแล้วคูปองคืน · engine ตัดเงินยอดหลังลด + รันซ้ำไม่ใช้ซ้ำ · ใบเสร็จ · ยิง API ตรงข้าม UI · ปิดคูปอง · **รอบ 2: ร้านออกคูปองเอง · ตั้ง `coupon_policy` รายสินค้า · จองซ้อน 2 ระดับแล้วยืนยันยอดใน DB · engine ตัดเงินยอดซ้อน · ใบเสร็จแจกแจง 2 บรรทัด** |

## ข้อมูลที่เกี่ยวข้อง

`coupons`, `coupon_products`, `coupon_redemptions` (ตารางใหม่) · `orders.discount_amount`, `orders.platform_redemption_id`, `orders.shop_redemption_id` · `products.coupon_policy` (คอลัมน์ใหม่) · `subscription_events` (2 event ใหม่) · `audit_logs` (3 action ใหม่)

## Out of scope

- **โค้ดลับที่ต้องพิมพ์เอง** — คูปองเป็นรายการที่เลือกจากหน้าจอ ถ้าจะทำโค้ดลับต้องเพิ่ม rate limit + กันการเดาโค้ดด้วย
- **จองล่วงหน้าหลายรอบพร้อมกัน** — 1 การจอง = 1 รอบ
- **`max_per_user` > 1** — เฟสนี้ล็อกที่ 1 เพราะบังคับด้วย partial unique ได้ตรง ๆ ถ้าจะให้มากกว่านั้นต้องเปลี่ยนไปนับแถว ซึ่งต้องคิดเรื่อง race ใหม่ทั้งหมด
- **ใช้คูปองซ้อนกันหลายใบในรอบเดียว** · ส่วนลดค่าส่ง (ระบบยังไม่มีค่าส่ง) · คูปองเจาะกลุ่มผู้ใช้ (สมาชิกใหม่ / ผู้ที่เพิ่ง churn)
- **คืนคูปองเมื่อร้านยกเลิกออเดอร์** — เป็นนโยบายชดเชยคนละเรื่อง ([15](15-order-exceptions.md) ระบุไว้แล้วว่า "ระบบชดเชยผู้ซื้อ" อยู่นอกขอบเขต)
- **รายงานประสิทธิผลแคมเปญ** (คูปองใบไหนทำให้ churn ลด) — ข้อมูลถูกเก็บครบแล้วใน `coupon_redemptions` + `subscription_events` แต่หน้ารายงานยังไม่ทำ
