import { INestApplication } from '@nestjs/common';
import { addDays, toISODate, todayInBangkok } from '../src/common/date';
import { EngineService } from '../src/engine/engine.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEMO_DECLINE_LAST4 } from '../src/payments/demo-payment.provider';
import { api, ApiError, createTestApp } from './utils/app';
import { cardBody } from './utils/card';
import {
  bearer,
  cleanupTestUsers,
  registerTestUser,
  type TestUser,
} from './utils/auth';

const PRODUCT_BODY = {
  name: 'สินค้าเทสการจ่ายเงิน',
  categoryId: 1,
  images: ['https://example.com/pay.jpg'],
  oneTimePrice: 200,
  plans: [{ cycle: '1m', pricePerCycle: 120, qtyPerCycle: 1 }],
};

const ADDRESS = {
  recipientName: 'ผู้รับ การจ่ายเงิน',
  phone: '0812345678',
  addressLine: '9 ถนนทดสอบ',
  province: 'กรุงเทพมหานคร',
  postcode: '10900',
};

interface BuyerOrder {
  id: string;
  status: string;
  paymentStatus: string | null;
  paidAt: string | null;
  receiptNo: string | null;
}

/**
 * Phase 5 — การจ่ายเงินจำลอง (feature 09)
 *
 * คำถามที่ไฟล์นี้ต้องตอบ:
 *   1. บัตรที่ถูกปฏิเสธทำให้ checkout **ไม่เหลือเศษข้อมูล** ไว้เลยจริงไหม
 *   2. รอบที่ engine ตัดเงินไม่ผ่าน ออเดอร์ยังอยู่ให้จ่ายซ้ำ แต่ **ร้านต้องยังไม่เห็น**
 *   3. จ่ายซ้ำสำเร็จแล้วร้านถึงจะเห็นและจัดของได้
 *   4. ใบเสร็จจำลองออกได้เฉพาะรอบที่จ่ายสำเร็จ และเลขที่คงที่
 */
describe('Phase 5 — ตัดเงินจำลอง จ่ายไม่ผ่าน และจ่ายซ้ำ', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let engine: EngineService;

  let buyer: TestUser;
  let other: TestUser;
  let seller: TestUser;
  let shopId: string;
  let planId: string;
  /** บัตรปกติ (ผ่านเสมอ) กับบัตรจำลองที่ถูกปฏิเสธเสมอ */
  let goodCardId: string;
  let badCardId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    engine = app.get(EngineService);
    await cleanupTestUsers(prisma);

    buyer = await registerTestUser(app, 'pay-buyer');
    other = await registerTestUser(app, 'pay-other');
    seller = await registerTestUser(app, 'pay-seller');

    const shop = await api(app)
      .post('/api/v1/seller/shop')
      .set(bearer(seller.accessToken))
      .send({ name: 'ร้านทดสอบการจ่ายเงิน' })
      .expect(201);
    shopId = (shop.body as { id: string }).id;

    const product = await api(app)
      .post('/api/v1/seller/products')
      .set(bearer(seller.accessToken))
      .send(PRODUCT_BODY)
      .expect(201);
    planId = (product.body as { plans: { id: string }[] }).plans[0]!.id;

    const good = await api(app)
      .post('/api/v1/me/payment-methods')
      .set(bearer(buyer.accessToken))
      .send(cardBody())
      .expect(201);
    goodCardId = (good.body as { id: string }).id;

    const bad = await api(app)
      .post('/api/v1/me/payment-methods')
      .set(bearer(buyer.accessToken))
      .send(cardBody({ last4: DEMO_DECLINE_LAST4 }))
      .expect(201);
    badCardId = (bad.body as { id: string }).id;
  });

  afterAll(async () => {
    if (prisma) {
      await cleanupTestUsers(prisma);
      await prisma.productPlan.deleteMany({
        where: { product: { shopId } },
      });
      await prisma.product.deleteMany({ where: { shopId } });
      await prisma.shop.deleteMany({ where: { ownerId: seller?.id } });
    }
    if (app) await app.close();
  });

  /**
   * สมัคร 1 รายการด้วยบัตรที่ระบุ แล้วยืนยัน status ที่คาดไว้
   *
   * รับ status เข้ามาเพราะไฟล์นี้ใช้ทั้งเส้นทางที่สำเร็จ (201) และเส้นทางที่
   * บัตรถูกปฏิเสธ (402) — ที่อยู่สร้างใหม่ทุกครั้งเพราะกฎกันสมัครซ้ำคือ
   * "แผนเดิม + ที่อยู่เดิม" (เพดาน 20 ที่อยู่ต่อบัญชีเพียงพอสำหรับไฟล์นี้)
   */
  async function subscribeWith(
    cardId: string,
    status: number,
    startOffset = 1,
  ) {
    const address = await prisma.address.create({
      data: { ...ADDRESS, userId: buyer.id },
      select: { id: true },
    });
    return api(app)
      .post('/api/v1/subscriptions')
      .set(bearer(buyer.accessToken))
      .send({
        planId,
        quantity: 1,
        addressId: address.id,
        paymentMethodId: cardId,
        startDate: toISODate(addDays(todayInBangkok(), startOffset)),
      })
      .expect(status);
  }

  // ==========================================================
  // checkout — บัตรถูกปฏิเสธต้องไม่เหลือเศษข้อมูล
  // ==========================================================

  describe('POST /subscriptions (ตัดเงินรอบแรก)', () => {
    it('★ บัตรถูกปฏิเสธ → 402 และไม่มี subscription/order/payment เกิดขึ้นเลย', async () => {
      const before = await prisma.subscription.count({
        where: { buyerId: buyer.id },
      });

      const res = await subscribeWith(badCardId, 402);
      expect((res.body as ApiError).code).toBe('PAYMENT_FAILED');

      // ★ ทั้งก้อน rollback ★ ไม่มีสมาชิกที่ไม่เคยจ่ายรอบไหนสำเร็จค้างอยู่
      expect(
        await prisma.subscription.count({ where: { buyerId: buyer.id } }),
      ).toBe(before);
      expect(
        await prisma.order.count({
          where: { buyerId: buyer.id, payment: { is: null } },
        }),
      ).toBe(0);
    });

    it('บัตรปกติ → payment เป็น paid และใบเสร็จมีเลขที่', async () => {
      const res = await subscribeWith(goodCardId, 201);
      const orderId = (res.body as { firstOrder: { id: string } }).firstOrder
        .id;

      const detail = await api(app)
        .get(`/api/v1/orders/${orderId}`)
        .set(bearer(buyer.accessToken))
        .expect(200);
      const order = detail.body as BuyerOrder;
      expect(order.paymentStatus).toBe('paid');
      expect(order.paidAt).not.toBeNull();
      expect(order.receiptNo).toMatch(/^RC-[0-9A-F]{8}$/);

      // เลขที่ใบเสร็จต้องคงที่ — เปิดดูซ้ำต้องได้ใบเดิม ไม่ใช่เลขใหม่ทุกครั้ง
      const again = await api(app)
        .get(`/api/v1/orders/${orderId}`)
        .set(bearer(buyer.accessToken))
        .expect(200);
      expect((again.body as BuyerOrder).receiptNo).toBe(order.receiptNo);
    });
  });

  // ==========================================================
  // engine — รอบถัดไปที่ตัดเงินไม่ผ่าน
  // ==========================================================

  describe('engine + จ่ายซ้ำ', () => {
    let orderId = '';
    let subscriptionId = '';

    it('★ รอบถัดไปตัดเงินไม่ผ่าน → ออเดอร์ยังอยู่ · payment failed · ผู้ซื้อได้แจ้งเตือน', async () => {
      // สมัครด้วยบัตรปกติก่อน (รอบแรกต้องผ่าน) แล้วค่อยสลับเป็นบัตรที่ถูกปฏิเสธ
      const res = await subscribeWith(goodCardId, 201);
      subscriptionId = (res.body as { subscription: { id: string } })
        .subscription.id;
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          paymentMethodId: badCardId,
          // ต้องขยับหมุดมาด้วย — CHECK `subs_anchor_not_after_next` ห้ามให้หมุด
          // อยู่หลังวันรอบถัดไป (หมุดคือจุดตั้งต้นของกริด ไม่ใช่ค่าอิสระ)
          cycleAnchorDate: todayInBangkok(),
          nextOrderDate: todayInBangkok(),
        },
      });

      const result = await engine.run(todayInBangkok());
      expect(result.detail.paymentsFailed).toBeGreaterThanOrEqual(1);

      const order = await prisma.order.findFirstOrThrow({
        where: { subscriptionId, cycleDate: todayInBangkok() },
        include: { payment: true },
      });
      orderId = order.id;
      expect(order.status).toBe('pending');
      expect(order.payment?.status).toBe('failed');
      // CHECK `payments_lifecycle` บังคับไว้แล้วว่า failed ต้องไม่มีเวลาจ่าย
      expect(order.payment?.paidAt).toBeNull();

      expect(
        await prisma.notification.count({
          where: { userId: buyer.id, linkPath: `/orders/${orderId}` },
        }),
      ).toBeGreaterThanOrEqual(1);
    });

    it('★ ร้านยังไม่เห็นออเดอร์ที่จ่ายไม่สำเร็จ และกดเปลี่ยนสถานะไม่ได้', async () => {
      const list = await api(app)
        .get('/api/v1/seller/orders?tab=open')
        .set(bearer(seller.accessToken))
        .expect(200);
      expect((list.body as { id: string }[]).map((o) => o.id)).not.toContain(
        orderId,
      );

      // ซ่อนในรายการอย่างเดียวไม่พอ — ยิงตรงก็ต้องไม่ได้
      await api(app)
        .post(`/api/v1/seller/orders/${orderId}/advance`)
        .set(bearer(seller.accessToken))
        .send({})
        .expect(404);
    });

    it('ผู้ซื้อเห็นออเดอร์นั้นพร้อมสถานะจ่ายไม่สำเร็จ และยังไม่มีใบเสร็จ', async () => {
      const res = await api(app)
        .get(`/api/v1/orders/${orderId}`)
        .set(bearer(buyer.accessToken))
        .expect(200);
      const order = res.body as BuyerOrder;
      expect(order.paymentStatus).toBe('failed');
      expect(order.receiptNo).toBeNull();
      expect(order.paidAt).toBeNull();
    });

    it('จ่ายซ้ำด้วยบัตรที่ยังถูกปฏิเสธ → 402 และ payment ยังเป็น failed', async () => {
      const res = await api(app)
        .post(`/api/v1/orders/${orderId}/retry-payment`)
        .set(bearer(buyer.accessToken))
        .expect(402);
      expect((res.body as ApiError).code).toBe('PAYMENT_FAILED');

      const payment = await prisma.payment.findFirstOrThrow({
        where: { orderId },
      });
      expect(payment.status).toBe('failed');
    });

    it('ออเดอร์ของคนอื่น → 404 · ไม่มี token → 401', async () => {
      await api(app)
        .post(`/api/v1/orders/${orderId}/retry-payment`)
        .set(bearer(other.accessToken))
        .expect(404);
      await api(app)
        .post(`/api/v1/orders/${orderId}/retry-payment`)
        .expect(401);
    });

    it('★ เปลี่ยนบัตรแล้วจ่ายซ้ำสำเร็จ → payment paid · ร้านเห็นออเดอร์ · ร้านได้แจ้งเตือน', async () => {
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { paymentMethodId: goodCardId },
      });

      const res = await api(app)
        .post(`/api/v1/orders/${orderId}/retry-payment`)
        .set(bearer(buyer.accessToken))
        .expect(200);
      const order = res.body as BuyerOrder;
      expect(order.paymentStatus).toBe('paid');
      expect(order.receiptNo).not.toBeNull();

      const payment = await prisma.payment.findFirstOrThrow({
        where: { orderId },
      });
      expect(payment.status).toBe('paid');
      expect(payment.paidAt).not.toBeNull();

      const list = await api(app)
        .get('/api/v1/seller/orders?tab=open')
        .set(bearer(seller.accessToken))
        .expect(200);
      expect((list.body as { id: string }[]).map((o) => o.id)).toContain(
        orderId,
      );

      expect(
        await prisma.notification.count({
          where: { userId: seller.id, title: 'มีออเดอร์ใหม่ที่จ่ายเงินแล้ว' },
        }),
      ).toBeGreaterThanOrEqual(1);
    });

    it('จ่ายซ้ำอีกครั้งหลังจ่ายสำเร็จแล้ว → 409 (กันตัดเงินซ้ำ)', async () => {
      const res = await api(app)
        .post(`/api/v1/orders/${orderId}/retry-payment`)
        .set(bearer(buyer.accessToken))
        .expect(409);
      expect((res.body as ApiError).code).toBe('PAYMENT_NOT_RETRYABLE');

      expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
    });
  });
});
