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

const PRODUCT_BODY = {
  name: 'สินค้าเทสรอบส่ง',
  categoryId: 1,
  description: 'สำหรับ e2e ของ Phase 4.5',
  images: ['https://example.com/p.jpg'],
  oneTimePrice: 200,
  plans: [{ cycle: '1m', pricePerCycle: 150, qtyPerCycle: 1 }],
};

const ADDRESS = {
  recipientName: 'ผู้รับ ออเดอร์',
  phone: '0812345678',
  addressLine: '8 ถนนทดสอบ',
  province: 'กรุงเทพมหานคร',
  postcode: '10900',
};

interface BuyerOrder {
  id: string;
  status: string;
  confirmedAt: string | null;
  cancelReason: string | null;
  paymentStatus: string | null;
  refundedAt: string | null;
  subscriptionId: string;
  shipTo: { name: string; addressLine: string };
  issue: { id: string; status: string; resolutionNote: string | null } | null;
}

interface Review {
  id: string;
  rating: number;
  cyclesReceived: number;
  edited: boolean;
}

/**
 * Phase 4.5 — ความน่าเชื่อถือ (features 07 · 15 · 16 · 17)
 *
 * คำถามที่ไฟล์นี้ต้องตอบ:
 *   1. ทุกออเดอร์มีปลายทางเสมอไหม (delivered หรือ cancelled+คืนเงิน) — ไม่ค้าง pending ตลอดกาล
 *   2. **ร้านตั้ง `confirmed_at` แทนผู้ซื้อได้ไหม** (หัวใจของ trust gap ที่ feature 16 ปิด)
 *   3. ยกเลิกออเดอร์แล้วเงินคืนจริงไหม และ subscription ยังเดินต่อไหม
 *   4. รีวิวได้โดยไม่เคยรับของไหม · "รับมาแล้ว N รอบ" เชื่อได้ไหม
 *   5. ผู้ใช้คนอื่นอ่าน/ปิดเคสของเราได้ไหม
 */
describe('Phase 4.5 — ออเดอร์ ยืนยันรับของ เคสปัญหา รีวิว', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let engine: EngineService;

  let buyer: TestUser;
  let other: TestUser;
  let seller: TestUser;
  let seller2: TestUser;
  let shopId: string;
  let planId: string;
  let cardId: string;
  let startedAt: Date;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    engine = app.get(EngineService);
    await cleanupTestUsers(prisma);
    startedAt = new Date();

    buyer = await registerTestUser(app, 'ord-buyer');
    other = await registerTestUser(app, 'ord-other');
    seller = await registerTestUser(app, 'ord-seller');
    seller2 = await registerTestUser(app, 'ord-seller2');

    const shop = await api(app)
      .post('/api/v1/seller/shop')
      .set(bearer(seller.accessToken))
      .send({ name: 'ร้านทดสอบออเดอร์' })
      .expect(201);
    shopId = (shop.body as { id: string }).id;

    await api(app)
      .post('/api/v1/seller/shop')
      .set(bearer(seller2.accessToken))
      .send({ name: 'ร้านคนอื่น' })
      .expect(201);

    const product = await api(app)
      .post('/api/v1/seller/products')
      .set(bearer(seller.accessToken))
      .send(PRODUCT_BODY)
      .expect(201);
    planId = (product.body as { plans: { id: string }[] }).plans[0]!.id;

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
      await prisma.productPlan.deleteMany({
        where: { product: { shop: { ownerId: { in: [seller?.id] } } } },
      });
      await prisma.product.deleteMany({ where: { shopId } });
      await prisma.shop.deleteMany({
        where: { ownerId: { in: [seller?.id, seller2?.id] } },
      });
    }
    if (app) await app.close();
  });

  /** สมัคร 1 รายการแล้วคืนออเดอร์รอบแรกที่ checkout สร้างให้ */
  async function newOrder(): Promise<{
    orderId: string;
    subscriptionId: string;
  }> {
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
        startDate: toISODate(addDays(todayInBangkok(), 1)),
      })
      .expect(201);
    const body = res.body as {
      subscription: { id: string };
      firstOrder: { id: string };
    };
    return {
      orderId: body.firstOrder.id,
      subscriptionId: body.subscription.id,
    };
  }

  const advance = (orderId: string, trackingNote?: string) =>
    api(app)
      .post(`/api/v1/seller/orders/${orderId}/advance`)
      .set(bearer(seller.accessToken))
      .send(trackingNote === undefined ? {} : { trackingNote })
      .expect(200);

  /** ดันออเดอร์ไปจนถึงสถานะที่ต้องการผ่าน endpoint จริงของร้าน */
  async function shipOrder(orderId: string): Promise<void> {
    await advance(orderId);
    await advance(orderId, 'TH-TEST-001');
  }

  // ==========================================================
  // feature 07 — ประวัติออเดอร์
  // ==========================================================

  describe('GET /orders', () => {
    it('เห็นเฉพาะออเดอร์ของตัวเอง + ที่อยู่มาจาก snapshot ตอนสั่ง', async () => {
      const { orderId } = await newOrder();

      const mine = await api(app)
        .get('/api/v1/orders')
        .set(bearer(buyer.accessToken))
        .expect(200);
      const list = mine.body as BuyerOrder[];
      expect(list.map((o) => o.id)).toContain(orderId);
      expect(list[0]?.shipTo.name).toBe(ADDRESS.recipientName);

      const theirs = await api(app)
        .get('/api/v1/orders')
        .set(bearer(other.accessToken))
        .expect(200);
      expect((theirs.body as BuyerOrder[]).map((o) => o.id)).not.toContain(
        orderId,
      );
    });

    it('แท็บ "สำเร็จ" ไม่มีออเดอร์ที่ยังไม่ถึงมือ', async () => {
      const res = await api(app)
        .get('/api/v1/orders?tab=done')
        .set(bearer(buyer.accessToken))
        .expect(200);
      for (const order of res.body as BuyerOrder[]) {
        expect(['delivered', 'cancelled']).toContain(order.status);
      }
    });

    it('เปิดออเดอร์ของคนอื่น → 404 · ไม่มี token → 401', async () => {
      const { orderId } = await newOrder();
      await api(app)
        .get(`/api/v1/orders/${orderId}`)
        .set(bearer(other.accessToken))
        .expect(404);
      await api(app).get(`/api/v1/orders/${orderId}`).expect(401);
    });
  });

  // ==========================================================
  // feature 16 — ยืนยันรับของ + แจ้งปัญหา
  // ==========================================================

  describe('POST /orders/:id/confirm', () => {
    it('★ ยืนยันรับของ → confirmedAt ถูกตั้ง + สถานะเป็น delivered · กดซ้ำไม่ error', async () => {
      const { orderId } = await newOrder();
      await shipOrder(orderId);

      const first = await api(app)
        .post(`/api/v1/orders/${orderId}/confirm`)
        .set(bearer(buyer.accessToken))
        .expect(200);
      expect((first.body as BuyerOrder).status).toBe('delivered');
      expect((first.body as BuyerOrder).confirmedAt).not.toBeNull();

      // idempotent — กดซ้ำเพราะเน็ตช้าเป็นเรื่องปกติ ต้องไม่เด้ง error (W11 E3)
      const again = await api(app)
        .post(`/api/v1/orders/${orderId}/confirm`)
        .set(bearer(buyer.accessToken))
        .expect(200);
      expect((again.body as BuyerOrder).confirmedAt).toBe(
        (first.body as BuyerOrder).confirmedAt,
      );

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      expect(row.confirmedAt).not.toBeNull();
    });

    it('ยืนยันออเดอร์ที่ร้านยังไม่ส่ง → 409', async () => {
      const { orderId } = await newOrder();
      const res = await api(app)
        .post(`/api/v1/orders/${orderId}/confirm`)
        .set(bearer(buyer.accessToken))
        .expect(409);
      expect((res.body as ApiError).code).toBe('ORDER_NOT_SHIPPED');
    });

    it('★ ร้านตั้ง confirmedAt แทนผู้ซื้อไม่ได้เลยทุกช่องทาง (หัวใจของ feature 16)', async () => {
      const { orderId } = await newOrder();
      await shipOrder(orderId);
      const confirmedAt = new Date().toISOString();

      // ไม่มี endpoint ไหนของร้านรับฟิลด์นี้ — DTO ตัดทิ้งตั้งแต่ต้นทาง
      await api(app)
        .post(`/api/v1/seller/orders/${orderId}/advance`)
        .set(bearer(seller.accessToken))
        .send({ confirmedAt })
        .expect(400);

      // และยืนยันแทนผู้ซื้อผ่าน endpoint ของผู้ซื้อก็ไม่ได้ (ownership 404)
      await api(app)
        .post(`/api/v1/orders/${orderId}/confirm`)
        .set(bearer(seller.accessToken))
        .expect(404);

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      expect(row.confirmedAt).toBeNull();
    });

    it('ออเดอร์ของคนอื่น → 404', async () => {
      const { orderId } = await newOrder();
      await shipOrder(orderId);
      await api(app)
        .post(`/api/v1/orders/${orderId}/confirm`)
        .set(bearer(other.accessToken))
        .expect(404);
    });
  });

  describe('POST /orders/:id/issues + ตอบเคสฝั่งร้าน', () => {
    it('★ แจ้งปัญหา → ร้านได้แจ้งเตือนทันที และเคสโผล่ในรายการของร้าน', async () => {
      const { orderId } = await newOrder();
      await advance(orderId); // pending → preparing

      const before = await prisma.notification.count({
        where: { userId: seller.id, createdAt: { gte: startedAt } },
      });

      const res = await api(app)
        .post(`/api/v1/orders/${orderId}/issues`)
        .set(bearer(buyer.accessToken))
        .send({ type: 'not_received', detail: 'รอมา 5 วันแล้วยังไม่ได้ของ' })
        .expect(201);
      expect((res.body as BuyerOrder).issue?.status).toBe('open');

      expect(
        await prisma.notification.count({
          where: { userId: seller.id, createdAt: { gte: startedAt } },
        }),
      ).toBe(before + 1);

      const issues = await api(app)
        .get('/api/v1/seller/issues')
        .set(bearer(seller.accessToken))
        .expect(200);
      const rows = issues.body as { orderId: string; recipientName: string }[];
      expect(rows.map((i) => i.orderId)).toContain(orderId);
      // ร้านต้องรู้ว่าเป็นออเดอร์ของใครเพื่อตามเรื่อง แต่ไม่ต้องรู้ user id
      expect(rows[0]?.recipientName).toBe(ADDRESS.recipientName);
      expect(JSON.stringify(issues.body)).not.toContain(buyer.id);
    });

    it('แจ้งซ้ำบนออเดอร์เดิม → 409 (1 ออเดอร์ = 1 เคส)', async () => {
      const { orderId } = await newOrder();
      await advance(orderId);
      const body = { type: 'damaged', detail: 'กล่องบุบมาก ของข้างในแตก' };

      await api(app)
        .post(`/api/v1/orders/${orderId}/issues`)
        .set(bearer(buyer.accessToken))
        .send(body)
        .expect(201);

      const res = await api(app)
        .post(`/api/v1/orders/${orderId}/issues`)
        .set(bearer(buyer.accessToken))
        .send(body)
        .expect(409);
      expect((res.body as ApiError).code).toBe('ISSUE_EXISTS');
    });

    it('แจ้งปัญหาตอนร้านยังไม่เริ่มจัดของ → 409 · รายละเอียดสั้นเกิน → 400', async () => {
      const { orderId } = await newOrder();

      const early = await api(app)
        .post(`/api/v1/orders/${orderId}/issues`)
        .set(bearer(buyer.accessToken))
        .send({ type: 'other', detail: 'ยังไม่ได้ของเลย' })
        .expect(409);
      expect((early.body as ApiError).code).toBe('ORDER_NOT_STARTED');

      await advance(orderId);
      await api(app)
        .post(`/api/v1/orders/${orderId}/issues`)
        .set(bearer(buyer.accessToken))
        .send({ type: 'other', detail: 'สั้น' })
        .expect(400);
      // ประเภทที่ไม่มีในระบบก็ต้องไม่ผ่าน
      await api(app)
        .post(`/api/v1/orders/${orderId}/issues`)
        .set(bearer(buyer.accessToken))
        .send({ type: 'ของหาย', detail: 'รายละเอียดยาวพอ' })
        .expect(400);
    });

    it('★ ร้านตอบเคส → ผู้ซื้อได้แจ้งเตือน + เห็นหมายเหตุ · ปิดซ้ำไม่ได้', async () => {
      const { orderId } = await newOrder();
      await advance(orderId);
      await api(app)
        .post(`/api/v1/orders/${orderId}/issues`)
        .set(bearer(buyer.accessToken))
        .send({ type: 'wrong_item', detail: 'ได้กลิ่นอื่นที่ไม่ได้สั่ง' })
        .expect(201);

      const issue = await prisma.orderIssue.findFirstOrThrow({
        where: { orderId },
      });
      const before = await prisma.notification.count({
        where: { userId: buyer.id, createdAt: { gte: startedAt } },
      });

      const resolved = await api(app)
        .post(`/api/v1/seller/issues/${issue.id}/resolve`)
        .set(bearer(seller.accessToken))
        .send({ status: 'resolved', note: 'ส่งของถูกต้องไปให้ใหม่แล้ววันนี้' })
        .expect(200);
      expect((resolved.body as { status: string }).status).toBe('resolved');

      expect(
        await prisma.notification.count({
          where: { userId: buyer.id, createdAt: { gte: startedAt } },
        }),
      ).toBe(before + 1);

      // ผู้ซื้อเห็นผลบนออเดอร์ของตัวเอง
      const order = await api(app)
        .get(`/api/v1/orders/${orderId}`)
        .set(bearer(buyer.accessToken))
        .expect(200);
      expect((order.body as BuyerOrder).issue?.resolutionNote).toContain(
        'ส่งของถูกต้อง',
      );

      const twice = await api(app)
        .post(`/api/v1/seller/issues/${issue.id}/resolve`)
        .set(bearer(seller.accessToken))
        .send({ status: 'rejected', note: 'พยายามปิดซ้ำ' })
        .expect(409);
      expect((twice.body as ApiError).code).toBe('ISSUE_CLOSED');
    });

    it('ร้านอื่นปิดเคสของร้านเรา → 404 และเคสยังเปิดอยู่', async () => {
      const { orderId } = await newOrder();
      await advance(orderId);
      await api(app)
        .post(`/api/v1/orders/${orderId}/issues`)
        .set(bearer(buyer.accessToken))
        .send({ type: 'not_received', detail: 'ของยังไม่ถึงเลยครับ' })
        .expect(201);
      const issue = await prisma.orderIssue.findFirstOrThrow({
        where: { orderId },
      });

      await api(app)
        .post(`/api/v1/seller/issues/${issue.id}/resolve`)
        .set(bearer(seller2.accessToken))
        .send({ status: 'resolved', note: 'ปิดเคสร้านคนอื่น' })
        .expect(404);

      const row = await prisma.orderIssue.findUniqueOrThrow({
        where: { id: issue.id },
      });
      expect(row.status).toBe('open');
    });
  });

  // ==========================================================
  // feature 15 — ร้านยกเลิก + คืนเงินจำลอง
  // ==========================================================

  describe('POST /seller/orders/:id/cancel', () => {
    it('★ ยกเลิก → คืนเงินจำลอง + event + แจ้งผู้ซื้อ ในทรานแซกชันเดียว', async () => {
      const { orderId, subscriptionId } = await newOrder();
      const subBefore = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });

      const res = await api(app)
        .post(`/api/v1/seller/orders/${orderId}/cancel`)
        .set(bearer(seller.accessToken))
        .send({ reason: 'ของหมดสต๊อกกะทันหัน ขออภัยครับ' })
        .expect(200);
      expect((res.body as { status: string }).status).toBe('cancelled');

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { payment: true },
      });
      expect(order.status).toBe('cancelled');
      expect(order.cancelledAt).not.toBeNull();
      expect(order.cancelReason).toContain('ของหมดสต๊อก');
      // ★ เงินต้องคืนจริง ไม่ใช่แค่เปลี่ยนสถานะออเดอร์ ★
      expect(order.payment?.status).toBe('refunded');
      expect(order.payment?.refundedAt).not.toBeNull();

      expect(
        await prisma.subscriptionEvent.count({
          where: { subscriptionId, event: 'order_cancelled' },
        }),
      ).toBe(1);
      expect(
        await prisma.notification.count({
          where: {
            userId: buyer.id,
            linkPath: `/orders/${orderId}`,
            createdAt: { gte: startedAt },
          },
        }),
      ).toBeGreaterThanOrEqual(1);

      // ★ subscription ต้องไม่ถูกแตะ ★ ปัญหาสต๊อกรอบเดียวไม่ควรทำให้เสียทั้งสาย
      const subAfter = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      expect(subAfter.status).toBe(subBefore.status);
      expect(subAfter.nextOrderDate?.getTime()).toBe(
        subBefore.nextOrderDate?.getTime(),
      );
    });

    it('ผู้ซื้อเห็นเหตุผลและหลักฐานการคืนเงินบนออเดอร์ของตัวเอง', async () => {
      const { orderId } = await newOrder();
      await api(app)
        .post(`/api/v1/seller/orders/${orderId}/cancel`)
        .set(bearer(seller.accessToken))
        .send({ reason: 'ร้านปิดปรับปรุงกะทันหัน' })
        .expect(200);

      const res = await api(app)
        .get(`/api/v1/orders/${orderId}`)
        .set(bearer(buyer.accessToken))
        .expect(200);
      const order = res.body as BuyerOrder;
      expect(order.status).toBe('cancelled');
      expect(order.cancelReason).toContain('ปิดปรับปรุง');
      expect(order.paymentStatus).toBe('refunded');
      expect(order.refundedAt).not.toBeNull();
    });

    it('ยกเลิกออเดอร์ที่ส่งออกไปแล้ว → 409 · ยกเลิกซ้ำ → 409 · เหตุผลสั้นเกิน → 400', async () => {
      const shipped = await newOrder();
      await shipOrder(shipped.orderId);
      const late = await api(app)
        .post(`/api/v1/seller/orders/${shipped.orderId}/cancel`)
        .set(bearer(seller.accessToken))
        .send({ reason: 'อยากยกเลิกทีหลัง' })
        .expect(409);
      expect((late.body as ApiError).code).toBe('ORDER_NOT_CANCELLABLE');

      const { orderId } = await newOrder();
      await api(app)
        .post(`/api/v1/seller/orders/${orderId}/cancel`)
        .set(bearer(seller.accessToken))
        .send({ reason: 'ของหมดจริง ๆ' })
        .expect(200);
      await api(app)
        .post(`/api/v1/seller/orders/${orderId}/cancel`)
        .set(bearer(seller.accessToken))
        .send({ reason: 'ยกเลิกซ้ำอีกครั้ง' })
        .expect(409);

      const fresh = await newOrder();
      await api(app)
        .post(`/api/v1/seller/orders/${fresh.orderId}/cancel`)
        .set(bearer(seller.accessToken))
        .send({ reason: '.' })
        .expect(400);
    });

    it('ร้านอื่นยกเลิกออเดอร์ของร้านเรา → 404 และออเดอร์ไม่ขยับ', async () => {
      const { orderId } = await newOrder();
      await api(app)
        .post(`/api/v1/seller/orders/${orderId}/cancel`)
        .set(bearer(seller2.accessToken))
        .send({ reason: 'ยกเลิกออเดอร์ร้านคนอื่น' })
        .expect(404);

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      expect(row.status).toBe('pending');
    });

    it('ยกเลิกแล้วผู้ซื้อยืนยันรับของ/แจ้งปัญหาไม่ได้อีก', async () => {
      const { orderId } = await newOrder();
      await api(app)
        .post(`/api/v1/seller/orders/${orderId}/cancel`)
        .set(bearer(seller.accessToken))
        .send({ reason: 'ยกเลิกเพราะของหมด' })
        .expect(200);

      await api(app)
        .post(`/api/v1/orders/${orderId}/confirm`)
        .set(bearer(buyer.accessToken))
        .expect(409);
      await api(app)
        .post(`/api/v1/orders/${orderId}/issues`)
        .set(bearer(buyer.accessToken))
        .send({ type: 'not_received', detail: 'ไม่ได้ของเลยครับ' })
        .expect(409);
    });
  });

  // ==========================================================
  // feature 17 — รีวิว verified
  // ==========================================================

  describe('POST /subscriptions/:id/review', () => {
    it('★ ยังไม่เคยรับของ → 422 (รีวิวปลอมเขียนไม่ได้)', async () => {
      const { subscriptionId } = await newOrder();
      const res = await api(app)
        .post(`/api/v1/subscriptions/${subscriptionId}/review`)
        .set(bearer(buyer.accessToken))
        .send({ rating: 5, comment: 'ดีมากทั้งที่ยังไม่ได้ของ' })
        .expect(422);
      expect((res.body as ApiError).code).toBe('NOTHING_RECEIVED_YET');

      expect(await prisma.review.count({ where: { subscriptionId } })).toBe(0);
    });

    it('★ หลังรับของแล้วรีวิวได้ · รีวิวซ้ำ = แก้ไข · "รับมาแล้ว N รอบ" นับจากออเดอร์จริง', async () => {
      const { orderId, subscriptionId } = await newOrder();
      await shipOrder(orderId);
      await api(app)
        .post(`/api/v1/orders/${orderId}/confirm`)
        .set(bearer(buyer.accessToken))
        .expect(200);

      const first = await api(app)
        .post(`/api/v1/subscriptions/${subscriptionId}/review`)
        .set(bearer(buyer.accessToken))
        .send({ rating: 4, comment: 'ใช้รอบแรกแล้วโอเค' })
        .expect(200);
      const review = first.body as Review;
      expect(review.rating).toBe(4);
      expect(review.cyclesReceived).toBe(1);

      // รอบที่ 2 ถึงมือแล้วค่อยกลับมาแก้รีวิว — ป้ายต้องขยับตามของจริง
      const second = await prisma.order.create({
        data: {
          subscriptionId,
          buyerId: buyer.id,
          cycleDate: addDays(todayInBangkok(), -30),
          status: 'delivered',
          amount: 150,
          addressSnapshot: { recipient_name: ADDRESS.recipientName },
        },
      });
      expect(second.id).toBeTruthy();

      const edited = await api(app)
        .post(`/api/v1/subscriptions/${subscriptionId}/review`)
        .set(bearer(buyer.accessToken))
        .send({ rating: 5, comment: 'ใช้ไป 2 รอบแล้วดีขึ้นอีก' })
        .expect(200);
      const updated = edited.body as Review;
      expect(updated.id).toBe(review.id); // แก้ ไม่ใช่รีวิวใหม่
      expect(updated.rating).toBe(5);
      expect(updated.cyclesReceived).toBe(2);

      expect(await prisma.review.count({ where: { subscriptionId } })).toBe(1);
      expect(
        await prisma.subscriptionEvent.count({
          where: { subscriptionId, event: 'reviewed' },
        }),
      ).toBe(2);
    });

    it('คะแนนนอกช่วง 1-5 หรือแนบ cyclesReceived มาเอง → 400', async () => {
      const { orderId, subscriptionId } = await newOrder();
      await shipOrder(orderId);
      await api(app)
        .post(`/api/v1/orders/${orderId}/confirm`)
        .set(bearer(buyer.accessToken))
        .expect(200);

      for (const body of [
        { rating: 0 },
        { rating: 6 },
        { rating: 5, cyclesReceived: 99 },
      ]) {
        await api(app)
          .post(`/api/v1/subscriptions/${subscriptionId}/review`)
          .set(bearer(buyer.accessToken))
          .send(body)
          .expect(400);
      }
    });

    it('รีวิว subscription ของคนอื่น → 404 · ไม่มี token → 401', async () => {
      const { subscriptionId } = await newOrder();
      await api(app)
        .post(`/api/v1/subscriptions/${subscriptionId}/review`)
        .set(bearer(other.accessToken))
        .send({ rating: 1, comment: 'รีวิวของคนอื่น' })
        .expect(404);
      await api(app)
        .post(`/api/v1/subscriptions/${subscriptionId}/review`)
        .send({ rating: 1 })
        .expect(401);
    });

    it('ยกเลิก subscription ไปแล้วก็ยังรีวิวได้ (ตั้งใจตามสเปก)', async () => {
      const { orderId, subscriptionId } = await newOrder();
      await shipOrder(orderId);
      await api(app)
        .post(`/api/v1/orders/${orderId}/confirm`)
        .set(bearer(buyer.accessToken))
        .expect(200);
      await api(app)
        .post(`/api/v1/subscriptions/${subscriptionId}/cancel`)
        .set(bearer(buyer.accessToken))
        .expect(201);

      const res = await api(app)
        .post(`/api/v1/subscriptions/${subscriptionId}/review`)
        .set(bearer(buyer.accessToken))
        .send({ rating: 2, comment: 'เลิกใช้เพราะกลิ่นแรงไป' })
        .expect(200);
      expect((res.body as Review).rating).toBe(2);
    });

    it('คะแนนเฉลี่ยขึ้นหน้าสินค้าสาธารณะ และไม่มี buyerId/subscriptionId หลุด', async () => {
      const product = await prisma.product.findFirstOrThrow({
        where: { shopId },
      });
      const res = await api(app)
        .get(`/api/v1/catalog/products/${product.id}`)
        .expect(200);

      const body = res.body as {
        rating: number | null;
        reviewCount: number;
        reviews: { reviewerName: string }[];
      };
      expect(body.reviewCount).toBeGreaterThanOrEqual(1);
      expect(body.rating).not.toBeNull();
      // ชื่อผู้รีวิวถูก mask และไม่มี identifier ของผู้ซื้อเลย
      expect(body.reviews[0]?.reviewerName).toContain('*');
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(buyer.id);
      expect(raw).not.toContain('subscriptionId');
    });
  });

  // ==========================================================
  // engine งานที่ 4 — ปิดออเดอร์ที่ส่งเกิน 7 วัน
  // ==========================================================

  describe('engine auto-confirm', () => {
    it('★ ส่งเกิน 7 วันไม่มีใครทัก → ปิดให้เป็น delivered แต่ confirmedAt ยังว่าง', async () => {
      const { orderId } = await newOrder();
      await shipOrder(orderId);
      // ย้อนเวลาที่ส่งของไป 8 วัน (แก้ `cycleDate` ไม่ได้ — trigger ห้ามไว้)
      await prisma.order.update({
        where: { id: orderId },
        data: { shippedAt: addDays(todayInBangkok(), -8) },
      });

      const result = await engine.run(todayInBangkok());
      expect(result.detail.autoConfirmed).toBeGreaterThanOrEqual(1);

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      expect(row.status).toBe('delivered');
      // ★ ต้องแยกได้ว่า "ผู้ซื้อยืนยันเอง" กับ "ระบบปิดให้" ★
      expect(row.confirmedAt).toBeNull();

      expect(
        await prisma.notification.count({
          where: { userId: buyer.id, linkPath: `/orders/${orderId}` },
        }),
      ).toBeGreaterThanOrEqual(1);
    });

    it('ออเดอร์ที่มีเคสปัญหาเปิดค้าง → engine ไม่ปิดให้ (เรื่องยังไม่จบ)', async () => {
      const { orderId } = await newOrder();
      await shipOrder(orderId);
      await api(app)
        .post(`/api/v1/orders/${orderId}/issues`)
        .set(bearer(buyer.accessToken))
        .send({ type: 'not_received', detail: 'ส่งมา 8 วันแล้วยังไม่ถึง' })
        .expect(201);
      await prisma.order.update({
        where: { id: orderId },
        data: { shippedAt: addDays(todayInBangkok(), -8) },
      });

      await engine.run(todayInBangkok());

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      expect(row.status).toBe('shipped');
    });

    it('เคสที่ร้านปิดไปแล้ว → engine ปิดออเดอร์ให้ตามปกติ (ไม่ค้างตลอดกาล)', async () => {
      const { orderId } = await newOrder();
      await shipOrder(orderId);
      await api(app)
        .post(`/api/v1/orders/${orderId}/issues`)
        .set(bearer(buyer.accessToken))
        .send({ type: 'damaged', detail: 'กล่องบุบแต่ของยังใช้ได้' })
        .expect(201);

      const issue = await prisma.orderIssue.findFirstOrThrow({
        where: { orderId },
      });
      await api(app)
        .post(`/api/v1/seller/issues/${issue.id}/resolve`)
        .set(bearer(seller.accessToken))
        .send({ status: 'resolved', note: 'ส่งกล่องใหม่ให้แล้ว' })
        .expect(200);

      await prisma.order.update({
        where: { id: orderId },
        data: { shippedAt: addDays(todayInBangkok(), -8) },
      });

      await engine.run(todayInBangkok());

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      expect(row.status).toBe('delivered');
      // ระบบปิดให้ ไม่ใช่ผู้ซื้อยืนยัน — ยังต้องแยกออกจากกัน
      expect(row.confirmedAt).toBeNull();
    });
  });
});
