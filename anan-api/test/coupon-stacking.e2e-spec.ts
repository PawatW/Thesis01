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

const PRICE = 400;

const ADDRESS = {
  recipientName: 'ผู้รับ ซ้อนคูปอง',
  phone: '0812345678',
  addressLine: '11 ถนนทดสอบ',
  province: 'กรุงเทพมหานคร',
  postcode: '10900',
};

interface CouponRes {
  id: string;
  code: string;
  tier: 'platform' | 'shop';
  shopName: string | null;
  appliesToAllProducts: boolean;
  inUseCount: number;
}

interface TierView {
  allowed: boolean;
  blockedReason: string | null;
  applied: { code: string; tier: string; discountAmount: number } | null;
  available: { id: string; code: string; usable: boolean }[];
}

interface CouponsView {
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  canApply: boolean;
  platform: TierView;
  shop: TierView;
}

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

/**
 * Feature 18 รอบที่ 2 — คูปอง 2 ระดับ: แพลตฟอร์ม + ร้านค้า (W13)
 *
 * ★ คำถามที่ไฟล์นี้ต้องตอบให้ได้ ★
 *   1. ร้านออกคูปองของตัวเองได้ไหม และออกคูปอง "ระดับแพลตฟอร์ม" ได้ไหม (ต้องไม่ได้)
 *   2. ซ้อน 2 ใบแล้ว **ยอดที่ตัดจริง** ถูกไหม — คิดจากยอดเต็มทั้งคู่แล้วรวม
 *   3. ซ้อนใบที่ 3 (หรือใบที่ 2 ของระดับเดิม) ได้ไหม (ต้องไม่ได้ — DB กัน)
 *   4. `products.coupon_policy` ที่ร้านตั้งเอง ปิดระดับได้จริงไหม
 *   5. รวมแล้วเกินยอด ระบบหนีบยังไง และผลรวมยังเท่ากับ `orders.discount_amount` ไหม
 */
describe('Feature 18 — คูปอง 2 ระดับ (แพลตฟอร์ม + ร้าน)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let engine: EngineService;

  let admin: TestUser;
  let sellerA: TestUser;
  let sellerB: TestUser;
  let shopA = '';
  let shopB = '';
  /** สินค้าของร้าน A ที่ตั้ง policy = both (ซ้อนได้) */
  let productBoth = '';
  let planBoth = '';
  /** สินค้าของร้าน A ที่ตั้ง policy = platform_only */
  let productPlatformOnly = '';
  let planPlatformOnly = '';
  /** สินค้าของร้าน B — ใช้พิสูจน์ว่าคูปองข้ามร้านไม่ได้ */
  let productB = '';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    engine = app.get(EngineService);
    await cleanupTestUsers(prisma);
    await cleanupTestCoupons(prisma);

    admin = await registerTestUser(app, 'stk-admin');
    sellerA = await registerTestUser(app, 'stk-sa');
    sellerB = await registerTestUser(app, 'stk-sb');

    await prisma.user.update({
      where: { id: admin.id },
      data: { isAdmin: true },
    });
    const relogin = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: TEST_PASSWORD })
      .expect(200);
    admin.accessToken = (relogin.body as { accessToken: string }).accessToken;

    shopA = await openShop(sellerA, 'ร้านซ้อนคูปอง เอ');
    shopB = await openShop(sellerB, 'ร้านซ้อนคูปอง บี');
    [productBoth, planBoth] = await createProduct(sellerA, 'สินค้าซ้อนได้');
    [productPlatformOnly, planPlatformOnly] = await createProduct(
      sellerA,
      'สินค้าเฉพาะคูปองแพลตฟอร์ม',
    );
    [productB] = await createProduct(sellerB, 'สินค้าร้านบี');
  });

  afterAll(async () => {
    if (prisma) {
      await cleanupTestUsers(prisma);
      await cleanupTestCoupons(prisma);
      const shopIds = [shopA, shopB].filter(Boolean);
      await prisma.productPlan.deleteMany({
        where: { product: { shopId: { in: shopIds } } },
      });
      await prisma.product.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    }
    if (app) await app.close();
  });

  // ---------- ตัวช่วย ----------

  async function openShop(user: TestUser, name: string): Promise<string> {
    const res = await api(app)
      .post('/api/v1/seller/shop')
      .set(bearer(user.accessToken))
      .send({ name })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function createProduct(
    user: TestUser,
    name: string,
  ): Promise<[string, string]> {
    const res = await api(app)
      .post('/api/v1/seller/products')
      .set(bearer(user.accessToken))
      .send({
        name,
        categoryId: 1,
        images: ['https://example.com/a.jpg'],
        oneTimePrice: PRICE * 2,
        plans: [{ cycle: '1m', pricePerCycle: PRICE, qtyPerCycle: 1 }],
      })
      .expect(201);
    const body = res.body as { id: string; plans: { id: string }[] };
    return [body.id, body.plans[0]!.id];
  }

  let seq = 0;
  const code = (prefix: string) =>
    `E2E-${prefix}-${Date.now()}-${seq++}`.slice(0, 24);

  const terms = (over: Record<string, unknown> = {}) => ({
    code: code('STK'),
    title: 'คูปองทดสอบซ้อน',
    discountType: 'percent',
    discountValue: 10,
    startsAt: hours(-1),
    endsAt: hours(24 * 60),
    ...over,
  });

  /** คูปองแพลตฟอร์ม + ให้ร้านติ๊กสินค้าเข้าร่วม */
  async function platformCoupon(
    productId: string,
    seller: TestUser,
    over: Record<string, unknown> = {},
    policy: 'both' | 'platform_only' | 'shop_only' | 'none' = 'both',
  ): Promise<CouponRes> {
    const res = await api(app)
      .post('/api/v1/admin/coupons')
      .set(bearer(admin.accessToken))
      .send(terms(over))
      .expect(201);
    const coupon = res.body as CouponRes;

    const current = await prisma.couponProduct.findMany({
      where: { productId },
      select: { couponId: true },
    });
    await api(app)
      .put(`/api/v1/seller/products/${productId}/coupons`)
      .set(bearer(seller.accessToken))
      .send({
        couponIds: [...current.map((c) => c.couponId), coupon.id],
        couponPolicy: policy,
      })
      .expect(200);
    return coupon;
  }

  /** คูปองของร้าน — ค่าปริยายครอบทั้งร้าน */
  async function shopCoupon(
    seller: TestUser,
    over: Record<string, unknown> = {},
  ): Promise<CouponRes> {
    const res = await api(app)
      .post('/api/v1/seller/coupons')
      .set(bearer(seller.accessToken))
      .send({ ...terms(over), appliesToAllProducts: true, ...over })
      .expect(201);
    return res.body as CouponRes;
  }

  async function makeBuyer(tag: string) {
    const user = await registerTestUser(app, tag);
    const card = await api(app)
      .post('/api/v1/me/payment-methods')
      .set(bearer(user.accessToken))
      .send(cardBody())
      .expect(201);
    return { user, cardId: (card.body as { id: string }).id };
  }

  async function subscribe(
    b: Awaited<ReturnType<typeof makeBuyer>>,
    planId: string,
  ): Promise<{ id: string; nextOrderDate: string }> {
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
    return (res.body as { subscription: { id: string; nextOrderDate: string } })
      .subscription;
  }

  const applyCoupon = (
    b: Awaited<ReturnType<typeof makeBuyer>>,
    subId: string,
    couponId: string,
  ) =>
    api(app)
      .post(`/api/v1/subscriptions/${subId}/coupon`)
      .set(bearer(b.user.accessToken))
      .send({ couponId });

  const view = async (
    b: Awaited<ReturnType<typeof makeBuyer>>,
    subId: string,
  ): Promise<CouponsView> => {
    const res = await api(app)
      .get(`/api/v1/subscriptions/${subId}/coupons`)
      .set(bearer(b.user.accessToken))
      .expect(200);
    return res.body as CouponsView;
  };

  // ==========================================================
  // ร้านออกคูปองเอง
  // ==========================================================

  describe('POST /seller/coupons', () => {
    it('ร้านออกคูปองของตัวเองได้ → tier = shop และผูกกับร้านผู้เรียก', async () => {
      const coupon = await shopCoupon(sellerA, { discountValue: 15 });
      expect(coupon.tier).toBe('shop');
      expect(coupon.appliesToAllProducts).toBe(true);

      const [row] = await prisma.coupon.findMany({
        where: { id: coupon.id },
        select: { tier: true, shopId: true, createdBy: true },
      });
      expect(row!.tier).toBe('shop');
      expect(row!.shopId).toBe(shopA);
    });

    it('★ ร้านออกคูปองระดับแพลตฟอร์มไม่ได้ ★ แนบ tier/shopId มาก็ถูกตัดทิ้ง (400)', async () => {
      await api(app)
        .post('/api/v1/seller/coupons')
        .set(bearer(sellerA.accessToken))
        .send({ ...terms(), appliesToAllProducts: true, tier: 'platform' })
        .expect(400);

      await api(app)
        .post('/api/v1/seller/coupons')
        .set(bearer(sellerA.accessToken))
        .send({ ...terms(), appliesToAllProducts: true, shopId: shopB })
        .expect(400);
    });

    it('เลือกสินค้าเองได้ แต่ต้องเป็นสินค้าของร้านตัวเอง', async () => {
      const ok = await api(app)
        .post('/api/v1/seller/coupons')
        .set(bearer(sellerA.accessToken))
        .send({
          ...terms(),
          appliesToAllProducts: false,
          productIds: [productBoth],
        })
        .expect(201);
      expect((ok.body as { productIds: string[] }).productIds).toEqual([
        productBoth,
      ]);

      // ★ สินค้าของร้าน B → 404 ★
      const res = await api(app)
        .post('/api/v1/seller/coupons')
        .set(bearer(sellerA.accessToken))
        .send({
          ...terms(),
          appliesToAllProducts: false,
          productIds: [productB],
        })
        .expect(404);
      expect((res.body as ApiError).code).toBe('PRODUCT_NOT_FOUND');
    });

    it('เลือกสินค้าเองแต่ไม่ส่งสินค้ามาเลย → 422', async () => {
      const res = await api(app)
        .post('/api/v1/seller/coupons')
        .set(bearer(sellerA.accessToken))
        .send({ ...terms(), appliesToAllProducts: false, productIds: [] })
        .expect(422);
      expect((res.body as ApiError).code).toBe('COUPON_SCOPE_EMPTY');
    });

    it('ร้าน A แก้/ปิดคูปองของร้าน B ไม่ได้ → 404', async () => {
      const ofB = await shopCoupon(sellerB);
      await api(app)
        .patch(`/api/v1/seller/coupons/${ofB.id}`)
        .set(bearer(sellerA.accessToken))
        .send({ title: 'แอบแก้' })
        .expect(404);
      await api(app)
        .post(`/api/v1/seller/coupons/${ofB.id}/deactivate`)
        .set(bearer(sellerA.accessToken))
        .expect(404);

      const [row] = await prisma.coupon.findMany({
        where: { id: ofB.id },
        select: { isActive: true, title: true },
      });
      expect(row!.isActive).toBe(true);
      expect(row!.title).not.toBe('แอบแก้');
    });

    it('ร้านเห็นเฉพาะคูปองของร้านตัวเองใน GET /seller/coupons', async () => {
      const mine = await shopCoupon(sellerA);
      const ofB = await shopCoupon(sellerB);

      const res = await api(app)
        .get('/api/v1/seller/coupons')
        .set(bearer(sellerA.accessToken))
        .expect(200);
      const ids = (res.body as CouponRes[]).map((c) => c.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(ofB.id);
    });

    it('โค้ดซ้ำกับของแพลตฟอร์มไม่ได้ (unique ทั้งตาราง)', async () => {
      const shared = code('DUP');
      await api(app)
        .post('/api/v1/admin/coupons')
        .set(bearer(admin.accessToken))
        .send(terms({ code: shared }))
        .expect(201);

      const res = await api(app)
        .post('/api/v1/seller/coupons')
        .set(bearer(sellerA.accessToken))
        .send({ ...terms({ code: shared }), appliesToAllProducts: true })
        .expect(409);
      expect((res.body as ApiError).code).toBe('COUPON_CODE_TAKEN');
    });
  });

  // ==========================================================
  // ซ้อน 2 ระดับ
  // ==========================================================

  describe('ซ้อนคูปอง 2 ระดับในรอบเดียว', () => {
    it('★ จองได้ทั้งสองระดับ และยอดคิดจากยอดเต็มทั้งคู่แล้วรวม ★', async () => {
      const b = await makeBuyer('stk-both');
      const sub = await subscribe(b, planBoth);
      const platform = await platformCoupon(productBoth, sellerA, {
        discountValue: 20,
      });
      const shop = await shopCoupon(sellerA, { discountValue: 10 });

      await applyCoupon(b, sub.id, platform.id).expect(200);
      const after = await applyCoupon(b, sub.id, shop.id).expect(200);
      const body = after.body as CouponsView;

      // ยอด ฿400 · แพลตฟอร์ม 20% = ฿80 · ร้าน 10% = ฿40 → รวม ฿120
      expect(body.grossAmount).toBe(PRICE);
      expect(body.platform.applied?.discountAmount).toBe(80);
      expect(body.shop.applied?.discountAmount).toBe(40);
      expect(body.discountAmount).toBe(120);
      expect(body.netAmount).toBe(280);

      // ★ ฐานข้อมูล ★ 2 ใบ คนละระดับ ในรอบเดียวกัน
      const rows = await prisma.couponRedemption.findMany({
        where: { subscriptionId: sub.id, status: 'reserved' },
        select: { tier: true, cycleDate: true },
      });
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.tier).sort()).toEqual(['platform', 'shop']);
      expect(new Set(rows.map((r) => r.cycleDate.getTime())).size).toBe(1);
    });

    it('★ ใบที่ 2 ของระดับเดิม → 409 (DB บังคับ 1 รอบ 1 ใบต่อระดับ) ★', async () => {
      const b = await makeBuyer('stk-dup-tier');
      const sub = await subscribe(b, planBoth);
      const first = await shopCoupon(sellerA);
      const second = await shopCoupon(sellerA);

      await applyCoupon(b, sub.id, first.id).expect(200);
      const res = await applyCoupon(b, sub.id, second.id).expect(409);
      expect((res.body as ApiError).code).toBe('COUPON_ALREADY_APPLIED');

      expect(
        await prisma.couponRedemption.count({
          where: { subscriptionId: sub.id, status: 'reserved' },
        }),
      ).toBe(1);
    });

    it('ถอนระดับหนึ่ง อีกระดับต้องยังอยู่', async () => {
      const b = await makeBuyer('stk-remove-one');
      const sub = await subscribe(b, planBoth);
      const platform = await platformCoupon(productBoth, sellerA, {
        discountValue: 25,
      });
      const shop = await shopCoupon(sellerA, { discountValue: 5 });
      await applyCoupon(b, sub.id, platform.id).expect(200);
      await applyCoupon(b, sub.id, shop.id).expect(200);

      const res = await api(app)
        .delete(`/api/v1/subscriptions/${sub.id}/coupon/shop`)
        .set(bearer(b.user.accessToken))
        .expect(200);
      const body = res.body as CouponsView;

      expect(body.shop.applied).toBeNull();
      expect(body.platform.applied?.code).toBe(platform.code);
      expect(body.discountAmount).toBe(100); // เหลือ 25% ของ ฿400
    });

    it('ถอนระดับที่ไม่ได้จองไว้ → 409', async () => {
      const b = await makeBuyer('stk-remove-none');
      const sub = await subscribe(b, planBoth);
      const res = await api(app)
        .delete(`/api/v1/subscriptions/${sub.id}/coupon/platform`)
        .set(bearer(b.user.accessToken))
        .expect(409);
      expect((res.body as ApiError).code).toBe('NO_COUPON_APPLIED');
    });

    it('ระดับที่ไม่รู้จักใน path → 400', async () => {
      const b = await makeBuyer('stk-bad-tier');
      const sub = await subscribe(b, planBoth);
      await api(app)
        .delete(`/api/v1/subscriptions/${sub.id}/coupon/vip`)
        .set(bearer(b.user.accessToken))
        .expect(400);
    });
  });

  // ==========================================================
  // นโยบายคูปองรายสินค้า
  // ==========================================================

  describe('products.coupon_policy — ร้านปิดระดับรายสินค้า', () => {
    it('★ platform_only → ระดับร้านถูกปิด และยิง API ตรงก็ยังถูกปฏิเสธ ★', async () => {
      const b = await makeBuyer('stk-platform-only');
      const sub = await subscribe(b, planPlatformOnly);
      const platform = await platformCoupon(
        productPlatformOnly,
        sellerA,
        { discountValue: 20 },
        'platform_only',
      );
      const shop = await shopCoupon(sellerA, { discountValue: 10 });

      const v = await view(b, sub.id);
      expect(v.platform.allowed).toBe(true);
      expect(v.shop.allowed).toBe(false);
      expect(v.shop.blockedReason).toContain('เฉพาะคูปองของแพลตฟอร์ม');
      expect(v.shop.available).toHaveLength(0);
      expect(v.platform.available.map((c) => c.id)).toContain(platform.id);

      // ปุ่มที่ซ่อนไม่ใช่ security — ยิงตรงต้องโดนปฏิเสธด้วย
      const res = await applyCoupon(b, sub.id, shop.id).expect(409);
      expect((res.body as ApiError).code).toBe('COUPON_TIER_NOT_ALLOWED');
      expect(
        await prisma.couponRedemption.count({
          where: { subscriptionId: sub.id },
        }),
      ).toBe(0);
    });

    it('none → ปิดทั้งสองระดับ', async () => {
      const b = await makeBuyer('stk-none');
      const sub = await subscribe(b, planBoth);
      const shop = await shopCoupon(sellerA, { discountValue: 10 });

      await api(app)
        .put(`/api/v1/seller/products/${productBoth}/coupons`)
        .set(bearer(sellerA.accessToken))
        .send({ couponIds: [], couponPolicy: 'none' })
        .expect(200);

      const v = await view(b, sub.id);
      expect(v.platform.allowed).toBe(false);
      expect(v.shop.allowed).toBe(false);
      await applyCoupon(b, sub.id, shop.id).expect(409);

      // คืนสภาพให้เคสหลัง
      await api(app)
        .put(`/api/v1/seller/products/${productBoth}/coupons`)
        .set(bearer(sellerA.accessToken))
        .send({ couponIds: [], couponPolicy: 'both' })
        .expect(200);
    });

    it('คูปองของร้านอื่นไม่โผล่ในรายการของสินค้าเรา', async () => {
      const b = await makeBuyer('stk-cross-shop');
      const sub = await subscribe(b, planBoth);
      const ofB = await shopCoupon(sellerB, { discountValue: 50 });

      const v = await view(b, sub.id);
      expect(v.shop.available.map((c) => c.id)).not.toContain(ofB.id);
      // ยิงตรงก็ต้องไม่ได้ — คูปองของร้าน B ไม่ครอบสินค้าของร้าน A
      const res = await applyCoupon(b, sub.id, ofB.id).expect(404);
      expect((res.body as ApiError).code).toBe('COUPON_NOT_FOUND');
    });
  });

  // ==========================================================
  // engine ตัดเงินเมื่อซ้อน
  // ==========================================================

  describe('engine ตัดเงินเมื่อมีคูปองสองระดับ', () => {
    it('★ ยอดที่ตัดจริง = ยอดเต็ม − (แพลตฟอร์ม + ร้าน) ยืนยันใน DB ★', async () => {
      const b = await makeBuyer('stk-engine');
      const sub = await subscribe(b, planBoth);
      const platform = await platformCoupon(productBoth, sellerA, {
        discountType: 'fixed',
        discountValue: 60,
      });
      const shop = await shopCoupon(sellerA, {
        discountType: 'fixed',
        discountValue: 40,
      });
      await applyCoupon(b, sub.id, platform.id).expect(200);
      await applyCoupon(b, sub.id, shop.id).expect(200);

      const cycleDate = parseISODate(sub.nextOrderDate);
      await engine.run(cycleDate);

      const order = await prisma.order.findFirstOrThrow({
        where: { subscriptionId: sub.id, cycleDate },
        include: {
          payment: true,
          platformRedemption: { include: { coupon: true } },
          shopRedemption: { include: { coupon: true } },
        },
      });
      expect(order.amount.toNumber()).toBe(PRICE - 100);
      expect(order.discountAmount.toNumber()).toBe(100);
      // ★ invariant ของใบเสร็จ ★ ยอดสองใบรวมกัน = ส่วนลดของออเดอร์
      expect(
        order
          .platformRedemption!.discountAmount.add(
            order.shopRedemption!.discountAmount,
          )
          .toNumber(),
      ).toBe(order.discountAmount.toNumber());
      expect(order.payment?.amount.toNumber()).toBe(PRICE - 100);
      expect(order.platformRedemption!.coupon.code).toBe(platform.code);
      expect(order.shopRedemption!.coupon.code).toBe(shop.code);
      expect(order.platformRedemption!.status).toBe('consumed');
      expect(order.shopRedemption!.status).toBe('consumed');
    });

    it('★ รวมเกินยอด → หนีบที่ใบของร้าน และยอดสุทธิเป็น ฿0 ไม่ติดลบ ★', async () => {
      const b = await makeBuyer('stk-clamp');
      const sub = await subscribe(b, planBoth);
      // แพลตฟอร์ม 80% (฿320) + ร้าน ฿200 = ฿520 ซึ่งเกินยอด ฿400
      const platform = await platformCoupon(productBoth, sellerA, {
        discountValue: 80,
      });
      const shop = await shopCoupon(sellerA, {
        discountType: 'fixed',
        discountValue: 200,
      });
      await applyCoupon(b, sub.id, platform.id).expect(200);
      await applyCoupon(b, sub.id, shop.id).expect(200);

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
      expect(order.amount.toNumber()).toBe(0);
      expect(order.discountAmount.toNumber()).toBe(PRICE);
      expect(order.platformRedemption!.discountAmount.toNumber()).toBe(320);
      // ★ ใบของร้านถูกหนีบด้วยยอดที่เหลือ ★ ไม่ใช่ ฿200 เต็ม
      expect(order.shopRedemption!.discountAmount.toNumber()).toBe(80);
      expect(order.payment?.status).toBe('paid');
    });

    it('รันซ้ำวันเดิม → ออเดอร์ใบเดียว คูปองถูกใช้ระดับละครั้ง', async () => {
      const b = await makeBuyer('stk-rerun');
      const sub = await subscribe(b, planBoth);
      const platform = await platformCoupon(productBoth, sellerA, {
        discountValue: 10,
      });
      const shop = await shopCoupon(sellerA, { discountValue: 5 });
      await applyCoupon(b, sub.id, platform.id).expect(200);
      await applyCoupon(b, sub.id, shop.id).expect(200);

      const cycleDate = parseISODate(sub.nextOrderDate);
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
          where: { subscriptionId: sub.id, status: 'consumed' },
        }),
      ).toBe(2);
    });

    it('ข้ามรอบ → คืนทั้งสองระดับพร้อมกัน', async () => {
      const b = await makeBuyer('stk-skip');
      const sub = await subscribe(b, planBoth);
      const platform = await platformCoupon(productBoth, sellerA, {
        discountValue: 10,
      });
      const shop = await shopCoupon(sellerA, { discountValue: 5 });
      await applyCoupon(b, sub.id, platform.id).expect(200);
      await applyCoupon(b, sub.id, shop.id).expect(200);

      await api(app)
        .post(`/api/v1/subscriptions/${sub.id}/skip`)
        .set(bearer(b.user.accessToken))
        .expect(201);

      const rows = await prisma.couponRedemption.findMany({
        where: { subscriptionId: sub.id },
        select: { status: true, releasedReason: true },
      });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === 'released')).toBe(true);
      expect(rows.every((r) => r.releasedReason === 'cycle_changed')).toBe(
        true,
      );

      for (const id of [platform.id, shop.id]) {
        const [c] = await prisma.coupon.findMany({
          where: { id },
          select: { inUseCount: true },
        });
        expect(c!.inUseCount).toBe(0);
      }
    });
  });

  // ==========================================================
  // ร้านที่ถูกระงับ
  // ==========================================================

  describe('ร้านที่ผู้ดูแลระงับ', () => {
    it('★ ออก/แก้/ปิดคูปองของร้านไม่ได้ แม้ยิง API ตรง ★', async () => {
      const existing = await shopCoupon(sellerA);

      await api(app)
        .post(`/api/v1/admin/shops/${shopA}/suspension`)
        .set(bearer(admin.accessToken))
        .send({ suspend: true, reason: 'ทดสอบคูปองร้าน' })
        .expect(200);

      // อ่านได้ (ร้านต้องเห็นแคมเปญของตัวเอง) แต่เขียนไม่ได้ทุกทาง
      await api(app)
        .get('/api/v1/seller/coupons')
        .set(bearer(sellerA.accessToken))
        .expect(200);
      await api(app)
        .post('/api/v1/seller/coupons')
        .set(bearer(sellerA.accessToken))
        .send({ ...terms(), appliesToAllProducts: true })
        .expect(404);
      await api(app)
        .patch(`/api/v1/seller/coupons/${existing.id}`)
        .set(bearer(sellerA.accessToken))
        .send({ title: 'แก้ตอนถูกระงับ' })
        .expect(404);
      await api(app)
        .post(`/api/v1/seller/coupons/${existing.id}/deactivate`)
        .set(bearer(sellerA.accessToken))
        .expect(404);

      const [row] = await prisma.coupon.findMany({
        where: { id: existing.id },
        select: { isActive: true, title: true },
      });
      expect(row!.isActive).toBe(true);
      expect(row!.title).not.toBe('แก้ตอนถูกระงับ');

      await api(app)
        .post(`/api/v1/admin/shops/${shopA}/suspension`)
        .set(bearer(admin.accessToken))
        .send({ suspend: false })
        .expect(200);
    });
  });

  // ==========================================================
  // ผู้ดูแลเห็นคูปองของร้าน (อ่านอย่างเดียว)
  // ==========================================================

  describe('GET /admin/coupons?tier=shop', () => {
    it('ผู้ดูแลเห็นคูปองของร้านพร้อมชื่อร้าน — ต้องตอบได้ว่าแคมเปญไหนของใคร', async () => {
      const mine = await shopCoupon(sellerA);
      const res = await api(app)
        .get('/api/v1/admin/coupons?tier=shop')
        .set(bearer(admin.accessToken))
        .expect(200);

      const row = (res.body as CouponRes[]).find((c) => c.id === mine.id);
      expect(row?.tier).toBe('shop');
      expect(row?.shopName).toBe('ร้านซ้อนคูปอง เอ');
    });
  });

  void planPlatformOnly;
});
