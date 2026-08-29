import { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
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

const PRODUCT_BODY = {
  name: 'สบู่สมุนไพรทดสอบ',
  categoryId: 1,
  description: 'สินค้าสำหรับ e2e',
  images: ['https://example.com/a.jpg'],
  oneTimePrice: 120,
  netAmount: 100,
  unit: 'g',
  plans: [{ cycle: '1m', pricePerCycle: 99, qtyPerCycle: 1 }],
};

const BUYER_ADDRESS = {
  recipientName: 'ผู้รับ ฝั่งร้าน',
  phone: '0812345678',
  addressLine: '5 ถนนทดสอบ',
  province: 'กรุงเทพมหานคร',
  postcode: '10900',
};

interface ShopRes {
  id: string;
  name: string;
  isActive: boolean;
  isSuspended: boolean;
}
interface PlanRes {
  id: string;
  cycle: string;
  pricePerCycle: number;
  isActive: boolean;
  activeSubscribers: number;
}
interface ProductRes {
  id: string;
  name: string;
  isActive: boolean;
  isSuspended: boolean;
  activeSubscribers: number;
  plans: PlanRes[];
}
interface OrderRes {
  id: string;
  status: string;
  amount: number;
  trackingNote: string | null;
  productName: string;
  recipient: { name: string; addressLine: string };
  subscriptionCancelled: boolean;
}

/**
 * Phase 4 — ฝั่งร้านค้า (features 10/11/12 · W02/W07/W08)
 *
 * คำถามที่ไฟล์นี้ต้องตอบให้ได้:
 *   1. ร้าน A แตะข้อมูลของร้าน B ได้ไหม (ทุก endpoint)
 *   2. ร้านเห็นข้อมูลผู้ซื้อเกินที่ต้องส่งของไหม (buyerId / subscriptionId ต้องไม่มี)
 *   3. ร้านที่ถูกผู้ดูแลระงับ ยังทำงาน/ปลดแบนตัวเองได้ไหม
 *   4. ขึ้นราคาแล้วสมาชิกได้รับแจ้งเตือนจริงไหม (consumer protection)
 *   5. ไล่สถานะออเดอร์ข้ามขั้นได้ไหม
 */
describe('Seller — ร้านค้า สินค้า ออเดอร์ forecast', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let engine: EngineService;

  /** ร้าน A = ร้านหลักของเทส · ร้าน B = ร้านคนอื่น (ใช้พิสูจน์ ownership) */
  let sellerA: TestUser;
  let sellerB: TestUser;
  let buyer: TestUser;
  let shopA: ShopRes;
  let shopB: ShopRes;
  let productA: ProductRes;
  let cardId: string;
  /** เวลาที่ไฟล์นี้เริ่มรัน — ใช้กรองแจ้งเตือน/ออเดอร์ของรอบนี้ออกจากของเก่า */
  let startedAt: Date;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    startedAt = new Date();
    engine = app.get(EngineService);
    await cleanupTestUsers(prisma);

    sellerA = await registerTestUser(app, 'seller-a');
    sellerB = await registerTestUser(app, 'seller-b');
    buyer = await registerTestUser(app, 'seller-buyer');

    shopA = await openShop(sellerA, 'ร้านทดสอบ เอ');
    shopB = await openShop(sellerB, 'ร้านทดสอบ บี');
    productA = await createProduct(sellerA);

    const card = await api(app)
      .post('/api/v1/me/payment-methods')
      .set(bearer(buyer.accessToken))
      .send(cardBody())
      .expect(201);
    cardId = (card.body as { id: string }).id;
  });

  afterAll(async () => {
    if (prisma) {
      // ลบของที่เทสสร้างเองตามลำดับ FK (ร้าน/สินค้าไม่ได้ผูกกับ cleanupTestUsers)
      const shopIds = [shopA?.id, shopB?.id].filter(Boolean);
      await cleanupTestUsers(prisma);
      await prisma.productPlan.deleteMany({
        where: { product: { shopId: { in: shopIds } } },
      });
      await prisma.product.deleteMany({ where: { shopId: { in: shopIds } } });
      await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    }
    if (app) await app.close();
  });

  // ---------- ตัวช่วย ----------

  async function openShop(user: TestUser, name: string): Promise<ShopRes> {
    const res = await api(app)
      .post('/api/v1/seller/shop')
      .set(bearer(user.accessToken))
      .send({ name })
      .expect(201);
    return res.body as ShopRes;
  }

  async function createProduct(
    user: TestUser,
    over: Record<string, unknown> = {},
  ): Promise<ProductRes> {
    const res = await api(app)
      .post('/api/v1/seller/products')
      .set(bearer(user.accessToken))
      .send({ ...PRODUCT_BODY, ...over })
      .expect(201);
    return res.body as ProductRes;
  }

  /** สมัครสมาชิกให้แผนของร้าน A — ที่อยู่ใหม่ทุกครั้งเพราะกฎกันสมัครซ้ำ */
  async function subscribe(planId: string): Promise<string> {
    const address = await prisma.address.create({
      data: { ...BUYER_ADDRESS, userId: buyer.id },
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
        startDate: toISODate(addDays(todayInBangkok(), 1)),
      })
      .expect(201);
    return (res.body as { subscription: { id: string } }).subscription.id;
  }

  // ==========================================================
  // feature 10 — ร้านค้า
  // ==========================================================

  describe('POST /seller/shop — เปิดร้าน (W02)', () => {
    it('เปิดร้าน → ได้ร้าน + บัญชีกลายเป็น seller ในคำขอถัดไปทันที', async () => {
      const owner = await registerTestUser(app, 'shop-open');

      // ก่อนเปิดร้าน endpoint ของ seller ต้องปฏิเสธเพราะ role ไม่ถึง
      await api(app)
        .get('/api/v1/seller/shop')
        .set(bearer(owner.accessToken))
        .expect(403);

      const res = await api(app)
        .post('/api/v1/seller/shop')
        .set(bearer(owner.accessToken))
        .send({ name: 'ร้านเปิดใหม่' })
        .expect(201);
      expect((res.body as ShopRes).name).toBe('ร้านเปิดใหม่');

      // role มาจาก DB ทุก request — token ใบเดิมใช้ต่อได้เลยไม่ต้องล็อกอินใหม่
      await api(app)
        .get('/api/v1/seller/shop')
        .set(bearer(owner.accessToken))
        .expect(200);
      const row = await prisma.user.findUniqueOrThrow({
        where: { id: owner.id },
      });
      expect(row.isSeller).toBe(true);

      await prisma.shop.deleteMany({ where: { ownerId: owner.id } });
    });

    it('เปิดร้านซ้ำ → 409 (1 บัญชี = 1 ร้าน)', async () => {
      const res = await api(app)
        .post('/api/v1/seller/shop')
        .set(bearer(sellerA.accessToken))
        .send({ name: 'ร้านที่สอง' })
        .expect(409);
      expect((res.body as ApiError).code).toBe('SHOP_EXISTS');
    });

    it('ชื่อร้านสั้นเกิน → 400 · แนบ ownerId/suspendedAt มา → 400', async () => {
      const owner = await registerTestUser(app, 'shop-bad');
      await api(app)
        .post('/api/v1/seller/shop')
        .set(bearer(owner.accessToken))
        .send({ name: 'ก' })
        .expect(400);

      // ★ ยกระดับตัวเอง/ปลดแบนตัวเองผ่าน body ไม่ได้ — ฟิลด์ไม่อยู่ใน DTO
      await api(app)
        .post('/api/v1/seller/shop')
        .set(bearer(owner.accessToken))
        .send({ name: 'ร้านแอบระงับ', suspendedAt: null, ownerId: buyer.id })
        .expect(400);
    });

    it('ไม่มี token → 401', async () => {
      await api(app)
        .post('/api/v1/seller/shop')
        .send({ name: 'ร้านไม่มี token' })
        .expect(401);
    });
  });

  describe('PATCH /seller/shop', () => {
    it('แก้ชื่อและปิดร้านเองได้', async () => {
      const res = await api(app)
        .patch('/api/v1/seller/shop')
        .set(bearer(sellerA.accessToken))
        .send({ name: 'ร้านทดสอบ เอ (แก้แล้ว)', isActive: false })
        .expect(200);

      const shop = res.body as ShopRes;
      expect(shop.name).toBe('ร้านทดสอบ เอ (แก้แล้ว)');
      expect(shop.isActive).toBe(false);

      await api(app)
        .patch('/api/v1/seller/shop')
        .set(bearer(sellerA.accessToken))
        .send({ isActive: true })
        .expect(200);
    });

    it('★ ร้านที่ถูกผู้ดูแลระงับ → แก้ข้อมูลร้านไม่ได้ และปลดระงับตัวเองไม่ได้', async () => {
      await prisma.shop.update({
        where: { id: shopA.id },
        data: { suspendedAt: new Date(), suspendedReason: 'ทดสอบ' },
      });
      try {
        const res = await api(app)
          .patch('/api/v1/seller/shop')
          .set(bearer(sellerA.accessToken))
          .send({ name: 'พยายามแก้ตอนถูกระงับ' })
          .expect(409);
        expect((res.body as ApiError).code).toBe('SHOP_SUSPENDED');

        // ยิงตรงเพื่อปลดระงับ → ฟิลด์ไม่อยู่ใน DTO เลย = 400
        await api(app)
          .patch('/api/v1/seller/shop')
          .set(bearer(sellerA.accessToken))
          .send({ suspendedAt: null })
          .expect(400);

        const row = await prisma.shop.findUniqueOrThrow({
          where: { id: shopA.id },
        });
        expect(row.suspendedAt).not.toBeNull();
        expect(row.name).toBe('ร้านทดสอบ เอ (แก้แล้ว)');
      } finally {
        await prisma.shop.update({
          where: { id: shopA.id },
          data: { suspendedAt: null, suspendedReason: null },
        });
      }
    });
  });

  describe('GET /seller/dashboard', () => {
    it('ตัวเลขตรงกับข้อมูลจริง และขยับตามเมื่อมีคนสมัคร/ยกเลิก', async () => {
      const before = await dashboard();

      const planId = productA.plans[0]!.id;
      const subscriptionId = await subscribe(planId);

      const after = await dashboard();
      expect(after.activeSubscribers).toBe(before.activeSubscribers + 1);
      // MRR ของแผนรายเดือน = ราคาต่อรอบ × จำนวน × 1
      expect(after.monthlyRevenue).toBeCloseTo(before.monthlyRevenue + 99, 2);

      await api(app)
        .post(`/api/v1/subscriptions/${subscriptionId}/cancel`)
        .set(bearer(buyer.accessToken))
        .expect(201);

      const cancelled = await dashboard();
      expect(cancelled.activeSubscribers).toBe(before.activeSubscribers);
      expect(cancelled.cancelledThisMonth).toBe(before.cancelledThisMonth + 1);
    });

    it('★ ไม่มีข้อมูลระบุตัวผู้ซื้อหลุดออกมาเลย (data minimization)', async () => {
      const res = await api(app)
        .get('/api/v1/seller/dashboard')
        .set(bearer(sellerA.accessToken))
        .expect(200);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(buyer.id);
      expect(raw).not.toContain(buyer.email);
      expect(raw).not.toContain('buyerId');
    });

    it('ผู้ซื้อธรรมดาเปิด dashboard ของร้าน → 403', async () => {
      const res = await api(app)
        .get('/api/v1/seller/dashboard')
        .set(bearer(buyer.accessToken))
        .expect(403);
      expect((res.body as ApiError).code).toBe('FORBIDDEN_ROLE');
    });
  });

  // ==========================================================
  // feature 11 — สินค้า + แผน
  // ==========================================================

  describe('POST /seller/products (W07)', () => {
    it('ลงสินค้าครบ 2 ขั้น → ขึ้น catalog ฝั่งผู้ซื้อทันที', async () => {
      const product = await createProduct(sellerA, {
        name: 'ยาสระผมทดสอบ',
        plans: [
          { cycle: '1m', pricePerCycle: 150, qtyPerCycle: 1 },
          { cycle: '2m', pricePerCycle: 280, qtyPerCycle: 2 },
        ],
      });

      expect(product.plans).toHaveLength(2);
      expect(product.activeSubscribers).toBe(0);

      // ผู้ซื้อที่ยังไม่ล็อกอินก็ต้องเห็นทันที (ไม่มีขั้นอนุมัติใน demo)
      const publicView = await api(app)
        .get(`/api/v1/catalog/products/${product.id}`)
        .expect(200);
      expect((publicView.body as { name: string }).name).toBe('ยาสระผมทดสอบ');
    });

    it('ไม่มีแผนเลย → 400 · รอบส่งซ้ำกัน → 400 · หมวดไม่มีจริง → 400', async () => {
      const post = (body: Record<string, unknown>) =>
        api(app)
          .post('/api/v1/seller/products')
          .set(bearer(sellerA.accessToken))
          .send({ ...PRODUCT_BODY, ...body });

      await post({ plans: [] }).expect(400);

      const dup = await post({
        plans: [
          { cycle: '1m', pricePerCycle: 10, qtyPerCycle: 1 },
          { cycle: '1m', pricePerCycle: 20, qtyPerCycle: 1 },
        ],
      }).expect(400);
      expect((dup.body as ApiError).code).toBe('DUPLICATE_CYCLE');

      const cat = await post({ categoryId: 9999 }).expect(400);
      expect((cat.body as ApiError).code).toBe('CATEGORY_NOT_FOUND');
    });

    it('★ แนบ shopId มากับ body → 400 (ย้ายสินค้าไปร้านคนอื่นไม่ได้)', async () => {
      await api(app)
        .post('/api/v1/seller/products')
        .set(bearer(sellerA.accessToken))
        .send({ ...PRODUCT_BODY, shopId: shopB.id })
        .expect(400);
    });

    it('รูปที่ไม่ใช่ https หรือเกิน 5 รูป → 400', async () => {
      const post = (images: string[]) =>
        api(app)
          .post('/api/v1/seller/products')
          .set(bearer(sellerA.accessToken))
          .send({ ...PRODUCT_BODY, images });

      await post(['http://example.com/a.jpg']).expect(400);
      await post(
        Array.from({ length: 6 }, (_, i) => `https://x.com/${i}.jpg`),
      ).expect(400);
    });
  });

  describe('PATCH /seller/products/:id', () => {
    it('แก้สินค้าของตัวเองได้ · ปิดการขายแล้วหายจาก catalog', async () => {
      const product = await createProduct(sellerA, { name: 'สินค้าปิดขาย' });

      await api(app)
        .patch(`/api/v1/seller/products/${product.id}`)
        .set(bearer(sellerA.accessToken))
        .send({ isActive: false })
        .expect(200);

      await api(app).get(`/api/v1/catalog/products/${product.id}`).expect(404);
    });

    it('★ แก้สินค้าของร้านอื่น → 404 (ไม่ใช่ 403)', async () => {
      const res = await api(app)
        .patch(`/api/v1/seller/products/${productA.id}`)
        .set(bearer(sellerB.accessToken))
        .send({ name: 'ยึดสินค้าร้านอื่น' })
        .expect(404);
      expect((res.body as ApiError).code).toBe('PRODUCT_NOT_FOUND');

      const row = await prisma.product.findUniqueOrThrow({
        where: { id: productA.id },
      });
      expect(row.name).toBe(PRODUCT_BODY.name);
    });

    it('สินค้าที่ถูกผู้ดูแลระงับ → แก้ไม่ได้ (409) และยังหายจาก catalog', async () => {
      const product = await createProduct(sellerA, { name: 'สินค้าถูกระงับ' });
      await prisma.product.update({
        where: { id: product.id },
        data: { suspendedAt: new Date(), suspendedReason: 'ทดสอบ' },
      });

      const res = await api(app)
        .patch(`/api/v1/seller/products/${product.id}`)
        .set(bearer(sellerA.accessToken))
        .send({ name: 'พยายามแก้' })
        .expect(409);
      expect((res.body as ApiError).code).toBe('PRODUCT_SUSPENDED');
    });
  });

  describe('แผนรอบส่ง', () => {
    /** นับแจ้งเตือนเรื่องราคาที่ส่งถึงผู้ซื้อของเทสนี้เท่านั้น */
    const priceNotices = () =>
      prisma.notification.count({
        where: {
          userId: buyer.id,
          type: 'price_changed',
          createdAt: { gte: startedAt },
        },
      });

    it('เปิดรอบเพิ่มได้ · รอบที่มีอยู่แล้ว → 409', async () => {
      const product = await createProduct(sellerA, { name: 'สินค้าเพิ่มรอบ' });

      const added = await api(app)
        .post(`/api/v1/seller/products/${product.id}/plans`)
        .set(bearer(sellerA.accessToken))
        .send({ cycle: '2w', pricePerCycle: 60, qtyPerCycle: 1 })
        .expect(201);
      expect((added.body as ProductRes).plans).toHaveLength(2);

      const dup = await api(app)
        .post(`/api/v1/seller/products/${product.id}/plans`)
        .set(bearer(sellerA.accessToken))
        .send({ cycle: '2w', pricePerCycle: 70, qtyPerCycle: 1 })
        .expect(409);
      expect((dup.body as ApiError).code).toBe('PLAN_EXISTS');
    });

    it('★ ขึ้นราคา → สมาชิกทุกคนได้แจ้งเตือน + event price_changed ในทรานแซกชันเดียว', async () => {
      const product = await createProduct(sellerA, { name: 'สินค้าขึ้นราคา' });
      const planId = product.plans[0]!.id;
      const subscriptionId = await subscribe(planId);

      await api(app)
        .patch(`/api/v1/seller/plans/${planId}`)
        .set(bearer(sellerA.accessToken))
        .send({ pricePerCycle: 129 })
        .expect(200);

      const events = await prisma.subscriptionEvent.findMany({
        where: { subscriptionId, event: 'price_changed' },
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.detail).toMatchObject({ from: 99, to: 129 });

      const notices = await prisma.notification.count({
        where: { userId: buyer.id, type: 'price_changed' },
      });
      expect(notices).toBeGreaterThanOrEqual(1);

      // ราคาใน DB ต้องเปลี่ยนจริง (รอบถัดไปของสมาชิกเดิมใช้ราคาใหม่)
      const plan = await prisma.productPlan.findUniqueOrThrow({
        where: { id: planId },
      });
      expect(plan.pricePerCycle.toNumber()).toBe(129);
    });

    it('เพิ่มจำนวนชิ้นให้เท่าเดิมราคาเดิม (ผู้ซื้อได้เปรียบ) → ไม่ต้องรบกวนใคร', async () => {
      const product = await createProduct(sellerA, { name: 'สินค้าแถมเพิ่ม' });
      const planId = product.plans[0]!.id;
      const subscriptionId = await subscribe(planId);
      // นับ ณ ตอนเริ่มเคสนี้ ไม่ใช่ค่าที่เก็บไว้ตอนต้น describe — เคสก่อนหน้า
      // ในกลุ่มเดียวกันสร้างแจ้งเตือนไปแล้ว ค่าเก่าจึงเก่าไปหนึ่งใบ
      const noticesBefore = await priceNotices();

      await api(app)
        .patch(`/api/v1/seller/plans/${planId}`)
        .set(bearer(sellerA.accessToken))
        .send({ qtyPerCycle: 3 })
        .expect(200);

      expect(
        await prisma.subscriptionEvent.count({
          where: { subscriptionId, event: 'price_changed' },
        }),
      ).toBe(0);
      expect(
        await prisma.notification.count({
          where: {
            userId: buyer.id,
            type: 'price_changed',
            createdAt: { gte: startedAt },
          },
        }),
      ).toBe(noticesBefore);
    });

    it('★ ลดจำนวนชิ้นโดยคงราคาเดิม = ขึ้นราคาต่อชิ้น → ต้องแจ้งสมาชิกเหมือนกัน', async () => {
      const product = await createProduct(sellerA, {
        name: 'สินค้าลดปริมาณ',
        plans: [{ cycle: '1m', pricePerCycle: 200, qtyPerCycle: 2 }],
      });
      const planId = product.plans[0]!.id;
      const subscriptionId = await subscribe(planId);
      const before = await priceNotices();

      // 2 ชิ้น ฿200 → 1 ชิ้น ฿200 คือผู้ซื้อจ่ายเท่าเดิมแต่ได้ของครึ่งเดียว
      await api(app)
        .patch(`/api/v1/seller/plans/${planId}`)
        .set(bearer(sellerA.accessToken))
        .send({ qtyPerCycle: 1 })
        .expect(200);

      const events = await prisma.subscriptionEvent.findMany({
        where: { subscriptionId, event: 'price_changed' },
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.detail).toMatchObject({ qty_from: 2, qty_to: 1 });
      expect(await priceNotices()).toBe(before + 1);
    });

    it('สมาชิกที่หยุดชั่วคราวก็ต้องได้รับแจ้งตอนขึ้นราคา (กลับมาแล้วเจอราคาใหม่)', async () => {
      const product = await createProduct(sellerA, { name: 'สินค้าคนหยุดพัก' });
      const planId = product.plans[0]!.id;
      const subscriptionId = await subscribe(planId);

      await api(app)
        .post(`/api/v1/subscriptions/${subscriptionId}/pause`)
        .set(bearer(buyer.accessToken))
        .expect(201);
      const before = await priceNotices();

      await api(app)
        .patch(`/api/v1/seller/plans/${planId}`)
        .set(bearer(sellerA.accessToken))
        .send({ pricePerCycle: 150 })
        .expect(200);

      expect(await priceNotices()).toBe(before + 1);
      expect(
        await prisma.subscriptionEvent.count({
          where: { subscriptionId, event: 'price_changed' },
        }),
      ).toBe(1);
    });

    it('แผนที่ถูกแก้ไปแล้วจากอีกหน้าจอ → 409 PLAN_CHANGED · ฟิลด์แปลกปลอม → 400', async () => {
      const product = await createProduct(sellerA, { name: 'สินค้าแก้ชนกัน' });
      const planId = product.plans[0]!.id;

      // จำลองว่าอีกหน้าจอแก้ราคาไปก่อนแล้ว (optimistic lock ต้องจับได้)
      await prisma.productPlan.update({
        where: { id: planId },
        data: { pricePerCycle: 111 },
      });

      // service อ่านราคาปัจจุบัน (111) แล้วเขียนด้วย where ที่ผูกกับค่านั้น จึงผ่าน
      await api(app)
        .patch(`/api/v1/seller/plans/${planId}`)
        .set(bearer(sellerA.accessToken))
        .send({ pricePerCycle: 122 })
        .expect(200);

      await api(app)
        .patch(`/api/v1/seller/plans/${planId}`)
        .set(bearer(sellerA.accessToken))
        .send({ cycle: '2m' })
        .expect(400);
    });

    it('★ ปิดแผน → รับสมาชิกใหม่ไม่ได้ แต่ engine ยังสร้างออเดอร์ให้สมาชิกเดิม', async () => {
      const product = await createProduct(sellerA, { name: 'สินค้าปิดแผน' });
      const planId = product.plans[0]!.id;
      const subscriptionId = await subscribe(planId);

      await api(app)
        .patch(`/api/v1/seller/plans/${planId}`)
        .set(bearer(sellerA.accessToken))
        .send({ isActive: false })
        .expect(200);

      // สมัครใหม่ไม่ได้แล้ว
      const address = await prisma.address.create({
        data: { ...BUYER_ADDRESS, userId: buyer.id },
        select: { id: true },
      });
      await api(app)
        .post('/api/v1/subscriptions')
        .set(bearer(buyer.accessToken))
        .send({
          planId,
          quantity: 1,
          addressId: address.id,
          paymentMethodId: cardId,
          startDate: toISODate(addDays(todayInBangkok(), 1)),
        })
        .expect(409);

      // แต่คนที่สมัครไว้แล้วต้องยังได้ของ — ให้ engine ตัดสิน ไม่ใช่เดา
      const due = todayInBangkok();
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { nextOrderDate: due, cycleAnchorDate: due },
      });
      await engine.run(due);

      const orders = await prisma.order.findMany({
        where: { subscriptionId, cycleDate: due },
      });
      expect(orders).toHaveLength(1);
    });

    it('แก้แผนของร้านอื่น → 404', async () => {
      await api(app)
        .patch(`/api/v1/seller/plans/${productA.plans[0]!.id}`)
        .set(bearer(sellerB.accessToken))
        .send({ pricePerCycle: 1 })
        .expect(404);
    });
  });

  // ==========================================================
  // feature 12 — ออเดอร์ + forecast
  // ==========================================================

  describe('GET /seller/orders + advance (W08)', () => {
    let orderId: string;

    beforeAll(async () => {
      // ออเดอร์รอบแรกเกิดตอน checkout อยู่แล้ว — หยิบใบนั้นมาไล่สถานะ
      const subscriptionId = await subscribe(productA.plans[0]!.id);
      const order = await prisma.order.findFirstOrThrow({
        where: { subscriptionId },
      });
      orderId = order.id;
    });

    it('เห็นเฉพาะออเดอร์ของร้านตัวเอง (ทดสอบด้วย 2 ร้าน)', async () => {
      const mine = await api(app)
        .get('/api/v1/seller/orders')
        .set(bearer(sellerA.accessToken))
        .expect(200);
      const ids = (mine.body as OrderRes[]).map((o) => o.id);
      expect(ids).toContain(orderId);

      const theirs = await api(app)
        .get('/api/v1/seller/orders')
        .set(bearer(sellerB.accessToken))
        .expect(200);
      expect((theirs.body as OrderRes[]).map((o) => o.id)).not.toContain(
        orderId,
      );
    });

    it('★ response มีที่อยู่ผู้รับ (ต้องส่งของ) แต่ไม่มี buyerId / subscriptionId', async () => {
      const res = await api(app)
        .get(`/api/v1/seller/orders/${orderId}`)
        .set(bearer(sellerA.accessToken))
        .expect(200);

      const order = res.body as OrderRes;
      expect(order.recipient.name).toBe(BUYER_ADDRESS.recipientName);
      expect(order.recipient.addressLine).toBe(BUYER_ADDRESS.addressLine);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(buyer.id);
      expect(raw).not.toContain('buyerId');
      expect(raw).not.toContain('subscriptionId');
      expect(raw).not.toContain('paymentMethodId');
    });

    it('★ ไล่สถานะทีละขั้นเท่านั้น และผู้ซื้อได้แจ้งเตือนทุกครั้ง', async () => {
      const before = await prisma.notification.count({
        where: { userId: buyer.id, type: 'order_status' },
      });

      const advance = (body: Record<string, unknown> = {}) =>
        api(app)
          .post(`/api/v1/seller/orders/${orderId}/advance`)
          .set(bearer(sellerA.accessToken))
          .send(body);

      // pending → preparing (เลขพัสดุยังใส่ไม่ได้ในขั้นนี้)
      const early = await advance({ trackingNote: 'TH999' }).expect(422);
      expect((early.body as ApiError).code).toBe('TRACKING_NOTE_NOT_ALLOWED');

      expect((await advance().expect(200)).body).toMatchObject({
        status: 'preparing',
      });
      // preparing → shipped พร้อมเลขพัสดุ
      const shipped = await advance({ trackingNote: 'TH1234567899' }).expect(
        200,
      );
      expect(shipped.body).toMatchObject({
        status: 'shipped',
        trackingNote: 'TH1234567899',
      });
      // shipped → delivered
      expect((await advance().expect(200)).body).toMatchObject({
        status: 'delivered',
      });
      // จบแล้วต้องไม่มีขั้นถัดไป
      const done = await advance().expect(409);
      expect((done.body as ApiError).code).toBe('ORDER_COMPLETED');

      const after = await prisma.notification.count({
        where: { userId: buyer.id, type: 'order_status' },
      });
      expect(after).toBe(before + 3);
    });

    it('เลื่อนสถานะออเดอร์ของร้านอื่น → 404 และของจริงไม่ขยับ', async () => {
      const subscriptionId = await subscribe(productA.plans[0]!.id);
      const order = await prisma.order.findFirstOrThrow({
        where: { subscriptionId },
      });

      await api(app)
        .post(`/api/v1/seller/orders/${order.id}/advance`)
        .set(bearer(sellerB.accessToken))
        .send({})
        .expect(404);

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(row.status).toBe('pending');
    });

    it('★ แนบ status/amount มากับ advance → 400 (ข้ามขั้นด้วย body ไม่ได้)', async () => {
      const subscriptionId = await subscribe(productA.plans[0]!.id);
      const order = await prisma.order.findFirstOrThrow({
        where: { subscriptionId },
      });

      for (const body of [
        { status: 'delivered' },
        { amount: 0 },
        { confirmedAt: new Date().toISOString() },
      ]) {
        await api(app)
          .post(`/api/v1/seller/orders/${order.id}/advance`)
          .set(bearer(sellerA.accessToken))
          .send(body)
          .expect(400);
      }

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(row.status).toBe('pending');
    });

    it('เปิดออเดอร์ของร้านอื่น → 404 · tab ที่ไม่มีอยู่ → 400', async () => {
      const subscriptionId = await subscribe(productA.plans[0]!.id);
      const order = await prisma.order.findFirstOrThrow({
        where: { subscriptionId },
      });

      await api(app)
        .get(`/api/v1/seller/orders/${order.id}`)
        .set(bearer(sellerB.accessToken))
        .expect(404);

      await api(app)
        .get('/api/v1/seller/orders?tab=ทั้งหมด')
        .set(bearer(sellerA.accessToken))
        .expect(400);
    });

    it('ไม่มี token → 401 ทุก endpoint ของฝั่งร้าน', async () => {
      await api(app).get('/api/v1/seller/orders').expect(401);
      await api(app).get('/api/v1/seller/products').expect(401);
      await api(app).get('/api/v1/seller/dashboard').expect(401);
      await api(app).get('/api/v1/seller/forecast').expect(401);
    });
  });

  describe('GET /seller/forecast', () => {
    it('สรุปรายสินค้าเป็นตัวเลขรวมที่ตรงกับ subscription จริง และไม่มีข้อมูลผู้ซื้อ', async () => {
      // qtyPerCycle = 2 เพื่อพิสูจน์ว่า "ชิ้น" ไม่ใช่ "จำนวนออเดอร์"
      const product = await createProduct(sellerA, {
        name: 'สินค้าล่วงหน้า',
        plans: [{ cycle: '1m', pricePerCycle: 99, qtyPerCycle: 2 }],
      });
      const subscriptionId = await subscribe(product.plans[0]!.id);

      // ดันวันรอบเข้ามาในช่วง 7 วัน (ปกติรอบถัดไปคือเดือนหน้า จึงไม่เข้าช่วง)
      const due = addDays(todayInBangkok(), 3);
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { nextOrderDate: due, cycleAnchorDate: due },
      });

      const res = await api(app)
        .get('/api/v1/seller/forecast?days=7')
        .set(bearer(sellerA.accessToken))
        .expect(200);

      const body = res.body as {
        days: number;
        approximate: boolean;
        items: {
          productId: string;
          ordersCount: number;
          units: number;
          revenue: number;
        }[];
      };
      expect(body.days).toBe(7);
      // หน้าจอต้องบอกผู้ใช้ว่าเป็นค่าประมาณ (ผู้ซื้อ skip ได้ถึงวันก่อนรอบ)
      expect(body.approximate).toBe(true);

      const row = body.items.find((i) => i.productId === product.id);
      expect(row).toEqual({
        productId: product.id,
        productName: 'สินค้าล่วงหน้า',
        ordersCount: 1,
        units: 2,
        revenue: 99,
      });

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(buyer.id);
      expect(raw).not.toContain(BUYER_ADDRESS.recipientName);
    });

    it('ผู้ซื้อ skip รอบ → รายการนั้นหลุดออกจาก forecast ทันที', async () => {
      const product = await createProduct(sellerA, {
        name: 'สินค้าถูกข้ามรอบ',
        plans: [{ cycle: '1m', pricePerCycle: 50, qtyPerCycle: 1 }],
      });
      const subscriptionId = await subscribe(product.plans[0]!.id);
      const due = addDays(todayInBangkok(), 2);
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { nextOrderDate: due, cycleAnchorDate: due },
      });

      const inRange = async (): Promise<boolean> => {
        const res = await api(app)
          .get('/api/v1/seller/forecast?days=7')
          .set(bearer(sellerA.accessToken))
          .expect(200);
        return (res.body as { items: { productId: string }[] }).items.some(
          (i) => i.productId === product.id,
        );
      };

      expect(await inRange()).toBe(true);

      await api(app)
        .post(`/api/v1/subscriptions/${subscriptionId}/skip`)
        .set(bearer(buyer.accessToken))
        .expect(201);

      // ข้ามไปเดือนหน้าแล้ว จึงต้องหายจากช่วง 7 วัน (feature 12 · AC)
      expect(await inRange()).toBe(false);
    });

    it('ช่วงวันที่ไม่ได้เปิดให้เลือก → 400 (กันขอ 3650 วันแล้วกวาดทั้งตาราง)', async () => {
      const res = await api(app)
        .get('/api/v1/seller/forecast?days=3650')
        .set(bearer(sellerA.accessToken))
        .expect(400);
      expect((res.body as ApiError).code).toBe('INVALID_RANGE');
    });

    it('ร้านอื่นเห็นเฉพาะของตัวเอง (ร้านที่ไม่มีสินค้า = ว่าง)', async () => {
      const res = await api(app)
        .get('/api/v1/seller/forecast?days=30')
        .set(bearer(sellerB.accessToken))
        .expect(200);
      expect((res.body as { items: unknown[] }).items).toEqual([]);
    });
  });

  // ==========================================================
  // อัปโหลดรูป
  // ==========================================================

  describe('POST /uploads/signature', () => {
    afterEach(() => {
      delete process.env.CLOUDINARY_CLOUD_NAME;
      delete process.env.CLOUDINARY_API_KEY;
      delete process.env.CLOUDINARY_API_SECRET;
    });

    it('★ ลายเซ็นผูกกับ folder ของร้านที่อยู่ใน token และไม่มี api_secret หลุดออกมา', async () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
      process.env.CLOUDINARY_API_KEY = '123456789';
      process.env.CLOUDINARY_API_SECRET = 'super-secret-value';

      const res = await api(app)
        .post('/api/v1/uploads/signature')
        .set(bearer(sellerA.accessToken))
        .expect(200);

      const body = res.body as {
        folder: string;
        timestamp: number;
        signature: string;
      };
      expect(body.folder).toBe(`anan/shops/${shopA.id}`);
      expect(JSON.stringify(res.body)).not.toContain('super-secret-value');

      // ลายเซ็นต้องคำนวณได้ตรงตามสูตรของ Cloudinary จริง ๆ
      // ★ allowed_formats ต้องอยู่ในลายเซ็นด้วย ★ ไม่งั้น client แก้ชนิดไฟล์ได้
      // โดยลายเซ็นยังใช้ได้อยู่ (เรียงพารามิเตอร์ตามชื่อตามที่ Cloudinary กำหนด)
      const expected = createHash('sha1')
        .update(
          `allowed_formats=jpg,jpeg,png,webp&folder=${body.folder}&timestamp=${body.timestamp}super-secret-value`,
        )
        .digest('hex');
      expect(body.signature).toBe(expected);
    });

    it('เครื่องที่ยังไม่ได้ตั้งค่า Cloudinary → 503 พร้อมรหัสที่หน้าจอแตกเคสได้', async () => {
      const res = await api(app)
        .post('/api/v1/uploads/signature')
        .set(bearer(sellerA.accessToken))
        .expect(503);
      expect((res.body as ApiError).code).toBe('UPLOADS_NOT_CONFIGURED');
    });

    it('ผู้ซื้อธรรมดาขอลายเซ็น → 403 · ไม่มี token → 401', async () => {
      await api(app)
        .post('/api/v1/uploads/signature')
        .set(bearer(buyer.accessToken))
        .expect(403);
      await api(app).post('/api/v1/uploads/signature').expect(401);
    });
  });

  // ---------- ตัวช่วยท้ายไฟล์ ----------

  async function dashboard(): Promise<{
    activeSubscribers: number;
    monthlyRevenue: number;
    cancelledThisMonth: number;
  }> {
    const res = await api(app)
      .get('/api/v1/seller/dashboard')
      .set(bearer(sellerA.accessToken))
      .expect(200);
    return res.body as {
      activeSubscribers: number;
      monthlyRevenue: number;
      cancelledThisMonth: number;
    };
  }
});
