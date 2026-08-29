import { INestApplication } from '@nestjs/common';
import { toISODate, todayInBangkok, addDays } from '../src/common/date';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, ApiError, createTestApp } from './utils/app';
import { cardBody } from './utils/card';
import {
  bearer,
  cleanupTestUsers,
  registerTestUser,
  type TestUser,
} from './utils/auth';

const PLAN_1M = '30000000-0000-4000-8000-000000000002'; // ราคา 255/เดือน (seed)
const PLAN_CLOSED = '30000000-0000-4000-8000-000000000005'; // isActive = false
const PLAN_PRICE = 255;

const ADDRESS = {
  recipientName: 'ผู้รับ เช็คเอาท์',
  phone: '0812345678',
  addressLine: '9 ถนนทดสอบ',
  province: 'กรุงเทพมหานคร',
  postcode: '10900',
};

const tomorrow = () => toISODate(addDays(todayInBangkok(), 1));

describe('Checkout — สมัครรับสินค้า (POST /subscriptions)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyer: TestUser;
  let other: TestUser;
  let addressId: string;
  let cardId: string;
  let otherAddressId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupTestUsers(prisma);

    buyer = await registerTestUser(app, 'checkout');
    other = await registerTestUser(app, 'checkout-other');

    addressId = await createAddress(buyer);
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

  async function createAddress(user: TestUser): Promise<string> {
    const res = await api(app)
      .post('/api/v1/me/addresses')
      .set(bearer(user.accessToken))
      .send(ADDRESS)
      .expect(201);
    return (res.body as { id: string }).id;
  }

  const body = (over: Record<string, unknown> = {}) => ({
    planId: PLAN_1M,
    quantity: 2,
    addressId,
    paymentMethodId: cardId,
    startDate: tomorrow(),
    ...over,
  });

  it('สมัครสำเร็จ → สร้าง subscription + order + payment ครบในทรานแซกชันเดียว', async () => {
    const res = await api(app)
      .post('/api/v1/subscriptions')
      .set(bearer(buyer.accessToken))
      .send(body())
      .expect(201);

    const result = res.body as {
      subscription: {
        id: string;
        status: string;
        nextOrderDate: string;
        cycle: string;
      };
      firstOrder: {
        id: string;
        amount: number;
        cycleDate: string;
        status: string;
      };
    };

    expect(result.subscription.status).toBe('active');
    expect(result.subscription.cycle).toBe('1m');
    // ★ ยอดมาจากราคาใน DB × จำนวน ไม่ใช่จากอะไรที่ client ส่งมา
    expect(result.firstOrder.amount).toBe(PLAN_PRICE * 2);
    expect(result.firstOrder.cycleDate).toBe(tomorrow());
    // รอบถัดไป = วันเริ่ม + 1 เดือน
    expect(result.subscription.nextOrderDate).not.toBe(tomorrow());

    // ตรวจของจริงใน DB ไม่ใช่แค่ response
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: result.firstOrder.id },
      include: { payment: true },
    });
    expect(order.amount.toNumber()).toBe(PLAN_PRICE * 2);
    expect(order.buyerId).toBe(buyer.id);
    expect(order.payment?.status).toBe('paid');
    expect(order.payment?.paidAt).not.toBeNull();

    // audit trail ต้องมี
    const events = await prisma.subscriptionEvent.count({
      where: { subscriptionId: result.subscription.id, event: 'created' },
    });
    expect(events).toBe(1);

    // ร้านต้องได้รับแจ้งเตือน
    const notified = await prisma.notification.count({
      where: {
        user: {
          shop: { products: { some: { plans: { some: { id: PLAN_1M } } } } },
        },
        type: 'new_subscriber',
      },
    });
    expect(notified).toBeGreaterThanOrEqual(1);
  });

  it('สมัครซ้ำแผนเดิม ที่อยู่เดิม → 409 (กันกดปุ่มรัวแล้วโดนตัดเงิน 2 ครั้ง)', async () => {
    const res = await api(app)
      .post('/api/v1/subscriptions')
      .set(bearer(buyer.accessToken))
      .send(body())
      .expect(409);

    expect((res.body as ApiError).code).toBe('ALREADY_SUBSCRIBED');

    const count = await prisma.subscription.count({
      where: { buyerId: buyer.id, planId: PLAN_1M },
    });
    expect(count).toBe(1);
  });

  it('★ แนบ amount มากับ body → 400 และไม่มีรายการเกิดขึ้น', async () => {
    const before = await prisma.subscription.count({
      where: { buyerId: other.id },
    });

    await api(app)
      .post('/api/v1/subscriptions')
      .set(bearer(other.accessToken))
      .send({
        planId: PLAN_1M,
        quantity: 1,
        addressId: otherAddressId,
        paymentMethodId: cardId,
        startDate: tomorrow(),
        amount: 1,
      })
      .expect(400);

    expect(
      await prisma.subscription.count({ where: { buyerId: other.id } }),
    ).toBe(before);
  });

  it('ใช้ addressId ของคนอื่น → 404 (ownership check)', async () => {
    const res = await api(app)
      .post('/api/v1/subscriptions')
      .set(bearer(buyer.accessToken))
      .send(body({ addressId: otherAddressId }))
      .expect(404);

    expect((res.body as ApiError).code).toBe('ADDRESS_NOT_FOUND');
  });

  it('ใช้บัตรของคนอื่น → 404', async () => {
    await api(app)
      .post('/api/v1/subscriptions')
      .set(bearer(other.accessToken))
      .send({
        planId: PLAN_1M,
        quantity: 1,
        addressId: otherAddressId,
        paymentMethodId: cardId, // บัตรของ buyer
        startDate: tomorrow(),
      })
      .expect(404);
  });

  it('แผนที่ปิดรับสมาชิกแล้ว → 409', async () => {
    const res = await api(app)
      .post('/api/v1/subscriptions')
      .set(bearer(other.accessToken))
      .send(body({ planId: PLAN_CLOSED, addressId: otherAddressId }))
      .expect(409);

    expect((res.body as ApiError).code).toBe('PLAN_UNAVAILABLE');
  });

  it('วันเริ่มรอบเป็นวันนี้หรืออดีต → 422', async () => {
    const today = toISODate(todayInBangkok());
    const res = await api(app)
      .post('/api/v1/subscriptions')
      .set(bearer(other.accessToken))
      .send(body({ startDate: today, addressId: otherAddressId }))
      .expect(422);

    expect((res.body as ApiError).code).toBe('START_DATE_OUT_OF_RANGE');
  });

  it('วันที่ไม่มีจริง (30 ก.พ.) → 400 ไม่ใช่ 500', async () => {
    await api(app)
      .post('/api/v1/subscriptions')
      .set(bearer(other.accessToken))
      .send(body({ startDate: '2027-02-30', addressId: otherAddressId }))
      .expect(400);
  });

  it('quantity เกิน 10 → 400', async () => {
    await api(app)
      .post('/api/v1/subscriptions')
      .set(bearer(other.accessToken))
      .send(body({ quantity: 99, addressId: otherAddressId }))
      .expect(400);
  });

  it('ไม่มี token → 401', async () => {
    await api(app).post('/api/v1/subscriptions').send(body()).expect(401);
    await api(app).get('/api/v1/subscriptions').expect(401);
  });

  it('GET /subscriptions → เห็นเฉพาะของตัวเอง', async () => {
    const mine = await api(app)
      .get('/api/v1/subscriptions')
      .set(bearer(buyer.accessToken))
      .expect(200);
    expect((mine.body as unknown[]).length).toBe(1);

    const theirs = await api(app)
      .get('/api/v1/subscriptions')
      .set(bearer(other.accessToken))
      .expect(200);
    expect(theirs.body).toEqual([]);
  });

  it('เปิดดู subscription ของคนอื่น → 404', async () => {
    const mine = await api(app)
      .get('/api/v1/subscriptions')
      .set(bearer(buyer.accessToken))
      .expect(200);
    const id = (mine.body as { id: string }[])[0]?.id;

    const res = await api(app)
      .get(`/api/v1/subscriptions/${id}`)
      .set(bearer(other.accessToken))
      .expect(404);
    expect((res.body as ApiError).code).toBe('SUBSCRIPTION_NOT_FOUND');
  });
});
