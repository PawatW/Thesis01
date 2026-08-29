import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, ApiError, createTestApp } from './utils/app';
import {
  bearer,
  cleanupTestCoupons,
  cleanupTestUsers,
  registerTestUser,
  TEST_PASSWORD,
  type TestUser,
} from './utils/auth';

interface CouponRes {
  id: string;
  code: string;
  title: string;
  label: string;
  state: 'scheduled' | 'running' | 'expired' | 'disabled';
  isActive: boolean;
  inUseCount: number;
  maxRedemptions: number | null;
  maxPerUser: number;
  productCount: number;
  reservedCount: number;
  consumedCount: number;
  releasedCount: number;
}

interface SellerCouponRes {
  id: string;
  code: string;
  tier: 'platform' | 'shop';
  enabled: boolean;
  coveredByAllProducts: boolean;
  maxDiscountPerCycle: number | null;
}

interface ProductCouponsRes {
  couponPolicy: 'both' | 'platform_only' | 'shop_only' | 'none';
  platform: SellerCouponRes[];
  shop: SellerCouponRes[];
}

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

/**
 * Feature 18 ชั้นที่ 1-2 — admin ออกคูปอง · ร้านเลือกสินค้าเข้าร่วม (W13 Flow A/B)
 *
 * คำถามที่ไฟล์นี้ต้องตอบให้ได้:
 *   1. บัญชีธรรมดา/ร้านค้า ออกคูปองเองได้ไหม (คำตอบต้องคือ "ไม่ได้เลย")
 *   2. ร้าน A ติ๊กคูปองให้สินค้าของร้าน B ได้ไหม
 *   3. เงื่อนไขที่เป็นไปไม่ได้ (percent > 100 · fixed + เพดาน · ปิดหลังเริ่ม) ถูกปฏิเสธที่ไหน
 *   4. คูปองถูก "ลบ" ได้ไหม (ต้องไม่มีทางลบ — มีแต่ปิด)
 */
describe('Feature 18 — คูปอง: admin ออก · ร้านเข้าร่วม', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let admin: TestUser;
  let sellerA: TestUser;
  let sellerB: TestUser;
  let plain: TestUser;
  const shopIds: string[] = [];
  let productA: string;
  let productB: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupTestUsers(prisma);
    await cleanupTestCoupons(prisma);

    admin = await registerTestUser(app, 'cpn-admin');
    sellerA = await registerTestUser(app, 'cpn-sa');
    sellerB = await registerTestUser(app, 'cpn-sb');
    plain = await registerTestUser(app, 'cpn-plain');

    // สิทธิ์ admin ตั้งได้ทาง DB เท่านั้น แล้วต้องล็อกอินใหม่ให้ token มีสิทธิ์ (G-2)
    await prisma.user.update({
      where: { id: admin.id },
      data: { isAdmin: true },
    });
    const relogin = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: TEST_PASSWORD })
      .expect(200);
    admin.accessToken = (relogin.body as { accessToken: string }).accessToken;

    productA = await openShopWithProduct(sellerA, 'ร้านคูปอง เอ', 200);
    productB = await openShopWithProduct(sellerB, 'ร้านคูปอง บี', 500);
  });

  afterAll(async () => {
    if (prisma) {
      await cleanupTestUsers(prisma);
      await cleanupTestCoupons(prisma);
      await prisma.productPlan.deleteMany({
        where: { product: { shopId: { in: shopIds } } },
      });
      await prisma.product.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    }
    if (app) await app.close();
  });

  // ---------- ตัวช่วย ----------

  async function openShopWithProduct(
    user: TestUser,
    shopName: string,
    price: number,
  ): Promise<string> {
    const shop = await api(app)
      .post('/api/v1/seller/shop')
      .set(bearer(user.accessToken))
      .send({ name: shopName })
      .expect(201);
    shopIds.push((shop.body as { id: string }).id);

    const product = await api(app)
      .post('/api/v1/seller/products')
      .set(bearer(user.accessToken))
      .send({
        name: `สินค้าคูปอง ${shopName}`,
        categoryId: 1,
        images: ['https://example.com/a.jpg'],
        oneTimePrice: price * 2,
        plans: [{ cycle: '1m', pricePerCycle: price, qtyPerCycle: 1 }],
      })
      .expect(201);
    return (product.body as { id: string }).id;
  }

  let seq = 0;
  function couponBody(over: Record<string, unknown> = {}) {
    return {
      code: `E2E-CPN-${Date.now()}-${seq++}`.slice(0, 24),
      title: 'คูปองทดสอบ',
      discountType: 'percent',
      discountValue: 20,
      startsAt: hours(-1),
      endsAt: hours(24 * 30),
      ...over,
    };
  }

  async function createCoupon(
    over: Record<string, unknown> = {},
  ): Promise<CouponRes> {
    const res = await api(app)
      .post('/api/v1/admin/coupons')
      .set(bearer(admin.accessToken))
      .send(couponBody(over))
      .expect(201);
    return res.body as CouponRes;
  }

  // ==========================================================
  // Flow A — admin ออกคูปอง
  // ==========================================================

  describe('POST /admin/coupons', () => {
    it('ออกคูปองสำเร็จ → นับโควตาเริ่มที่ 0 และมี audit log', async () => {
      const coupon = await createCoupon({
        title: 'ลด 20% รอบไหนก็ได้',
        discountValue: 20,
        maxDiscountAmount: 50,
        maxRedemptions: 5,
      });

      expect(coupon.state).toBe('running');
      expect(coupon.label).toBe('ลด 20% (สูงสุด ฿50.00)');
      expect(coupon.inUseCount).toBe(0);
      // เฟสนี้ล็อกที่ 1 — บังคับด้วย partial unique `coupon_once_per_user`
      expect(coupon.maxPerUser).toBe(1);

      const log = await prisma.auditLog.findFirst({
        where: { action: 'coupon_created', targetId: coupon.id },
      });
      expect(log?.actorId).toBe(admin.id);
    });

    it('★ ห้ามรับยอดส่วนลดจาก client ★ แนบ inUseCount/isActive มา → 400', async () => {
      await api(app)
        .post('/api/v1/admin/coupons')
        .set(bearer(admin.accessToken))
        .send({ ...couponBody(), inUseCount: 99 })
        .expect(400);

      await api(app)
        .post('/api/v1/admin/coupons')
        .set(bearer(admin.accessToken))
        .send({ ...couponBody(), isActive: false })
        .expect(400);
    });

    it('percent เกิน 100 → 422 (ไม่ใช่ 500 จาก CHECK)', async () => {
      const res = await api(app)
        .post('/api/v1/admin/coupons')
        .set(bearer(admin.accessToken))
        .send(couponBody({ discountValue: 120 }))
        .expect(422);
      expect((res.body as ApiError).code).toBe('COUPON_PERCENT_TOO_HIGH');
    });

    it('fixed + เพดานส่วนลด → 422 (เพดานมีความหมายเฉพาะ percent)', async () => {
      const res = await api(app)
        .post('/api/v1/admin/coupons')
        .set(bearer(admin.accessToken))
        .send(
          couponBody({
            discountType: 'fixed',
            discountValue: 50,
            maxDiscountAmount: 20,
          }),
        )
        .expect(422);
      expect((res.body as ApiError).code).toBe('COUPON_CAP_NOT_ALLOWED');
    });

    it('วันสิ้นสุดก่อนวันเริ่ม → 422', async () => {
      await api(app)
        .post('/api/v1/admin/coupons')
        .set(bearer(admin.accessToken))
        .send(couponBody({ startsAt: hours(24), endsAt: hours(1) }))
        .expect(422);
    });

    it('โค้ดผิดรูปแบบ (ตัวพิมพ์เล็ก/สั้นเกิน) → 400 จาก DTO', async () => {
      await api(app)
        .post('/api/v1/admin/coupons')
        .set(bearer(admin.accessToken))
        .send(couponBody({ code: 'ab' }))
        .expect(400);
    });

    it('โค้ดซ้ำ → 409', async () => {
      const code = `E2E-DUP-${Date.now()}`.slice(0, 24);
      await createCoupon({ code });
      const res = await api(app)
        .post('/api/v1/admin/coupons')
        .set(bearer(admin.accessToken))
        .send(couponBody({ code }))
        .expect(409);
      expect((res.body as ApiError).code).toBe('COUPON_CODE_TAKEN');
    });

    it('บัญชีธรรมดาและร้านค้าออกคูปองไม่ได้ → 403', async () => {
      await api(app)
        .post('/api/v1/admin/coupons')
        .set(bearer(plain.accessToken))
        .send(couponBody())
        .expect(403);
      await api(app)
        .post('/api/v1/admin/coupons')
        .set(bearer(sellerA.accessToken))
        .send(couponBody())
        .expect(403);
      await api(app).get('/api/v1/admin/coupons').expect(401);
    });
  });

  describe('PATCH /admin/coupons/:id', () => {
    it('★ แก้ชนิด/มูลค่าไม่ได้ ★ ส่งมาก็ถูกตัดทิ้งด้วย 400', async () => {
      const coupon = await createCoupon();
      await api(app)
        .patch(`/api/v1/admin/coupons/${coupon.id}`)
        .set(bearer(admin.accessToken))
        .send({ discountValue: 90 })
        .expect(400);
      await api(app)
        .patch(`/api/v1/admin/coupons/${coupon.id}`)
        .set(bearer(admin.accessToken))
        .send({ discountType: 'fixed' })
        .expect(400);
    });

    it('แก้ชื่อ/วันสิ้นสุด/โควตาได้ + ลง audit', async () => {
      const coupon = await createCoupon({ maxRedemptions: 10 });
      const res = await api(app)
        .patch(`/api/v1/admin/coupons/${coupon.id}`)
        .set(bearer(admin.accessToken))
        .send({ title: 'ชื่อใหม่', maxRedemptions: 3 })
        .expect(200);

      const body = res.body as CouponRes;
      expect(body.title).toBe('ชื่อใหม่');
      expect(body.maxRedemptions).toBe(3);
      expect(
        await prisma.auditLog.count({
          where: { action: 'coupon_updated', targetId: coupon.id },
        }),
      ).toBe(1);
    });

    it('ลดโควตาต่ำกว่าที่ใช้ไปแล้ว → 422', async () => {
      const coupon = await createCoupon({ maxRedemptions: 10 });
      // จำลองว่ามีคนจองไปแล้ว 2 ใบ
      await prisma.coupon.update({
        where: { id: coupon.id },
        data: { inUseCount: 2 },
      });
      const res = await api(app)
        .patch(`/api/v1/admin/coupons/${coupon.id}`)
        .set(bearer(admin.accessToken))
        .send({ maxRedemptions: 1 })
        .expect(422);
      expect((res.body as ApiError).code).toBe('COUPON_QUOTA_BELOW_USED');
    });

    it('คูปองที่ไม่มีอยู่ → 404', async () => {
      await api(app)
        .patch('/api/v1/admin/coupons/99999999-0000-4000-8000-000000000000')
        .set(bearer(admin.accessToken))
        .send({ title: 'x' })
        .expect(404);
    });
  });

  describe('ปิดคูปอง (ไม่มี DELETE)', () => {
    it('★ ไม่มี endpoint ลบคูปอง ★ DELETE → 404 route', async () => {
      const coupon = await createCoupon();
      await api(app)
        .delete(`/api/v1/admin/coupons/${coupon.id}`)
        .set(bearer(admin.accessToken))
        .expect(404);
      // ยังอยู่ครบ
      expect(await prisma.coupon.count({ where: { id: coupon.id } })).toBe(1);
    });

    it('ปิดแล้วสถานะเป็น disabled · ปิดซ้ำ → 409', async () => {
      const coupon = await createCoupon();
      const res = await api(app)
        .post(`/api/v1/admin/coupons/${coupon.id}/deactivate`)
        .set(bearer(admin.accessToken))
        .expect(201);
      expect((res.body as CouponRes).state).toBe('disabled');

      const again = await api(app)
        .post(`/api/v1/admin/coupons/${coupon.id}/deactivate`)
        .set(bearer(admin.accessToken))
        .expect(409);
      expect((again.body as ApiError).code).toBe('COUPON_ALREADY_INACTIVE');
    });
  });

  describe('GET /admin/coupons', () => {
    it('กรอง active/inactive ได้ และนับสถานะใบจองครบ 3 ช่อง', async () => {
      const running = await createCoupon();
      const expired = await createCoupon({
        startsAt: hours(-48),
        endsAt: hours(-1),
      });

      const active = await api(app)
        .get('/api/v1/admin/coupons?status=active')
        .set(bearer(admin.accessToken))
        .expect(200);
      const activeIds = (active.body as CouponRes[]).map((c) => c.id);
      expect(activeIds).toContain(running.id);
      expect(activeIds).not.toContain(expired.id);

      const inactive = await api(app)
        .get('/api/v1/admin/coupons?status=inactive')
        .set(bearer(admin.accessToken))
        .expect(200);
      const row = (inactive.body as CouponRes[]).find(
        (c) => c.id === expired.id,
      );
      expect(row?.state).toBe('expired');
      expect(row).toMatchObject({
        reservedCount: 0,
        consumedCount: 0,
        releasedCount: 0,
      });
    });
  });

  // ==========================================================
  // Flow B — ร้านเลือกสินค้าที่เข้าร่วม
  // ==========================================================

  describe('PUT /seller/products/:id/coupons', () => {
    it('ติ๊กเข้าร่วม → enabled = true และโชว์ส่วนลดต่อรอบของสินค้าชิ้นนั้น', async () => {
      const coupon = await createCoupon({ discountValue: 25 });

      const res = await api(app)
        .put(`/api/v1/seller/products/${productA}/coupons`)
        .set(bearer(sellerA.accessToken))
        .send({ couponIds: [coupon.id], couponPolicy: 'both' })
        .expect(200);

      const row = (res.body as ProductCouponsRes).platform.find(
        (c) => c.id === coupon.id,
      );
      expect(row?.enabled).toBe(true);
      // แผนของ productA ราคา 200 → 25% = 50
      expect(row?.maxDiscountPerCycle).toBe(50);
    });

    it('ส่งชุดเดิมซ้ำ → idempotent (ไม่เกิดแถวซ้ำ)', async () => {
      const coupon = await createCoupon();
      const send = () =>
        api(app)
          .put(`/api/v1/seller/products/${productA}/coupons`)
          .set(bearer(sellerA.accessToken))
          .send({ couponIds: [coupon.id], couponPolicy: 'both' })
          .expect(200);

      await send();
      await send();
      expect(
        await prisma.couponProduct.count({
          where: { couponId: coupon.id, productId: productA },
        }),
      ).toBe(1);
    });

    it('ส่ง [] → ถอนออกทุกใบ', async () => {
      const coupon = await createCoupon();
      await api(app)
        .put(`/api/v1/seller/products/${productA}/coupons`)
        .set(bearer(sellerA.accessToken))
        .send({ couponIds: [coupon.id], couponPolicy: 'both' })
        .expect(200);

      const res = await api(app)
        .put(`/api/v1/seller/products/${productA}/coupons`)
        .set(bearer(sellerA.accessToken))
        .send({ couponIds: [], couponPolicy: 'both' })
        .expect(200);

      expect(
        (res.body as ProductCouponsRes).platform.every((c) => !c.enabled),
      ).toBe(true);
      expect(
        await prisma.couponProduct.count({ where: { productId: productA } }),
      ).toBe(0);
    });

    it('★ ร้าน A ติ๊กคูปองให้สินค้าของร้าน B ไม่ได้ → 404 ★', async () => {
      const coupon = await createCoupon();
      await api(app)
        .put(`/api/v1/seller/products/${productB}/coupons`)
        .set(bearer(sellerA.accessToken))
        .send({ couponIds: [coupon.id], couponPolicy: 'both' })
        .expect(404);
      await api(app)
        .get(`/api/v1/seller/products/${productB}/coupons`)
        .set(bearer(sellerA.accessToken))
        .expect(404);

      expect(
        await prisma.couponProduct.count({ where: { productId: productB } }),
      ).toBe(0);
    });

    it('ติ๊กคูปองที่ปิดไปแล้ว → 404', async () => {
      const coupon = await createCoupon();
      await api(app)
        .post(`/api/v1/admin/coupons/${coupon.id}/deactivate`)
        .set(bearer(admin.accessToken))
        .expect(201);

      const res = await api(app)
        .put(`/api/v1/seller/products/${productA}/coupons`)
        .set(bearer(sellerA.accessToken))
        .send({ couponIds: [coupon.id], couponPolicy: 'both' })
        .expect(404);
      expect((res.body as ApiError).code).toBe('COUPON_NOT_FOUND');
    });

    it('★ ร้านที่ผู้ดูแลระงับ แก้คูปองที่ร่วมรายการไม่ได้ (404) แม้ยิง API ตรง ★', async () => {
      const coupon = await createCoupon();
      const shopId = shopIds[0] as string;

      await api(app)
        .post(`/api/v1/admin/shops/${shopId}/suspension`)
        .set(bearer(admin.accessToken))
        .send({ suspend: true, reason: 'ทดสอบคูปอง' })
        .expect(200);

      // อ่านได้ (ร้านต้องเห็นว่าตัวเองร่วมอะไรอยู่) แต่เขียนไม่ได้
      await api(app)
        .get(`/api/v1/seller/products/${productA}/coupons`)
        .set(bearer(sellerA.accessToken))
        .expect(200);
      await api(app)
        .put(`/api/v1/seller/products/${productA}/coupons`)
        .set(bearer(sellerA.accessToken))
        .send({ couponIds: [coupon.id], couponPolicy: 'both' })
        .expect(404);

      expect(
        await prisma.couponProduct.count({
          where: { couponId: coupon.id, productId: productA },
        }),
      ).toBe(0);

      await api(app)
        .post(`/api/v1/admin/shops/${shopId}/suspension`)
        .set(bearer(admin.accessToken))
        .send({ suspend: false })
        .expect(200);
    });

    it('บัญชีที่ยังไม่เปิดร้าน → 403 (role ไม่ถึง)', async () => {
      await api(app)
        .get(`/api/v1/seller/products/${productA}/coupons`)
        .set(bearer(plain.accessToken))
        .expect(403);
    });
  });
});
