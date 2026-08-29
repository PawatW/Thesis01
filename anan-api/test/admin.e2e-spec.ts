import { INestApplication } from '@nestjs/common';
import { addDays, toISODate, todayInBangkok } from '../src/common/date';
import { EngineService } from '../src/engine/engine.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, ApiError, createTestApp } from './utils/app';
import { cardBody } from './utils/card';
import {
  bearer,
  cleanupTestUsers,
  registerTestUser,
  type TestUser,
} from './utils/auth';

const ADDRESS = {
  recipientName: 'ผู้รับ แอดมิน',
  phone: '0812345678',
  addressLine: '10 ถนนทดสอบ',
  province: 'กรุงเทพมหานคร',
  postcode: '10900',
};

interface Suspension {
  id: string;
  suspendedAt: string | null;
  affectedSubscriptions: number;
}

interface AdminShop {
  id: string;
  name: string;
  suspendedAt: string | null;
  activeSubscribers: number;
  openIssues: number;
  cancelledOrders30d: number;
}

/**
 * Phase 6 — ผู้ดูแลแพลตฟอร์ม (feature 14 · W10)
 *
 * คำถามที่ไฟล์นี้ต้องตอบ:
 *   1. บัญชีธรรมดาแตะอะไรของ admin ได้บ้าง (คำตอบต้องคือ "ไม่ได้เลย")
 *   2. **"ระงับร้าน" หยุดเงินจริงไหม** — หรือแค่ซ่อนสินค้าจากหน้าค้นหา
 *   3. ปลดระงับแล้วผู้ซื้อกลับมาเดินรอบต่อโดยไม่ถูกเก็บเงินย้อนหลังไหม
 *   4. ตัวเลขบน dashboard มาจากข้อมูลจริงไหม
 */
describe('Phase 6 — Admin', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let engine: EngineService;

  let admin: TestUser;
  let buyer: TestUser;
  let seller: TestUser;
  let shopId: string;
  let productId: string;
  let planId: string;
  let cardId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    engine = app.get(EngineService);
    await cleanupTestUsers(prisma);

    admin = await registerTestUser(app, 'adm-admin');
    buyer = await registerTestUser(app, 'adm-buyer');
    seller = await registerTestUser(app, 'adm-seller');

    // ★ สิทธิ์ admin ตั้งได้ทาง DB เท่านั้น ★ ไม่มี endpoint ไหนสร้าง admin ได้
    // (G-2) — เทสจึงต้องเขียนตรงเหมือนที่ seed ทำ แล้วล็อกอินใหม่ให้ token มีสิทธิ์
    await prisma.user.update({
      where: { id: admin.id },
      data: { isAdmin: true },
    });
    const relogin = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: 'E2ePassword2026!' })
      .expect(200);
    admin.accessToken = (relogin.body as { accessToken: string }).accessToken;

    const shop = await api(app)
      .post('/api/v1/seller/shop')
      .set(bearer(seller.accessToken))
      .send({ name: 'ร้านทดสอบผู้ดูแล' })
      .expect(201);
    shopId = (shop.body as { id: string }).id;

    const product = await api(app)
      .post('/api/v1/seller/products')
      .set(bearer(seller.accessToken))
      .send({
        name: 'สินค้าทดสอบผู้ดูแล',
        categoryId: 1,
        images: ['https://example.com/a.jpg'],
        oneTimePrice: 300,
        plans: [{ cycle: '1m', pricePerCycle: 250, qtyPerCycle: 1 }],
      })
      .expect(201);
    const productBody = product.body as { id: string; plans: { id: string }[] };
    productId = productBody.id;
    planId = productBody.plans[0]!.id;

    const card = await api(app)
      .post('/api/v1/me/payment-methods')
      .set(bearer(buyer.accessToken))
      .send(cardBody())
      .expect(201);
    cardId = (card.body as { id: string }).id;
  });

  afterAll(async () => {
    if (prisma) {
      await cleanupTestUsers(prisma);
      await prisma.productPlan.deleteMany({ where: { product: { shopId } } });
      await prisma.product.deleteMany({ where: { shopId } });
      await prisma.shop.deleteMany({ where: { ownerId: seller?.id } });
    }
    if (app) await app.close();
  });

  /** สมัคร 1 รายการของร้านทดสอบ แล้วคืน id */
  async function subscribe(startOffset = 5): Promise<string> {
    const address = await prisma.address.create({
      data: { ...ADDRESS, userId: buyer.id },
      select: { id: true },
    });
    const res = await api(app)
      .post('/api/v1/subscriptions')
      .set(bearer(buyer.accessToken))
      .send({
        planId,
        quantity: 1,
        addressId: address.id,
        paymentMethodId: cardId,
        startDate: toISODate(addDays(todayInBangkok(), startOffset)),
      })
      .expect(201);
    return (res.body as { subscription: { id: string } }).subscription.id;
  }

  // ==========================================================
  // ด่านสิทธิ์ — ข้อแรกที่ต้องผ่านก่อนพูดถึงอย่างอื่น
  // ==========================================================

  describe('สิทธิ์ของ endpoint ฝั่ง admin', () => {
    const adminRoutes = [
      '/api/v1/admin/stats',
      '/api/v1/admin/categories',
      '/api/v1/admin/shops',
      '/api/v1/admin/products',
      '/api/v1/admin/issues',
    ];

    it('★ บัญชีธรรมดายิงทุก endpoint ของ admin → 403 · ไม่มี token → 401', async () => {
      for (const route of adminRoutes) {
        await api(app).get(route).set(bearer(buyer.accessToken)).expect(403);
        await api(app).get(route).expect(401);
      }
    });

    it('บัญชีร้านค้าก็ยังไม่ใช่ admin → 403', async () => {
      await api(app)
        .get('/api/v1/admin/stats')
        .set(bearer(seller.accessToken))
        .expect(403);
    });

    it('non-admin ระงับร้านผ่าน API ตรง → 403 และร้านไม่ถูกแตะ', async () => {
      await api(app)
        .post(`/api/v1/admin/shops/${shopId}/suspension`)
        .set(bearer(seller.accessToken))
        .send({ suspend: true, reason: 'ลองระงับตัวเอง' })
        .expect(403);

      const shop = await prisma.shop.findUniqueOrThrow({
        where: { id: shopId },
      });
      expect(shop.suspendedAt).toBeNull();
    });
  });

  // ==========================================================
  // dashboard
  // ==========================================================

  describe('GET /admin/stats', () => {
    it('ตัวเลขตรงกับที่นับได้จากฐานข้อมูลจริง', async () => {
      const res = await api(app)
        .get('/api/v1/admin/stats')
        .set(bearer(admin.accessToken))
        .expect(200);
      const stats = res.body as {
        users: number;
        shops: number;
        products: number;
        activeSubscriptions: number;
        openIssues: number;
        mrr: number;
      };

      expect(stats.users).toBe(await prisma.user.count());
      expect(stats.shops).toBe(await prisma.shop.count());
      expect(stats.products).toBe(await prisma.product.count());
      expect(stats.activeSubscriptions).toBe(
        await prisma.subscription.count({ where: { status: 'active' } }),
      );
      expect(stats.openIssues).toBe(
        await prisma.orderIssue.count({ where: { status: 'open' } }),
      );
      expect(stats.mrr).toBeGreaterThanOrEqual(0);
    });

    it('ไม่มีรายชื่อผู้ใช้หรือ id ของใครหลุดมากับตัวเลขภาพรวม', async () => {
      const res = await api(app)
        .get('/api/v1/admin/stats')
        .set(bearer(admin.accessToken))
        .expect(200);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(buyer.id);
      expect(raw).not.toContain(buyer.email);
    });
  });

  // ==========================================================
  // หมวดสินค้า
  // ==========================================================

  describe('หมวดสินค้า', () => {
    let categoryId = 0;

    it('เพิ่มหมวดใหม่ → ผู้ซื้อเห็นในหน้า catalog ทันที', async () => {
      const name = `หมวดทดสอบ ${Date.now()}`;
      const res = await api(app)
        .post('/api/v1/admin/categories')
        .set(bearer(admin.accessToken))
        .send({ name, icon: 'sparkles', sortOrder: 99 })
        .expect(201);
      const body = res.body as { id: number; productCount: number };
      categoryId = body.id;
      expect(body.productCount).toBe(0);

      // ฝั่งผู้ซื้อเป็น endpoint สาธารณะคนละตัว — ต้องเห็นของใหม่โดยไม่ต้องทำอะไรเพิ่ม
      const publicList = await api(app)
        .get('/api/v1/catalog/categories')
        .expect(200);
      expect(
        (publicList.body as { name: string }[]).map((c) => c.name),
      ).toContain(name);
    });

    it('ชื่อซ้ำ → 409 · ชื่อว่าง → 400', async () => {
      const existing = await prisma.category.findFirstOrThrow();
      const dup = await api(app)
        .post('/api/v1/admin/categories')
        .set(bearer(admin.accessToken))
        .send({ name: existing.name })
        .expect(409);
      expect((dup.body as ApiError).code).toBe('CATEGORY_EXISTS');

      await api(app)
        .post('/api/v1/admin/categories')
        .set(bearer(admin.accessToken))
        .send({ name: '   ' })
        .expect(400);
    });

    it('แก้ชื่อและลำดับแล้วค่าใน DB เปลี่ยนตาม', async () => {
      await api(app)
        .patch(`/api/v1/admin/categories/${categoryId}`)
        .set(bearer(admin.accessToken))
        .send({ name: 'หมวดที่แก้แล้ว', sortOrder: 3 })
        .expect(200);

      const row = await prisma.category.findUniqueOrThrow({
        where: { id: categoryId },
      });
      expect(row.name).toBe('หมวดที่แก้แล้ว');
      expect(row.sortOrder).toBe(3);
    });

    it('★ ลบหมวดที่ยังมีสินค้า → 409 พร้อมบอกจำนวน (FK เป็นคนบล็อก)', async () => {
      const res = await api(app)
        .delete('/api/v1/admin/categories/1')
        .set(bearer(admin.accessToken))
        .expect(409);
      const err = res.body as ApiError;
      expect(err.code).toBe('CATEGORY_IN_USE');
      expect(err.message).toMatch(/\d+/);

      // ของเดิมต้องยังอยู่ครบ ไม่ใช่ลบไปครึ่งทาง
      expect(await prisma.category.count({ where: { id: 1 } })).toBe(1);
    });

    it('ลบหมวดที่ไม่มีสินค้า → 204 และหายจากรายการ', async () => {
      await api(app)
        .delete(`/api/v1/admin/categories/${categoryId}`)
        .set(bearer(admin.accessToken))
        .expect(204);

      expect(await prisma.category.count({ where: { id: categoryId } })).toBe(
        0,
      );
    });

    it('หมวดที่ไม่มีอยู่ → 404 · non-admin เพิ่มหมวด → 403', async () => {
      await api(app)
        .patch('/api/v1/admin/categories/999999')
        .set(bearer(admin.accessToken))
        .send({ name: 'ไม่มีอยู่จริง' })
        .expect(404);

      await api(app)
        .post('/api/v1/admin/categories')
        .set(bearer(buyer.accessToken))
        .send({ name: 'หมวดของคนที่ไม่ใช่แอดมิน' })
        .expect(403);
    });
  });

  // ==========================================================
  // moderation — หัวใจของเฟสนี้
  // ==========================================================

  describe('ระงับร้าน / คืนสถานะ', () => {
    let subscriptionId = '';

    it('รายการร้านมีสัญญาณคุณภาพ และไม่มีข้อมูลผู้ซื้อปนมา', async () => {
      subscriptionId = await subscribe();

      const res = await api(app)
        .get('/api/v1/admin/shops?q=ร้านทดสอบผู้ดูแล')
        .set(bearer(admin.accessToken))
        .expect(200);
      const shops = res.body as AdminShop[];
      const mine = shops.find((s) => s.id === shopId);
      expect(mine).toBeDefined();
      expect(mine!.activeSubscribers).toBeGreaterThanOrEqual(1);
      expect(mine!.openIssues).toBe(0);
      expect(mine!.cancelledOrders30d).toBe(0);
      expect(JSON.stringify(res.body)).not.toContain(buyer.id);
    });

    it('ระงับโดยไม่ใส่เหตุผล → 400 และร้านยังไม่ถูกระงับ', async () => {
      await api(app)
        .post(`/api/v1/admin/shops/${shopId}/suspension`)
        .set(bearer(admin.accessToken))
        .send({ suspend: true })
        .expect(400);

      const shop = await prisma.shop.findUniqueOrThrow({
        where: { id: shopId },
      });
      expect(shop.suspendedAt).toBeNull();
    });

    it('★ ระงับร้าน = หยุดเงินจริง: subscription ถูกแช่แข็ง + แจ้งผู้ซื้อ + engine ไม่สร้างออเดอร์', async () => {
      const res = await api(app)
        .post(`/api/v1/admin/shops/${shopId}/suspension`)
        .set(bearer(admin.accessToken))
        .send({ suspend: true, reason: 'ได้รับร้องเรียนหลายราย' })
        .expect(200);
      const result = res.body as Suspension;
      expect(result.suspendedAt).not.toBeNull();
      expect(result.affectedSubscriptions).toBeGreaterThanOrEqual(1);

      const sub = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      expect(sub.status).toBe('paused');
      // ★ 'shop_suspended' ไม่ใช่ 'user' — ผู้ซื้อปลดเองไม่ได้
      expect(sub.pausedReason).toBe('shop_suspended');

      expect(
        await prisma.notification.count({
          where: { userId: buyer.id, type: 'subscription_frozen' },
        }),
      ).toBeGreaterThanOrEqual(1);
      expect(
        await prisma.subscriptionEvent.count({
          where: { subscriptionId, event: 'paused' },
        }),
      ).toBeGreaterThanOrEqual(1);

      // สินค้าหายจาก catalog สาธารณะทันที
      await api(app).get(`/api/v1/catalog/products/${productId}`).expect(404);

      // และรอบที่ถึงกำหนดก็ต้องไม่เกิดออเดอร์ให้ร้านที่ถูกระงับ
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          nextOrderDate: todayInBangkok(),
          cycleAnchorDate: todayInBangkok(),
        },
      });
      const before = await prisma.order.count({ where: { subscriptionId } });
      await engine.run(todayInBangkok());
      expect(await prisma.order.count({ where: { subscriptionId } })).toBe(
        before,
      );
    });

    it('ผู้ซื้อกดกลับมาใช้งานรายการที่ถูกแช่แข็งเอง → 409', async () => {
      const res = await api(app)
        .post(`/api/v1/subscriptions/${subscriptionId}/resume`)
        .set(bearer(buyer.accessToken))
        .expect(409);
      expect((res.body as ApiError).code).toBe('SHOP_SUSPENDED');
    });

    it('ระงับซ้ำ → 409 (ไม่แช่แข็งซ้ำและไม่ส่งแจ้งเตือนรอบสอง)', async () => {
      const noticesBefore = await prisma.notification.count({
        where: { userId: buyer.id, type: 'subscription_frozen' },
      });

      const res = await api(app)
        .post(`/api/v1/admin/shops/${shopId}/suspension`)
        .set(bearer(admin.accessToken))
        .send({ suspend: true, reason: 'กดซ้ำอีกครั้ง' })
        .expect(409);
      expect((res.body as ApiError).code).toBe('SUSPENSION_UNCHANGED');

      expect(
        await prisma.notification.count({
          where: { userId: buyer.id, type: 'subscription_frozen' },
        }),
      ).toBe(noticesBefore);
    });

    it('★ คืนสถานะ → subscription กลับมา active และรอบถัดไปไม่ย้อนหลัง', async () => {
      const res = await api(app)
        .post(`/api/v1/admin/shops/${shopId}/suspension`)
        .set(bearer(admin.accessToken))
        .send({ suspend: false })
        .expect(200);
      expect(
        (res.body as Suspension).affectedSubscriptions,
      ).toBeGreaterThanOrEqual(1);

      const sub = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      expect(sub.status).toBe('active');
      expect(sub.pausedReason).toBeNull();
      // รอบถัดไปต้องเป็นวันในอนาคตเสมอ — ห้ามตัดเงินย้อนหลังทันทีที่ปลดระงับ
      expect(sub.nextOrderDate).not.toBeNull();
      expect(toISODate(sub.nextOrderDate!)).toBe(
        toISODate(addDays(todayInBangkok(), 1)),
      );

      await api(app).get(`/api/v1/catalog/products/${productId}`).expect(200);
    });

    it('คืนสถานะร้านที่ไม่ได้ถูกระงับ → 409 · ร้านที่ไม่มีอยู่ → 404', async () => {
      await api(app)
        .post(`/api/v1/admin/shops/${shopId}/suspension`)
        .set(bearer(admin.accessToken))
        .send({ suspend: false })
        .expect(409);

      await api(app)
        .post(
          '/api/v1/admin/shops/00000000-0000-4000-8000-00000000dead/suspension',
        )
        .set(bearer(admin.accessToken))
        .send({ suspend: true, reason: 'ร้านที่ไม่มีอยู่จริง' })
        .expect(404);
    });
  });

  // ==========================================================
  // ระงับสินค้าชิ้นเดียว + คิวเคสปัญหา
  // ==========================================================

  describe('ระงับสินค้า และคิวเคสปัญหา', () => {
    it('★ ระงับสินค้า → แช่แข็งเฉพาะ subscription ของสินค้านั้น และสินค้าหายจาก catalog', async () => {
      const subscriptionId = await subscribe(6);

      const res = await api(app)
        .post(`/api/v1/admin/products/${productId}/suspension`)
        .set(bearer(admin.accessToken))
        .send({ suspend: true, reason: 'รูปสินค้าไม่ตรงกับของจริง' })
        .expect(200);
      expect(
        (res.body as Suspension).affectedSubscriptions,
      ).toBeGreaterThanOrEqual(1);

      const sub = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      expect(sub.status).toBe('paused');
      expect(sub.pausedReason).toBe('shop_suspended');

      await api(app).get(`/api/v1/catalog/products/${productId}`).expect(404);

      // ร้านยังไม่ถูกระงับ — การระงับสินค้าต้องไม่ลามไปทั้งร้าน
      const shop = await prisma.shop.findUniqueOrThrow({
        where: { id: shopId },
      });
      expect(shop.suspendedAt).toBeNull();

      // คืนสถานะเพื่อไม่ให้เคสถัดไปเห็นสินค้าที่ถูกระงับค้างอยู่
      await api(app)
        .post(`/api/v1/admin/products/${productId}/suspension`)
        .set(bearer(admin.accessToken))
        .send({ suspend: false })
        .expect(200);
      const back = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      expect(back.status).toBe('active');
    });

    it('สินค้าที่ไม่มีอยู่ → 404 · non-admin → 403', async () => {
      await api(app)
        .post(
          '/api/v1/admin/products/00000000-0000-4000-8000-00000000beef/suspension',
        )
        .set(bearer(admin.accessToken))
        .send({ suspend: true, reason: 'สินค้าที่ไม่มีอยู่จริง' })
        .expect(404);

      await api(app)
        .post(`/api/v1/admin/products/${productId}/suspension`)
        .set(bearer(buyer.accessToken))
        .send({ suspend: true, reason: 'ผู้ซื้อสั่งระงับเอง' })
        .expect(403);
    });

    it('คิวเคสปัญหาเห็นข้ามร้าน แต่ไม่มี id ของผู้แจ้งหลุดออกมา', async () => {
      // สร้างเคสจริง 1 ใบ: สมัคร → ร้านส่ง → ผู้ซื้อแจ้งปัญหา
      const subscriptionId = await subscribe(7);
      const order = await prisma.order.findFirstOrThrow({
        where: { subscriptionId },
      });
      await api(app)
        .post(`/api/v1/seller/orders/${order.id}/advance`)
        .set(bearer(seller.accessToken))
        .send({})
        .expect(200);
      await api(app)
        .post(`/api/v1/seller/orders/${order.id}/advance`)
        .set(bearer(seller.accessToken))
        .send({ trackingNote: 'TH-ADM-001' })
        .expect(200);
      await api(app)
        .post(`/api/v1/orders/${order.id}/issues`)
        .set(bearer(buyer.accessToken))
        .send({ type: 'not_received', detail: 'รอมา 10 วันแล้วยังไม่ถึง' })
        .expect(201);

      const res = await api(app)
        .get('/api/v1/admin/issues?status=open')
        .set(bearer(admin.accessToken))
        .expect(200);
      const issues = res.body as { orderId: string; shopId: string }[];
      expect(issues.map((i) => i.orderId)).toContain(order.id);
      expect(issues.find((i) => i.orderId === order.id)!.shopId).toBe(shopId);
      expect(JSON.stringify(res.body)).not.toContain(buyer.id);
    });

    it('ร้านที่มีเคสค้างขึ้นในรายการ moderation พร้อมจำนวนเคส', async () => {
      const res = await api(app)
        .get('/api/v1/admin/shops?q=ร้านทดสอบผู้ดูแล')
        .set(bearer(admin.accessToken))
        .expect(200);
      const mine = (res.body as AdminShop[]).find((s) => s.id === shopId);
      expect(mine!.openIssues).toBeGreaterThanOrEqual(1);
    });
  });
});
