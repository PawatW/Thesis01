import { INestApplication } from '@nestjs/common';
import { addDays, toISODate, todayInBangkok } from '../src/common/date';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, ApiError, createTestApp } from './utils/app';
import { cardBody } from './utils/card';
import {
  bearer,
  cleanupTestUsers,
  E2E_PREFIX,
  registerTestUser,
  type TestUser,
} from './utils/auth';

const PLAN_1M = '30000000-0000-4000-8000-000000000002'; // กาแฟรายเดือน 255 (Bean Story)
const PLAN_2M = '30000000-0000-4000-8000-000000000003'; // กาแฟราย 2 เดือน (สินค้าชิ้นเดียวกัน)
const PLAN_PRICE = 255;
const BEAN_STORY = '10000000-0000-4000-8000-000000000001';

/**
 * บวกเดือนแบบหนีบปลายเดือน — **เขียนซ้ำในเทสโดยตั้งใจ**
 * ถ้าเรียก `addMonths` ของโค้ดจริง เทสจะยืนยันได้แค่ว่าโค้ดเท่ากับตัวมันเอง
 */
function monthsFrom(anchor: Date, months: number): Date {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + months + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(y, m + months, Math.min(anchor.getUTCDate(), lastDay)),
  );
}

const ADDRESS = {
  recipientName: 'ผู้รับ เอนจิน',
  phone: '0812345678',
  addressLine: '1 ถนนรอบส่ง',
  province: 'กรุงเทพมหานคร',
  postcode: '10900',
};

interface RunResult {
  id: number;
  runDate: string;
  ordersCreated: number;
  notificationsCreated: number;
  detail: { due: number; skipped: number; upcoming: number; failed: number };
}

/**
 * Recurring engine (feature 13 · W06) — บทที่อธิบายละเอียดที่สุดในเล่ม
 *
 * สิ่งที่ไฟล์นี้ต้องพิสูจน์ให้ได้ (Acceptance Criteria ของ feature 13):
 *   1. รัน 1 ครั้ง → ออเดอร์ + การจ่ายเงิน + แจ้งเตือน ครบ และวันรอบขยับถูก
 *   2. **รันซ้ำวันเดิม → ไม่มีอะไรซ้ำและไม่มีรอบไหนหาย** (ชิ้นเอกของการนำเสนอ)
 *   3. skip/pause แล้วรอบนั้นต้องไม่เกิดออเดอร์
 *   4. ร้านที่แอดมินระงับต้องไม่ถูกเรียกเก็บเงินเด็ดขาด
 *   5. เรียก endpoint ด้วยบัญชีธรรมดา → 403 · ไม่มี token → 401
 */
describe('Engine — รอบอัตโนมัติ (POST /admin/engine/run)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: TestUser;
  let buyer: TestUser;
  let cardId: string;

  /**
   * engine ทำงานกับ "ทุก subscription ในระบบ" ตามธรรมชาติของมัน — รวมของ seed ด้วย
   * จึงถ่ายรูปสถานะรายการที่ไม่ใช่ของเทสไว้ก่อน แล้วคืนให้เหมือนเดิมตอนจบ
   * (ไฟล์อื่นและงานพัฒนาใช้ฐานข้อมูลตัวเดียวกันนี้)
   */
  let othersBefore: {
    id: string;
    nextOrderDate: Date | null;
    cycleAnchorDate: Date;
  }[] = [];
  let startedAt: Date;

  beforeAll(async () => {
    // time-travel เปิดได้เฉพาะเครื่องเดโม่ — ต้องตั้งก่อนสร้างแอปเพราะ env
    // ถูกอ่านและตรวจตอนบูตครั้งเดียว (config/env.ts)
    process.env.DEMO_MODE = 'true';
    ({ app, prisma } = await createTestApp());
    await cleanupTestUsers(prisma);

    startedAt = new Date();
    othersBefore = await prisma.subscription.findMany({
      where: { buyer: { email: { not: { startsWith: E2E_PREFIX } } } },
      select: { id: true, nextOrderDate: true, cycleAnchorDate: true },
    });

    buyer = await registerTestUser(app, 'engine-buyer');
    admin = await registerTestUser(app, 'engine-admin');
    // ยกระดับสิทธิ์ผ่าน DB เท่านั้น — ไม่มี endpoint ไหนให้ยกระดับตัวเองได้
    await prisma.user.update({
      where: { id: admin.id },
      data: { isAdmin: true },
    });

    const card = await api(app)
      .post('/api/v1/me/payment-methods')
      .set(bearer(buyer.accessToken))
      .send(cardBody())
      .expect(201);
    cardId = (card.body as { id: string }).id;
  });

  afterAll(async () => {
    if (prisma) {
      // ลบร่องรอยที่ engine ทิ้งไว้กับข้อมูล seed แล้วคืนวันรอบให้เหมือนเดิม
      await prisma.payment.deleteMany({
        where: { order: { createdAt: { gte: startedAt } } },
      });
      await prisma.order.deleteMany({
        where: { createdAt: { gte: startedAt } },
      });
      await prisma.notification.deleteMany({
        where: { createdAt: { gte: startedAt } },
      });
      await prisma.engineRun.deleteMany({
        where: { ranAt: { gte: startedAt } },
      });
      for (const sub of othersBefore) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            nextOrderDate: sub.nextOrderDate,
            cycleAnchorDate: sub.cycleAnchorDate,
          },
        });
      }
      await prisma.shop.update({
        where: { id: BEAN_STORY },
        data: { suspendedAt: null, suspendedReason: null },
      });
      await cleanupTestUsers(prisma);
    }
    if (app) await app.close();
    delete process.env.DEMO_MODE;
  });

  // ---------- ตัวช่วย ----------

  async function newSubscription(opts: {
    /** ตั้งวันรอบถัดไปให้ตรงกับเคสที่จะทดสอบ (ผ่าน DB — ไม่มี endpoint ให้ตั้งตรง ๆ) */
    dueInDays: number;
    quantity?: number;
    planId?: string;
  }): Promise<string> {
    const address = await api(app)
      .post('/api/v1/me/addresses')
      .set(bearer(buyer.accessToken))
      .send(ADDRESS)
      .expect(201);

    const res = await api(app)
      .post('/api/v1/subscriptions')
      .set(bearer(buyer.accessToken))
      .send({
        planId: opts.planId ?? PLAN_1M,
        quantity: opts.quantity ?? 1,
        addressId: (address.body as { id: string }).id,
        paymentMethodId: cardId,
        startDate: toISODate(addDays(todayInBangkok(), 1)),
      })
      .expect(201);

    const id = (res.body as { subscription: { id: string } }).subscription.id;
    const due = addDays(todayInBangkok(), opts.dueInDays);
    await prisma.subscription.update({
      where: { id },
      data: { nextOrderDate: due, cycleAnchorDate: due },
    });
    return id;
  }

  const runEngine = (runDate?: string, user: TestUser = admin) =>
    api(app)
      .post('/api/v1/admin/engine/run')
      .set(bearer(user.accessToken))
      .send(runDate === undefined ? {} : { runDate });

  const ordersOf = (subscriptionId: string) =>
    prisma.order.findMany({
      where: { subscriptionId },
      orderBy: { cycleDate: 'asc' },
      include: { payment: true },
    });

  // ---------- งานหลัก ----------

  it('รันครั้งแรก → ได้ออเดอร์ + ตัดเงินจำลอง + แจ้งเตือน และวันรอบถัดไปขยับ', async () => {
    const id = await newSubscription({ dueInDays: 0, quantity: 2 });

    const res = await runEngine().expect(200);
    expect((res.body as RunResult).ordersCreated).toBeGreaterThanOrEqual(1);

    // ออเดอร์รอบแรกจากตอน checkout + รอบที่ engine เพิ่งสร้าง
    const orders = await ordersOf(id);
    const cycle = orders.find(
      (o) => toISODate(o.cycleDate) === toISODate(todayInBangkok()),
    );
    expect(cycle).toBeDefined();
    // ★ ยอดมาจากราคาใน DB × จำนวน ไม่ใช่ค่าที่ใครส่งมา
    expect(cycle?.amount.toNumber()).toBe(PLAN_PRICE * 2);
    expect(cycle?.payment?.status).toBe('paid');
    expect(cycle?.payment?.paidAt).not.toBeNull();
    expect(cycle?.addressSnapshot).toMatchObject({
      recipient_name: ADDRESS.recipientName,
    });

    // ★ วันรอบถัดไปต้องเป็นค่าที่ระบุได้แน่นอน (หมุด + 1 เดือน) ไม่ใช่แค่ "อนาคต"
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id } });
    expect(toISODate(sub.nextOrderDate as Date)).toBe(
      toISODate(monthsFrom(todayInBangkok(), 1)),
    );

    const notified = await prisma.notification.count({
      where: { userId: buyer.id, type: 'order_created' },
    });
    expect(notified).toBeGreaterThanOrEqual(1);

    // ร้านต้องได้สรุปประจำวัน 1 ใบ ไม่ใช่แจ้งทีละออเดอร์
    const summary = await prisma.notification.count({
      where: { type: 'engine_summary', createdAt: { gte: startedAt } },
    });
    expect(summary).toBeGreaterThanOrEqual(1);
  });

  it('★ รันซ้ำวันเดิม 2 ครั้ง → ไม่มีออเดอร์ซ้ำ และวันรอบไม่ขยับต่อ', async () => {
    const id = await newSubscription({ dueInDays: 0 });

    await runEngine().expect(200);
    const afterFirst = await prisma.subscription.findUniqueOrThrow({
      where: { id },
    });
    const countFirst = (await ordersOf(id)).length;

    const second = await runEngine().expect(200);
    const third = await runEngine().expect(200);

    // รอบที่ 2-3 ต้องไม่สร้างอะไรของ sub นี้เพิ่ม และต้องไม่มีรายการล้มเหลว
    expect((await ordersOf(id)).length).toBe(countFirst);
    expect((second.body as RunResult).detail.failed).toBe(0);
    expect((third.body as RunResult).detail.failed).toBe(0);

    const afterThird = await prisma.subscription.findUniqueOrThrow({
      where: { id },
    });
    // ★ หัวใจของ idempotency: รอบต้องไม่ถูกเลื่อนซ้ำ ไม่งั้นรอบถัดไปหายเงียบ
    expect(afterThird.nextOrderDate?.getTime()).toBe(
      afterFirst.nextOrderDate?.getTime(),
    );

    // engine_runs ต้องเพิ่มทุกครั้งที่รัน แม้จะไม่มีออเดอร์ใหม่ (ไว้ตรวจย้อนหลัง)
    const runs = await prisma.engineRun.count({
      where: { ranAt: { gte: startedAt } },
    });
    expect(runs).toBeGreaterThanOrEqual(3);
  });

  /**
   * ★ เคสที่พิสูจน์ว่าคอลัมน์ `cycle_anchor_date` ทำงานจริง ★
   *
   * หมุดเป็นวันที่ 31 แล้วรอบถัดไปต้องกลับไปเป็น "วันสุดท้ายของเดือน" เสมอ
   * ถ้าใครแก้ engine ให้บวกทบจาก `cycleDate` (เท่ากับก่อนมีคอลัมน์นี้)
   * วันจะยุบเป็นวันที่ของ cycleDate ถาวร แล้วเคสนี้จะแดงทันที
   *
   * ค่าที่คาดหวังคำนวณเองในเทส ไม่เรียก `nextCycleAfter` ของโค้ดจริง — ไม่งั้น
   * เทสก็แค่ยืนยันว่าโค้ดเท่ากับตัวมันเอง
   */
  it('★ หมุดเป็นวันสิ้นเดือน → รอบถัดไปกลับไปเป็นวันสิ้นเดือน ไม่ยุบตามวันที่รัน', async () => {
    const today = todayInBangkok();
    const id = await newSubscription({ dueInDays: 0 });

    // หมุด = วันที่ 31 ของเดือนก่อน ๆ (ผ่านเดือนที่มี 28/30 วันมาแล้ว)
    const anchor = new Date(Date.UTC(today.getUTCFullYear(), 0, 31));
    await prisma.subscription.update({
      where: { id },
      data: { cycleAnchorDate: anchor, nextOrderDate: today },
    });

    await runEngine().expect(200);

    // วันสุดท้ายของเดือนนี้ (หรือของเดือนถัดไป ถ้าวันนี้เป็นวันสุดท้ายพอดี)
    const endOfThisMonth = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0),
    );
    const expected =
      endOfThisMonth > today
        ? endOfThisMonth
        : new Date(
            Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 0),
          );

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id } });
    expect(toISODate(sub.nextOrderDate as Date)).toBe(toISODate(expected));
    // หมุดต้องไม่ขยับ — engine อ่านอย่างเดียว
    expect(toISODate(sub.cycleAnchorDate)).toBe(toISODate(anchor));
  });

  it('★ วันรอบถูกตั้งกลับไปวันที่เคยสร้างออเดอร์แล้ว → UNIQUE ที่ DB กันไว้ ไม่เกิดออเดอร์ซ้ำ', async () => {
    const id = await newSubscription({ dueInDays: 0 });
    const today = todayInBangkok();

    await runEngine().expect(200);
    const countAfterFirst = (await ordersOf(id)).length;

    // จำลองสภาพที่ปกติเกิดไม่ได้ (ข้อมูลถูกแก้มือ / งานค้างจากรอบก่อน) เพื่อบังคับ
    // ให้เดินเข้าเส้นทาง insert ชน unique — เส้นทางที่ idempotency ทั้งหมดพึ่งอยู่
    await prisma.subscription.update({
      where: { id },
      data: { nextOrderDate: today },
    });

    const res = await runEngine().expect(200);
    expect((res.body as RunResult).detail.skipped).toBeGreaterThanOrEqual(1);
    expect((res.body as RunResult).detail.failed).toBe(0);
    expect((await ordersOf(id)).length).toBe(countAfterFirst);

    // ★ และวันรอบต้องไม่ถูกเลื่อน เพราะออเดอร์ไม่ได้ถูกสร้างจริง ★
    // (ถ้าเลื่อน = รอบนั้นหายเงียบ ผู้ซื้อจ่ายเงินแล้วไม่ได้ของ — บั๊กร้ายแรงสุดของระบบ)
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id } });
    expect(toISODate(sub.nextOrderDate as Date)).toBe(toISODate(today));
  });

  it('ผู้ใช้กด skip ก่อนถึงรอบ → วันนั้น engine ไม่สร้างออเดอร์ (flow ที่ต้องโชว์กรรมการ)', async () => {
    const id = await newSubscription({ dueInDays: 0 });
    const today = toISODate(todayInBangkok());

    await api(app)
      .post(`/api/v1/subscriptions/${id}/skip`)
      .set(bearer(buyer.accessToken))
      .expect(201);

    await runEngine().expect(200);

    const orders = await ordersOf(id);
    expect(orders.some((o) => toISODate(o.cycleDate) === today)).toBe(false);
  });

  it('รายการที่หยุดชั่วคราว → ไม่ถูกเรียกเก็บเงิน', async () => {
    const id = await newSubscription({ dueInDays: 0 });
    await api(app)
      .post(`/api/v1/subscriptions/${id}/pause`)
      .set(bearer(buyer.accessToken))
      .expect(201);
    const before = (await ordersOf(id)).length;

    await runEngine().expect(200);
    expect((await ordersOf(id)).length).toBe(before);
  });

  it('★ ร้านถูกแอดมินระงับ → ไม่สร้างออเดอร์และไม่ตัดเงิน', async () => {
    const id = await newSubscription({ dueInDays: 0 });
    const before = (await ordersOf(id)).length;

    await prisma.shop.update({
      where: { id: BEAN_STORY },
      data: { suspendedAt: new Date(), suspendedReason: 'ทดสอบ' },
    });
    try {
      await runEngine().expect(200);
      expect((await ordersOf(id)).length).toBe(before);

      const sub = await prisma.subscription.findUniqueOrThrow({
        where: { id },
      });
      // วันรอบต้องค้างไว้ที่เดิมด้วย — ไม่ใช่ข้ามรอบให้ฟรี ๆ
      expect(toISODate(sub.nextOrderDate as Date)).toBe(
        toISODate(todayInBangkok()),
      );
    } finally {
      await prisma.shop.update({
        where: { id: BEAN_STORY },
        data: { suspendedAt: null, suspendedReason: null },
      });
    }
  });

  it('cron ไม่ได้รันไปหลายเดือน → เก็บตกรอบที่ค้าง 1 ใบ แล้วเดินต่อจากวันนี้', async () => {
    const id = await newSubscription({ dueInDays: -40 });
    const missed = toISODate(addDays(todayInBangkok(), -40));

    await runEngine().expect(200);

    const orders = await ordersOf(id);
    // cycle_date เป็นวันที่ควรเกิดจริง ไม่ใช่วันที่รัน
    expect(orders.some((o) => toISODate(o.cycleDate) === missed)).toBe(true);
    // แต่ต้องไม่ไล่สร้างย้อนหลังทุกงวด — ผู้ซื้อไม่ควรถูกตัดเงินรัว
    const backlog = orders.filter(
      (o) =>
        o.cycleDate < todayInBangkok() && toISODate(o.cycleDate) !== missed,
    );
    expect(backlog.length).toBe(0);

    // รอบใหม่ต้องยังอยู่บนกริดของหมุด (หมุด = วันที่ค้างเมื่อ 40 วันก่อน) —
    // ไม่ใช่ "วันที่รัน + 1 เดือน" ซึ่งจะทำให้วันตัดเงินเลื่อนไปเรื่อย ๆ ทุกครั้งที่ cron ล่ม
    const anchor = addDays(todayInBangkok(), -40);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id } });
    expect(toISODate(sub.nextOrderDate as Date)).toBe(
      toISODate(monthsFrom(anchor, 2)),
    );
  });

  it('แจ้งล่วงหน้า T-3 → แจ้ง 1 ใบ และรันซ้ำก็ไม่แจ้งซ้ำ', async () => {
    const id = await newSubscription({ dueInDays: 3 });

    await runEngine().expect(200);
    await runEngine().expect(200);

    const notices = await prisma.notification.count({
      where: {
        userId: buyer.id,
        type: 'upcoming_cycle',
        linkPath: { startsWith: `/subscriptions/${id}` },
      },
    });
    expect(notices).toBe(1);

    // ยังไม่ถึงรอบ จึงต้องไม่มีออเดอร์ของวันนั้น
    const orders = await ordersOf(id);
    expect(
      orders.some(
        (o) =>
          toISODate(o.cycleDate) === toISODate(addDays(todayInBangkok(), 3)),
      ),
    ).toBe(false);
  });

  // ---------- time-travel + สิทธิ์ ----------

  it('time-travel ไปข้างหน้า → รายการที่ถึงรอบเกิดออเดอร์ ส่วนที่ยังไม่ถึงต้องไม่เกิด', async () => {
    const soon = await newSubscription({ dueInDays: 20 });
    const later = await newSubscription({ dueInDays: 45, planId: PLAN_2M });
    const future = toISODate(addDays(todayInBangkok(), 25));

    await runEngine(future).expect(200);

    expect(
      (await ordersOf(soon)).some(
        (o) =>
          toISODate(o.cycleDate) === toISODate(addDays(todayInBangkok(), 20)),
      ),
    ).toBe(true);

    // อีก 45 วันถึงจะถึงรอบ — เดินเวลาไป 25 วันแล้วต้องยังไม่ถูกตัดเงิน
    // (ออเดอร์ที่มีคือใบแรกจากตอน checkout เท่านั้น)
    const laterOrders = await ordersOf(later);
    expect(
      laterOrders.some(
        (o) =>
          toISODate(o.cycleDate) === toISODate(addDays(todayInBangkok(), 45)),
      ),
    ).toBe(false);
  });

  it('runDate นอกช่วง ±180 วัน → 422 · รูปแบบวันที่ผิด → 400', async () => {
    const far = toISODate(addDays(todayInBangkok(), 400));
    const res = await runEngine(far).expect(422);
    expect((res.body as ApiError).code).toBe('RUN_DATE_OUT_OF_RANGE');

    await runEngine('16/08/2026').expect(400);
    await runEngine('2027-02-30').expect(400);
  });

  it('บัญชีผู้ซื้อธรรมดาสั่ง engine → 403 · ไม่มี token → 401', async () => {
    const res = await runEngine(undefined, buyer).expect(403);
    expect((res.body as ApiError).code).toBe('FORBIDDEN_ROLE');

    await api(app).post('/api/v1/admin/engine/run').send({}).expect(401);
    await api(app).get('/api/v1/admin/engine/runs').expect(401);
  });

  it('GET /admin/engine/runs → admin เห็นประวัติการรัน · ผู้ซื้อไม่เห็น', async () => {
    const res = await api(app)
      .get('/api/v1/admin/engine/runs?limit=5')
      .set(bearer(admin.accessToken))
      .expect(200);

    const rows = res.body as RunResult[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(rows[0]?.runDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await api(app)
      .get('/api/v1/admin/engine/runs')
      .set(bearer(buyer.accessToken))
      .expect(403);
  });

  /**
   * ด่านที่สองของ time-travel: ต่อให้เป็น admin ถ้าเครื่องไม่ได้เปิดโหมดเดโม่
   * ก็ระบุวันที่เองไม่ได้ — และ "รันวันนี้" ต้องยังทำได้ตามปกติ
   */
  it('★ DEMO_MODE ปิดอยู่ → admin ระบุ runDate เองไม่ได้ (403) แต่รันวันนี้ได้', async () => {
    process.env.DEMO_MODE = 'false';
    try {
      const res = await runEngine(
        toISODate(addDays(todayInBangkok(), 5)),
      ).expect(403);
      expect((res.body as ApiError).code).toBe('TIME_TRAVEL_DISABLED');

      await runEngine().expect(200);
    } finally {
      process.env.DEMO_MODE = 'true';
    }
  });

  it('★ ไม่ได้ตั้ง DEMO_MODE ไว้เลย → ปิดโดยปริยาย (fail closed)', async () => {
    delete process.env.DEMO_MODE;
    try {
      await runEngine(toISODate(addDays(todayInBangkok(), 5))).expect(403);
    } finally {
      process.env.DEMO_MODE = 'true';
    }
  });
});
