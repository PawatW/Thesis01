import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './utils/app';
import { cleanupTestUsers, E2E_PREFIX } from './utils/auth';
import { cardRow } from './utils/card';

/**
 * ชั้น L3 — พิสูจน์ว่า **ฐานข้อมูลปฏิเสธเอง** ไม่ใช่แค่ DTO ปฏิเสธ
 *
 * ทุกเคสในไฟล์นี้ยิง Prisma ตรง ข้าม guard/ValidationPipe ทั้งหมด ซึ่งคือสิ่งที่
 * จะเกิดจริงถ้าวันหนึ่ง service เขียนพลาด หรือมี migration/สคริปต์เขียนข้อมูลเข้ามา
 * ถ้าเคสไหนที่นี่ผ่านทั้งที่ควรถูกปฏิเสธ = ด่านสุดท้ายของระบบหายไปโดยไม่มีใครรู้
 *
 * ที่มาของกฎแต่ละข้อ: prisma/migrations/*_check_constraints
 */
describe('DB invariants — CHECK / UNIQUE / FK ที่ต้องกันได้เอง', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId: string;

  const BCRYPT =
    '$2b$12$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
  const email = () =>
    `${E2E_PREFIX}dbinv-${Date.now()}-${Math.random()}@t.local`;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupTestUsers(prisma);
    const user = await prisma.user.create({
      data: { email: email(), passwordHash: BCRYPT, displayName: 'ทดสอบ DB' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (prisma) await cleanupTestUsers(prisma);
    if (app) await app.close();
  });

  describe('users', () => {
    it('ปฏิเสธ password ที่ไม่ใช่ bcrypt hash', async () => {
      await expect(
        prisma.user.create({
          data: {
            email: email(),
            passwordHash: 'plaintext-password',
            displayName: 'x',
          },
        }),
      ).rejects.toThrow();
    });

    it('ปฏิเสธอีเมลที่มีตัวพิมพ์ใหญ่ (บังคับ normalize ที่ DB ด้วย)', async () => {
      await expect(
        prisma.user.create({
          data: {
            email: `${E2E_PREFIX}UPPER@T.LOCAL`,
            passwordHash: BCRYPT,
            displayName: 'x',
          },
        }),
      ).rejects.toThrow();
    });

    it('ปฏิเสธอีเมลซ้ำ', async () => {
      const dup = email();
      await prisma.user.create({
        data: { email: dup, passwordHash: BCRYPT, displayName: 'x' },
      });
      await expect(
        prisma.user.create({
          data: { email: dup, passwordHash: BCRYPT, displayName: 'y' },
        }),
      ).rejects.toThrow();
    });

    it('ปฏิเสธ avatar_url ที่ไม่ใช่ https', async () => {
      await expect(
        prisma.user.update({
          where: { id: userId },
          data: { avatarUrl: 'http://evil.example/x.png' },
        }),
      ).rejects.toThrow();
    });

    it('ปฏิเสธชื่อที่แสดงยาวเกิน 60 ตัว', async () => {
      await expect(
        prisma.user.update({
          where: { id: userId },
          data: { displayName: 'ก'.repeat(61) },
        }),
      ).rejects.toThrow();
    });
  });

  describe('addresses', () => {
    const base = {
      recipientName: 'ผู้รับ',
      phone: '0812345678',
      addressLine: '1 ถนนทดสอบ',
      province: 'กรุงเทพมหานคร',
      postcode: '10900',
    };

    it('ปฏิเสธรหัสไปรษณีย์ที่ไม่ใช่เลข 5 หลัก', async () => {
      await expect(
        prisma.address.create({
          data: { ...base, userId, postcode: 'ABCDE' },
        }),
      ).rejects.toThrow();
    });

    it('★ ที่อยู่หลักซ้อนกัน 2 อันไม่ได้ (unique partial index)', async () => {
      const owner = await prisma.user.create({
        data: { email: email(), passwordHash: BCRYPT, displayName: 'เจ้าของ' },
      });
      await prisma.address.create({
        data: { ...base, userId: owner.id, isDefault: true },
      });
      await expect(
        prisma.address.create({
          data: { ...base, userId: owner.id, isDefault: true },
        }),
      ).rejects.toThrow();
    });
  });

  describe('payment_methods', () => {
    it('★ เก็บเลขบัตรเต็มไม่ได้แม้ยิง Prisma ตรง (กฎเหล็กข้อ 1)', async () => {
      await expect(
        prisma.paymentMethod.create({
          data: { ...cardRow({ last4: '4242424242424242' }), userId },
        }),
      ).rejects.toThrow();
    });

    it('ปฏิเสธ last4 ที่ไม่ใช่ตัวเลข', async () => {
      await expect(
        prisma.paymentMethod.create({
          data: { ...cardRow({ last4: 'abcd' }), userId },
        }),
      ).rejects.toThrow();
    });

    it('ปฏิเสธเดือนหมดอายุนอกช่วง 1–12', async () => {
      await expect(
        prisma.paymentMethod.create({
          data: { ...cardRow({ last4: '1234', expMonth: 13 }), userId },
        }),
      ).rejects.toThrow();
    });

    it('ปฏิเสธปีหมดอายุนอกช่วง 2000–2100', async () => {
      await expect(
        prisma.paymentMethod.create({
          data: { ...cardRow({ last4: '1234', expYear: 1999 }), userId },
        }),
      ).rejects.toThrow();
    });

    it('★ ผูกบัตรใบเดิมซ้ำไม่ได้ (UNIQUE user + last4 + วันหมดอายุ)', async () => {
      const row = cardRow({ last4: '7777' });
      await prisma.paymentMethod.create({ data: { ...row, userId } });
      await expect(
        prisma.paymentMethod.create({ data: { ...row, userId } }),
      ).rejects.toThrow();
    });
  });

  /**
   * ตารางนี้เก็บ **กุญแจสำรองของทุกบัญชี** — ใครอ่านคอลัมน์เดียวได้ก็ยึดบัญชีไหนก็ได้
   * กฎทั้งสามข้อจึงต้องเป็นรูปร่างของข้อมูล ไม่ใช่มารยาทของ `AuthService`
   */
  /**
   * ตั้งค่าเมล — สองกฎที่ต้องเป็นรูปร่างของข้อมูล ไม่ใช่แค่การตรวจใน DTO:
   * "มีแถวเดียวเสมอ" และ "เปิดโหมดแล้วต้องมีปลายทาง"
   */
  describe('mail_settings', () => {
    it('★ ปฏิเสธแถวที่สอง — ตารางนี้ต้องมีแถวเดียวเสมอ', async () => {
      // มีหลายแถวเมื่อไหร่ จะไม่มีทางรู้ว่าแถวไหนคือ "ค่าที่ระบบใช้อยู่จริง"
      await expect(
        prisma.mailSetting.create({ data: { id: 2 } }),
      ).rejects.toThrow();
    });

    it('★ ปฏิเสธการเปิดโหมดโดยไม่มีปลายทาง (อีเมลทั้งระบบจะหายเงียบ ๆ)', async () => {
      await expect(
        prisma.mailSetting.update({
          where: { id: 1 },
          data: { redirectEnabled: true, redirectTo: null },
        }),
      ).rejects.toThrow();
    });

    it('ปฏิเสธปลายทาง / รายการ Cc ที่ไม่ใช่อีเมล', async () => {
      await expect(
        prisma.mailSetting.update({
          where: { id: 1 },
          data: { redirectTo: 'ไม่ใช่อีเมล' },
        }),
      ).rejects.toThrow();

      await expect(
        prisma.mailSetting.update({
          where: { id: 1 },
          data: { redirectCc: 'a@b.com, ขยะ' },
        }),
      ).rejects.toThrow();
    });

    it('ปฏิเสธพอร์ตนอกช่วง และชื่อโฮสต์ที่มีช่องว่าง/บรรทัดใหม่', async () => {
      await expect(
        prisma.mailSetting.update({ where: { id: 1 }, data: { smtpPort: 0 } }),
      ).rejects.toThrow();
      await expect(
        prisma.mailSetting.update({
          where: { id: 1 },
          data: { smtpPort: 70_000 },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.mailSetting.update({
          where: { id: 1 },
          data: { smtpHost: 'smtp.example.com evil' },
        }),
      ).rejects.toThrow();
    });

    it('ปฏิเสธชื่อผู้ส่งที่มีการขึ้นบรรทัดใหม่ (กันยัด header เข้าไปในเมล)', async () => {
      await expect(
        prisma.mailSetting.update({
          where: { id: 1 },
          data: { mailFrom: 'ANAN <a@b.com>\r\nBcc: attacker@evil.com' },
        }),
      ).rejects.toThrow();
    });
  });

  describe('audit_logs', () => {
    it('ปฏิเสธข้อความสรุปที่ว่างเปล่าหรือยาวเกิน 500 ตัว', async () => {
      await expect(
        prisma.auditLog.create({
          data: { action: 'category_created', summary: '' },
        }),
      ).rejects.toThrow();

      await expect(
        prisma.auditLog.create({
          data: { action: 'category_created', summary: 'ก'.repeat(501) },
        }),
      ).rejects.toThrow();
    });

    it('เขียนได้โดยไม่มี actor — เหตุการณ์ที่ระบบทำเองต้องบันทึกได้', async () => {
      const row = await prisma.auditLog.create({
        data: {
          action: 'engine_run_manual',
          summary: 'เทส L3 — เหตุการณ์ที่ไม่มีผู้กระทำ',
        },
      });
      expect(row.actorId).toBeNull();
      await prisma.auditLog.delete({ where: { id: row.id } });
    });
  });

  describe('email_logs', () => {
    const base = {
      kind: 'password_reset',
      toIntended: 'real@user.local',
      toActual: 'real@user.local',
      status: 'sent' as const,
    };

    it('★ ธง redirected โกหกไม่ได้ — บอกว่าไม่ได้เปลี่ยนเส้นทางแต่ปลายทางคนละคน', async () => {
      // ถ้าปล่อยผ่าน หน้า log จะแสดงว่า "ส่งถึงเจ้าตัวแล้ว" ทั้งที่เมลไปเข้ากล่องอื่น
      await expect(
        prisma.emailLog.create({
          data: { ...base, toActual: 'qa@test.local', redirected: false },
        }),
      ).rejects.toThrow();
    });

    it('เหตุผลต้องมาคู่กับความล้มเหลวเสมอ (ทั้งสองทาง)', async () => {
      // failed แต่ไม่บอกสาเหตุ
      await expect(
        prisma.emailLog.create({
          data: { ...base, status: 'failed', error: null },
        }),
      ).rejects.toThrow();

      // สำเร็จแต่ดันมีสาเหตุความล้มเหลวติดมา
      await expect(
        prisma.emailLog.create({
          data: { ...base, status: 'sent', error: 'connection refused' },
        }),
      ).rejects.toThrow();
    });

    it('ปฏิเสธอีเมลที่ยาวเกินขอบเขตของคอลัมน์', async () => {
      const long = `${'a'.repeat(250)}@x.com`;
      await expect(
        prisma.emailLog.create({
          data: { ...base, toIntended: long, toActual: long },
        }),
      ).rejects.toThrow();
    });
  });

  describe('password_reset_tokens', () => {
    const future = () => new Date(Date.now() + 1_800_000);

    it('★ ปฏิเสธค่าที่ไม่ใช่ sha256 hex — เขียน token ดิบลงไปไม่ได้เลย', async () => {
      // ของจริงเป็น base64url 43 ตัว: ถ้าวันหนึ่ง service เผลอเก็บตัวที่ส่งเข้าเมล
      // แทนที่จะเก็บ hash ด่านนี้คือสิ่งเดียวที่จะจับได้
      await expect(
        prisma.passwordResetToken.create({
          data: {
            userId,
            tokenHash: '1brcMB3ph9dJxMe83AFg9NKWADzvWtQB0Kqbpms4_W8',
            expiresAt: future(),
          },
        }),
      ).rejects.toThrow();
    });

    it('ปฏิเสธ hash ที่ยาวไม่ครบ 64 ตัว และที่มีตัวอักษรนอก hex', async () => {
      await expect(
        prisma.passwordResetToken.create({
          data: { userId, tokenHash: 'a'.repeat(63), expiresAt: future() },
        }),
      ).rejects.toThrow();

      await expect(
        prisma.passwordResetToken.create({
          data: {
            userId,
            tokenHash: `${'a'.repeat(63)}Z`,
            expiresAt: future(),
          },
        }),
      ).rejects.toThrow();
    });

    it('ปฏิเสธตั๋วที่หมดอายุตั้งแต่วินาทีที่เกิด (กันหน่วยเวลาผิด)', async () => {
      await expect(
        prisma.passwordResetToken.create({
          data: {
            userId,
            tokenHash: 'b'.repeat(64),
            // เผลอคิดเป็นวินาทีแทนมิลลิวินาที = ได้วันหมดอายุที่อยู่ในอดีต
            expiresAt: new Date(Date.now() - 1_000),
          },
        }),
      ).rejects.toThrow();
    });

    it('ปฏิเสธตั๋วที่ถูก "ใช้" ก่อนวันที่ถูกสร้าง', async () => {
      await expect(
        prisma.passwordResetToken.create({
          data: {
            userId,
            tokenHash: 'c'.repeat(64),
            expiresAt: future(),
            usedAt: new Date(Date.now() - 3_600_000),
          },
        }),
      ).rejects.toThrow();
    });

    it('★ ตั๋วที่ถูกต้องต้องเขียนได้ และ hash ซ้ำต้องถูกปฏิเสธ (UNIQUE)', async () => {
      const hash = 'd'.repeat(64);
      await prisma.passwordResetToken.create({
        data: { userId, tokenHash: hash, expiresAt: future() },
      });
      await expect(
        prisma.passwordResetToken.create({
          data: { userId, tokenHash: hash, expiresAt: future() },
        }),
      ).rejects.toThrow();
    });
  });

  describe('refresh_tokens', () => {
    it('ปฏิเสธค่าที่ไม่ใช่ sha256 hex (กันเผลอเก็บตัว token จริง)', async () => {
      await expect(
        prisma.refreshToken.create({
          data: {
            userId,
            tokenHash: 'eyJhbGciOiJIUzI1NiJ9.not-a-hash',
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        }),
      ).rejects.toThrow();
    });

    it('ปฏิเสธวันหมดอายุที่อยู่ก่อนวันสร้าง', async () => {
      await expect(
        prisma.refreshToken.create({
          data: {
            userId,
            tokenHash: 'a'.repeat(64),
            expiresAt: new Date(Date.now() - 86_400_000),
          },
        }),
      ).rejects.toThrow();
    });

    /**
     * เหตุผลการเพิกถอนต้องมาคู่กับเวลาที่เพิกถอนเสมอ — ถ้าเหตุผลหายไป
     * การใช้ซ้ำของใบที่ logout แล้วจะถูกตีความผิดเป็น token รั่ว แล้วเจ้าของ
     * บัญชีถูกเตะออกทุกเครื่อง (A-8) กฎนี้จึงเป็นความถูกต้องของข้อมูล ไม่ใช่แค่กฎในโค้ด
     */
    it('★ ปฏิเสธการเพิกถอนที่ไม่บอกเหตุผล และเหตุผลที่ไม่ได้เพิกถอน (A-8)', async () => {
      await expect(
        prisma.refreshToken.create({
          data: {
            userId,
            tokenHash: 'b'.repeat(64),
            expiresAt: new Date(Date.now() + 86_400_000),
            revokedAt: new Date(),
          },
        }),
      ).rejects.toThrow();

      await expect(
        prisma.refreshToken.create({
          data: {
            userId,
            tokenHash: 'c'.repeat(64),
            expiresAt: new Date(Date.now() + 86_400_000),
            revokedReason: 'logout',
          },
        }),
      ).rejects.toThrow();
    });
  });

  /**
   * state machine ของ subscription ถูกบังคับที่ DB ด้วย (CHECK subs_state_consistent)
   * ไม่ใช่แค่ใน service — ต่อให้ Phase ถัดไปมีใครเขียน service ผิด หรือมีสคริปต์
   * แก้ข้อมูลมือ ก็ยังออกจากสถานะ cancelled ไม่ได้
   */
  describe('subscriptions', () => {
    const PLAN_1M = '30000000-0000-4000-8000-000000000002';
    let subscriptionId: string;

    beforeAll(async () => {
      const address = await prisma.address.create({
        data: {
          userId,
          recipientName: 'ผู้รับ DB',
          phone: '0812345678',
          addressLine: '1 ถนนทดสอบ',
          province: 'กรุงเทพมหานคร',
          postcode: '10900',
        },
      });
      const card = await prisma.paymentMethod.create({
        data: { ...cardRow({ last4: '4343' }), userId },
      });
      const today = new Date();
      const sub = await prisma.subscription.create({
        data: {
          buyerId: userId,
          planId: PLAN_1M,
          addressId: address.id,
          paymentMethodId: card.id,
          status: 'active',
          startDate: today,
          cycleAnchorDate: today,
          nextOrderDate: today,
        },
      });
      subscriptionId = sub.id;
    });

    /**
     * กริดรอบทั้งระบบคือ "หมุด + k×cycle" (k ≥ 0) วันรอบถัดไปจึงอยู่ก่อนหมุดไม่ได้
     * ถ้าวันหนึ่งมีโค้ดเลื่อนวันรอบย้อนหลังโดยลืมขยับหมุด ผู้ซื้อจะถูกตัดเงินผิดวัน
     *
     * ★ เคสนี้ต้องอยู่ก่อนเคสที่ยกเลิกรายการ ★ เพราะพอสถานะเป็น cancelled แล้ว
     * ทุกการ update ที่ตั้งวันรอบจะถูก `subs_state_consistent` ปฏิเสธก่อน
     * แล้วเคสนี้จะ "ผ่าน" ด้วยเหตุผลคนละข้อกับที่ตั้งใจทดสอบ
     */
    it('★ วันรอบถัดไปอยู่ก่อนหมุดของกริดรอบ → DB ปฏิเสธ', async () => {
      await expect(
        prisma.subscription.update({
          where: { id: subscriptionId },
          data: {
            cycleAnchorDate: new Date('2027-01-10T00:00:00Z'),
            nextOrderDate: new Date('2026-12-31T00:00:00Z'),
          },
        }),
      ).rejects.toThrow();

      // ยังต้อง active อยู่ — พิสูจน์ว่าเคสข้างบนถูกปฏิเสธด้วย CHECK ของหมุดจริง ๆ
      const row = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      expect(row.status).toBe('active');
    });

    it('★ ยกเลิกแล้วยังมีวันรอบถัดไปค้างอยู่ → DB ปฏิเสธ', async () => {
      await expect(
        prisma.subscription.update({
          where: { id: subscriptionId },
          data: { status: 'cancelled', cancelledAt: new Date() },
        }),
      ).rejects.toThrow();
    });

    it('★ ออกจากสถานะ cancelled กลับมา active → DB ปฏิเสธ (ยกเลิกคือถาวร)', async () => {
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          nextOrderDate: null,
        },
      });

      await expect(
        prisma.subscription.update({
          where: { id: subscriptionId },
          data: { status: 'active', nextOrderDate: null },
        }),
      ).rejects.toThrow();
    });

    it('เหตุผลการหยุดค้างอยู่ทั้งที่กลับมาใช้งานแล้ว → DB ปฏิเสธ', async () => {
      await expect(
        prisma.subscription.update({
          where: { id: subscriptionId },
          data: { status: 'active', pausedReason: 'user' },
        }),
      ).rejects.toThrow();
    });
  });

  /**
   * ลำดับสถานะออเดอร์ + ความคงที่ของยอดเงิน — บังคับด้วย trigger `guard_order_update`
   *
   * เคสพวกนี้ยิง Prisma ตรง ข้าม service ทั้งหมด ซึ่งคือสิ่งที่จะเกิดถ้าวันหนึ่ง
   * มีใครเขียน `order.update` ที่อื่นโดยลืมตรวจลำดับ (feature 12 ประกาศชั้นนี้ไว้)
   */
  describe('orders (trigger guard_order_update)', () => {
    const PLAN_1M = '30000000-0000-4000-8000-000000000002';
    let orderId: string;

    beforeAll(async () => {
      const address = await prisma.address.create({
        data: {
          userId,
          recipientName: 'ผู้รับ ออเดอร์',
          phone: '0812345678',
          addressLine: '2 ถนนทดสอบ',
          province: 'กรุงเทพมหานคร',
          postcode: '10900',
        },
      });
      const card = await prisma.paymentMethod.create({
        data: { ...cardRow({ last4: '4444' }), userId },
      });
      const today = new Date();
      const sub = await prisma.subscription.create({
        data: {
          buyerId: userId,
          planId: PLAN_1M,
          addressId: address.id,
          paymentMethodId: card.id,
          status: 'active',
          startDate: today,
          cycleAnchorDate: today,
          nextOrderDate: today,
        },
      });
      const order = await prisma.order.create({
        data: {
          subscriptionId: sub.id,
          buyerId: userId,
          cycleDate: today,
          status: 'pending',
          amount: 100,
          addressSnapshot: { recipient_name: 'ผู้รับ ออเดอร์' },
        },
      });
      orderId = order.id;
    });

    it('★ กระโดดจาก pending ไป delivered → DB ปฏิเสธ (ไม่มีทางลัด)', async () => {
      await expect(
        prisma.order.update({
          where: { id: orderId },
          data: { status: 'delivered' },
        }),
      ).rejects.toThrow();
    });

    it('★ ย้อนสถานะกลับ (preparing → pending) → DB ปฏิเสธ', async () => {
      await prisma.order.update({
        where: { id: orderId },
        data: { status: 'preparing' },
      });
      await expect(
        prisma.order.update({
          where: { id: orderId },
          data: { status: 'pending' },
        }),
      ).rejects.toThrow();
    });

    it('★ แก้ยอดเงิน / วันรอบ / ที่อยู่ที่คัดลอกไว้ → DB ปฏิเสธทั้งหมด', async () => {
      for (const data of [
        { amount: 1 },
        { cycleDate: new Date('2030-01-01T00:00:00Z') },
        { addressSnapshot: { recipient_name: 'สลับที่อยู่' } },
      ]) {
        await expect(
          prisma.order.update({ where: { id: orderId }, data }),
        ).rejects.toThrow();
      }

      const row = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      expect(row.amount.toNumber()).toBe(100);
    });

    it('เดินหน้าทีละขั้นตามลำดับ → ผ่านปกติ', async () => {
      await prisma.order.update({
        where: { id: orderId },
        data: { status: 'shipped', trackingNote: 'TH-INVARIANT' },
      });
      const row = await prisma.order.update({
        where: { id: orderId },
        data: { status: 'delivered' },
      });
      expect(row.status).toBe('delivered');
    });
  });

  /**
   * วงจรชีวิตของการจ่ายเงินจำลอง — `payments_lifecycle`
   *
   * CHECK เดิม (`payments_paid_consistent`) บังคับว่า `paid_at` มีค่าได้เฉพาะตอน
   * status = 'paid' ซึ่งทำให้ **คืนเงินไม่ได้เลย** (refunded ต้องเคยจ่ายมาก่อน)
   * — เจอตอนเขียนเทสของ feature 15 · เคสพวกนี้ล็อกกติกาใหม่ไว้ไม่ให้ถอยกลับไปแบบเดิม
   */
  describe('payments (lifecycle)', () => {
    let orderId: string;

    beforeAll(async () => {
      const order = await prisma.order.findFirstOrThrow({
        where: { buyerId: userId },
        select: { id: true },
      });
      orderId = order.id;
      await prisma.payment.deleteMany({ where: { orderId } });
    });

    afterEach(async () => {
      await prisma.payment.deleteMany({ where: { orderId } });
    });

    it('★ คืนเงินโดยเก็บประวัติว่าเคยจ่ายจริง → DB ยอมรับ', async () => {
      const paid = await prisma.payment.create({
        data: { orderId, amount: 100, status: 'paid', paidAt: new Date() },
      });
      const refunded = await prisma.payment.update({
        where: { id: paid.id },
        data: { status: 'refunded', refundedAt: new Date() },
      });
      expect(refunded.paidAt).not.toBeNull();
      expect(refunded.refundedAt).not.toBeNull();
    });

    it('คืนเงินโดยไม่เคยจ่าย / จ่ายแล้วไม่มีเวลาจ่าย / failed ที่มีเวลา → DB ปฏิเสธ', async () => {
      for (const data of [
        { status: 'refunded' as const, refundedAt: new Date() },
        { status: 'paid' as const },
        { status: 'failed' as const, paidAt: new Date() },
      ]) {
        await expect(
          prisma.payment.create({ data: { orderId, amount: 100, ...data } }),
        ).rejects.toThrow();
      }
    });
  });

  describe('shops', () => {
    it('ปฏิเสธโลโก้ที่ไม่ใช่ https (กัน mixed content และรูปที่เบราว์เซอร์บล็อก)', async () => {
      await expect(
        prisma.shop.create({
          data: {
            ownerId: userId,
            name: 'ร้านโลโก้ไม่ปลอดภัย',
            logoUrl: 'http://example.com/logo.png',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('notifications', () => {
    it('★ ปฏิเสธ link_path ที่ชี้ออกนอกแอป (กัน stored phishing link)', async () => {
      await expect(
        prisma.notification.create({
          data: {
            userId,
            type: 'order_status',
            title: 'ลองกดดูสิ',
            linkPath: 'https://evil.example/login',
          },
        }),
      ).rejects.toThrow();
    });

    it('ยอมรับ path ภายในแอป', async () => {
      const created = await prisma.notification.create({
        data: {
          userId,
          type: 'order_status',
          title: 'พัสดุออกจากร้านแล้ว',
          linkPath: '/orders/abc-123',
        },
      });
      expect(created.linkPath).toBe('/orders/abc-123');
    });
  });

  describe('product_plans', () => {
    it('ปฏิเสธ cycle ที่ไม่ใช่ 2w/1m/2m', async () => {
      // ใช้ raw เพราะ Prisma ไม่รู้จัก CHECK นี้ (cycle เป็น text ไม่ใช่ enum)
      await expect(
        prisma.$executeRawUnsafe(
          `insert into product_plans (product_id, cycle, price_per_cycle)
           select id, '3m', 100 from products limit 1`,
        ),
      ).rejects.toThrow();
    });
  });
  /**
   * feature 18 — คูปองรายรอบ
   *
   * กฎที่สำคัญที่สุดของฟีเจอร์นี้ทั้งหมดอยู่ที่ DB ไม่ใช่ที่ service:
   * โควตาห้ามเกิน · 1 รอบ 1 ใบ · 1 คน 1 ครั้ง · ส่วนลดต้องชี้กลับไปหาที่มาได้
   */
  describe('coupons (feature 18)', () => {
    const couponData = (over: Record<string, unknown> = {}) => ({
      code: `E2EINV${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 900 + 100)}`,
      title: 'คูปอง invariant',
      discountType: 'percent' as const,
      discountValue: 10,
      startsAt: new Date(Date.now() - 3_600_000),
      endsAt: new Date(Date.now() + 3_600_000),
      ...over,
    });

    it('ปฏิเสธโค้ดที่ไม่ใช่ตัวพิมพ์ใหญ่/สั้นเกิน', async () => {
      await expect(
        prisma.coupon.create({ data: couponData({ code: 'e2e-lower' }) }),
      ).rejects.toThrow();
      await expect(
        prisma.coupon.create({ data: couponData({ code: 'AB' }) }),
      ).rejects.toThrow();
    });

    it('ปฏิเสธส่วนลดแบบเปอร์เซ็นต์ที่เกิน 100', async () => {
      await expect(
        prisma.coupon.create({ data: couponData({ discountValue: 101 }) }),
      ).rejects.toThrow();
    });

    it('ปฏิเสธเพดานส่วนลดบนคูปองแบบจำนวนเงิน (เพดานมีความหมายเฉพาะ percent)', async () => {
      await expect(
        prisma.coupon.create({
          data: couponData({
            discountType: 'fixed',
            discountValue: 50,
            maxDiscountAmount: 20,
          }),
        }),
      ).rejects.toThrow();
    });

    it('ปฏิเสธช่วงเวลาที่สิ้นสุดก่อนเริ่ม', async () => {
      await expect(
        prisma.coupon.create({
          data: couponData({
            startsAt: new Date(Date.now() + 7_200_000),
            endsAt: new Date(Date.now() + 3_600_000),
          }),
        }),
      ).rejects.toThrow();
    });

    it('★ โควตาเกินเป็นไปไม่ได้ — ต่อให้ service คำนวณพลาด DB ก็ปฏิเสธ', async () => {
      const coupon = await prisma.coupon.create({
        data: couponData({ maxRedemptions: 1 }),
      });
      await expect(
        prisma.coupon.update({
          where: { id: coupon.id },
          data: { inUseCount: 2 },
        }),
      ).rejects.toThrow();
      await prisma.coupon.delete({ where: { id: coupon.id } });
    });

    it('★ สถานะของใบจองต้องมาคู่กับเวลาเสมอทั้งสองทาง', async () => {
      const coupon = await prisma.coupon.create({ data: couponData() });
      const sub = await prisma.subscription.findFirstOrThrow({
        select: { id: true, buyerId: true, nextOrderDate: true },
        where: { nextOrderDate: { not: null } },
      });
      const base = {
        couponId: coupon.id,
        subscriptionId: sub.id,
        buyerId: sub.buyerId,
        cycleDate: sub.nextOrderDate as Date,
        discountType: 'percent' as const,
        discountValue: 10,
        discountAmount: 10,
      };

      // consumed แต่ไม่มีเวลาที่ใช้
      await expect(
        prisma.couponRedemption.create({
          data: { ...base, status: 'consumed' },
        }),
      ).rejects.toThrow();

      // released แต่ไม่มีเหตุผล
      await expect(
        prisma.couponRedemption.create({
          data: { ...base, status: 'released', releasedAt: new Date() },
        }),
      ).rejects.toThrow();

      // reserved แต่ดันมีเวลาที่ใช้แล้ว
      await expect(
        prisma.couponRedemption.create({
          data: { ...base, status: 'reserved', consumedAt: new Date() },
        }),
      ).rejects.toThrow();

      await prisma.coupon.delete({ where: { id: coupon.id } });
    });

    it('★ ระดับกับเจ้าของร้านต้องตรงกันเสมอ (feature 18 รอบ 2)', async () => {
      // คูปองร้านที่ไม่มีร้าน = ตอบไม่ได้ว่าใครรับภาระส่วนลด
      await expect(
        prisma.coupon.create({ data: couponData({ tier: 'shop' }) }),
      ).rejects.toThrow();

      // คูปองแพลตฟอร์มที่ดันมีร้านติดมา = เหตุผลเดียวกันในทางกลับ
      const shop = await prisma.shop.findFirstOrThrow({ select: { id: true } });
      await expect(
        prisma.coupon.create({
          data: couponData({ tier: 'platform', shopId: shop.id }),
        }),
      ).rejects.toThrow();
    });

    it('★ คูปองแพลตฟอร์มครอบ "ทั้งร้าน" เองไม่ได้ — ร้านต้องเป็นคนกดเข้าร่วม', async () => {
      await expect(
        prisma.coupon.create({
          data: couponData({ tier: 'platform', appliesToAllProducts: true }),
        }),
      ).rejects.toThrow();
    });

    it('★ 1 รอบ ได้ระดับละ 1 ใบ — ซ้อน 2 ระดับได้ แต่ระดับเดิมซ้ำไม่ได้', async () => {
      const shop = await prisma.shop.findFirstOrThrow({ select: { id: true } });
      const [p1, p2, s1] = await Promise.all([
        prisma.coupon.create({ data: couponData() }),
        prisma.coupon.create({ data: couponData() }),
        prisma.coupon.create({
          data: couponData({ tier: 'shop', shopId: shop.id }),
        }),
      ]);
      const sub = await prisma.subscription.findFirstOrThrow({
        select: { id: true, buyerId: true, nextOrderDate: true },
        where: { nextOrderDate: { not: null } },
      });
      const base = {
        subscriptionId: sub.id,
        buyerId: sub.buyerId,
        cycleDate: sub.nextOrderDate as Date,
        discountType: 'percent' as const,
        discountValue: 10,
        discountAmount: 10,
      };

      const a = await prisma.couponRedemption.create({
        data: { ...base, couponId: p1.id, tier: 'platform' },
      });
      // ★ คนละระดับในรอบเดียวกัน = อนุญาต (นี่คือการซ้อน) ★
      const b = await prisma.couponRedemption.create({
        data: { ...base, couponId: s1.id, tier: 'shop' },
      });
      // ★ ระดับเดิมซ้ำ = ปฏิเสธ ★
      await expect(
        prisma.couponRedemption.create({
          data: { ...base, couponId: p2.id, tier: 'platform' },
        }),
      ).rejects.toThrow();

      await prisma.couponRedemption.deleteMany({
        where: { id: { in: [a.id, b.id] } },
      });
      await prisma.coupon.deleteMany({
        where: { id: { in: [p1.id, p2.id, s1.id] } },
      });
    });

    it('★ 1 รอบ 1 ใบต่อระดับ และคืนแล้วจองใหม่ได้ (partial unique)', async () => {
      const [a, b] = await Promise.all([
        prisma.coupon.create({ data: couponData() }),
        prisma.coupon.create({ data: couponData() }),
      ]);
      const sub = await prisma.subscription.findFirstOrThrow({
        select: { id: true, buyerId: true, nextOrderDate: true },
        where: { nextOrderDate: { not: null } },
      });
      const base = {
        subscriptionId: sub.id,
        buyerId: sub.buyerId,
        cycleDate: sub.nextOrderDate as Date,
        discountType: 'percent' as const,
        discountValue: 10,
        discountAmount: 10,
      };

      const first = await prisma.couponRedemption.create({
        data: { ...base, couponId: a.id },
      });
      // ใบที่สองของ **ระดับเดียวกัน** ในรอบเดียวกัน ต้องถูกปฏิเสธ
      await expect(
        prisma.couponRedemption.create({ data: { ...base, couponId: b.id } }),
      ).rejects.toThrow();

      // คืนใบแรกแล้วจองใหม่ได้
      await prisma.couponRedemption.update({
        where: { id: first.id },
        data: {
          status: 'released',
          releasedAt: new Date(),
          releasedReason: 'user_removed',
        },
      });
      const second = await prisma.couponRedemption.create({
        data: { ...base, couponId: b.id },
      });

      await prisma.couponRedemption.deleteMany({
        where: { id: { in: [first.id, second.id] } },
      });
      await prisma.coupon.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    });

    it('★ 1 คน ใช้คูปองใบเดิมซ้ำไม่ได้แม้คนละ subscription', async () => {
      const coupon = await prisma.coupon.create({ data: couponData() });
      const subs = await prisma.subscription.findMany({
        select: { id: true, buyerId: true, nextOrderDate: true },
        where: { nextOrderDate: { not: null } },
        take: 50,
      });
      const buyerId = subs.find(
        (s) => subs.filter((x) => x.buyerId === s.buyerId).length >= 2,
      )?.buyerId;
      if (buyerId === undefined) {
        // ข้อมูล seed ไม่มีผู้ซื้อที่มี 2 รายการ — เคสนี้ครอบด้วย e2e ของ API แล้ว
        await prisma.coupon.delete({ where: { id: coupon.id } });
        return;
      }
      const mine = subs.filter((s) => s.buyerId === buyerId).slice(0, 2);
      const row = (i: number) => ({
        couponId: coupon.id,
        subscriptionId: mine[i]!.id,
        buyerId,
        cycleDate: mine[i]!.nextOrderDate as Date,
        discountType: 'percent' as const,
        discountValue: 10,
        discountAmount: 10,
      });

      const first = await prisma.couponRedemption.create({ data: row(0) });
      await expect(
        prisma.couponRedemption.create({ data: row(1) }),
      ).rejects.toThrow();

      await prisma.couponRedemption.delete({ where: { id: first.id } });
      await prisma.coupon.delete({ where: { id: coupon.id } });
    });

    it('★ `buyer_id` ของใบจองต้องเป็นเจ้าของ subscription จริงเท่านั้น (D-4)', async () => {
      // กฎ "1 คน 1 ครั้งต่อคูปอง" บังคับที่ (coupon_id, buyer_id) — ถ้าคอลัมน์นี้
      // เพี้ยนไปจากเจ้าของจริงได้ กฎนั้นก็ถูกข้ามได้ทันที · FK คู่จึงต้องปฏิเสธเอง
      const coupon = await prisma.coupon.create({ data: couponData() });
      const sub = await prisma.subscription.findFirstOrThrow({
        select: { id: true, buyerId: true, nextOrderDate: true },
        where: { nextOrderDate: { not: null } },
      });
      const someoneElse = await prisma.user.findFirstOrThrow({
        where: { id: { not: sub.buyerId } },
        select: { id: true },
      });

      await expect(
        prisma.couponRedemption.create({
          data: {
            couponId: coupon.id,
            subscriptionId: sub.id,
            // ★ ไม่ใช่เจ้าของ subscription นี้ ★
            buyerId: someoneElse.id,
            cycleDate: sub.nextOrderDate as Date,
            discountType: 'percent',
            discountValue: 10,
            discountAmount: 10,
          },
        }),
      ).rejects.toThrow();

      await prisma.coupon.delete({ where: { id: coupon.id } });
    });

    it('★ ออเดอร์ที่มีส่วนลดต้องชี้กลับไปหาใบจองได้เสมอ', async () => {
      const order = await prisma.order.findFirstOrThrow({
        select: { id: true },
      });
      // ตั้งส่วนลดโดยไม่มีใบจองทั้งสองช่อง → ผิด CHECK
      // (และ trigger `guard_order_update` ก็ห้ามแก้ยอด/ช่องใบจองอยู่แล้ว)
      await expect(
        prisma.order.update({
          where: { id: order.id },
          data: { discountAmount: 50 },
        }),
      ).rejects.toThrow();
    });
  });
});
