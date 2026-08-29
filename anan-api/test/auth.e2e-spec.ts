import { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, ApiError, createTestApp } from './utils/app';
import {
  bearer,
  cleanupTestUsers,
  E2E_PREFIX,
  registerTestUser,
  TEST_PASSWORD,
} from './utils/auth';

describe('Auth — สมัคร / เข้าสู่ระบบ / หมุน token', () => {
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

  // ---------- สมัครสมาชิก ----------

  it('สมัครสำเร็จ → 201 พร้อม token และข้อมูลผู้ใช้', async () => {
    const email = `${E2E_PREFIX}register-${Date.now()}@test.local`;
    const res = await api(app)
      .post('/api/v1/auth/register')
      .send({ email, password: TEST_PASSWORD, displayName: 'ผู้ใช้ใหม่' })
      .expect(201);

    const body = res.body as Record<string, unknown> & {
      user: Record<string, unknown>;
    };
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
    expect(body.user.email).toBe(email);
    expect(body.user.isAdmin).toBe(false);
    expect(body.user.isSeller).toBe(false);

    // ★ ห้ามหลุด ★
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain(TEST_PASSWORD);
  });

  it('อีเมลซ้ำ → 409 EMAIL_TAKEN', async () => {
    const user = await registerTestUser(app, 'dup');
    const res = await api(app)
      .post('/api/v1/auth/register')
      .send({
        email: user.email.toUpperCase(), // ต้องถือว่าเป็นอีเมลเดียวกัน
        password: TEST_PASSWORD,
        displayName: 'ซ้ำ',
      })
      .expect(409);

    expect((res.body as ApiError).code).toBe('EMAIL_TAKEN');
  });

  it('แนบ isAdmin มากับ body → 400 และไม่มีบัญชีถูกสร้าง (T-1)', async () => {
    const email = `${E2E_PREFIX}escalate-${Date.now()}@test.local`;
    await api(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: TEST_PASSWORD,
        displayName: 'คนอยากเป็นแอดมิน',
        isAdmin: true,
      })
      .expect(400);

    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('รหัสผ่านสั้นกว่า 10 ตัว → 400', async () => {
    await api(app)
      .post('/api/v1/auth/register')
      .send({
        email: `${E2E_PREFIX}short-${Date.now()}@test.local`,
        password: 'sh0rt',
        displayName: 'สั้นไป',
      })
      .expect(400);
  });

  it('รหัสผ่านถูกเก็บเป็น bcrypt hash ไม่ใช่ข้อความธรรมดา', async () => {
    const user = await registerTestUser(app, 'hash');
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    expect(row.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(row.passwordHash).not.toContain(TEST_PASSWORD);
  });

  // ---------- เข้าสู่ระบบ ----------

  it('เข้าสู่ระบบสำเร็จ → 200', async () => {
    const user = await registerTestUser(app, 'login');
    const res = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);

    expect(typeof (res.body as { accessToken: string }).accessToken).toBe(
      'string',
    );
  });

  it('รหัสผิด กับ อีเมลที่ไม่มีในระบบ ตอบเหมือนกันทุกอย่าง (กัน user enumeration)', async () => {
    const user = await registerTestUser(app, 'enum');

    const wrongPassword = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'WrongPassword123!' })
      .expect(401);

    const unknownEmail = await api(app)
      .post('/api/v1/auth/login')
      .send({
        email: `${E2E_PREFIX}ghost-${Date.now()}@test.local`,
        password: 'WrongPassword123!',
      })
      .expect(401);

    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect((wrongPassword.body as ApiError).code).toBe('INVALID_CREDENTIALS');
  });

  // ---------- refresh token ----------

  it('refresh สำเร็จ → ได้ token ชุดใหม่ที่ไม่ซ้ำของเดิม', async () => {
    const user = await registerTestUser(app, 'refresh');
    const res = await api(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(200);

    const body = res.body as { accessToken: string; refreshToken: string };
    expect(body.refreshToken).not.toBe(user.refreshToken);
  });

  it('ใช้ refresh token เดิมซ้ำหลังหมุนแล้ว → 401 และทุก session ถูกเพิกถอน (T-24)', async () => {
    const user = await registerTestUser(app, 'reuse');

    const rotated = await api(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(200);
    const fresh = (rotated.body as { refreshToken: string }).refreshToken;

    // เอาตัวเก่ามาใช้ซ้ำ = สัญญาณว่า token รั่ว
    const reused = await api(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);
    expect((reused.body as ApiError).code).toBe('TOKEN_REUSED');

    // ตัวที่เพิ่งหมุนมาต้องใช้ไม่ได้ด้วย — ระบบตัดทุก session ทิ้ง
    await api(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: fresh })
      .expect(401);

    const alive = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    });
    expect(alive).toBe(0);
  });

  it('refresh token มั่ว → 401', async () => {
    await api(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'ไม่ใช่ token' })
      .expect(401);
  });

  it('DB เก็บแค่ hash ของ refresh token ไม่ใช่ตัว token', async () => {
    const user = await registerTestUser(app, 'store');
    const rows = await prisma.refreshToken.findMany({
      where: { userId: user.id },
      select: { tokenHash: true },
    });
    expect(rows).toHaveLength(1);
    const [stored] = rows;
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.tokenHash).not.toBe(user.refreshToken);
  });

  // ---------- ออกจากระบบ ----------

  it('ออกจากระบบแล้ว refresh token ใบนั้นใช้ไม่ได้อีก', async () => {
    const user = await registerTestUser(app, 'logout');

    await api(app)
      .post('/api/v1/auth/logout')
      .set(bearer(user.accessToken))
      .send({ refreshToken: user.refreshToken })
      .expect(204);

    await api(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);
  });

  /**
   * A-8 — ช่องโหว่ที่ค้างไว้ตั้งแต่ Phase 1 (security-design §5)
   *
   * เดิม "token ที่ถูกเพิกถอนแล้วถูกใช้ซ้ำ" ถูกตีความว่ารั่วทุกกรณี ใครก็ตามที่
   * เคยเห็น token ที่ logout ไปแล้ว (หรือแอปที่ยิงซ้ำเองตอนเน็ตกระตุก) จึงเตะ
   * เจ้าของบัญชีออกจากทุกเครื่องได้ตลอดเวลา = DoS ระดับบัญชี
   */
  it('★ ยิง refresh token ที่ logout ไปแล้วซ้ำ → 401 แต่เครื่องอื่นของเจ้าของยังใช้ได้ (A-8)', async () => {
    const user = await registerTestUser(app, 'a8');

    // ล็อกอินอีกเครื่องหนึ่งของคนเดียวกัน
    const other = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);
    const otherRefresh = (other.body as { refreshToken: string }).refreshToken;

    await api(app)
      .post('/api/v1/auth/logout')
      .set(bearer(user.accessToken))
      .send({ refreshToken: user.refreshToken })
      .expect(204);

    // ยิงใบที่ logout ไปแล้วซ้ำ ๆ — ต้องไม่ลามไปเครื่องอื่น
    for (let i = 0; i < 3; i++) {
      const res = await api(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(401);
      expect((res.body as ApiError).code).toBe('INVALID_REFRESH_TOKEN');
    }

    await api(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: otherRefresh })
      .expect(200);
  });

  it('ยิง logout ด้วย refresh token ของคนอื่น → ของคนนั้นต้องไม่ถูกเพิกถอน', async () => {
    const victim = await registerTestUser(app, 'victim');
    const attacker = await registerTestUser(app, 'attacker');

    await api(app)
      .post('/api/v1/auth/logout')
      .set(bearer(attacker.accessToken))
      .send({ refreshToken: victim.refreshToken })
      .expect(204);

    // เหยื่อยังใช้งานต่อได้ตามปกติ
    await api(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: victim.refreshToken })
      .expect(200);
  });

  // ---------- endpoint ที่ต้องล็อกอิน ----------

  it('เรียก endpoint ที่ต้องล็อกอินโดยไม่มี token → 401 (global guard)', async () => {
    const res = await api(app).get('/api/v1/me').expect(401);
    expect((res.body as ApiError).code).toBe('UNAUTHENTICATED');
  });

  it('token ที่เซ็นด้วย secret อื่น / มั่ว → 401 (T-25)', async () => {
    // ลายเซ็นไม่ตรงกับ JWT_ACCESS_SECRET ของเรา
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5OTk5OTk5OS05OTk5LTQ5OTktOTk5OS05OTk5OTk5OTk5OTkiLCJlbWFpbCI6ImhhY2tlckB0ZXN0LmxvY2FsIn0.aW52YWxpZC1zaWduYXR1cmUtbm90LXNpZ25lZC1ieS11cw';
    await api(app).get('/api/v1/me').set(bearer(forged)).expect(401);
  });

  it('access token ที่ผู้ใช้ถูกลบไปแล้ว → 401 (สิทธิ์อ่านจาก DB ใหม่ทุก request)', async () => {
    const user = await registerTestUser(app, 'deleted');
    await prisma.user.delete({ where: { id: user.id } });

    await api(app).get('/api/v1/me').set(bearer(user.accessToken)).expect(401);
  });
});

describe('Auth — rate limit (เปิด throttler จริง)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ throttle: true }));
  });

  afterAll(async () => {
    if (prisma) await cleanupTestUsers(prisma);
    if (app) await app.close();
  });

  // เพดานของ /auth/* คือ 10 ครั้ง/นาที (auth.controller.ts) — ทดสอบที่ "ขอบ"
  // ไม่ใช่แค่ "เจอ 429 สักครั้ง" ไม่งั้นเพดานเพี้ยนเป็น 1/นาที test ก็ยังเขียว
  const AUTH_LIMIT = 10;

  it(`ยิง login ผิด ${AUTH_LIMIT} ครั้งแรกได้ 401 · ครั้งที่ ${AUTH_LIMIT + 1} ได้ 429 (T-23)`, async () => {
    const email = `${E2E_PREFIX}throttle-${Date.now()}@test.local`;
    const body = { email, password: 'WrongPassword123!' };

    for (let i = 1; i <= AUTH_LIMIT; i++) {
      const res = await api(app).post('/api/v1/auth/login').send(body);
      expect(`ครั้งที่ ${i} → ${res.status}`).toBe(`ครั้งที่ ${i} → 401`);
    }

    const blocked = await api(app).post('/api/v1/auth/login').send(body);
    expect(blocked.status).toBe(429);
    expect((blocked.body as ApiError).code).toBe('RATE_LIMITED');
  });
});

/**
 * ลืมรหัสผ่าน (feature 01) — จุดที่ต้องไม่พลาด 3 อย่าง
 *   1. ตอบเหมือนกันทุกกรณี ไม่บอกว่าอีเมลมีในระบบไหม
 *   2. ตั๋วใช้ได้ครั้งเดียว หมดอายุจริง และตายเมื่อขอใบใหม่
 *   3. ตั้งรหัสใหม่แล้วต้องเตะทุก session เดิมออก ไม่งั้นการรีเซ็ตไม่มีความหมาย
 *
 * ตัว token จริงอยู่ในอีเมลเท่านั้น (DB เก็บแค่ sha256) — เทสจึงดักที่ `MailService`
 * ซึ่งเป็นทางออกทางเดียวของมัน วิธีนี้ได้ทดสอบการประกอบลิงก์จริงไปด้วยในตัว
 */
describe('Auth — ลืมรหัสผ่าน / ตั้งรหัสผ่านใหม่', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  // ผูก type ของอาร์กิวเมนต์ไว้กับ spy ตรงนี้ — ไม่งั้น `mock.calls` เป็น any
  // แล้วต้องไล่ cast ทุกจุดที่อ่านค่า (ซึ่ง lint ห้ามอยู่แล้ว)
  let sent: jest.SpyInstance<
    Promise<void>,
    [{ to: string; resetUrl: string; expiresInMinutes: number }]
  >;

  /** ขอลิงก์แล้วแกะ token ออกจากอีเมลที่ระบบส่ง — เหมือนที่ผู้ใช้จริงทำ */
  async function requestResetToken(email: string): Promise<string> {
    sent.mockClear();
    await api(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email })
      .expect(204);

    expect(sent).toHaveBeenCalledTimes(1);
    const { resetUrl } = sent.mock.calls[0]![0];
    const token = new URL(resetUrl).searchParams.get('token');
    expect(typeof token).toBe('string');
    return token!;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupTestUsers(prisma);
    // ไม่ส่งเมลจริงระหว่างเทส แต่ยังเดินผ่านเมธอดเดิมทุกครั้ง
    sent = jest
      .spyOn(app.get(MailService), 'sendPasswordReset')
      .mockResolvedValue(undefined);
  });

  afterAll(async () => {
    sent?.mockRestore();
    if (prisma) await cleanupTestUsers(prisma);
    if (app) await app.close();
  });

  // ---------- ขอลิงก์ ----------

  it('อีเมลที่มีในระบบ → 204 พร้อมตั๋วใน DB และลิงก์ที่ชี้ไปหน้าจอของแอป', async () => {
    const user = await registerTestUser(app, 'forgot-ok');
    sent.mockClear();

    await api(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: user.email })
      .expect(204);

    const rows = await prisma.passwordResetToken.findMany({
      where: { userId: user.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.usedAt).toBeNull();
    expect(rows[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    expect(sent).toHaveBeenCalledTimes(1);
    const arg = sent.mock.calls[0]![0];
    expect(arg.to).toBe(user.email);
    // ปลายทางมาจาก APP_WEB_URL ของ API เท่านั้น ไม่ได้มาจาก request
    expect(arg.resetUrl.startsWith(process.env.APP_WEB_URL!)).toBe(true);
    expect(arg.resetUrl).toContain('/reset-password?token=');
  });

  it('★ อีเมลที่ไม่มีในระบบ → 204 เหมือนกันเป๊ะ และไม่มีเมลถูกส่ง (กัน user enumeration)', async () => {
    sent.mockClear();
    const before = await prisma.passwordResetToken.count();

    await api(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: `${E2E_PREFIX}ghost-${Date.now()}@test.local` })
      .expect(204);

    expect(sent).not.toHaveBeenCalled();
    expect(await prisma.passwordResetToken.count()).toBe(before);
  });

  it('★ เวลาตอบกลับถูกตรึงเท่ากันทั้งอีเมลที่มีและไม่มี (ปิดออราเคิลด้าน timing)', async () => {
    const user = await registerTestUser(app, 'forgot-timing');

    const measure = async (email: string): Promise<number> => {
      const t0 = Date.now();
      await api(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(204);
      return Date.now() - t0;
    };

    const existing = await measure(user.email);
    const missing = await measure(
      `${E2E_PREFIX}timing-ghost-${Date.now()}@test.local`,
    );

    // ยืนยัน "พื้น" ไม่ใช่ "เพดาน" — เพดานขึ้นกับความเร็วเครื่องจึงเทสไม่ได้
    // แต่พื้นคือสิ่งที่ทำให้สองเส้นทางแยกกันไม่ออก และเป็นค่าที่กำหนดเองในโค้ด
    const FLOOR_MS = 250;
    expect(existing).toBeGreaterThanOrEqual(FLOOR_MS - 25);
    expect(missing).toBeGreaterThanOrEqual(FLOOR_MS - 25);
  });

  it('อีเมลผิดรูปแบบ → 400 (ผิดที่รูปแบบ ไม่ใช่ที่ตัวบัญชี จึงบอกได้)', async () => {
    await api(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ไม่ใช่อีเมล' })
      .expect(400);
  });

  it('★ แนบ redirectTo มาด้วย → 400 (ปลายทางของลิงก์ต้องไม่มาจาก client)', async () => {
    const user = await registerTestUser(app, 'forgot-redirect');
    await api(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: user.email, redirectTo: 'https://evil.example.com' })
      .expect(400);
  });

  it('★ DB เก็บเฉพาะ sha256 — ตัว token ไม่เคยถูกเขียนลงตาราง', async () => {
    const user = await registerTestUser(app, 'forgot-hash');
    const token = await requestResetToken(user.email);

    const row = await prisma.passwordResetToken.findFirst({
      where: { userId: user.id, usedAt: null },
    });
    expect(row!.tokenHash).not.toBe(token);
    expect(row!.tokenHash).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // ---------- ตั้งรหัสใหม่ ----------

  it('★ ตั้งรหัสใหม่สำเร็จ → รหัสใหม่ใช้ได้ · รหัสเก่าใช้ไม่ได้ · ตั๋วถูกปิด', async () => {
    const user = await registerTestUser(app, 'reset-ok');
    const token = await requestResetToken(user.email);
    const newPassword = 'BrandNewPass2026!';

    await api(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: newPassword })
      .expect(204);

    await api(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: newPassword })
      .expect(200);

    const old = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(401);
    expect((old.body as ApiError).code).toBe('INVALID_CREDENTIALS');

    const row = await prisma.passwordResetToken.findFirst({
      where: { userId: user.id },
    });
    expect(row!.usedAt).not.toBeNull();
  });

  it('★ ตั้งรหัสใหม่แล้ว session เดิมทุกเครื่องต้องหลุด (revoked_reason = password_reset)', async () => {
    const user = await registerTestUser(app, 'reset-revoke');
    const token = await requestResetToken(user.email);
    const newPassword = 'AnotherStrongPass2026!';

    await api(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: newPassword })
      .expect(204);

    // refresh token ที่ถืออยู่ก่อนรีเซ็ตต้องใช้ไม่ได้อีก
    const res = await api(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);
    expect((res.body as ApiError).code).toBe('INVALID_REFRESH_TOKEN');

    const revoked = await prisma.refreshToken.count({
      where: { userId: user.id, revokedReason: 'password_reset' },
    });
    expect(revoked).toBeGreaterThan(0);

    // ★ ใบที่ปิดเพราะรีเซ็ต ถูกใช้ซ้ำแล้วต้องไม่ถูกตีความว่า token รั่ว (A-8) ★
    // ถ้าตีความผิด session ใหม่ที่เพิ่งล็อกอินเสร็จจะถูกเตะออกตามไปด้วยทันที
    const after = await api(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: newPassword })
      .expect(200);
    const fresh = (after.body as { refreshToken: string }).refreshToken;

    await api(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);
    await api(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: fresh })
      .expect(200);
  });

  it('ใช้ตั๋วซ้ำครั้งที่สอง → 400 INVALID_RESET_TOKEN', async () => {
    const user = await registerTestUser(app, 'reset-twice');
    const token = await requestResetToken(user.email);

    await api(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'FirstReset2026!' })
      .expect(204);

    const res = await api(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'SecondReset2026!' })
      .expect(400);
    expect((res.body as ApiError).code).toBe('INVALID_RESET_TOKEN');

    // รหัสต้องยังเป็นของครั้งแรก ไม่ใช่ของครั้งที่สอง
    await api(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'FirstReset2026!' })
      .expect(200);
  });

  it('★ ขอลิงก์ใหม่ → ใบเก่าที่ยังอยู่ในกล่องเมลใช้ไม่ได้ทันที', async () => {
    const user = await registerTestUser(app, 'reset-superseded');
    const first = await requestResetToken(user.email);
    const second = await requestResetToken(user.email);
    expect(second).not.toBe(first);

    await api(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: first, password: 'ShouldNotWork2026!' })
      .expect(400);

    await api(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: second, password: 'ShouldWork2026!' })
      .expect(204);
  });

  it('ตั๋วหมดอายุ → 400 (ข้อความเดียวกับตั๋วที่ไม่มีจริง)', async () => {
    const user = await registerTestUser(app, 'reset-expired');
    const token = await requestResetToken(user.email);

    // CHECK `expires_at > created_at` บังคับให้ต้องดันทั้งคู่ ไม่ใช่แค่วันหมดอายุ
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: {
        createdAt: new Date(Date.now() - 120 * 60_000),
        expiresAt: new Date(Date.now() - 60 * 60_000),
      },
    });

    const res = await api(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'TooLate2026!' })
      .expect(400);
    expect((res.body as ApiError).code).toBe('INVALID_RESET_TOKEN');

    // รหัสเดิมต้องยังใช้ได้ — ตั๋วที่หมดอายุต้องไม่เปลี่ยนอะไรเลย
    await api(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);
  });

  it('token มั่ว → 400 (ข้อความเดียวกัน ไม่ยืนยันว่าเคยมีใบนี้ไหม)', async () => {
    const res = await api(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'not-a-real-token', password: 'WhateverPass2026!' })
      .expect(400);
    expect((res.body as ApiError).code).toBe('INVALID_RESET_TOKEN');
  });

  it('รหัสใหม่สั้นกว่า 10 ตัว → 400 และตั๋วต้องยังใช้ได้อยู่', async () => {
    const user = await registerTestUser(app, 'reset-weak');
    const token = await requestResetToken(user.email);

    await api(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'sh0rt' })
      .expect(400);

    // ล้มที่ DTO ต้องไม่กินตั๋วทิ้ง — ผู้ใช้ต้องกรอกใหม่ได้ด้วยลิงก์เดิม
    await api(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'GoodEnoughPass2026!' })
      .expect(204);
  });
});

/**
 * refresh token ของฝั่งเว็บอยู่ใน httpOnly cookie ไม่ใช่ response body
 *
 * ★ สิ่งที่ชุดนี้พิสูจน์ ★ ไม่ใช่แค่ "cookie ถูกตั้ง" แต่คือ **token ไม่มีทาง
 * ไปโผล่ในที่ที่ JavaScript อ่านได้เลย** ถ้าวันหนึ่งมีคนเผลอส่ง `refreshToken`
 * กลับลง body ด้วยความหวังดี (เช่นเพื่อ debug) ชั้นป้องกัน XSS ทั้งหมดจะหายไป
 * เงียบ ๆ โดยไม่มีอะไรพัง — เคสในไฟล์นี้คือสิ่งเดียวที่จะจับได้
 *
 * ตัวแยกว่าใครเป็นเบราว์เซอร์คือ header `Origin` ซึ่ง JavaScript ปลอมไม่ได้
 * (forbidden header name) — supertest ไม่ส่งมาเอง เคสที่ต้องการโหมดเว็บจึงต้อง
 * `.set('Origin', WEB_ORIGIN)` ให้ชัด ส่วนเคสที่ไม่ตั้ง = จำลอง Expo native
 */
describe('Auth — refresh token ใน httpOnly cookie (ฝั่งเว็บ)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  /** ต้องตรงกับ CORS_ORIGINS ใน .env ไม่งั้น AllowedOriginGuard ปัดตกตั้งแต่ต้น */
  const WEB_ORIGIN = 'http://localhost:8081';
  const COOKIE = 'anan_rt';
  const CLEARED = /Expires=Thu, 01 Jan 1970|Max-Age=0/;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupTestUsers(prisma);
  });

  afterAll(async () => {
    if (prisma) await cleanupTestUsers(prisma);
    if (app) await app.close();
  });

  interface WithHeaders {
    headers: Record<string, unknown>;
  }

  function setCookieHeaders(res: WithHeaders): string[] {
    const raw = res.headers['set-cookie'];
    // express ส่งเป็น array เสมอเมื่อมี Set-Cookie — เคสอื่นถือว่าไม่มี
    if (!Array.isArray(raw)) return typeof raw === 'string' ? [raw] : [];
    return raw as string[];
  }

  /** บรรทัด Set-Cookie ของ refresh token ทั้งบรรทัด (รวม attribute) */
  function refreshCookieHeader(res: WithHeaders): string | undefined {
    return setCookieHeaders(res).find((c) => c.startsWith(COOKIE + '='));
  }

  function refreshCookieValue(res: WithHeaders): string {
    const header = refreshCookieHeader(res);
    if (header == null) throw new Error('ไม่พบ cookie ของ refresh token');
    return header.slice(COOKIE.length + 1).split(';')[0] ?? '';
  }

  async function registerFor(tag: string): Promise<string> {
    const email = `${E2E_PREFIX}${tag}-${Date.now()}@test.local`;
    await api(app)
      .post('/api/v1/auth/register')
      .send({ email, password: TEST_PASSWORD, displayName: tag })
      .expect(201);
    return email;
  }

  /** ล็อกอินแบบเบราว์เซอร์ แล้วคืน cookie ที่ได้มา */
  async function loginAsBrowser(email: string): Promise<string> {
    const res = await api(app)
      .post('/api/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return refreshCookieValue(res);
  }

  it('สมัครจากเบราว์เซอร์ → refresh token อยู่ใน cookie เท่านั้น ไม่อยู่ใน body', async () => {
    const email = `${E2E_PREFIX}cookie-reg-${Date.now()}@test.local`;

    const res = await api(app)
      .post('/api/v1/auth/register')
      .set('Origin', WEB_ORIGIN)
      .send({ email, password: TEST_PASSWORD, displayName: 'เว็บ' })
      .expect(201);

    const body = res.body as Record<string, unknown>;
    // ★ หัวใจของทั้งชุด ★ ถ้าบรรทัดนี้แดง = XSS ดูด token ออกไปได้อีกครั้ง
    expect(body.refreshToken).toBeUndefined();
    expect(typeof body.accessToken).toBe('string');
    expect(refreshCookieValue(res).length).toBeGreaterThan(20);
  });

  it('cookie ต้องมี HttpOnly · SameSite · Path จำกัดไว้ที่ /auth', async () => {
    const email = await registerFor('cookie-attrs');

    const res = await api(app)
      .post('/api/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ email, password: TEST_PASSWORD })
      .expect(200);

    const header = refreshCookieHeader(res) ?? '';
    // HttpOnly คือคุณสมบัติเดียวที่ทำให้ XSS อ่าน token ไม่ได้ — ห้ามหาย
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    // จำกัด path = จำนวน endpoint ที่ต้องคิดเรื่อง CSRF เหลือแค่ในไฟล์เดียว
    expect(header).toContain('Path=/api/v1/auth');
  });

  it('refresh ด้วย cookie ล้วน (ไม่มี body) → ได้ token ชุดใหม่ + cookie ใบใหม่', async () => {
    const email = await registerFor('cookie-refresh');
    const cookie = await loginAsBrowser(email);

    const res = await api(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', `${COOKIE}=${cookie}`)
      .expect(200);

    const body = res.body as Record<string, unknown>;
    expect(body.refreshToken).toBeUndefined();
    expect(typeof body.accessToken).toBe('string');
    // หมุนแล้วต้องได้ใบใหม่จริง ไม่ใช่ตอบ 200 แล้วปล่อยใบเดิมค้าง
    expect(refreshCookieValue(res)).not.toBe(cookie);
  });

  it('reuse detection ยังทำงานในโหมด cookie — ใช้ cookie ที่หมุนแล้วซ้ำ → 401 + ตัดทุก session', async () => {
    const email = await registerFor('cookie-reuse');
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const first = await loginAsBrowser(email);

    await api(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', `${COOKIE}=${first}`)
      .expect(200);

    // ใบเดิมถูกหมุนไปแล้ว — เอามาใช้ซ้ำแปลว่ามีคนอื่นถือสำเนาอยู่
    await api(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', `${COOKIE}=${first}`)
      .expect(401);

    const alive = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    });
    expect(alive).toBe(0);
  });

  it('refresh ที่ใช้ไม่ได้ → ต้องสั่งลบ cookie ทิ้งด้วย ไม่งั้นผู้ใช้ติดวง 401 ถาวร', async () => {
    const res = await api(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', `${COOKIE}=not-a-real-token`)
      .expect(401);

    // ผู้ใช้ล้าง httpOnly cookie เองไม่ได้ — server ต้องเป็นคนสั่งลบ
    expect(refreshCookieHeader(res) ?? '').toMatch(CLEARED);
  });

  it('ออกจากระบบด้วย cookie (ไม่มี body) → cookie ถูกลบ + ใบนั้นถูกเพิกถอนใน DB', async () => {
    const email = await registerFor('cookie-logout');

    const login = await api(app)
      .post('/api/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .send({ email, password: TEST_PASSWORD })
      .expect(200);

    const cookie = refreshCookieValue(login);
    const { accessToken } = login.body as { accessToken: string };

    const res = await api(app)
      .post('/api/v1/auth/logout')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', `${COOKIE}=${cookie}`)
      .set(bearer(accessToken))
      .expect(204);

    expect(refreshCookieHeader(res) ?? '').toMatch(CLEARED);

    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: createHash('sha256').update(cookie).digest('hex') },
    });
    expect(stored?.revokedReason).toBe('logout');
  });

  it('Origin ที่ไม่อยู่ใน allowlist → 403 (ด่าน CSRF ของ endpoint ที่กิน cookie)', async () => {
    const email = await registerFor('cookie-csrf');
    const cookie = await loginAsBrowser(email);

    const res = await api(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', 'https://evil.example.com')
      .set('Cookie', `${COOKIE}=${cookie}`)
      .expect(403);

    expect((res.body as ApiError).code).toBe('ORIGIN_NOT_ALLOWED');

    // ต้องถูกปัดตกก่อนแตะ token — ใบเดิมยังใช้ได้อยู่ ไม่ถูกหมุนทิ้ง
    await api(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', `${COOKIE}=${cookie}`)
      .expect(200);
  });

  it('ผู้เรียกที่ไม่ใช่เบราว์เซอร์ (Expo native) ยังได้ token ลง body และไม่ได้ cookie', async () => {
    const email = `${E2E_PREFIX}native-${Date.now()}@test.local`;

    // ไม่ตั้ง Origin = เลียนแบบ fetch ของ React Native
    const res = await api(app)
      .post('/api/v1/auth/register')
      .send({ email, password: TEST_PASSWORD, displayName: 'มือถือ' })
      .expect(201);

    const body = res.body as Record<string, unknown>;
    expect(typeof body.refreshToken).toBe('string');
    // ไม่ตั้ง cookie ให้ client ที่ไม่มี cookie jar ที่เชื่อถือได้
    expect(refreshCookieHeader(res)).toBeUndefined();
  });
});
