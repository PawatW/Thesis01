import { INestApplication } from '@nestjs/common';
import {
  addCycles,
  addDays,
  toISODate,
  todayInBangkok,
  tryParseISODate,
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

/** แผนของสินค้าชิ้นเดียวกัน (กาแฟคั่วกลาง) — ใช้ทดสอบการเปลี่ยนรอบส่ง */
const PLAN_1M = '30000000-0000-4000-8000-000000000002';
const PLAN_2M = '30000000-0000-4000-8000-000000000003';
/** แผนของ "สินค้าคนละชิ้น" — เปลี่ยนรอบข้ามสินค้าต้องไม่ได้ */
const PLAN_OTHER_PRODUCT = '30000000-0000-4000-8000-000000000018';

const ADDRESS = {
  recipientName: 'ผู้รับ จัดการรายการ',
  phone: '0812345678',
  addressLine: '77 ถนนทดสอบ',
  province: 'กรุงเทพมหานคร',
  postcode: '10900',
};

interface Card {
  id: string;
  status: 'active' | 'paused' | 'cancelled';
  pausedReason: string | null;
  nextOrderDate: string | null;
  cycleAnchorDate: string;
  cycle: string;
  planId: string;
  addressId: string;
}

/**
 * 7 actions ของ W05 — จุดขายของแอปทั้งใบอยู่ตรงนี้
 *
 * แต่ละ endpoint ต้องมีอย่างน้อย 3 เคสตาม docs/testing.md §3:
 * เจ้าของทำสำเร็จ · คนอื่นทำ → 404 · สถานะผิด → 409
 * และทุก action ต้องทิ้งแถวใน `subscription_events` เพราะเป็นข้อมูลดิบของ
 * กราฟ churn ในเล่ม — action ที่สำเร็จแต่ไม่มี event ถือว่าไม่ผ่าน
 */
describe('Subscriptions — 7 actions ของ W05', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyer: TestUser;
  let other: TestUser;
  let cardId: string;
  let otherAddressId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupTestUsers(prisma);

    buyer = await registerTestUser(app, 'subs');
    other = await registerTestUser(app, 'subs-other');
    otherAddressId = await createAddress(other);

    const card = await api(app)
      .post('/api/v1/me/payment-methods')
      .set(bearer(buyer.accessToken))
      .send(cardBody())
      .expect(201);
    cardId = (card.body as { id: string }).id;
  });

  afterAll(async () => {
    if (prisma) await cleanupTestUsers(prisma);
    if (app) await app.close();
  });

  /**
   * สร้างที่อยู่ผ่าน Prisma ตรง ๆ ไม่ผ่าน endpoint โดยตั้งใจ
   *
   * ไฟล์นี้ต้องการที่อยู่ใหม่ต่อ 1 เคส (ดู `newSubscription`) ซึ่งเกินเพดาน
   * 20 ที่อยู่ต่อบัญชีของ `AddressesService` — เพดานนั้นเป็นกฎของ endpoint
   * ที่มีเทสของตัวเองอยู่แล้วใน me.e2e-spec.ts ไม่ใช่สิ่งที่ไฟล์นี้ทดสอบ
   */
  async function createAddress(user: TestUser): Promise<string> {
    const row = await prisma.address.create({
      data: { ...ADDRESS, userId: user.id },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * รายการใหม่ต่อ 1 เคส — action เปลี่ยนสถานะถาวร ถ้าใช้รายการร่วมกัน
   * ลำดับการรันจะกลายเป็นส่วนหนึ่งของเงื่อนไขเทสโดยไม่ได้ตั้งใจ
   * (ที่อยู่ใหม่ทุกครั้งด้วย เพราะแผนเดิม+ที่อยู่เดิมถูกกฎกันสมัครซ้ำปฏิเสธ)
   */
  async function newSubscription(planId = PLAN_1M): Promise<Card> {
    const addressId = await createAddress(buyer);
    const res = await api(app)
      .post('/api/v1/subscriptions')
      .set(bearer(buyer.accessToken))
      .send({
        planId,
        quantity: 1,
        addressId,
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

  const eventsOf = (id: string) =>
    prisma.subscriptionEvent.findMany({
      where: { subscriptionId: id },
      orderBy: { id: 'asc' },
    });

  // ---------- skip ----------

  describe('POST /:id/skip', () => {
    it('ข้ามรอบ → วันรอบถัดไปขยับไป 1 รอบ + มี event skipped ที่บอก from/to', async () => {
      const sub = await newSubscription();
      const before = sub.nextOrderDate as string;

      const res = await act(sub.id, 'skip').expect(201);
      const after = (res.body as Card).nextOrderDate as string;

      // ★ ต้องเท่ากับรอบถัดไปบนกริดเป๊ะ ★ ไม่ใช่แค่ "มากกว่าเดิม" —
      // การเลื่อน 2 รอบรวดหรือ +30 วันคร่าว ๆ ต้องทำให้เคสนี้แดง
      const expected = toISODate(
        addCycles(tryParseISODate(sub.cycleAnchorDate) as Date, '1m', 2),
      );
      expect(after).toBe(expected);
      expect(after > before).toBe(true);

      const row = await prisma.subscription.findUniqueOrThrow({
        where: { id: sub.id },
      });
      expect(toISODate(row.nextOrderDate as Date)).toBe(after);
      // หมุดของกริดไม่ขยับ — ข้ามรอบคือเลื่อนไป 1 ช่องบนกริดเดิม
      expect(toISODate(row.cycleAnchorDate)).toBe(toISODate(row.startDate));

      const events = await eventsOf(sub.id);
      const skipped = events.find((e) => e.event === 'skipped');
      expect(skipped?.detail).toEqual({ from: before, to: after });
    });

    it('ข้ามรอบของคนอื่น → 404 (ไม่บอกว่า id นี้มีจริง)', async () => {
      const sub = await newSubscription();
      const res = await act(sub.id, 'skip', other).expect(404);
      expect((res.body as ApiError).code).toBe('SUBSCRIPTION_NOT_FOUND');

      // ของจริงต้องไม่ขยับแม้แต่วันเดียว
      const row = await prisma.subscription.findUniqueOrThrow({
        where: { id: sub.id },
      });
      expect(toISODate(row.nextOrderDate as Date)).toBe(sub.nextOrderDate);
    });

    it('ข้ามรอบตอนหยุดชั่วคราวอยู่ → 409', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'pause').expect(201);

      const res = await act(sub.id, 'skip').expect(409);
      expect((res.body as ApiError).code).toBe('SUBSCRIPTION_PAUSED');
    });

    it('ไม่มี token → 401', async () => {
      const sub = await newSubscription();
      await api(app).post(`/api/v1/subscriptions/${sub.id}/skip`).expect(401);
    });

    it('id ไม่ใช่ UUID → 400 (ไม่หลุดไปถึง service)', async () => {
      await act('ไม่ใช่-uuid', 'skip').expect(400);
    });
  });

  // ---------- pause / resume ----------

  describe('POST /:id/pause + /:id/resume', () => {
    it('หยุดชั่วคราว → paused + pausedReason = user + event', async () => {
      const sub = await newSubscription();
      const res = await act(sub.id, 'pause').expect(201);
      const card = res.body as Card;

      expect(card.status).toBe('paused');
      expect(card.pausedReason).toBe('user');

      const row = await prisma.subscription.findUniqueOrThrow({
        where: { id: sub.id },
      });
      expect(row.pausedAt).not.toBeNull();
      expect((await eventsOf(sub.id)).some((e) => e.event === 'paused')).toBe(
        true,
      );
    });

    it('หยุดซ้ำอีกครั้ง → 409 และไม่มี event เพิ่ม', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'pause').expect(201);
      const before = (await eventsOf(sub.id)).length;

      await act(sub.id, 'pause').expect(409);
      expect((await eventsOf(sub.id)).length).toBe(before);
    });

    it('กลับมาใช้งาน → active และวันรอบถัดไปต้องไม่อยู่ในอดีต', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'pause').expect(201);

      // จำลองว่าหยุดไว้จนวันรอบเดิมผ่านไปแล้ว — เคสที่ทำให้ engine
      // ยิงออเดอร์ย้อนหลังทันทีถ้าไม่เลื่อนวันให้ (ข้อบังคับใน W05)
      // ต้องขยับหมุดตามด้วย ไม่งั้นชน CHECK `subs_anchor_not_after_next`
      const stale = addDays(todayInBangkok(), -20);
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { nextOrderDate: stale, cycleAnchorDate: stale },
      });

      const res = await act(sub.id, 'resume').expect(201);
      const card = res.body as Card;
      const tomorrow = toISODate(addDays(todayInBangkok(), 1));

      expect(card.status).toBe('active');
      expect(card.pausedReason).toBeNull();
      expect(card.nextOrderDate).toBe(tomorrow);

      const row = await prisma.subscription.findUniqueOrThrow({
        where: { id: sub.id },
      });
      expect(row.pausedAt).toBeNull();
      // หมุดย้ายมาที่วันที่กลับมาใช้งาน — รอบถัด ๆ ไปนับจากวันนี้ ไม่ใช่วันเดิม
      expect(toISODate(row.cycleAnchorDate)).toBe(tomorrow);
      expect((await eventsOf(sub.id)).some((e) => e.event === 'resumed')).toBe(
        true,
      );
    });

    it('กลับมาใช้งานทั้งที่ยังใช้งานอยู่ → 409', async () => {
      const sub = await newSubscription();
      const res = await act(sub.id, 'resume').expect(409);
      expect((res.body as ApiError).code).toBe('SUBSCRIPTION_ACTIVE');
    });

    it('★ รายการที่ระบบแช่แข็งเพราะร้านถูกระงับ → ผู้ซื้อ resume เองไม่ได้ (T-7)', async () => {
      const sub = await newSubscription();
      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'paused',
          pausedAt: new Date(),
          pausedReason: 'shop_suspended',
        },
      });

      const res = await act(sub.id, 'resume').expect(409);
      expect((res.body as ApiError).code).toBe('SHOP_SUSPENDED');

      // ยังต้องหยุดอยู่เหมือนเดิม — ไม่งั้นแพลตฟอร์มกลับไปเก็บเงินให้ร้านที่ตัวเองระงับ
      const row = await prisma.subscription.findUniqueOrThrow({
        where: { id: sub.id },
      });
      expect(row.status).toBe('paused');
      expect(row.pausedReason).toBe('shop_suspended');
    });

    it('หยุดรายการของคนอื่น → 404', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'pause', other).expect(404);
    });
  });

  // ---------- reschedule ----------

  describe('POST /:id/reschedule', () => {
    const target = (days: number) => toISODate(addDays(todayInBangkok(), days));

    it('เลื่อนวันส่ง → วันใหม่มีผลทันที และหมุดย้ายตาม (รอบถัดไปนับจากวันใหม่)', async () => {
      const sub = await newSubscription();
      const date = target(10);

      const res = await act(sub.id, 'reschedule').send({ date }).expect(201);
      expect((res.body as Card).nextOrderDate).toBe(date);

      const row = await prisma.subscription.findUniqueOrThrow({
        where: { id: sub.id },
      });
      expect(toISODate(row.cycleAnchorDate)).toBe(date);

      const event = (await eventsOf(sub.id)).find(
        (e) => e.event === 'rescheduled',
      );
      expect(event?.detail).toEqual({ from: sub.nextOrderDate, to: date });
    });

    it('เลื่อนไปวันนี้หรืออดีต → 422', async () => {
      const sub = await newSubscription();
      for (const days of [0, -1]) {
        const res = await act(sub.id, 'reschedule')
          .send({ date: target(days) })
          .expect(422);
        expect((res.body as ApiError).code).toBe('RESCHEDULE_OUT_OF_RANGE');
      }
    });

    it('เลื่อนไกลเกินเพดาน (เท่ากับยกเลิกแบบไม่ทิ้งร่องรอย) → 422', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'reschedule')
        .send({ date: target(365) })
        .expect(422);
    });

    it('วันที่ไม่มีจริง (30 ก.พ.) → 400 ไม่ใช่ 500', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'reschedule').send({ date: '2027-02-30' }).expect(400);
    });

    it('แนบฟิลด์ที่ไม่ได้ประกาศใน DTO → 400 (whitelist ตัดทิ้งไม่พอ ต้องปฏิเสธ)', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'reschedule')
        .send({ date: target(5), status: 'cancelled' })
        .expect(400);
    });

    it('เลื่อนรายการของคนอื่น → 404', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'reschedule', other)
        .send({ date: target(5) })
        .expect(404);
    });

    it('เลื่อนรายการที่ยกเลิกไปแล้ว → 409', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'cancel').expect(201);

      const res = await act(sub.id, 'reschedule')
        .send({ date: target(5) })
        .expect(409);
      expect((res.body as ApiError).code).toBe('SUBSCRIPTION_CANCELLED');
    });
  });

  // ---------- เปลี่ยนรอบส่ง ----------

  describe('POST /:id/plan', () => {
    it('เปลี่ยนรอบส่ง → แผนใหม่มีผล แต่วันรอบถัดไปคงเดิม (W05)', async () => {
      const sub = await newSubscription();

      const res = await act(sub.id, 'plan')
        .send({ planId: PLAN_2M })
        .expect(201);
      const card = res.body as Card;

      expect(card.planId).toBe(PLAN_2M);
      expect(card.cycle).toBe('2m');
      expect(card.nextOrderDate).toBe(sub.nextOrderDate);

      const row = await prisma.subscription.findUniqueOrThrow({
        where: { id: sub.id },
      });
      // หมุดย้ายมาที่รอบถัดไป: รอบหน้าวันเดิม รอบถัด ๆ ไปเดินตามความถี่ใหม่
      expect(toISODate(row.cycleAnchorDate)).toBe(card.nextOrderDate);

      const event = (await eventsOf(sub.id)).find(
        (e) => e.event === 'cycle_changed',
      );
      expect(event?.detail).toMatchObject({ from_cycle: '1m', to_cycle: '2m' });
    });

    it('เปลี่ยนไปแผนของสินค้าคนละชิ้น → 409 (ไม่ใช่การเปลี่ยนสินค้ากลางคัน)', async () => {
      const sub = await newSubscription();
      const res = await act(sub.id, 'plan')
        .send({ planId: PLAN_OTHER_PRODUCT })
        .expect(409);
      expect((res.body as ApiError).code).toBe('PLAN_UNAVAILABLE');

      const row = await prisma.subscription.findUniqueOrThrow({
        where: { id: sub.id },
      });
      expect(row.planId).toBe(PLAN_1M);
    });

    it('เลือกแผนเดิม → ไม่เปลี่ยนอะไรและไม่เกิด event ขยะ', async () => {
      const sub = await newSubscription();
      const before = (await eventsOf(sub.id)).length;

      await act(sub.id, 'plan').send({ planId: PLAN_1M }).expect(201);
      expect((await eventsOf(sub.id)).length).toBe(before);
    });

    it('เปลี่ยนรอบของคนอื่น → 404', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'plan', other).send({ planId: PLAN_2M }).expect(404);
    });
  });

  // ---------- เปลี่ยนที่อยู่ ----------

  describe('POST /:id/address', () => {
    it('เปลี่ยนที่อยู่ → มีผลกับรอบถัดไป และมี event address_changed', async () => {
      const sub = await newSubscription();
      const addressId = await createAddress(buyer);

      const res = await act(sub.id, 'address').send({ addressId }).expect(201);
      expect((res.body as Card).addressId).toBe(addressId);

      expect(
        (await eventsOf(sub.id)).some((e) => e.event === 'address_changed'),
      ).toBe(true);
    });

    it('เปลี่ยนได้แม้กำลังหยุดชั่วคราว (ตารางใน W05)', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'pause').expect(201);
      const addressId = await createAddress(buyer);

      const res = await act(sub.id, 'address').send({ addressId }).expect(201);
      expect((res.body as Card).status).toBe('paused');
      expect((res.body as Card).addressId).toBe(addressId);
    });

    it('ใช้ที่อยู่ของคนอื่น → 404 และของเดิมไม่ถูกแตะ', async () => {
      const sub = await newSubscription();
      const res = await act(sub.id, 'address')
        .send({ addressId: otherAddressId })
        .expect(404);
      expect((res.body as ApiError).code).toBe('ADDRESS_NOT_FOUND');

      const row = await prisma.subscription.findUniqueOrThrow({
        where: { id: sub.id },
      });
      expect(row.addressId).toBe(sub.addressId);
    });

    it('ย้ายไปที่อยู่ที่มีรายการแผนเดียวกันอยู่แล้ว → 409 (กันเลี่ยงกฎสมัครซ้ำ)', async () => {
      const first = await newSubscription();
      const second = await newSubscription();

      const res = await act(second.id, 'address')
        .send({ addressId: first.addressId })
        .expect(409);
      expect((res.body as ApiError).code).toBe('ALREADY_SUBSCRIBED');
    });
  });

  // ---------- cancel ----------

  describe('POST /:id/cancel', () => {
    /** แจ้งเตือน "มีผู้ยกเลิก" ที่ส่งถึงเจ้าของร้านของแผนที่ใช้ทดสอบ */
    const cancelNoticesForShop = () =>
      prisma.notification.count({
        where: {
          type: 'subscriber_cancelled',
          user: {
            shop: { products: { some: { plans: { some: { id: PLAN_1M } } } } },
          },
        },
      });

    it('ยกเลิก → cancelled + ไม่มีรอบถัดไป + ร้านได้รับแจ้งเตือน', async () => {
      const sub = await newSubscription();
      const noticesBefore = await cancelNoticesForShop();

      const res = await act(sub.id, 'cancel').expect(201);
      const card = res.body as Card;
      expect(card.status).toBe('cancelled');
      expect(card.nextOrderDate).toBeNull();

      const row = await prisma.subscription.findUniqueOrThrow({
        where: { id: sub.id },
      });
      expect(row.cancelledAt).not.toBeNull();
      expect(row.pausedReason).toBeNull();

      expect(
        (await eventsOf(sub.id)).some((e) => e.event === 'cancelled'),
      ).toBe(true);

      // นับก่อน-หลังของ action นี้เท่านั้น — การนับรวมทั้งตารางจะผ่านได้ด้วย
      // ใบที่ค้างจากการรันครั้งก่อน (เจ้าของคือ seller ของ seed ที่ cleanup ไม่ลบ)
      expect(await cancelNoticesForShop()).toBe(noticesBefore + 1);
    });

    it('ยกเลิกซ้ำ → 409 (cancelled คือถาวร)', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'cancel').expect(201);

      const res = await act(sub.id, 'cancel').expect(409);
      expect((res.body as ApiError).code).toBe('SUBSCRIPTION_CANCELLED');
    });

    it('★ ยกเลิกแล้วทุก action ถูกปฏิเสธหมด (state machine ของ W05)', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'cancel').expect(201);

      // ครบทั้ง 6 action ที่เหลือ ไม่ใช่แค่ 3 ตัวแรก — endpoint ที่รับ body
      // มีเส้นทางตรวจของตัวเองแยก จึงต้องพิสูจน์ว่ามันก็เจอด่านสถานะเหมือนกัน
      for (const action of ['resume', 'pause', 'skip']) {
        const res = await act(sub.id, action).expect(409);
        expect((res.body as ApiError).code).toBe('SUBSCRIPTION_CANCELLED');
      }
      await act(sub.id, 'plan').send({ planId: PLAN_2M }).expect(409);
      await act(sub.id, 'address')
        .send({ addressId: await createAddress(buyer) })
        .expect(409);
      await act(sub.id, 'reschedule')
        .send({ date: toISODate(addDays(todayInBangkok(), 5)) })
        .expect(409);

      const row = await prisma.subscription.findUniqueOrThrow({
        where: { id: sub.id },
      });
      expect(row.status).toBe('cancelled');
    });

    it('ยกเลิกรายการของคนอื่น → 404', async () => {
      const sub = await newSubscription();
      await act(sub.id, 'cancel', other).expect(404);
    });
  });

  /** ทุก endpoint ต้องมีด่าน token ไม่ใช่แค่ตัวแรกของกลุ่ม (docs/testing.md §3) */
  it('เรียกทุก action โดยไม่มี token → 401 ทั้งหมด', async () => {
    const sub = await newSubscription();
    for (const action of [
      'skip',
      'pause',
      'resume',
      'reschedule',
      'plan',
      'address',
      'cancel',
    ]) {
      await api(app)
        .post(`/api/v1/subscriptions/${sub.id}/${action}`)
        .send({})
        .expect(401);
    }
  });
});
