import { INestApplication } from '@nestjs/common';
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
  label: 'บ้าน',
  recipientName: 'ผู้รับ ทดสอบ',
  phone: '0812345678',
  addressLine: '1 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ',
  province: 'กรุงเทพมหานคร',
  postcode: '10900',
};

describe('Me — โปรไฟล์ / ที่อยู่ / บัตร', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let me: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupTestUsers(prisma);
    me = await registerTestUser(app, 'me');
    other = await registerTestUser(app, 'other');
  });

  afterAll(async () => {
    if (prisma) await cleanupTestUsers(prisma);
    if (app) await app.close();
  });

  // ---------- โปรไฟล์ ----------

  describe('GET/PATCH /me', () => {
    it('อ่านโปรไฟล์ตัวเองได้ และไม่มี passwordHash ติดมา', async () => {
      const res = await api(app)
        .get('/api/v1/me')
        .set(bearer(me.accessToken))
        .expect(200);

      const body = res.body as Record<string, unknown>;
      expect(body.id).toBe(me.id);
      expect(body).not.toHaveProperty('passwordHash');
    });

    it('แก้ชื่อและเบอร์โทรได้', async () => {
      const res = await api(app)
        .patch('/api/v1/me')
        .set(bearer(me.accessToken))
        .send({ displayName: 'ชื่อใหม่', phone: '0891234567' })
        .expect(200);

      const body = res.body as { displayName: string; phone: string };
      expect(body.displayName).toBe('ชื่อใหม่');
      expect(body.phone).toBe('0891234567');
    });

    it('แนบ isAdmin มากับ PATCH → 400 และสิทธิ์ใน DB ไม่เปลี่ยน (T-1)', async () => {
      await api(app)
        .patch('/api/v1/me')
        .set(bearer(me.accessToken))
        .send({ displayName: 'ยังคงเป็นคนธรรมดา', isAdmin: true })
        .expect(400);

      const row = await prisma.user.findUniqueOrThrow({
        where: { id: me.id },
        select: { isAdmin: true, isSeller: true },
      });
      expect(row.isAdmin).toBe(false);
      expect(row.isSeller).toBe(false);
    });

    it('เบอร์โทรผิดรูปแบบ → 400 (ไม่หลุดไปชน CHECK ที่ DB จนได้ 500)', async () => {
      const res = await api(app)
        .patch('/api/v1/me')
        .set(bearer(me.accessToken))
        .send({ phone: 'โทรหาฉันสิ' })
        .expect(400);

      expect((res.body as ApiError).code).toBe('VALIDATION_FAILED');
    });

    it('ไม่มี token → 401', async () => {
      await api(app).patch('/api/v1/me').send({ displayName: 'x' }).expect(401);
    });
  });

  // ---------- ที่อยู่ ----------

  describe('/me/addresses', () => {
    let firstId: string;

    it('ที่อยู่แรกถูกตั้งเป็นที่อยู่หลักอัตโนมัติ', async () => {
      const res = await api(app)
        .post('/api/v1/me/addresses')
        .set(bearer(me.accessToken))
        .send(ADDRESS)
        .expect(201);

      const body = res.body as { id: string; isDefault: boolean };
      expect(body.isDefault).toBe(true);
      // ไม่ส่ง userId ออกไป
      expect(res.body).not.toHaveProperty('userId');
      firstId = body.id;
    });

    it('ตั้งที่อยู่ใหม่เป็นหลัก → อันเก่าถูกปลดในทรานแซกชันเดียว', async () => {
      const created = await api(app)
        .post('/api/v1/me/addresses')
        .set(bearer(me.accessToken))
        .send({ ...ADDRESS, label: 'ที่ทำงาน', isDefault: true })
        .expect(201);

      const secondId = (created.body as { id: string }).id;

      const list = await api(app)
        .get('/api/v1/me/addresses')
        .set(bearer(me.accessToken))
        .expect(200);

      const rows = list.body as { id: string; isDefault: boolean }[];
      const defaults = rows.filter((r) => r.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0]?.id).toBe(secondId);
      expect(rows[0]?.id).toBe(secondId); // ตัวหลักมาก่อนเสมอ
    });

    it('รหัสไปรษณีย์ไม่ใช่เลข 5 หลัก → 400', async () => {
      await api(app)
        .post('/api/v1/me/addresses')
        .set(bearer(me.accessToken))
        .send({ ...ADDRESS, postcode: '109' })
        .expect(400);
    });

    it('เจ้าของแก้ที่อยู่ตัวเองได้ → 200 และค่าถูกเปลี่ยนจริงใน DB', async () => {
      const res = await api(app)
        .patch(`/api/v1/me/addresses/${firstId}`)
        .set(bearer(me.accessToken))
        .send({ recipientName: 'ชื่อผู้รับใหม่', postcode: '10310' })
        .expect(200);

      const body = res.body as { recipientName: string; postcode: string };
      expect(body.recipientName).toBe('ชื่อผู้รับใหม่');
      expect(body.postcode).toBe('10310');

      const row = await prisma.address.findUniqueOrThrow({
        where: { id: firstId },
      });
      expect(row.recipientName).toBe('ชื่อผู้รับใหม่');
      // ฟิลด์ที่ไม่ได้ส่งมาต้องไม่ถูกล้างเป็น null
      expect(row.province).toBe(ADDRESS.province);

      // คืนค่าเดิมให้เคสถัดไปที่เทียบกับ ADDRESS
      await api(app)
        .patch(`/api/v1/me/addresses/${firstId}`)
        .set(bearer(me.accessToken))
        .send({
          recipientName: ADDRESS.recipientName,
          postcode: ADDRESS.postcode,
        })
        .expect(200);
    });

    it('ส่งฟิลด์แปลกปลอมมากับ body → 400', async () => {
      await api(app)
        .post('/api/v1/me/addresses')
        .set(bearer(me.accessToken))
        .send({ ...ADDRESS, userId: other.id })
        .expect(400);
    });

    it('ส่ง null ให้ฟิลด์ที่ห้ามว่าง → 400 (ไม่ใช่ 422 จาก Prisma)', async () => {
      const res = await api(app)
        .patch(`/api/v1/me/addresses/${firstId}`)
        .set(bearer(me.accessToken))
        .send({ recipientName: null })
        .expect(400);

      expect((res.body as ApiError).code).toBe('VALIDATION_FAILED');
    });

    it('ปลดที่อยู่หลักอันสุดท้ายไม่ได้ → 409', async () => {
      const solo = await registerTestUser(app, 'solo');
      const created = await api(app)
        .post('/api/v1/me/addresses')
        .set(bearer(solo.accessToken))
        .send(ADDRESS)
        .expect(201);

      const res = await api(app)
        .patch(`/api/v1/me/addresses/${(created.body as { id: string }).id}`)
        .set(bearer(solo.accessToken))
        .send({ isDefault: false })
        .expect(409);

      expect((res.body as ApiError).code).toBe('DEFAULT_REQUIRED');
    });

    it('ไม่มี token → 401 ทุก verb', async () => {
      await api(app).get('/api/v1/me/addresses').expect(401);
      await api(app).post('/api/v1/me/addresses').send(ADDRESS).expect(401);
      await api(app)
        .patch(`/api/v1/me/addresses/${firstId}`)
        .send({})
        .expect(401);
      await api(app).delete(`/api/v1/me/addresses/${firstId}`).expect(401);
    });

    it('คนอื่นแก้ที่อยู่ของเรา → 404 ไม่ใช่ 403', async () => {
      const res = await api(app)
        .patch(`/api/v1/me/addresses/${firstId}`)
        .set(bearer(other.accessToken))
        .send({ recipientName: 'โดนแก้' })
        .expect(404);

      expect((res.body as ApiError).code).toBe('ADDRESS_NOT_FOUND');

      // ของจริงต้องไม่ถูกแตะ
      const row = await prisma.address.findUniqueOrThrow({
        where: { id: firstId },
      });
      expect(row.recipientName).toBe(ADDRESS.recipientName);
    });

    it('คนอื่นลบที่อยู่ของเรา → 404 และแถวยังอยู่', async () => {
      await api(app)
        .delete(`/api/v1/me/addresses/${firstId}`)
        .set(bearer(other.accessToken))
        .expect(404);

      expect(await prisma.address.count({ where: { id: firstId } })).toBe(1);
    });

    it('id ที่ไม่ใช่ uuid → 400 (ไม่ปล่อยไปถึง Prisma)', async () => {
      await api(app)
        .delete('/api/v1/me/addresses/not-a-uuid')
        .set(bearer(me.accessToken))
        .expect(400);
    });

    it('เจ้าของลบได้ → 204', async () => {
      await api(app)
        .delete(`/api/v1/me/addresses/${firstId}`)
        .set(bearer(me.accessToken))
        .expect(204);
    });
  });

  // ---------- บัตร ----------

  describe('/me/payment-methods', () => {
    let cardId: string;

    it('ผูกบัตรได้ครบทุก field และ kind ถูกล็อกไว้ที่ card', async () => {
      const res = await api(app)
        .post('/api/v1/me/payment-methods')
        .set(bearer(me.accessToken))
        .send(cardBody({ brand: 'mastercard', holderName: 'TEST USER' }))
        .expect(201);

      const body = res.body as {
        id: string;
        kind: string;
        brand: string;
        last4: string;
        expMonth: number;
        expYear: number;
        holderName: string;
      };
      expect(body.kind).toBe('card');
      expect(body.brand).toBe('mastercard');
      expect(body.last4).toBe('4242');
      expect(body.expMonth).toBe(12);
      expect(body.holderName).toBe('TEST USER');
      cardId = body.id;
    });

    it('★ ส่งเลขบัตรเต็มมา → 400 (กฎเหล็กข้อ 1)', async () => {
      await api(app)
        .post('/api/v1/me/payment-methods')
        .set(bearer(me.accessToken))
        .send(cardBody({ last4: '4242424242424242' }))
        .expect(400);

      // และต้องไม่มีอะไรถูกบันทึกเพิ่มเลย
      const rows = await prisma.paymentMethod.findMany({
        where: { userId: me.id },
        select: { last4: true },
      });
      expect(rows).toHaveLength(1);
      // เช็คว่าเป็นเลข 4 ตัวจริง ไม่ใช่แค่ยาว 4 (คอลัมน์เป็น char(4) จึงยาว 4 เสมอ)
      expect(rows[0]?.last4).toMatch(/^\d{4}$/);
      expect(rows[0]?.last4).toBe('4242');
    });

    it('ยัด kind มากับ body → 400', async () => {
      await api(app)
        .post('/api/v1/me/payment-methods')
        .set(bearer(me.accessToken))
        .send({ ...cardBody({ last4: '1111' }), kind: 'card_real' })
        .expect(400);
    });

    it('บัตรหมดอายุไปแล้ว → 400 CARD_EXPIRED และไม่มีแถวเพิ่ม', async () => {
      const before = await prisma.paymentMethod.count({
        where: { userId: me.id },
      });

      const res = await api(app)
        .post('/api/v1/me/payment-methods')
        .set(bearer(me.accessToken))
        .send(cardBody({ last4: '1212', expMonth: 1, expYear: 2020 }))
        .expect(400);

      expect((res.body as ApiError).code).toBe('CARD_EXPIRED');
      expect(
        await prisma.paymentMethod.count({ where: { userId: me.id } }),
      ).toBe(before);
    });

    it('เครือข่ายบัตรที่ไม่รู้จัก → 400 (enum ปิดชุด)', async () => {
      await api(app)
        .post('/api/v1/me/payment-methods')
        .set(bearer(me.accessToken))
        .send(cardBody({ last4: '1313', brand: 'discover' }))
        .expect(400);
    });

    it('★ ผูกบัตรใบเดิมซ้ำ → 409 CARD_ALREADY_ADDED', async () => {
      const dup = await registerTestUser(app, 'dupcard');
      await api(app)
        .post('/api/v1/me/payment-methods')
        .set(bearer(dup.accessToken))
        .send(cardBody({ last4: '8888' }))
        .expect(201);

      const res = await api(app)
        .post('/api/v1/me/payment-methods')
        .set(bearer(dup.accessToken))
        .send(cardBody({ last4: '8888' }))
        .expect(409);

      expect((res.body as ApiError).code).toBe('CARD_ALREADY_ADDED');
      expect(
        await prisma.paymentMethod.count({ where: { userId: dup.id } }),
      ).toBe(1);
    });

    it('คนอื่นลบบัตรของเรา → 404 และบัตรยังอยู่', async () => {
      await api(app)
        .delete(`/api/v1/me/payment-methods/${cardId}`)
        .set(bearer(other.accessToken))
        .expect(404);

      expect(await prisma.paymentMethod.count({ where: { id: cardId } })).toBe(
        1,
      );
    });

    it('เห็นเฉพาะบัตรของตัวเอง (ทั้งสองฝั่ง)', async () => {
      const mine = await api(app)
        .get('/api/v1/me/payment-methods')
        .set(bearer(me.accessToken))
        .expect(200);
      const mineRows = mine.body as { id: string }[];
      expect(mineRows.map((c) => c.id)).toEqual([cardId]);

      const theirs = await api(app)
        .get('/api/v1/me/payment-methods')
        .set(bearer(other.accessToken))
        .expect(200);
      expect(theirs.body).toEqual([]);
    });

    it('ไม่มี token → 401 ทุก verb', async () => {
      await api(app).get('/api/v1/me/payment-methods').expect(401);
      await api(app)
        .post('/api/v1/me/payment-methods')
        .send(cardBody())
        .expect(401);
      await api(app).delete(`/api/v1/me/payment-methods/${cardId}`).expect(401);
    });

    it('เพิ่มเกิน 5 ใบ → 409 TOO_MANY_CARDS', async () => {
      const collector = await registerTestUser(app, 'cards');
      for (let i = 0; i < 5; i++) {
        await api(app)
          .post('/api/v1/me/payment-methods')
          .set(bearer(collector.accessToken))
          .send(cardBody({ last4: String(1000 + i) }))
          .expect(201);
      }

      const res = await api(app)
        .post('/api/v1/me/payment-methods')
        .set(bearer(collector.accessToken))
        .send(cardBody({ last4: '9999' }))
        .expect(409);

      expect((res.body as ApiError).code).toBe('TOO_MANY_CARDS');
      expect(
        await prisma.paymentMethod.count({ where: { userId: collector.id } }),
      ).toBe(5);
    });

    it('เจ้าของลบบัตรตัวเองได้ → 204 และแถวหายจริง', async () => {
      await api(app)
        .delete(`/api/v1/me/payment-methods/${cardId}`)
        .set(bearer(me.accessToken))
        .expect(204);

      expect(await prisma.paymentMethod.count({ where: { id: cardId } })).toBe(
        0,
      );
    });
  });
});
