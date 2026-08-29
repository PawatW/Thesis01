import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, createTestApp } from './utils/app';
import {
  bearer,
  cleanupTestUsers,
  registerTestUser,
  type TestUser,
} from './utils/auth';

interface NotificationList {
  items: { id: number; title: string; readAt: string | null }[];
  unreadCount: number;
}

/**
 * Feature 08 — การแจ้งเตือน
 *
 * คำถามที่ไฟล์นี้ต้องตอบ: ผู้ใช้เห็นของคนอื่นได้ไหม · กด "อ่านแล้ว" ซ้ำแล้ว
 * เวลาที่อ่านครั้งแรกเพี้ยนไหม · และมี endpoint ไหนให้ปลอมแจ้งเตือนได้หรือเปล่า
 */
describe('Feature 08 — การแจ้งเตือน', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let me: TestUser;
  let other: TestUser;
  let mineId = 0;
  let theirsId = 0;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupTestUsers(prisma);

    me = await registerTestUser(app, 'noti-me');
    other = await registerTestUser(app, 'noti-other');

    const mine = await prisma.notification.create({
      data: {
        userId: me.id,
        type: 'upcoming_cycle',
        title: 'อีก 3 วันถึงรอบส่ง',
        body: 'กาแฟคั่วกลาง — ข้ามรอบได้ถึงพรุ่งนี้',
        linkPath: '/subscriptions',
      },
    });
    mineId = mine.id;

    const theirs = await prisma.notification.create({
      data: {
        userId: other.id,
        type: 'order_status',
        title: 'ของคนอื่น',
        linkPath: '/orders',
      },
    });
    theirsId = theirs.id;
  });

  afterAll(async () => {
    if (prisma) await cleanupTestUsers(prisma);
    if (app) await app.close();
  });

  it('เห็นเฉพาะของตัวเอง + นับจำนวนที่ยังไม่อ่านมาให้', async () => {
    const res = await api(app)
      .get('/api/v1/notifications')
      .set(bearer(me.accessToken))
      .expect(200);
    const body = res.body as NotificationList;

    expect(body.items.map((n) => n.id)).toContain(mineId);
    expect(body.items.map((n) => n.id)).not.toContain(theirsId);
    expect(body.unreadCount).toBeGreaterThanOrEqual(1);
  });

  it('แท็บ "ยังไม่อ่าน" กรองถูก · ไม่มี token → 401', async () => {
    const res = await api(app)
      .get('/api/v1/notifications?filter=unread')
      .set(bearer(me.accessToken))
      .expect(200);
    for (const item of (res.body as NotificationList).items) {
      expect(item.readAt).toBeNull();
    }

    await api(app).get('/api/v1/notifications').expect(401);
  });

  it('★ กด "อ่านแล้ว" ซ้ำ → เวลาที่อ่านครั้งแรกต้องไม่ถูกเขียนทับ', async () => {
    const first = await api(app)
      .post(`/api/v1/notifications/${mineId}/read`)
      .set(bearer(me.accessToken))
      .expect(200);
    const readAt = (first.body as { readAt: string }).readAt;
    expect(readAt).not.toBeNull();

    const again = await api(app)
      .post(`/api/v1/notifications/${mineId}/read`)
      .set(bearer(me.accessToken))
      .expect(200);
    expect((again.body as { readAt: string }).readAt).toBe(readAt);
  });

  it('ของคนอื่น → 404 และแถวนั้นยังไม่ถูกอ่าน', async () => {
    await api(app)
      .post(`/api/v1/notifications/${theirsId}/read`)
      .set(bearer(me.accessToken))
      .expect(404);

    const row = await prisma.notification.findUniqueOrThrow({
      where: { id: theirsId },
    });
    expect(row.readAt).toBeNull();
  });

  it('อ่านทั้งหมด → unreadCount เป็น 0 และไม่แตะของคนอื่น', async () => {
    await prisma.notification.create({
      data: { userId: me.id, type: 'order_status', title: 'ใบใหม่' },
    });

    await api(app)
      .post('/api/v1/notifications/read')
      .set(bearer(me.accessToken))
      .expect(200);

    const res = await api(app)
      .get('/api/v1/notifications')
      .set(bearer(me.accessToken))
      .expect(200);
    expect((res.body as NotificationList).unreadCount).toBe(0);

    expect(
      await prisma.notification.count({
        where: { userId: other.id, readAt: null },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('ไม่มี endpoint ให้สร้างแจ้งเตือนเอง (ปลอมข้อความถึงตัวเองไม่ได้)', async () => {
    await api(app)
      .post('/api/v1/notifications')
      .set(bearer(me.accessToken))
      .send({ type: 'order_status', title: 'แจ้งเตือนปลอม' })
      .expect(404);
  });

  /**
   * `scope` — บัญชีเดียวสวมได้ทั้งผู้ซื้อและร้าน แต่ละคอนโซลจึงถามเฉพาะกล่อง
   * ของตัวเอง · เคสชุดนี้ใช้ผู้ใช้คนใหม่เพราะเคสด้านบนกด "อ่านทั้งหมด" ไปแล้ว
   */
  describe('scope ของคอนโซล (ผู้ซื้อ / ร้าน)', () => {
    let dual: TestUser;

    beforeAll(async () => {
      dual = await registerTestUser(app, 'noti-scope');
      await prisma.notification.createMany({
        data: [
          {
            userId: dual.id,
            type: 'upcoming_cycle',
            title: 'ฝั่งผู้ซื้อ — ใกล้ถึงรอบ',
          },
          {
            userId: dual.id,
            type: 'new_subscriber',
            title: 'ฝั่งร้าน — มีผู้สมัครใหม่',
          },
          {
            userId: dual.id,
            type: 'engine_summary',
            title: 'ฝั่งร้าน — ออเดอร์ใหม่ประจำวัน',
          },
        ],
      });
    });

    it('scope=seller เห็นเฉพาะเรื่องของร้าน และนับเฉพาะฝั่งร้าน', async () => {
      const res = await api(app)
        .get('/api/v1/notifications?scope=seller')
        .set(bearer(dual.accessToken))
        .expect(200);
      const body = res.body as NotificationList;

      // สร้างพร้อมกันใน createMany เดียว → createdAt เท่ากัน ลำดับจึงไม่แน่นอน
      expect(body.items.map((n) => n.title).sort()).toEqual(
        ['ฝั่งร้าน — ออเดอร์ใหม่ประจำวัน', 'ฝั่งร้าน — มีผู้สมัครใหม่'].sort(),
      );
      expect(body.unreadCount).toBe(2);
    });

    it('scope=buyer ไม่มีเรื่องของร้านปนมา', async () => {
      const res = await api(app)
        .get('/api/v1/notifications?scope=buyer')
        .set(bearer(dual.accessToken))
        .expect(200);
      const body = res.body as NotificationList;

      expect(body.items.map((n) => n.title)).toEqual([
        'ฝั่งผู้ซื้อ — ใกล้ถึงรอบ',
      ]);
      expect(body.unreadCount).toBe(1);
    });

    it('★ "อ่านทั้งหมด" ของคอนโซลร้าน ต้องไม่ล้างกล่องของผู้ซื้อ', async () => {
      const marked = await api(app)
        .post('/api/v1/notifications/read?scope=seller')
        .set(bearer(dual.accessToken))
        .expect(200);
      expect((marked.body as { marked: number }).marked).toBe(2);

      const buyerBox = await api(app)
        .get('/api/v1/notifications?scope=buyer')
        .set(bearer(dual.accessToken))
        .expect(200);
      expect((buyerBox.body as NotificationList).unreadCount).toBe(1);

      const sellerBox = await api(app)
        .get('/api/v1/notifications?scope=seller')
        .set(bearer(dual.accessToken))
        .expect(200);
      expect((sellerBox.body as NotificationList).unreadCount).toBe(0);
    });

    it('scope ที่ไม่รู้จัก → 400 (ไม่ใช่เงียบ ๆ แล้วคืนทั้งหมด)', async () => {
      await api(app)
        .get('/api/v1/notifications?scope=admin')
        .set(bearer(dual.accessToken))
        .expect(400);
    });
  });
});
