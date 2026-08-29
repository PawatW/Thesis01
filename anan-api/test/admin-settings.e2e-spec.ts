import { INestApplication } from '@nestjs/common';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, ApiError, createTestApp } from './utils/app';
import {
  bearer,
  cleanupTestUsers,
  registerTestUser,
  TEST_PASSWORD,
  type TestUser,
} from './utils/auth';

interface MailSettings {
  redirectEnabled: boolean;
  redirectTo: string | null;
  redirectCc: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  mailFrom: string | null;
  uatModeAvailable: boolean;
  smtpConfigured: boolean;
}

interface AuditRow {
  id: number;
  action: string;
  summary: string;
  actor: string | null;
}

interface EmailRow {
  id: number;
  kind: string;
  toIntended: string;
  toActual: string;
  ccActual: string | null;
  redirected: boolean;
  status: string;
}

interface Paged<T> {
  rows: T[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** ค่าตั้งต้นที่ถูกต้องเสมอ — เทสส่วนใหญ่แก้แค่ช่องเดียวจากชุดนี้ */
const BASE = {
  redirectEnabled: false,
  redirectTo: 'qa@test.local',
  redirectCc: null,
  smtpHost: null,
  smtpPort: null,
  smtpSecure: false,
  mailFrom: null,
};

/**
 * ตั้งค่าเมล + log ระบบ (feature 14)
 *
 * คำถามที่ไฟล์นี้ต้องตอบ:
 *   1. บัญชีที่ไม่ใช่ admin แตะอะไรได้บ้าง (คำตอบต้องคือ "ไม่ได้เลย")
 *   2. **เปิดโหมด DEV แล้วอีเมลถูกเปลี่ยนเส้นทางจริงไหม** — หรือแค่เปลี่ยนค่าใน DB
 *   3. ด่าน env กันคนที่ยึดบัญชี admin ได้จริงไหม (ยิง PUT ตรงข้ามหน้าจอ)
 *   4. ทุกการกระทำมีร่องรอยใน `audit_logs` ไหม
 *
 * ★ เทสในไฟล์นี้สลับ `MAIL_UAT_MODE_AVAILABLE` ระหว่างทาง ★ ทำได้เพราะ
 * `MailSettingsService` อ่าน `process.env` ตอนเรียกจริง ไม่ผ่าน ConfigService
 * (กับดักที่ working-agreement §6 เตือนไว้ — ที่นี่ใช้เป็นข้อดี)
 */
describe('Admin — ตั้งค่าเมล + log ระบบ', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: TestUser;
  let buyer: TestUser;
  let sent: jest.SpyInstance;
  let originalGate: string | undefined;

  const get = (path: string, token: string) =>
    api(app).get(`/api/v1${path}`).set(bearer(token));

  const put = (body: object, token: string) =>
    api(app).put('/api/v1/admin/mail-settings').set(bearer(token)).send(body);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupTestUsers(prisma);
    originalGate = process.env.MAIL_UAT_MODE_AVAILABLE;
    process.env.MAIL_UAT_MODE_AVAILABLE = 'true';

    admin = await registerTestUser(app, 'set-admin');
    buyer = await registerTestUser(app, 'set-buyer');

    // ★ สิทธิ์ admin ตั้งได้ทาง DB เท่านั้น ★ ไม่มี endpoint ไหนสร้าง admin ได้
    await prisma.user.update({
      where: { id: admin.id },
      data: { isAdmin: true },
    });
    const relogin = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: TEST_PASSWORD })
      .expect(200);
    admin.accessToken = (relogin.body as { accessToken: string }).accessToken;

    // ไม่ส่งเมลจริง แต่ยังเดินผ่าน MailService เดิมทุกครั้ง
    sent = jest
      .spyOn(app.get(MailService), 'sendPasswordReset')
      .mockResolvedValue(undefined);
  });

  afterAll(async () => {
    sent?.mockRestore();
    // คืนค่าตั้งต้นให้ตารางเสมอ — แถวนี้เป็น singleton ที่ไฟล์เทสอื่นก็อ่านเจอ
    if (prisma) {
      await prisma.mailSetting.update({
        where: { id: 1 },
        data: {
          redirectEnabled: false,
          redirectTo: null,
          redirectCc: null,
          smtpHost: null,
          smtpPort: null,
          smtpSecure: false,
          mailFrom: null,
        },
      });
      await cleanupTestUsers(prisma);
    }
    process.env.MAIL_UAT_MODE_AVAILABLE = originalGate;
    if (app) await app.close();
  });

  // ---------- สิทธิ์ ----------

  it('บัญชีธรรมดาอ่านตั้งค่าเมลไม่ได้ → 403', async () => {
    const res = await get('/admin/mail-settings', buyer.accessToken).expect(
      403,
    );
    expect((res.body as ApiError).code).toBe('FORBIDDEN_ROLE');
  });

  it('บัญชีธรรมดาแก้ตั้งค่าเมลไม่ได้ → 403', async () => {
    await put({ ...BASE }, buyer.accessToken).expect(403);
  });

  it('บัญชีธรรมดาเปิดหน้า log ไม่ได้ทั้งสองแท็บ → 403', async () => {
    await get('/admin/logs/audit', buyer.accessToken).expect(403);
    await get('/admin/logs/email', buyer.accessToken).expect(403);
  });

  it('ไม่ล็อกอินเลย → 401 (ไม่ใช่ 403)', async () => {
    await api(app).get('/api/v1/admin/mail-settings').expect(401);
  });

  // ---------- ตั้งค่าเมล ----------

  it('admin อ่านค่าได้ และค่าตั้งต้นคือปิดโหมดไว้', async () => {
    const res = await get('/admin/mail-settings', admin.accessToken).expect(
      200,
    );
    const body = res.body as MailSettings;
    expect(body.redirectEnabled).toBe(false);
    expect(body.uatModeAvailable).toBe(true);
    // ★ ห้ามหลุด ★ credential ของ SMTP ไม่มีทางออกมาทาง API นี้
    expect(res.body).not.toHaveProperty('smtpUser');
    expect(res.body).not.toHaveProperty('smtpPass');
  });

  it('★ แนบรหัสผ่าน SMTP มากับ body → 400 (credential อยู่ใน .env เท่านั้น)', async () => {
    await put(
      { ...BASE, smtpUser: 'someone', smtpPass: 'hunter2' },
      admin.accessToken,
    ).expect(400);
  });

  it('เปิดโหมดโดยไม่ใส่ปลายทาง → 400', async () => {
    await put(
      { ...BASE, redirectEnabled: true, redirectTo: '' },
      admin.accessToken,
    ).expect(400);
  });

  it('ชื่อโฮสต์ SMTP ที่มีช่องว่าง / พอร์ตนอกช่วง → 400', async () => {
    await put({ ...BASE, smtpHost: 'evil host' }, admin.accessToken).expect(
      400,
    );
    await put({ ...BASE, smtpPort: 70_000 }, admin.accessToken).expect(400);
  });

  it('รายการ Cc ที่ไม่ใช่อีเมล → 400', async () => {
    await put(
      { ...BASE, redirectEnabled: true, redirectCc: 'ไม่ใช่อีเมล' },
      admin.accessToken,
    ).expect(400);
  });

  it('★ เปิดโหมดสำเร็จ → ค่าลง DB และมีร่องรอยใน audit log', async () => {
    const res = await put(
      {
        ...BASE,
        redirectEnabled: true,
        redirectTo: 'qa-team@test.local',
        redirectCc: 'dev@test.local, qa2@test.local',
      },
      admin.accessToken,
    ).expect(200);

    expect((res.body as MailSettings).redirectEnabled).toBe(true);
    expect((res.body as MailSettings).redirectTo).toBe('qa-team@test.local');

    const row = await prisma.mailSetting.findUniqueOrThrow({
      where: { id: 1 },
    });
    expect(row.redirectEnabled).toBe(true);
    expect(row.updatedById).toBe(admin.id);

    const logs = await prisma.auditLog.findMany({
      where: { action: 'mail_settings_updated', actorId: admin.id },
    });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.at(-1)!.summary).toContain('qa-team@test.local');
  });

  it('★★ เปิดโหมดแล้วอีเมลถูกเปลี่ยนเส้นทางจริง — ไม่ใช่แค่ค่าใน DB', async () => {
    // ปล่อยให้ MailService ทำงานเต็มเส้นทางรอบนี้ (ยังไม่มี SMTP → status skipped)
    sent.mockRestore();

    const victim = await registerTestUser(app, 'set-victim');
    await api(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: victim.email })
      .expect(204);

    // การส่งเมลถูกยิงแบบไม่ await — รอให้ microtask/DB write เดินให้จบก่อนอ่าน
    await waitFor(async () => {
      const log = await prisma.emailLog.findFirst({
        where: { toIntended: victim.email },
        orderBy: { createdAt: 'desc' },
      });
      return log != null;
    });

    const log = await prisma.emailLog.findFirstOrThrow({
      where: { toIntended: victim.email },
      orderBy: { createdAt: 'desc' },
    });
    expect(log.toActual).toBe('qa-team@test.local');
    expect(log.redirected).toBe(true);
    expect(log.ccActual).toBe('dev@test.local, qa2@test.local');
    expect(log.kind).toBe('password_reset');

    sent = jest
      .spyOn(app.get(MailService), 'sendPasswordReset')
      .mockResolvedValue(undefined);
  });

  it('ปิดโหมด → ปลายทางถูกล้างทิ้ง ไม่ค้างไว้เป็นกับดัก', async () => {
    const res = await put({ ...BASE }, admin.accessToken).expect(200);
    expect((res.body as MailSettings).redirectEnabled).toBe(false);
    expect((res.body as MailSettings).redirectTo).toBeNull();

    const row = await prisma.mailSetting.findUniqueOrThrow({
      where: { id: 1 },
    });
    expect(row.redirectTo).toBeNull();
    expect(row.redirectCc).toBeNull();
  });

  it('★ ด่าน env: ปิดสวิตช์ที่เครื่องแล้ว admin เปิดโหมดไม่ได้ → 403', async () => {
    process.env.MAIL_UAT_MODE_AVAILABLE = 'false';
    try {
      const res = await put(
        { ...BASE, redirectEnabled: true, redirectTo: 'qa@test.local' },
        admin.accessToken,
      ).expect(403);
      expect((res.body as ApiError).code).toBe('UAT_MODE_UNAVAILABLE');

      // ปิดโหมดยังทำได้เสมอ — ด่านนี้กัน "เปิด" ไม่ใช่กันการแก้ทั้งหน้า
      await put({ ...BASE }, admin.accessToken).expect(200);

      // ★ และเปลี่ยนปลายทางของ SMTP ก็ไม่ได้เช่นกัน ★
      // ถ้าเปิดไว้ บัญชี admin ที่ถูกยึดจะชี้ host ไปรีเลย์ของตัวเองแล้วรับอีเมล
      // ของทั้งระบบได้ (และอ่านผลการเชื่อมต่อกลับจากคอลัมน์ error ของ email_logs)
      const locked = await put(
        { ...BASE, smtpHost: 'smtp.attacker.example' },
        admin.accessToken,
      ).expect(403);
      expect((locked.body as ApiError).code).toBe('SMTP_TARGET_LOCKED');

      // แต่ชื่อผู้ส่งยังแก้ได้ — เป็นค่าที่ควรแก้ได้บนระบบจริง
      await put(
        { ...BASE, mailFrom: 'ANAN <no-reply@anan.local>' },
        admin.accessToken,
      ).expect(200);

      const flags = await get('/admin/mail-settings', admin.accessToken).expect(
        200,
      );
      expect((flags.body as MailSettings).uatModeAvailable).toBe(false);
    } finally {
      process.env.MAIL_UAT_MODE_AVAILABLE = 'true';
    }
  });

  // ---------- log ระบบ ----------

  it('admin อ่าน audit log ได้ และไม่มี id ของผู้ใช้หลุดมากับแถว', async () => {
    const res = await get('/admin/logs/audit', admin.accessToken).expect(200);
    const body = res.body as Paged<AuditRow>;
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.pageSize).toBe(50);
    // ส่งชื่อที่แสดง ไม่ใช่ uuid
    expect(body.rows[0]).not.toHaveProperty('actorId');
    expect(JSON.stringify(body.rows)).not.toContain(admin.id);
  });

  it('กรอง audit log ตามชนิดเหตุการณ์ได้ และชนิดที่ไม่รู้จัก → 400', async () => {
    const res = await get(
      '/admin/logs/audit?action=mail_settings_updated',
      admin.accessToken,
    ).expect(200);
    const body = res.body as Paged<AuditRow>;
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.every((r) => r.action === 'mail_settings_updated')).toBe(
      true,
    );

    await get(
      '/admin/logs/audit?action=drop_everything',
      admin.accessToken,
    ).expect(400);
  });

  it('หน้าเกินเพดาน → 400 (กันไล่ดูดทั้งตาราง)', async () => {
    await get('/admin/logs/audit?page=99999', admin.accessToken).expect(400);
    await get('/admin/logs/audit?page=0', admin.accessToken).expect(400);
  });

  it('★ email log บอกทั้งผู้รับตัวจริงและปลายทางที่ส่งไป', async () => {
    const res = await get('/admin/logs/email', admin.accessToken).expect(200);
    const body = res.body as Paged<EmailRow>;
    expect(body.rows.length).toBeGreaterThan(0);

    const redirectedRow = body.rows.find((r) => r.redirected);
    expect(redirectedRow).toBeDefined();
    expect(redirectedRow!.toIntended).not.toBe(redirectedRow!.toActual);
  });

  it('กรอง email log ตามสถานะได้ และสถานะที่ไม่รู้จัก → 400', async () => {
    const res = await get(
      '/admin/logs/email?status=skipped',
      admin.accessToken,
    ).expect(200);
    expect(
      (res.body as Paged<EmailRow>).rows.every((r) => r.status === 'skipped'),
    ).toBe(true);

    await get('/admin/logs/email?status=exploded', admin.accessToken).expect(
      400,
    );
  });

  it('★ ไม่มีทางลบ log — ไม่มี endpoint ให้เรียก', async () => {
    await api(app)
      .delete('/api/v1/admin/logs/audit')
      .set(bearer(admin.accessToken))
      .expect(404);
    await api(app)
      .delete('/api/v1/admin/logs/email')
      .set(bearer(admin.accessToken))
      .expect(404);
  });

  it('★ ระงับร้านแล้วมีร่องรอยใน audit log พร้อมชื่อร้านและเหตุผล', async () => {
    const seller = await registerTestUser(app, 'set-seller');
    const shop = await api(app)
      .post('/api/v1/seller/shop')
      .set(bearer(seller.accessToken))
      .send({ name: `ร้านทดสอบ log ${Date.now()}` })
      .expect(201);
    const shopId = (shop.body as { id: string }).id;

    await api(app)
      .post(`/api/v1/admin/shops/${shopId}/suspension`)
      .set(bearer(admin.accessToken))
      .send({ suspend: true, reason: 'ขายของผิดกฎ' })
      .expect(200);

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'shop_suspended', targetId: shopId },
    });
    expect(log.actorId).toBe(admin.id);
    expect(log.summary).toContain('ขายของผิดกฎ');
  });
});

/** รอเงื่อนไขให้เป็นจริง — ใช้กับงานที่ถูกยิงแบบไม่ await (การส่งเมล) */
async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('รอเงื่อนไขไม่สำเร็จภายในเวลาที่กำหนด');
}
