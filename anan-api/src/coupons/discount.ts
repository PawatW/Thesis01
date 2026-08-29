import { Prisma, type CouponDiscountType } from '@prisma/client';

/**
 * สูตรคำนวณส่วนลดของคูปอง — **ที่เดียวในระบบ** (feature 18)
 *
 * เป็น pure function โดยตั้งใจ: ยอดเงินคือสิ่งที่ผิดแล้วเจ็บที่สุด จึงต้องทดสอบได้
 * โดยไม่ต้องมี DB และต้องให้ผลเหมือนกันเป๊ะทั้ง 3 จุดที่เรียกใช้ —
 * ตอนแสดงรายการให้ผู้ซื้อเลือก · ตอนจอง · ตอน engine ตัดเงินจริง
 *
 * ★ ตอนตัดเงินต้องคำนวณใหม่เสมอ ★ ไม่ใช่ใช้ยอดที่จองไว้ตรง ๆ เพราะยอดก่อนลด
 * เปลี่ยนได้ระหว่างที่จองค้างอยู่ (ร้านขึ้น/ลดราคา · ผู้ซื้อเปลี่ยนแผนหรือจำนวน)
 * — แต่ **เงื่อนไข** ที่ใช้คำนวณต้องเป็น snapshot ตอนจอง ไม่ใช่ค่าปัจจุบันของคูปอง
 */

/** เงื่อนไขของคูปอง — รูปร่างเดียวกันทั้งจากตาราง `coupons` และจาก snapshot ในใบจอง */
export interface CouponTerms {
  discountType: CouponDiscountType;
  discountValue: Prisma.Decimal;
  maxDiscountAmount: Prisma.Decimal | null;
  minOrderAmount: Prisma.Decimal | null;
}

/**
 * เหตุที่ใช้คูปองใบนี้กับรอบนี้ไม่ได้ — ส่งกลับไปแสดงบนใบที่เทาไว้ในหน้าจอ
 * (`no_effect` เกิดกับยอดที่เล็กมากจนส่วนลดปัดลงเหลือ 0 — ปล่อยผ่านไม่ได้
 * เพราะจะได้ออเดอร์ที่ผูกใบจองไว้แต่ลด 0 บาท ซึ่งผิด CHECK ที่ DB)
 */
export type DiscountBlockedReason = 'below_min_order' | 'no_effect';

export type DiscountResult =
  | { ok: true; discount: Prisma.Decimal; net: Prisma.Decimal }
  | { ok: false; reason: DiscountBlockedReason };

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

/** ยอดก่อนลดของ 1 รอบ — ราคาต่อรอบ × จำนวน (อ่านจาก DB เท่านั้น ไม่เคยมาจาก client) */
export function grossAmount(
  pricePerCycle: Prisma.Decimal,
  quantity: number,
): Prisma.Decimal {
  return pricePerCycle.mul(quantity);
}

/**
 * คำนวณส่วนลดของรอบหนึ่ง
 *
 * ลำดับการหนีบสำคัญ: เพดานก่อน แล้วค่อยหนีบไม่ให้เกินยอด — สลับกันแล้วคูปอง
 * `fixed` ที่มากกว่ายอดจะทะลุเพดานไปได้
 *
 * **ปัดลง 2 ตำแหน่ง** ไม่ใช่ปัดใกล้สุด เพื่อให้ `net + discount = gross` เป๊ะเสมอ
 * (ถ้าปัดขึ้น ผลรวมจะเกินยอดจริงไป 1 สตางค์ แล้วใบเสร็จจะบวกไม่ลง)
 */
export function computeDiscount(
  gross: Prisma.Decimal,
  terms: CouponTerms,
): DiscountResult {
  if (terms.minOrderAmount !== null && gross.lt(terms.minOrderAmount)) {
    return { ok: false, reason: 'below_min_order' };
  }

  let discount =
    terms.discountType === 'percent'
      ? gross.mul(terms.discountValue).div(HUNDRED)
      : terms.discountValue;

  if (
    terms.maxDiscountAmount !== null &&
    discount.gt(terms.maxDiscountAmount)
  ) {
    discount = terms.maxDiscountAmount;
  }
  if (discount.gt(gross)) discount = gross;

  discount = discount.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);

  if (discount.lte(ZERO)) return { ok: false, reason: 'no_effect' };

  return { ok: true, discount, net: gross.sub(discount) };
}

/** ข้อความไทยของเหตุที่ใช้ไม่ได้ — ใช้ทั้งในรายการคูปองและใน error ตอนจอง */
export function blockedReasonText(
  reason: DiscountBlockedReason,
  terms: CouponTerms,
): string {
  if (reason === 'below_min_order') {
    return `ใช้กับยอดตั้งแต่ ฿${(terms.minOrderAmount ?? ZERO).toFixed(2)} ขึ้นไป`;
  }
  return 'ยอดรอบนี้น้อยเกินกว่าที่คูปองนี้จะลดได้';
}

/**
 * รวมส่วนลดสองระดับของรอบเดียวกัน (คูปองแพลตฟอร์ม + คูปองร้าน)
 *
 * ★ คิดจากยอดเต็มทั้งคู่ แล้วบวกกัน ★ ไม่ใช่ต่อยอด — เลขบนหน้าจอจะได้ตรงกับที่
 * แต่ละใบประกาศไว้เป๊ะ ("ลด 20%" ก็ลด 20% ของยอดจริง) ถ้าคิดต่อยอด ใบที่สอง
 * จะลดน้อยกว่าที่เขียนไว้เสมอ ซึ่งอธิบายบนใบเสร็จไม่ได้
 *
 * ★ ถ้ารวมแล้วเกินยอด หนีบที่ใบของ "ร้าน" ★ (แพลตฟอร์มคิดก่อน) — ต้องมีลำดับ
 * ที่แน่นอน ไม่งั้นยอดของสองใบรวมกันจะไม่เท่ากับ `orders.discount_amount` พอดี
 * แล้วใบเสร็จจะบวกไม่ลง · เกิดเฉพาะตอนส่วนลดรวม ≥ 100% ซึ่งหายากมาก
 */
export function combineDiscounts(
  gross: Prisma.Decimal,
  platform: Prisma.Decimal | null,
  shop: Prisma.Decimal | null,
): {
  platform: Prisma.Decimal;
  shop: Prisma.Decimal;
  total: Prisma.Decimal;
  net: Prisma.Decimal;
} {
  const p = platform ?? ZERO;
  const headroom = gross.sub(p);
  const s = shop === null ? ZERO : shop.gt(headroom) ? headroom : shop;
  const total = p.add(s);
  return { platform: p, shop: s, total, net: gross.sub(total) };
}

/** ป้ายมูลค่าคูปองบนหน้าจอ เช่น "ลด 20%" / "ลด ฿50" */
export function discountLabel(terms: CouponTerms): string {
  if (terms.discountType === 'percent') {
    const cap = terms.maxDiscountAmount;
    const base = `ลด ${terms.discountValue.toDecimalPlaces(2).toString()}%`;
    return cap === null ? base : `${base} (สูงสุด ฿${cap.toFixed(2)})`;
  }
  return `ลด ฿${terms.discountValue.toFixed(2)}`;
}
