import { INestApplication } from '@nestjs/common';
import {
  addCycles,
  addDays,
  toISODate,
  todayInBangkok,
} from '../src/common/date';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, ApiError, createTestApp } from './utils/app';
import { cardBody } from './utils/card';
import {
  bearer,
  cleanupTestUsers,
  registerTestUser,
  type TestUser,
} from './utils/auth';

const PLAN_1M = '30000000-0000-4000-8000-000000000002'; // กาแฟรายเดือน 255 (Bean Story)
const PLAN_PRICE = 255;
const BEAN_STORY = '10000000-0000-4000-8000-000000000001';

const ADDRESS = {
  recipientName: 'ผู้รับ รักษาลูกค้า',
  phone: '0812345678',
  addressLine: '83 ถนนทดสอบ',
  province: 'กรุงเทพมหานคร',
  postcode: '10900',
};

interface Card {
  id: string;
  status: 'active' | 'paused' | 'cancelled';
  quantity: number;
  nextOrderDate: string | null;
  cycleAnchorDate: string;
  resumeOn: string | null;
  cancelReason: string | null;
}

/**
 * Phase 8.3 — retention (feature 06 R1–R3)
 *
 * แต่ละ endpoint ใหม่มีครบ 3 ด่านตาม testing.md §3 (สำเร็จ · ของคนอื่น 404 ·
 * สถานะผิด 409) และทุกเคสที่ "สำเร็จ" ยืนยันผลใน DB ไม่ใช่แค่ response
 */
describe('Retention — ยกเลิกพร้อมเหตุผล · หยุดพัก N รอบ · ส่งรอบนี้เลย · เปลี่ยนจำนวน', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyer: TestUser;
  let other: TestUser;
  let cardId: string;
  let declinedCardId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupTestUsers(prisma);
    buyer = await registerTestUser(app, 'retention');
    other = await registerTestUser(app, 'retention-other');

    const add = (last4: string) =>
      api(app)
        .post('/api/v1/me/payment-methods')
        .set(bearer(buyer.accessToken))
        .send(cardBody({ last4 }))
        .expect(201);
    cardId = ((await add('4242')).body as { id: string }).id;
    // ลงท้าย 0000 = ถูกปฏิเสธเสมอ (DEMO_DECLINE_LAST4)
    declinedCardId = ((await add('0000')).body as { id: string }).id;
  });

  afterAll(async () => {
    if (prisma) await cleanupTestUsers(prisma);
    if (app) await app.close();
  });

  /** ที่อยู่ใหม่ทุกครั้ง — แผนเดิม+ที่อยู่เดิมชนกฎกันสมัครซ้ำ (ดู working-agreement §6) */
  async function newSubscription(): Promise<Card> {
    const address = await prisma.address.create({
      data: { ...ADDRESS, userId: buyer.id },
      select: { id: true },
    });
    const res = await api(app)
      .post('/api/v1/subscriptions')
      .set(bearer(buyer.accessToken))
      .send({
        planId: PLAN_1M,
        quantity: 1,
        addressId: address.id,
        paymentMethodId: cardId,
        startDate: toISODate(addDays(todayInBangkok(), 1)),
      })
      .expect(201);
    return (res.body as { subscription: Card }).subscription;
  }

  const act = (id: string, action: string, user: TestUser = buyer) =>
    api(app)
      .post(`/api/v1/subscriptions/${id}/${action}`)
      .set(bearer(user.accessToken));

  const rowOf = (id: string) =>
    prisma.subscription.findUniqueOrThrow({ where: { id } });

  const lastEvent = (id: string, event: string) =>
    prisma.subscriptionEvent.findFirstOrThrow({
      where: {
        subscriptionId: id,
        event: event as 'cancelled',
      },
      orderBy: { id: 'desc' },
    });

  // ==========================================================
  // R1 — ยกเลิกพร้อมเหตุผล
  // ==========================================================

  describe('POST /:id/cancel (เหตุผลบังคับ)', () => {
    it('ยกเลิกพร้อมเหตุผล + note → เก็บลง DB · event มีแค่หมวดเหตุผล · ร้านเห็นหมวดแต่ไม่เห็น note', async () => {
      const sub = await newSubscription();
      const note = 'ย้ายไปต่างจังหวัด เบอร์ 0899999999';

      const res = await act(sub.id, 'cancel')
        .send({ reason: 'taking_break', note })
        .expect(201);
      expect((res.body as Card).cancelReason).toBe('taking_break');

      const row = await rowOf(sub.id);
      expect(row.status).toBe('cancelled');
      expect(row.cancelReason).toBe('taking_break');
      expect(row.cancelNote).toBe(note);

      const event = await lastEvent(sub.id, 'cancelled');
      expect(event.detail).toEqual({
        from_status: 'active',
        reason: 'taking_break',
      });

      // ★ ข้อความอิสระของผู้ซื้อต้องไม่หลุดไปถึงร้าน (กฎข้อ 7)
      const notice = await prisma.notification.findFirstOrThrow({
        where: { type: 'subscriber_cancelled' },
        orderBy: { createdAt: 'desc' },
      });
      expect(notice.body).toContain('ขอพักก่อน');
      expect(notice.body).not.toContain('0899999999');
    });

    it('note ว่าง → เก็บเป็น null (CHECK ไม่ยอมรับสตริงว่าง)', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'cancel')
        .send({ reason: 'other', note: '   ' })
        .expect(201);
      expect((await rowOf(sub.id)).cancelNote).toBeNull();
    });

    it('ไม่ส่งเหตุผล → 400 และรายการยังไม่ถูกยกเลิก', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'cancel').send({}).expect(400);
      expect((await rowOf(sub.id)).status).toBe('active');
    });

    it('เหตุผลนอก enum / note ยาวเกิน 200 / แนบ field อื่น → 400', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'cancel').send({ reason: 'hacked' }).expect(400);
      await act(sub.id, 'cancel')
        .send({ reason: 'other', note: 'ก'.repeat(201) })
        .expect(400);
      // forbidNonWhitelisted — สถานะ/วันยกเลิกห้ามมาจาก client
      await act(sub.id, 'cancel')
        .send({ reason: 'other', status: 'active' })
        .expect(400);
      expect((await rowOf(sub.id)).status).toBe('active');
    });

    it('ยกเลิกจากสถานะหยุดพัก N รอบ → resume_on ถูกล้างด้วย', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'pause').send({ cycles: 2 }).expect(201);
      await act(sub.id, 'cancel').send({ reason: 'quality' }).expect(201);
      const row = await rowOf(sub.id);
      expect(row.status).toBe('cancelled');
      expect(row.resumeOn).toBeNull();
    });

    it('ของคนอื่น → 404', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'cancel', other).send({ reason: 'other' }).expect(404);
    });

    it('ยกเลิกซ้ำ → 409 และเหตุผลเดิมไม่ถูกเขียนทับ', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'cancel').send({ reason: 'switching' }).expect(201);
      const res = await act(sub.id, 'cancel')
        .send({ reason: 'too_expensive' })
        .expect(409);
      expect((res.body as ApiError).code).toBe('SUBSCRIPTION_CANCELLED');
      expect((await rowOf(sub.id)).cancelReason).toBe('switching');
    });
  });

  describe('source: cancel_flow (วัด save rate)', () => {
    it('skip / pause / plan ที่กดจากข้อเสนอ → event มี source = cancel_flow', async () => {
      const a = await newSubscription();
      await act(a.id, 'skip').send({ source: 'cancel_flow' }).expect(201);
      expect((await lastEvent(a.id, 'skipped')).detail).toMatchObject({
        source: 'cancel_flow',
      });

      const b = await newSubscription();
      await act(b.id, 'pause')
        .send({ cycles: 1, source: 'cancel_flow' })
        .expect(201);
      expect((await lastEvent(b.id, 'paused')).detail).toMatchObject({
        source: 'cancel_flow',
      });
    });

    it('skip เปล่าแบบเดิม → ไม่มี source · source ค่าอื่น → 400', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'skip').expect(201);
      expect((await lastEvent(sub.id, 'skipped')).detail).not.toHaveProperty(
        'source',
      );
      await act(sub.id, 'skip').send({ source: 'admin' }).expect(400);
    });
  });

  // ==========================================================
  // R2 — หยุดพัก N รอบ
  // ==========================================================

  describe('POST /:id/pause { cycles }', () => {
    it('หยุด 1 รอบ → resume_on = วันเดียวกับที่ "ข้ามรอบ" จะได้', async () => {
      const sub = await newSubscription();
      const next = new Date(`${sub.nextOrderDate as string}T00:00:00Z`);
      const anchor = new Date(`${sub.cycleAnchorDate}T00:00:00Z`);

      const res = await act(sub.id, 'pause').send({ cycles: 1 }).expect(201);
      const card = res.body as Card;
      expect(card.status).toBe('paused');

      // หมุด = วันเริ่ม · รอบถัดไป = หมุด+1 · พัก 1 รอบ = หมุด+2
      expect(next.getTime()).toBe(addCycles(anchor, '1m', 1).getTime());
      expect(card.resumeOn).toBe(toISODate(addCycles(anchor, '1m', 2)));

      const event = await lastEvent(sub.id, 'paused');
      expect(event.detail).toMatchObject({
        cycles: 1,
        resume_on: card.resumeOn,
      });
    });

    it('หยุด 3 รอบ → ข้ามไป 3 ช่องบนกริด', async () => {
      const sub = await newSubscription();
      const anchor = new Date(`${sub.cycleAnchorDate}T00:00:00Z`);
      const res = await act(sub.id, 'pause').send({ cycles: 3 }).expect(201);
      expect((res.body as Card).resumeOn).toBe(
        toISODate(addCycles(anchor, '1m', 4)),
      );
    });

    it('ไม่ส่ง cycles → หยุดไม่มีกำหนดแบบเดิม (resume_on = null)', async () => {
      const sub = await newSubscription();
      const res = await act(sub.id, 'pause').expect(201);
      expect((res.body as Card).resumeOn).toBeNull();
    });

    it('cycles นอกช่วง 1-3 → 400', async () => {
      const sub = await newSubscription();
      for (const cycles of [0, 4, 1.5, '2']) {
        await act(sub.id, 'pause').send({ cycles }).expect(400);
      }
      expect((await rowOf(sub.id)).status).toBe('active');
    });

    it('กลับมาก่อนกำหนด → resume_on ถูกล้าง', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'pause').send({ cycles: 2 }).expect(201);
      const res = await act(sub.id, 'resume').expect(201);
      expect((res.body as Card).resumeOn).toBeNull();
      expect((await rowOf(sub.id)).resumeOn).toBeNull();
    });

    it('หยุดอยู่แล้ว → 409 · ของคนอื่น → 404', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'pause').send({ cycles: 1 }).expect(201);
      const res = await act(sub.id, 'pause').send({ cycles: 2 }).expect(409);
      expect((res.body as ApiError).code).toBe('SUBSCRIPTION_PAUSED');

      const mine = await newSubscription();
      await act(mine.id, 'pause', other).send({ cycles: 1 }).expect(404);
    });
  });

  // ==========================================================
  // R3 — ส่งรอบนี้เลย
  // ==========================================================

  describe('POST /:id/ship-now', () => {
    it('สำเร็จ → ออเดอร์วันนี้ + จ่ายแล้ว · หมุดย้ายมาวันนี้ · รอบถัดไป = วันนี้ + 1 รอบ · ร้านได้แจ้งเตือน', async () => {
      const sub = await newSubscription();
      const today = todayInBangkok();
      const noticesBefore = await prisma.notification.count({
        where: { type: 'early_order' },
      });

      const res = await act(sub.id, 'ship-now').expect(201);
      const card = res.body as Card;
      expect(card.cycleAnchorDate).toBe(toISODate(today));
      expect(card.nextOrderDate).toBe(toISODate(addCycles(today, '1m', 1)));

      const order = await prisma.order.findFirstOrThrow({
        where: { subscriptionId: sub.id, cycleDate: today },
        include: { payment: true },
      });
      // ★ ยอดจากราคาใน DB ไม่ใช่จาก client
      expect(order.amount.toNumber()).toBe(PLAN_PRICE);
      expect(order.payment?.status).toBe('paid');
      expect(order.addressSnapshot).toMatchObject({
        recipient_name: ADDRESS.recipientName,
      });

      expect((await lastEvent(sub.id, 'ordered_early')).detail).toMatchObject({
        from: sub.nextOrderDate,
        cycle_date: toISODate(today),
      });
      expect(
        await prisma.notification.count({ where: { type: 'early_order' } }),
      ).toBe(noticesBefore + 1);
    });

    it('★ แนบยอดเงินมาใน body → ถูกเมิน ยอดยังมาจากแผน', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'ship-now').send({ amount: 1 }).expect(201);
      const order = await prisma.order.findFirstOrThrow({
        where: { subscriptionId: sub.id, cycleDate: todayInBangkok() },
      });
      expect(order.amount.toNumber()).toBe(PLAN_PRICE);
    });

    it('★ กดซ้ำวันเดียวกัน → 409 ORDER_EXISTS_TODAY และมีออเดอร์วันนี้ใบเดียว', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'ship-now').expect(201);
      const res = await act(sub.id, 'ship-now').expect(409);
      expect((res.body as ApiError).code).toBe('ORDER_EXISTS_TODAY');
      expect(
        await prisma.order.count({
          where: { subscriptionId: sub.id, cycleDate: todayInBangkok() },
        }),
      ).toBe(1);
    });

    it('★ กดพร้อมกัน 2 ครั้ง → สำเร็จครั้งเดียว', async () => {
      const sub = await newSubscription();
      const results = await Promise.all([
        act(sub.id, 'ship-now'),
        act(sub.id, 'ship-now'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        await prisma.order.count({
          where: { subscriptionId: sub.id, cycleDate: todayInBangkok() },
        }),
      ).toBe(1);
    });

    it('บัตรถูกปฏิเสธ → 402 และไม่เหลืออะไรเลย (rollback ทั้งก้อน)', async () => {
      const sub = await newSubscription();
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { paymentMethodId: declinedCardId },
      });
      const before = await rowOf(sub.id);

      const res = await act(sub.id, 'ship-now').expect(402);
      expect((res.body as ApiError).code).toBe('PAYMENT_FAILED');

      const after = await rowOf(sub.id);
      expect(after.nextOrderDate).toEqual(before.nextOrderDate);
      expect(after.cycleAnchorDate).toEqual(before.cycleAnchorDate);
      expect(
        await prisma.order.count({
          where: { subscriptionId: sub.id, cycleDate: todayInBangkok() },
        }),
      ).toBe(0);
    });

    it('หยุดชั่วคราวอยู่ → 409 · ของคนอื่น → 404', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'pause').expect(201);
      const res = await act(sub.id, 'ship-now').expect(409);
      expect((res.body as ApiError).code).toBe('SUBSCRIPTION_PAUSED');

      const mine = await newSubscription();
      await act(mine.id, 'ship-now', other).expect(404);
    });

    it('★ ร้านถูกระงับ (ข้อมูลหลุดมาเป็น active) → 409 ไม่ตัดเงิน', async () => {
      const sub = await newSubscription();
      await prisma.shop.update({
        where: { id: BEAN_STORY },
        data: { suspendedAt: new Date(), suspendedReason: 'ทดสอบ' },
      });
      try {
        const res = await act(sub.id, 'ship-now').expect(409);
        expect((res.body as ApiError).code).toBe('SHOP_SUSPENDED');
        expect(
          await prisma.order.count({
            where: { subscriptionId: sub.id, cycleDate: todayInBangkok() },
          }),
        ).toBe(0);
      } finally {
        await prisma.shop.update({
          where: { id: BEAN_STORY },
          data: { suspendedAt: null, suspendedReason: null },
        });
      }
    });
  });

  // ==========================================================
  // R3 — เปลี่ยนจำนวนต่อรอบ
  // ==========================================================

  describe('POST /:id/quantity', () => {
    it('เปลี่ยนจำนวน → ออเดอร์ถัดไปคิดตามจำนวนใหม่ + event quantity_changed', async () => {
      const sub = await newSubscription();
      const res = await act(sub.id, 'quantity')
        .send({ quantity: 3 })
        .expect(201);
      expect((res.body as Card).quantity).toBe(3);
      expect((await lastEvent(sub.id, 'quantity_changed')).detail).toEqual({
        from: 1,
        to: 3,
      });

      // ยืนยันผลกับเงินจริง: รอบถัดไปที่เกิดขึ้นใช้จำนวนใหม่
      await act(sub.id, 'ship-now').expect(201);
      const order = await prisma.order.findFirstOrThrow({
        where: { subscriptionId: sub.id, cycleDate: todayInBangkok() },
      });
      expect(order.amount.toNumber()).toBe(PLAN_PRICE * 3);
    });

    it('★ ออเดอร์ที่จ่ายไปแล้วไม่เปลี่ยนตามจำนวนใหม่ — ร้านเห็นจำนวนที่จ่ายจริง', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'ship-now').expect(201);
      // จ่าย 1 ชิ้นแล้วค่อยแก้เป็น 10 — ร้านต้องยังเห็น 1 (รีวิว security Phase 8.3)
      await act(sub.id, 'quantity').send({ quantity: 10 }).expect(201);

      const order = await prisma.order.findFirstOrThrow({
        where: { subscriptionId: sub.id, cycleDate: todayInBangkok() },
      });
      expect(order.quantity).toBe(1);
      expect(order.amount.toNumber()).toBe(PLAN_PRICE);

      const mine = await api(app)
        .get(`/api/v1/orders/${order.id}`)
        .set(bearer(buyer.accessToken))
        .expect(200);
      expect((mine.body as { quantity: number }).quantity).toBe(1);
    });

    it('ระหว่างหยุดพักก็เปลี่ยนได้', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'pause').send({ cycles: 1 }).expect(201);
      await act(sub.id, 'quantity').send({ quantity: 2 }).expect(201);
      const row = await rowOf(sub.id);
      expect(row.quantity).toBe(2);
      // ไม่แตะการหยุดพัก
      expect(row.status).toBe('paused');
      expect(row.resumeOn).not.toBeNull();
    });

    it('จำนวนนอกช่วง 1-10 / ไม่ใช่จำนวนเต็ม → 400', async () => {
      const sub = await newSubscription();
      for (const quantity of [0, 11, 2.5, '3']) {
        await act(sub.id, 'quantity').send({ quantity }).expect(400);
      }
      // forbidNonWhitelisted — ราคา/ยอดห้ามติดมากับคำขอเปลี่ยนจำนวน
      await act(sub.id, 'quantity')
        .send({ quantity: 2, pricePerCycle: 1 })
        .expect(400);
      expect((await rowOf(sub.id)).quantity).toBe(1);
    });

    it('ยกเลิกแล้ว → 409 · ของคนอื่น → 404', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'quantity', other).send({ quantity: 2 }).expect(404);
      await act(sub.id, 'cancel').send({ reason: 'other' }).expect(201);
      const res = await act(sub.id, 'quantity')
        .send({ quantity: 2 })
        .expect(409);
      expect((res.body as ApiError).code).toBe('SUBSCRIPTION_CANCELLED');
    });
  });

  it('endpoint ใหม่ทั้งหมดไม่มี token → 401', async () => {
    const sub = await newSubscription();
    for (const action of ['ship-now', 'quantity']) {
      await api(app)
        .post(`/api/v1/subscriptions/${sub.id}/${action}`)
        .send({})
        .expect(401);
    }
  });
});
