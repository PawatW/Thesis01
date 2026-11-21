import { INestApplication } from '@nestjs/common';
import {
  addDays,
  parseISODate,
  toISODate,
  todayInBangkok,
} from '../src/common/date';
import { EngineService } from '../src/engine/engine.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, ApiError, createTestApp } from './utils/app';
import { cardBody } from './utils/card';
import {
  bearer,
  cleanupTestCoupons,
  cleanupTestUsers,
  registerTestUser,
  TEST_PASSWORD,
  type TestUser,
} from './utils/auth';

const PRICE = 300;

const ADDRESS = {
  recipientName: 'ผู้รับ คูปอง',
  phone: '0812345678',
  addressLine: '7 ถนนทดสอบ',
  province: 'กรุงเทพมหานคร',
  postcode: '10900',
};

interface CouponRes {
  id: string;
  code: string;
  inUseCount: number;
}

interface AvailableCoupon {
  id: string;
  code: string;
  usable: boolean;
  discountAmount: number | null;
  blockedReason: string | null;
}

interface CouponsView {
  cycleDate: string | null;
  grossAmount: number;
  canApply: boolean;
  blockedReason: string | null;
  discountAmount: number;
  netAmount: number;
  platform: TierView;
  shop: TierView;
}

interface TierView {
  allowed: boolean;
  blockedReason: string | null;
  applied: {
    redemptionId: string;
    code: string;
    discountAmount: number;
    cycleDate: string;
  } | null;
  available: AvailableCoupon[];
}

interface Buyer {
  user: TestUser;
  cardId: string;
}

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

/**
 * Feature 18 ชั้นที่ 3 — ผู้ซื้อจองคูปองกับรอบ แล้ว engine เป็นคนใช้ (W13 Flow C/D/E)
 *
 * ★ นี่คือส่วนที่ต่างจากคูปองของ e-commerce ★ คำถามที่ไฟล์นี้ต้องตอบ:
 *   1. จองแล้ว engine ตัดเงินยอดหลังลดจริงไหม (ยืนยันใน DB ไม่ใช่แค่ response)
 *   2. engine รันซ้ำวันเดิม คูปองถูกใช้ซ้ำไหม
 *   3. skip/pause/ระงับร้าน แล้วคูปองถูกคืนพร้อมโควตาไหม
 *   4. ยกเลิกแล้วสมัครใหม่ ใช้คูปองใบเดิมซ้ำได้ไหม (ต้องไม่ได้)
 *   5. โควตาใบสุดท้ายถูกยิงพร้อมกัน 3 เส้น มีคนได้กี่คน (ต้องได้ 1)
 */
describe('Feature 18 — จองคูปองกับรอบ · engine ใช้ · การคืนคูปอง', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let engine: EngineService;

  let admin: TestUser;
  let seller: TestUser;
  let shopId: string;
  let productId: string;
  let planId: string;
  let buyer: Buyer;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    engine = app.get(EngineService);
    await cleanupTestUsers(prisma);
    await cleanupTestCoupons(prisma);

    admin = await registerTestUser(app, 'red-admin');
    seller = await registerTestUser(app, 'red-seller');
    await prisma.user.update({
      where: { id: admin.id },
      data: { isAdmin: true },
    });
    const relogin = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: TEST_PASSWORD })
      .expect(200);
    admin.accessToken = (relogin.body as { accessToken: string }).accessToken;

    const shop = await api(app)
      .post('/api/v1/seller/shop')
      .set(bearer(seller.accessToken))
      .send({ name: 'ร้านทดสอบคูปอง' })
      .expect(201);
    shopId = (shop.body as { id: string }).id;

    const product = await api(app)
      .post('/api/v1/seller/products')
      .set(bearer(seller.accessToken))
      .send({
        name: 'สินค้าทดสอบคูปอง',
        categoryId: 1,
        images: ['https://example.com/a.jpg'],
        oneTimePrice: PRICE * 2,
        plans: [{ cycle: '1m', pricePerCycle: PRICE, qtyPerCycle: 1 }],
      })
      .expect(201);
    const created = product.body as {
      id: string;
      plans: [{ id: string }, ...{ id: string }[]];
    };
    productId = created.id;
    planId = created.plans[0].id;

    buyer = await makeBuyer('red-buyer');
  });

  afterAll(async () => {
    if (prisma) {
      await cleanupTestUsers(prisma);
      await cleanupTestCoupons(prisma);
      await prisma.productPlan.deleteMany({ where: { product: { shopId } } });
      await prisma.product.deleteMany({ where: { shopId } });
      await prisma.shop.deleteMany({ where: { id: shopId } });
    }
    if (app) await app.close();
  });

  // ---------- ตัวช่วย ----------

  async function makeBuyer(tag: string): Promise<Buyer> {
    const user = await registerTestUser(app, tag);
    const card = await api(app)
      .post('/api/v1/me/payment-methods')
      .set(bearer(user.accessToken))
      .send(cardBody())
      .expect(201);
    return { user, cardId: (card.body as { id: string }).id };
  }

  /** ที่อยู่ใหม่ทุกครั้ง — กฎกันสมัครซ้ำผูกกับคู่ (แผน + ที่อยู่) */
  async function subscribe(b: Buyer): Promise<{
    id: string;
    nextOrderDate: string;
    firstOrder: { id: string; amount: number; discountAmount: number };
  }> {
    const address = await prisma.address.create({
      data: { ...ADDRESS, userId: b.user.id },
      select: { id: true },
    });
    const res = await api(app)
      .post('/api/v1/subscriptions')
      .set(bearer(b.user.accessToken))
      .send({
        planId,
        quantity: 1,
        addressId: address.id,
        paymentMethodId: b.cardId,
        startDate: toISODate(addDays(todayInBangkok(), 1)),
      })
      .expect(201);
    const body = res.body as {
      subscription: { id: string; nextOrderDate: string };
      firstOrder: { id: string; amount: number; discountAmount: number };
    };
    return { ...body.subscription, firstOrder: body.firstOrder };
  }

  let seq = 0;
  /** ออกคูปองแล้วให้ร้านติ๊กสินค้าเข้าร่วมทันที (ไม่ติ๊ก = ผู้ซื้อไม่เห็น) */
  async function publishCoupon(
    over: Record<string, unknown> = {},
    enroll = true,
  ): Promise<CouponRes> {
    const res = await api(app)
      .post('/api/v1/admin/coupons')
      .set(bearer(admin.accessToken))
      .send({
        code: `E2E-RED-${Date.now()}-${seq++}`.slice(0, 24),
        title: 'คูปองทดสอบรายรอบ',
        discountType: 'percent',
        discountValue: 10,
        startsAt: hours(-1),
        endsAt: hours(24 * 90),
        ...over,
      })
      .expect(201);
    const coupon = res.body as CouponRes;

    if (enroll) {
      const current = await prisma.couponProduct.findMany({
        where: { productId },
        select: { couponId: true },
      });
      await api(app)
        .put(`/api/v1/seller/products/${productId}/coupons`)
        .set(bearer(seller.accessToken))
        .send({
          couponIds: [...current.map((c) => c.couponId), coupon.id],
          couponPolicy: 'both',
        })
        .expect(200);
    }
    return coupon;
  }

  const view = async (b: Buyer, subId: string): Promise<CouponsView> => {
    const res = await api(app)
      .get(`/api/v1/subscriptions/${subId}/coupons`)
      .set(bearer(b.user.accessToken))
      .expect(200);
    return res.body as CouponsView;
  };

  const apply = (b: Buyer, subId: string, couponId: string) =>
    api(app)
      .post(`/api/v1/subscriptions/${subId}/coupon`)
      .set(bearer(b.user.accessToken))
      .send({ couponId });

  const inUse = async (couponId: string): Promise<number> =>
    (
      await prisma.coupon.findUniqueOrThrow({
        where: { id: couponId },
        select: { inUseCount: true },
      })
    ).inUseCount;

  // ==========================================================
  // Flow C — จองคูปองกับรอบถัดไป
  // ==========================================================

  describe('GET /subscriptions/:id/coupons', () => {
    it('เห็นเฉพาะคูปองที่ร้านติ๊กเข้าร่วม พร้อมยอดที่ server คำนวณให้', async () => {
      const sub = await subscribe(buyer);
      const joined = await publishCoupon({ discountValue: 10 });
      const notJoined = await publishCoupon({ discountValue: 50 }, false);

      const v = await view(buyer, sub.id);
      expect(v.grossAmount).toBe(PRICE);
      expect(v.canApply).toBe(true);
      expect(v.cycleDate).toBe(sub.nextOrderDate);

      const ids = v.platform.available.map((c) => c.id);
      expect(ids).toContain(joined.id);
      // ★ คูปองที่ร้านไม่ได้เข้าร่วม ต้องไม่โผล่มาให้เห็นเลย ★
      expect(ids).not.toContain(notJoined.id);

      const row = v.platform.available.find((c) => c.id === joined.id);
      expect(row?.usable).toBe(true);
      expect(row?.discountAmount).toBe(30); // 10% ของ 300
    });

    it('ยอดต่ำกว่าขั้นต่ำ → ใบนั้นเทาไว้พร้อมเหตุผลที่ทำตามได้', async () => {
      const sub = await subscribe(await makeBuyer('red-min'));
      const coupon = await publishCoupon({ minOrderAmount: PRICE + 100 });

      const res = await api(app)
        .get(`/api/v1/subscriptions/${sub.id}/coupons`)
        .set(bearer(await tokenFor(sub.id)))
        .expect(200);
      const row = (res.body as CouponsView).platform.available.find(
        (c) => c.id === coupon.id,
      );
      expect(row?.usable).toBe(false);
      expect(row?.discountAmount).toBeNull();
      expect(row?.blockedReason).toContain('ยอดตั้งแต่');
    });

    it('★ subscription ของคนอื่น → 404 ★', async () => {
      const sub = await subscribe(buyer);
      const stranger = await makeBuyer('red-stranger');
      await api(app)
        .get(`/api/v1/subscriptions/${sub.id}/coupons`)
        .set(bearer(stranger.user.accessToken))
        .expect(404);
    });
  });

  describe('POST /subscriptions/:id/coupon', () => {
    it('จองสำเร็จ → ใบจอง reserved + โควตา +1 + event coupon_applied', async () => {
      const sub = await subscribe(buyer);
      const coupon = await publishCoupon({ discountValue: 20 });

      const res = await apply(buyer, sub.id, coupon.id).expect(200);
      const body = res.body as CouponsView;

      expect(body.platform.applied?.code).toBe(coupon.code);
      expect(body.platform.applied?.discountAmount).toBe(60);
      expect(body.netAmount).toBe(240);
      expect(body.platform.applied?.cycleDate).toBe(sub.nextOrderDate);
      expect(body.platform.applied).not.toBeNull();

      const row = await prisma.couponRedemption.findFirstOrThrow({
        where: { subscriptionId: sub.id },
      });
      expect(row.status).toBe('reserved');
      expect(row.consumedAt).toBeNull();
      expect(toISODate(row.cycleDate)).toBe(sub.nextOrderDate);
      // ★ snapshot เงื่อนไข ★ แก้คูปองทีหลังต้องไม่ย้อนไปแก้ของที่จองแล้ว
      expect(row.discountValue.toNumber()).toBe(20);

      expect(await inUse(coupon.id)).toBe(1);
      expect(
        await prisma.subscriptionEvent.count({
          where: { subscriptionId: sub.id, event: 'coupon_applied' },
        }),
      ).toBe(1);
    });

    it('จองซ้ำรอบเดิม → 409 COUPON_ALREADY_APPLIED', async () => {
      const sub = await subscribe(await makeBuyer('red-dup'));
      const owner = await tokenFor(sub.id);
      const a = await publishCoupon();
      const b = await publishCoupon();

      await api(app)
        .post(`/api/v1/subscriptions/${sub.id}/coupon`)
        .set(bearer(owner))
        .send({ couponId: a.id })
        .expect(200);

      const res = await api(app)
        .post(`/api/v1/subscriptions/${sub.id}/coupon`)
        .set(bearer(owner))
        .send({ couponId: b.id })
        .expect(409);
      expect((res.body as ApiError).code).toBe('COUPON_ALREADY_APPLIED');
      expect(await inUse(b.id)).toBe(0);
    });

    it('★ 1 คน 1 คูปอง ★ ใช้ใบเดิมกับ subscription ที่ 2 → 409', async () => {
      const b = await makeBuyer('red-twice');
      const sub1 = await subscribe(b);
      const sub2 = await subscribe(b);
      const coupon = await publishCoupon();

      await apply(b, sub1.id, coupon.id).expect(200);
      const res = await apply(b, sub2.id, coupon.id).expect(409);
      expect((res.body as ApiError).code).toBe('COUPON_ALREADY_USED');
      expect(await inUse(coupon.id)).toBe(1);
    });

    it('★ โควตาใบสุดท้าย ยิงพร้อมกัน 3 เส้น → สำเร็จ 1 เท่านั้น ★', async () => {
      const coupon = await publishCoupon({ maxRedemptions: 1 });
      const buyers: Buyer[] = [];
      const subs: { id: string }[] = [];
      for (const tag of ['red-race1', 'red-race2', 'red-race3']) {
        const b = await makeBuyer(tag);
        buyers.push(b);
        subs.push(await subscribe(b));
      }

      const settled = await Promise.allSettled(
        subs.map((sub, i) => apply(buyers[i]!, sub.id, coupon.id)),
      );
      const ok = settled.filter(
        (r) => r.status === 'fulfilled' && r.value.status === 200,
      );
      expect(ok).toHaveLength(1);

      // ★ ข้อพิสูจน์จริงอยู่ที่ DB ★ ไม่ว่าฝั่ง HTTP จะตอบอะไร โควตาต้องไม่เกิน
      expect(await inUse(coupon.id)).toBe(1);
      expect(
        await prisma.couponRedemption.count({
          where: { couponId: coupon.id, status: { not: 'released' } },
        }),
      ).toBe(1);
    });

    it('★ ยอดส่วนลดห้ามมาจาก client ★ แนบ discountAmount → 400', async () => {
      const sub = await subscribe(await makeBuyer('red-nodto'));
      const coupon = await publishCoupon();
      await api(app)
        .post(`/api/v1/subscriptions/${sub.id}/coupon`)
        .set(bearer(await tokenFor(sub.id)))
        .send({ couponId: coupon.id, discountAmount: 999 })
        .expect(400);
    });

    it('คูปองที่ร้านไม่ได้เข้าร่วม → 404 (ไม่ใช่ 403 — กัน enumeration)', async () => {
      const sub = await subscribe(await makeBuyer('red-notjoin'));
      const coupon = await publishCoupon({}, false);
      const res = await api(app)
        .post(`/api/v1/subscriptions/${sub.id}/coupon`)
        .set(bearer(await tokenFor(sub.id)))
        .send({ couponId: coupon.id })
        .expect(404);
      expect((res.body as ApiError).code).toBe('COUPON_NOT_FOUND');
    });

    it('subscription ที่หยุดชั่วคราว → 409 (จองไม่ได้)', async () => {
      const b = await makeBuyer('red-paused');
      const sub = await subscribe(b);
      const coupon = await publishCoupon();

      await api(app)
        .post(`/api/v1/subscriptions/${sub.id}/pause`)
        .set(bearer(b.user.accessToken))
        .expect(201);

      const res = await apply(b, sub.id, coupon.id).expect(409);
      expect((res.body as ApiError).code).toBe('CYCLE_NOT_BOOKABLE');
      expect(await inUse(coupon.id)).toBe(0);
    });

    it('★ ถึงวันตัดรอบแล้ว → 409 CYCLE_NOT_BOOKABLE ★ (เดดไลน์เดียวกับ skip)', async () => {
      const b = await makeBuyer('red-late');
      const sub = await subscribe(b);
      const coupon = await publishCoupon();

      // ดันวันรอบมาเป็น "วันนี้" ตรง ๆ — engine จะตัดเงินตี 1 ของวันนี้ไปแล้ว
      // (ต้องขยับหมุดตามด้วย ไม่งั้นผิด CHECK `subs_anchor_not_after_next`)
      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          nextOrderDate: todayInBangkok(),
          cycleAnchorDate: todayInBangkok(),
        },
      });

      const res = await apply(b, sub.id, coupon.id).expect(409);
      expect((res.body as ApiError).message).toContain('รอบถัดไป');

      const v = await view(b, sub.id);
      expect(v.canApply).toBe(false);
      expect(v.platform.available).toHaveLength(0);
    });
  });

  describe('DELETE /subscriptions/:id/coupon', () => {
    it('ถอนเอง → released + คืนโควตา + จองใบเดิมกับรอบเดิมได้อีก', async () => {
      const b = await makeBuyer('red-remove');
      const sub = await subscribe(b);
      const coupon = await publishCoupon();

      await apply(b, sub.id, coupon.id).expect(200);
      expect(await inUse(coupon.id)).toBe(1);

      const res = await api(app)
        .delete(`/api/v1/subscriptions/${sub.id}/coupon/platform`)
        .set(bearer(b.user.accessToken))
        .expect(200);
      expect((res.body as CouponsView).platform.applied).toBeNull();
      expect(await inUse(coupon.id)).toBe(0);

      const row = await prisma.couponRedemption.findFirstOrThrow({
        where: { subscriptionId: sub.id },
      });
      expect(row.status).toBe('released');
      expect(row.releasedReason).toBe('user_removed');

      // ★ partial unique ปล่อยให้จองใหม่ได้หลังคืนแล้ว ★
      await apply(b, sub.id, coupon.id).expect(200);
      expect(await inUse(coupon.id)).toBe(1);
    });

    it('ไม่ได้จองไว้ → 409', async () => {
      const b = await makeBuyer('red-nocoupon');
      const sub = await subscribe(b);
      const res = await api(app)
        .delete(`/api/v1/subscriptions/${sub.id}/coupon/platform`)
        .set(bearer(b.user.accessToken))
        .expect(409);
      expect((res.body as ApiError).code).toBe('NO_COUPON_APPLIED');
    });
  });

  // ==========================================================
  // Flow E — กฎเดียว: รอบเปลี่ยนโดยไม่เกิดออเดอร์ = คืนคูปอง
  // ==========================================================

  describe('การคืนคูปองอัตโนมัติ', () => {
    it.each([
      ['skip', 'skip'],
      ['pause', 'pause'],
      ['cancel', 'cancel'],
      // Phase 8.3 — ส่งรอบนี้เลยย้ายหมุดไปวันนี้ รอบที่จองไว้จึงไม่มีวันเกิด
      ['ship-now', 'ship-now'],
    ])('%s → คูปองถูกคืนพร้อมโควตา', async (_label, action) => {
      const b = await makeBuyer(`red-rel-${action}`);
      const sub = await subscribe(b);
      const coupon = await publishCoupon();
      await apply(b, sub.id, coupon.id).expect(200);

      await api(app)
        .post(`/api/v1/subscriptions/${sub.id}/${action}`)
        .set(bearer(b.user.accessToken))
        // เหตุผลบังคับเฉพาะ cancel (Phase 8.3) — action อื่นไม่สนใจ body นี้
        .send(action === 'cancel' ? { reason: 'other' } : {})
        .expect(201);

      const row = await prisma.couponRedemption.findFirstOrThrow({
        where: { subscriptionId: sub.id },
      });
      expect(row.status).toBe('released');
      expect(row.releasedReason).toBe('cycle_changed');
      expect(await inUse(coupon.id)).toBe(0);
      expect(
        await prisma.subscriptionEvent.count({
          where: { subscriptionId: sub.id, event: 'coupon_released' },
        }),
      ).toBe(1);
    });

    it('★ เปลี่ยนที่อยู่ = ข้อยกเว้นเดียว ★ คูปองยังอยู่', async () => {
      const b = await makeBuyer('red-addr');
      const sub = await subscribe(b);
      const coupon = await publishCoupon();
      await apply(b, sub.id, coupon.id).expect(200);

      const newAddress = await prisma.address.create({
        data: { ...ADDRESS, addressLine: '8 ถนนใหม่', userId: b.user.id },
        select: { id: true },
      });
      await api(app)
        .post(`/api/v1/subscriptions/${sub.id}/address`)
        .set(bearer(b.user.accessToken))
        .send({ addressId: newAddress.id })
        .expect(201);

      const row = await prisma.couponRedemption.findFirstOrThrow({
        where: { subscriptionId: sub.id },
      });
      expect(row.status).toBe('reserved');
      expect(await inUse(coupon.id)).toBe(1);
    });

    it('admin ระงับร้าน → คูปองถูกคืน + แจ้งเตือนผู้ซื้อ', async () => {
      const b = await makeBuyer('red-suspend');
      const sub = await subscribe(b);
      const coupon = await publishCoupon();
      await apply(b, sub.id, coupon.id).expect(200);

      await api(app)
        .post(`/api/v1/admin/shops/${shopId}/suspension`)
        .set(bearer(admin.accessToken))
        .send({ suspend: true, reason: 'ทดสอบคูปอง' })
        .expect(200);

      const row = await prisma.couponRedemption.findFirstOrThrow({
        where: { subscriptionId: sub.id },
      });
      expect(row.status).toBe('released');
      expect(row.releasedReason).toBe('shop_suspended');
      expect(await inUse(coupon.id)).toBe(0);

      const note = await prisma.notification.findFirst({
        where: { userId: b.user.id, type: 'coupon_released' },
      });
      expect(note?.body).toContain(coupon.code);

      // คืนสถานะร้านให้เทสอื่นใช้ต่อ
      await api(app)
        .post(`/api/v1/admin/shops/${shopId}/suspension`)
        .set(bearer(admin.accessToken))
        .send({ suspend: false })
        .expect(200);
    });
  });

  // ==========================================================
  // Flow D — engine ใช้คูปองตอนตัดเงิน
  // ==========================================================

  describe('engine ใช้คูปองตอนสร้างออเดอร์', () => {
    it('★ ตัดเงินยอดหลังลด และยืนยันได้ใน DB ★ + รันซ้ำไม่ใช้ซ้ำ', async () => {
      const b = await makeBuyer('red-engine');
      const sub = await subscribe(b);
      const coupon = await publishCoupon({
        discountType: 'fixed',
        discountValue: 45,
      });
      await apply(b, sub.id, coupon.id).expect(200);

      const cycleDate = parseISODate(sub.nextOrderDate);
      await engine.run(cycleDate);

      const order = await prisma.order.findFirstOrThrow({
        where: { subscriptionId: sub.id, cycleDate },
        include: {
          payment: true,
          platformRedemption: true,
          shopRedemption: true,
        },
      });
      // ★ ยอดที่ตัดจริงคือยอดหลังลด ★
      expect(order.amount.toNumber()).toBe(PRICE - 45);
      expect(order.discountAmount.toNumber()).toBe(45);
      // ยอดก่อนลด = amount + discountAmount (invariant ของใบเสร็จ)
      expect(order.amount.add(order.discountAmount).toNumber()).toBe(PRICE);
      expect(order.payment?.amount.toNumber()).toBe(PRICE - 45);
      expect(order.payment?.status).toBe('paid');

      expect(order.platformRedemptionId).not.toBeNull();
      expect(order.platformRedemption?.status).toBe('consumed');
      expect(order.platformRedemption?.consumedAt).not.toBeNull();
      expect(order.platformRedemption?.discountAmount.toNumber()).toBe(45);

      // ---- รันซ้ำวันเดิม 3 ครั้ง ----
      const before = await inUse(coupon.id);
      await engine.run(cycleDate);
      await engine.run(cycleDate);
      await engine.run(cycleDate);

      expect(
        await prisma.order.count({
          where: { subscriptionId: sub.id, cycleDate },
        }),
      ).toBe(1);
      expect(
        await prisma.couponRedemption.count({
          where: { couponId: coupon.id, status: 'consumed' },
        }),
      ).toBe(1);
      expect(await inUse(coupon.id)).toBe(before);
    });

    it('ไม่ได้จองคูปอง → ตัดเงินเต็ม ส่วนลดเป็น 0 และไม่มีใบจองผูกอยู่', async () => {
      const b = await makeBuyer('red-nodisc');
      const sub = await subscribe(b);
      const cycleDate = parseISODate(sub.nextOrderDate);

      await engine.run(cycleDate);

      const order = await prisma.order.findFirstOrThrow({
        where: { subscriptionId: sub.id, cycleDate },
      });
      expect(order.amount.toNumber()).toBe(PRICE);
      expect(order.discountAmount.toNumber()).toBe(0);
      expect(order.platformRedemptionId).toBeNull();
    });

    it('แจ้งเตือน T-3 บอกยอดหลังลดเมื่อจองคูปองไว้แล้ว', async () => {
      const b = await makeBuyer('red-notify');
      const sub = await subscribe(b);
      const coupon = await publishCoupon({
        discountType: 'fixed',
        discountValue: 60,
      });
      await apply(b, sub.id, coupon.id).expect(200);

      // T-3 = 3 วันก่อนวันตัดรอบ
      const cycleDate = parseISODate(sub.nextOrderDate);
      await engine.run(addDays(cycleDate, -3));

      const note = await prisma.notification.findFirstOrThrow({
        where: { userId: b.user.id, type: 'upcoming_cycle' },
        orderBy: { createdAt: 'desc' },
      });
      expect(note.body).toContain(`฿${(PRICE - 60).toFixed(2)}`);
      expect(note.body).toContain(coupon.code);
    });
  });

  // ==========================================================
  // checkout — คูปองรอบแรก
  // ==========================================================

  describe('POST /subscriptions พร้อม couponId (รอบแรก)', () => {
    it('สมัครพร้อมคูปอง → ออเดอร์รอบแรกลดทันที + ใบจองเป็น consumed', async () => {
      const b = await makeBuyer('red-checkout');
      const coupon = await publishCoupon({ discountValue: 30 });

      const address = await prisma.address.create({
        data: { ...ADDRESS, userId: b.user.id },
        select: { id: true },
      });
      const res = await api(app)
        .post('/api/v1/subscriptions')
        .set(bearer(b.user.accessToken))
        .send({
          planId,
          quantity: 1,
          addressId: address.id,
          paymentMethodId: b.cardId,
          startDate: toISODate(addDays(todayInBangkok(), 1)),
          couponIds: [coupon.id],
        })
        .expect(201);

      const body = res.body as {
        subscription: { id: string };
        firstOrder: {
          id: string;
          amount: number;
          discountAmount: number;
          couponCodes: string[];
        };
      };
      expect(body.firstOrder.amount).toBe(PRICE * 0.7);
      expect(body.firstOrder.discountAmount).toBe(PRICE * 0.3);
      expect(body.firstOrder.couponCodes).toEqual([coupon.code]);

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: body.firstOrder.id },
        include: {
          payment: true,
          platformRedemption: true,
          shopRedemption: true,
        },
      });
      expect(order.payment?.amount.toNumber()).toBe(PRICE * 0.7);
      expect(order.platformRedemption?.status).toBe('consumed');
      expect(await inUse(coupon.id)).toBe(1);
    });

    it('★ คูปองลด 100% → ตัดเงินจำลอง ฿0 สำเร็จ ออเดอร์เกิดปกติ ★', async () => {
      const b = await makeBuyer('red-full');
      const coupon = await publishCoupon({ discountValue: 100 });

      const address = await prisma.address.create({
        data: { ...ADDRESS, userId: b.user.id },
        select: { id: true },
      });
      const res = await api(app)
        .post('/api/v1/subscriptions')
        .set(bearer(b.user.accessToken))
        .send({
          planId,
          quantity: 1,
          addressId: address.id,
          paymentMethodId: b.cardId,
          startDate: toISODate(addDays(todayInBangkok(), 1)),
          couponIds: [coupon.id],
        })
        .expect(201);

      const orderId = (res.body as { firstOrder: { id: string } }).firstOrder
        .id;
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { payment: true },
      });
      expect(order.amount.toNumber()).toBe(0);
      expect(order.discountAmount.toNumber()).toBe(PRICE);
      expect(order.payment?.status).toBe('paid');
    });

    it('แนบ discountAmount มาใน body ของ checkout → 400 (ต่อจาก T-2)', async () => {
      const b = await makeBuyer('red-ckdto');
      const address = await prisma.address.create({
        data: { ...ADDRESS, userId: b.user.id },
        select: { id: true },
      });
      await api(app)
        .post('/api/v1/subscriptions')
        .set(bearer(b.user.accessToken))
        .send({
          planId,
          quantity: 1,
          addressId: address.id,
          paymentMethodId: b.cardId,
          startDate: toISODate(addDays(todayInBangkok(), 1)),
          discountAmount: 999,
        })
        .expect(400);
    });
  });

  // ---------- ตัวช่วยที่ต้องรู้ token ของเจ้าของ subscription ----------

  const tokens = new Map<string, string>();
  async function tokenFor(subId: string): Promise<string> {
    const cached = tokens.get(subId);
    if (cached !== undefined) return cached;
    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { id: subId },
      select: { buyer: { select: { email: true } } },
    });
    const res = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: sub.buyer.email, password: TEST_PASSWORD })
      .expect(200);
    const token = (res.body as { accessToken: string }).accessToken;
    tokens.set(subId, token);
    return token;
  }
});
