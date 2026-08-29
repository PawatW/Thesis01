import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, createTestApp } from './utils/app';
import { cardBody } from './utils/card';
import { cleanupTestUsers, registerTestUser } from './utils/auth';

/**
 * เคสที่ agent รีวิวจับได้ และ test ชุดเดิมมองไม่เห็น
 *
 * T-24 เดิมทดสอบเฉพาะการใช้ refresh token ซ้ำ "แบบเรียงกัน" ซึ่งผ่านมาตลอด
 * แต่จังหวะที่อันตรายจริงคือ "ยิงพร้อมกัน" — เจ้าของกับคนที่ขโมย token ไป
 * ยิงในเวลาไล่เลี่ยกัน ถ้าโค้ดเช็ค revokedAt ด้วย `if` แล้วค่อยเขียนทีหลัง
 * ทั้งคู่จะผ่าน แล้ว token ใบเดียวจะแลกได้ 2 session โดยไม่มีการแจ้งเตือน
 */
describe('Auth — refresh token แข่งกัน (race condition)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupTestUsers(prisma);
  });

  afterAll(async () => {
    if (prisma) await cleanupTestUsers(prisma);
    if (app) await app.close();
  });

  it('ยิง refresh พร้อมกัน 2 ครั้งด้วย token ใบเดียว → สำเร็จได้แค่ 1', async () => {
    const user = await registerTestUser(app, 'race');

    const [a, b] = await Promise.all([
      api(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: user.refreshToken }),
      api(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: user.refreshToken }),
    ]);

    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 401]);

    // ผู้ชนะได้ session เดียว · ผู้แพ้ถูกตีความว่า token รั่ว → ตัดทุก session
    // ไม่ว่าทางไหน จำนวน token ที่ยังใช้ได้ต้องไม่เกิน 1 ใบ
    const alive = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    });
    expect(alive).toBeLessThanOrEqual(1);
  });

  it('เพิ่มที่อยู่พร้อมกัน 2 อัน ทั้งคู่ขอเป็นที่อยู่หลัก → เหลือหลักอันเดียว', async () => {
    const user = await registerTestUser(app, 'addr-race');
    const body = {
      recipientName: 'ผู้รับ ทดสอบ',
      phone: '0812345678',
      addressLine: '1 ถนนทดสอบ',
      province: 'กรุงเทพมหานคร',
      postcode: '10900',
      isDefault: true,
    };

    await Promise.all([
      api(app)
        .post('/api/v1/me/addresses')
        .set({ Authorization: `Bearer ${user.accessToken}` })
        .send(body),
      api(app)
        .post('/api/v1/me/addresses')
        .set({ Authorization: `Bearer ${user.accessToken}` })
        .send({ ...body, label: 'ที่ทำงาน' }),
    ]);

    // unique index `addresses_one_default_per_user` เป็นด่านที่บังคับข้อนี้จริง
    // ไม่ใช่ logic ใน service ซึ่งที่ READ COMMITTED มองไม่เห็นแถวของอีกทรานแซกชัน
    const defaults = await prisma.address.count({
      where: { userId: user.id, isDefault: true },
    });
    expect(defaults).toBe(1);
  });

  /**
   * T-21 — เคสที่แพงที่สุดถ้าพลาด: กดยืนยันสมัครรัว ๆ แล้วถูกตัดเงิน 2 ครั้ง
   *
   * ฝั่งแอปมี re-entrancy guard ด้วย `useRef` อยู่แล้ว แต่กฎข้อ 2 บอกว่าทุก request
   * ถือว่าเขียนด้วยมือ — 2 เส้น curl ยิงพร้อมกันข้าม guard ของหน้าจอได้ทันที
   * ด่านจริงคือ partial unique index `subs_one_live_per_plan_address` ที่ DB
   */
  it('★ ยิง POST /subscriptions พร้อมกัน 3 เส้น → ได้ subscription 1 รายการ ตัดเงินครั้งเดียว', async () => {
    const user = await registerTestUser(app, 'subscribe-race');
    const PLAN_1M = '30000000-0000-4000-8000-000000000002';
    const auth = { Authorization: `Bearer ${user.accessToken}` };

    const address = await api(app)
      .post('/api/v1/me/addresses')
      .set(auth)
      .send({
        recipientName: 'ผู้รับ ยิงรัว',
        phone: '0812345678',
        addressLine: '2 ถนนทดสอบ',
        province: 'กรุงเทพมหานคร',
        postcode: '10900',
      })
      .expect(201);
    const card = await api(app)
      .post('/api/v1/me/payment-methods')
      .set(auth)
      .send(cardBody())
      .expect(201);

    const tomorrow = new Date(Date.now() + 7 * 3600_000 + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const body = {
      planId: PLAN_1M,
      quantity: 1,
      addressId: (address.body as { id: string }).id,
      paymentMethodId: (card.body as { id: string }).id,
      startDate: tomorrow,
    };

    const results = await Promise.all([
      api(app).post('/api/v1/subscriptions').set(auth).send(body),
      api(app).post('/api/v1/subscriptions').set(auth).send(body),
      api(app).post('/api/v1/subscriptions').set(auth).send(body),
    ]);

    // สำเร็จ 1 · ที่เหลือต้องได้ 409 ที่อ่านรู้เรื่อง ไม่ใช่ 500 จาก unique violation
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const failed of results.filter((r) => r.status !== 201)) {
      expect(failed.status).toBe(409);
      expect((failed.body as { code: string }).code).toBe('ALREADY_SUBSCRIBED');
    }

    // ★ นับของจริงใน DB ★ ไม่ใช่ดูแค่ status code ที่ตอบกลับ
    expect(
      await prisma.subscription.count({ where: { buyerId: user.id } }),
    ).toBe(1);
    expect(await prisma.order.count({ where: { buyerId: user.id } })).toBe(1);
    expect(
      await prisma.payment.count({ where: { order: { buyerId: user.id } } }),
    ).toBe(1);
  });
});
