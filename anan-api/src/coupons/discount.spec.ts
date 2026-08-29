import { Prisma } from '@prisma/client';
import {
  blockedReasonText,
  combineDiscounts,
  computeDiscount,
  discountLabel,
  grossAmount,
  type CouponTerms,
} from './discount';

/**
 * unit test ของสูตรส่วนลด (ชั้น L1 ใน docs/testing.md)
 *
 * ไฟล์นี้คือต้นทางของ "รอบนี้ตัดเงินเท่าไหร่" เมื่อมีคูปอง — checkout, การจอง
 * และ engine เรียกมันหมด · คำนวณผิดสตางค์เดียวก็คือตัดเงินผิด ซึ่ง e2e จับไม่ได้
 * เพราะมันจะ "ผ่าน" ตามค่าที่ผิดนั่นแหละ (เหตุผลเดียวกับ date.spec.ts)
 */

const d = (v: string | number) => new Prisma.Decimal(v);

function terms(over: Partial<CouponTerms> = {}): CouponTerms {
  return {
    discountType: 'percent',
    discountValue: d(20),
    maxDiscountAmount: null,
    minOrderAmount: null,
    ...over,
  };
}

describe('discount — สูตรส่วนลดของคูปอง', () => {
  describe('grossAmount', () => {
    it('ยอดก่อนลด = ราคาต่อรอบ × จำนวน', () => {
      expect(grossAmount(d('149.50'), 3).toString()).toBe('448.5');
    });
  });

  describe('percent', () => {
    it('ลดตามสัดส่วนของยอด', () => {
      const r = computeDiscount(d(400), terms({ discountValue: d(20) }));
      expect(r).toMatchObject({ ok: true });
      if (!r.ok) return;
      expect(r.discount.toFixed(2)).toBe('80.00');
      expect(r.net.toFixed(2)).toBe('320.00');
    });

    it('★ เพดานชนะเปอร์เซ็นต์ ★ ลด 20% เพดาน ฿50 ยอด ฿400 → ฿50 ไม่ใช่ ฿80', () => {
      const r = computeDiscount(
        d(400),
        terms({ discountValue: d(20), maxDiscountAmount: d(50) }),
      );
      if (!r.ok) throw new Error('ควรใช้ได้');
      expect(r.discount.toFixed(2)).toBe('50.00');
      expect(r.net.toFixed(2)).toBe('350.00');
    });

    it('ยอดที่ยังไม่ถึงเพดาน ไม่ถูกเพดานแตะ', () => {
      const r = computeDiscount(
        d(100),
        terms({ discountValue: d(20), maxDiscountAmount: d(50) }),
      );
      if (!r.ok) throw new Error('ควรใช้ได้');
      expect(r.discount.toFixed(2)).toBe('20.00');
    });

    it('ลด 100% → ยอดสุทธิเป็น 0 (ต้องตัดเงินจำลอง ฿0 ได้ ไม่ใช่ error)', () => {
      const r = computeDiscount(d('250.00'), terms({ discountValue: d(100) }));
      if (!r.ok) throw new Error('ควรใช้ได้');
      expect(r.discount.toFixed(2)).toBe('250.00');
      expect(r.net.toFixed(2)).toBe('0.00');
    });
  });

  describe('fixed', () => {
    it('ลดเป็นจำนวนเงินตายตัว', () => {
      const r = computeDiscount(
        d('299.00'),
        terms({ discountType: 'fixed', discountValue: d(50) }),
      );
      if (!r.ok) throw new Error('ควรใช้ได้');
      expect(r.discount.toFixed(2)).toBe('50.00');
      expect(r.net.toFixed(2)).toBe('249.00');
    });

    it('★ ส่วนลดมากกว่ายอด → หนีบที่ยอด ยอดสุทธิห้ามติดลบ ★', () => {
      const r = computeDiscount(
        d('30.00'),
        terms({ discountType: 'fixed', discountValue: d(50) }),
      );
      if (!r.ok) throw new Error('ควรใช้ได้');
      expect(r.discount.toFixed(2)).toBe('30.00');
      expect(r.net.toFixed(2)).toBe('0.00');
      expect(r.net.isNegative()).toBe(false);
    });
  });

  describe('ยอดขั้นต่ำ', () => {
    it('ยอดต่ำกว่าขั้นต่ำ → ใช้ไม่ได้', () => {
      const r = computeDiscount(d('199.00'), terms({ minOrderAmount: d(200) }));
      expect(r).toEqual({ ok: false, reason: 'below_min_order' });
    });

    it('ยอดเท่าขั้นต่ำพอดี → ใช้ได้ (ขอบเขตแบบ >=)', () => {
      const r = computeDiscount(d('200.00'), terms({ minOrderAmount: d(200) }));
      expect(r.ok).toBe(true);
    });
  });

  describe('การปัดเศษ', () => {
    // ปัดลงเสมอ เพื่อให้ net + discount = gross เป๊ะ ไม่มีเศษหายหรือเกิน
    it.each([
      ['33.33', 15, '4.99'], // 4.9995 → 4.99 (ปัดขึ้นจะได้ 5.00 แล้วผลรวมเกิน)
      ['10.00', 33, '3.30'], // 3.3
      ['99.99', 7, '6.99'], // 6.9993
    ])('ยอด ฿%s ลด %i%% → ฿%s', (gross, percent, expected) => {
      const r = computeDiscount(d(gross), terms({ discountValue: d(percent) }));
      if (!r.ok) throw new Error('ควรใช้ได้');
      expect(r.discount.toFixed(2)).toBe(expected);
      // ★ invariant ที่ใบเสร็จพึ่งพา ★
      expect(r.net.add(r.discount).toFixed(2)).toBe(d(gross).toFixed(2));
    });

    it('ยอดเล็กจนส่วนลดปัดลงเหลือ 0 → ใช้ไม่ได้ (ไม่ใช่ลด 0 บาท)', () => {
      // ปล่อยผ่านไม่ได้: จะได้ออเดอร์ที่ผูกใบจองไว้แต่ discount_amount = 0
      // ซึ่งผิด CHECK `orders_discount_needs_redemption` ที่ DB
      const r = computeDiscount(d('0.01'), terms({ discountValue: d(20) }));
      expect(r).toEqual({ ok: false, reason: 'no_effect' });
    });
  });

  describe('รวมสองระดับ (แพลตฟอร์ม + ร้าน)', () => {
    it('★ คิดจากยอดเต็มทั้งคู่แล้วบวกกัน ★ ไม่ใช่ต่อยอด', () => {
      // ยอด ฿255 · แพลตฟอร์ม 20% (฿51) · ร้าน 10% (฿25.50)
      const r = combineDiscounts(d('255'), d('51'), d('25.50'));
      expect(r.total.toFixed(2)).toBe('76.50');
      expect(r.net.toFixed(2)).toBe('178.50');
      // ถ้าเป็นการต่อยอดจะได้ 51 + 20.40 = 71.40 ซึ่งไม่ตรงกับที่ป้ายคูปองบอก
      expect(r.platform.toFixed(2)).toBe('51.00');
      expect(r.shop.toFixed(2)).toBe('25.50');
    });

    it('มีใบเดียวก็ได้ — อีกช่องเป็น 0 ไม่ใช่ null', () => {
      const onlyShop = combineDiscounts(d('255'), null, d('50'));
      expect(onlyShop.platform.toFixed(2)).toBe('0.00');
      expect(onlyShop.net.toFixed(2)).toBe('205.00');

      const none = combineDiscounts(d('255'), null, null);
      expect(none.total.toFixed(2)).toBe('0.00');
      expect(none.net.toFixed(2)).toBe('255.00');
    });

    it('★ รวมเกินยอด → หนีบที่ใบของร้าน และผลรวมต้องเท่ากับยอดพอดี ★', () => {
      // แพลตฟอร์มลด 80% (฿204) + ร้านลด ฿100 = ฿304 ซึ่งเกินยอด ฿255
      const r = combineDiscounts(d('255'), d('204'), d('100'));
      expect(r.platform.toFixed(2)).toBe('204.00');
      expect(r.shop.toFixed(2)).toBe('51.00'); // ถูกหนีบด้วยยอดที่เหลือ
      expect(r.total.toFixed(2)).toBe('255.00');
      expect(r.net.toFixed(2)).toBe('0.00');
      expect(r.net.isNegative()).toBe(false);
      // ★ invariant ที่ใบเสร็จพึ่งพา ★ สองใบรวมกัน = ยอดส่วนลดของออเดอร์
      expect(r.platform.add(r.shop).toFixed(2)).toBe(r.total.toFixed(2));
    });

    it('แพลตฟอร์มกินยอดหมดแล้ว ใบของร้านเหลือ 0 (ไม่ติดลบ)', () => {
      const r = combineDiscounts(d('255'), d('255'), d('50'));
      expect(r.shop.toFixed(2)).toBe('0.00');
      expect(r.total.toFixed(2)).toBe('255.00');
    });
  });

  describe('ข้อความบนหน้าจอ', () => {
    it('ป้ายมูลค่าคูปอง', () => {
      expect(discountLabel(terms({ discountValue: d(20) }))).toBe('ลด 20%');
      expect(
        discountLabel(
          terms({ discountValue: d(20), maxDiscountAmount: d(50) }),
        ),
      ).toBe('ลด 20% (สูงสุด ฿50.00)');
      expect(
        discountLabel(terms({ discountType: 'fixed', discountValue: d(50) })),
      ).toBe('ลด ฿50.00');
    });

    it('เหตุที่ใช้ไม่ได้ บอกตัวเลขที่ผู้ซื้อทำตามได้', () => {
      expect(
        blockedReasonText('below_min_order', terms({ minOrderAmount: d(200) })),
      ).toBe('ใช้กับยอดตั้งแต่ ฿200.00 ขึ้นไป');
    });
  });
});
