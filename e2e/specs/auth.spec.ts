/**
 * Feature 01 — เข้าสู่ระบบ / สมัครสมาชิก / ออกจากระบบ / ด่านกันเข้าหน้าใน
 *
 * เคสในไฟล์นี้เป็นกลุ่มเดียวที่ล็อกอินผ่าน UI จริง — ที่เหลือทั้งชุดใช้
 * `loginAs()` เพราะไม่ได้ทดสอบตัวล็อกอิน (helpers/login.ts)
 */
import { createHash, randomBytes } from 'node:crypto';
import { testCase, test, expect } from '../helpers/test-case';
import {
  apiBaseUrl,
  apiLogin,
  expectSignedIn,
  expectSignedOut,
  gotoApp,
  loginAs,
  loginThroughUi,
} from '../helpers/login';
import * as ids from '../helpers/selectors';
import { CANARY_DISPLAY_NAME, USERS, uniqueEmail } from '../helpers/test-data';
import { queryTestDatabase } from '../setup/database';

const FEATURE = '01 — Auth';

testCase(
  { id: 'TC-001', priority: 'P0', feature: FEATURE },
  'ล็อกอินด้วยบัญชีที่ถูกต้องแล้วเข้าถึงหน้าผู้ซื้อได้',
  async ({ page }) => {
    await test.step('Arrange — เปิดหน้าเข้าสู่ระบบโดยยังไม่มี session', async () => {
      await gotoApp(page, '/login');
      await expect(page.locator(ids.login.submit)).toBeVisible();
    });

    await test.step('Act — กรอกอีเมลกับรหัสผ่านของบัญชีเดโม่แล้วกดเข้าสู่ระบบ', async () => {
      await page.locator(ids.login.email).fill(USERS.buyer.email);
      await page.locator(ids.login.password).fill(USERS.buyer.password);
      await page.locator(ids.login.submit).click();
    });

    await test.step('Assert — เข้าหน้าแรกของผู้ซื้อ พร้อมชื่อผู้ใช้จากฐานข้อมูลทดสอบ', async () => {
      await expectSignedIn(page);
      await expect(page.locator(ids.home.greeting)).toContainText(CANARY_DISPLAY_NAME);
    });
  },
);

testCase(
  { id: 'TC-002', priority: 'P0', feature: FEATURE },
  'รหัสผ่านผิดแล้วยังอยู่หน้าเดิมพร้อมข้อความผิดพลาด',
  async ({ page }) => {
    await test.step('Arrange — เปิดหน้าเข้าสู่ระบบ', async () => {
      await gotoApp(page, '/login');
    });

    await test.step('Act — ใส่อีเมลที่มีจริงแต่รหัสผ่านผิด', async () => {
      await loginThroughUi(page, { email: USERS.buyer.email, password: 'WrongPassword123!' });
    });

    await test.step('Assert — ขึ้น error และไม่ถูกพาเข้าไปข้างใน', async () => {
      await expect(page.locator(ids.login.formError)).toBeVisible();
      await expect(page.locator(ids.login.submit)).toBeVisible();
      await expect(page.locator(ids.home.greeting)).toHaveCount(0);
    });
  },
);

testCase(
  { id: 'TC-005', priority: 'P0', feature: FEATURE },
  'สมัครสมาชิกใหม่แล้วเข้าใช้งานได้ทันทีโดยไม่ต้องล็อกอินซ้ำ',
  async ({ page }) => {
    const email = uniqueEmail('signup');
    const displayName = 'ผู้ใช้ทดสอบ e2e';

    await test.step('Arrange — เปิดหน้าสมัครสมาชิกจากลิงก์ในหน้าเข้าสู่ระบบ', async () => {
      await gotoApp(page, '/login');
      await page.locator(ids.login.linkRegister).click();
      await expect(page.locator(ids.register.submit)).toBeVisible();
    });

    await test.step('Act — กรอกข้อมูลครบแล้วกดสมัคร', async () => {
      await page.locator(ids.register.name).fill(displayName);
      await page.locator(ids.register.email).fill(email);
      await page.locator(ids.register.password).fill('E2ePassword2026!');
      await page.locator(ids.register.submit).click();
    });

    await test.step('Assert — เข้าหน้าผู้ซื้อพร้อมชื่อที่เพิ่งสมัคร และยังไม่มีรายการสมัครรับสินค้า', async () => {
      await expectSignedIn(page);
      await expect(page.locator(ids.home.greeting)).toContainText(displayName);
      await expect(page.locator(ids.home.subsEmpty)).toBeVisible();
    });
  },
);

testCase(
  { id: 'TC-008', priority: 'P0', feature: FEATURE },
  'เข้าหน้าของผู้ซื้อโดยไม่มี session แล้วถูกพากลับหน้าเข้าสู่ระบบ',
  async ({ page }) => {
    await test.step('Arrange — ไม่ล็อกอิน ไม่มี token ใน storage', async () => {
      await page.context().clearCookies();
    });

    await test.step('Act — เปิด URL ของหน้ารายการของฉันตรง ๆ', async () => {
      await gotoApp(page, '/subscriptions');
    });

    await test.step('Assert — เห็นหน้าเข้าสู่ระบบ ไม่ใช่เนื้อหาของผู้ซื้อ', async () => {
      await expectSignedOut(page);
      await expect(page.locator(ids.subscriptions.spend)).toHaveCount(0);
    });
  },
);

testCase(
  { id: 'TC-009', priority: 'P0', feature: FEATURE },
  'ออกจากระบบแล้วกลับเข้าหน้าเดิมไม่ได้อีก',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินแล้วเปิดหน้าโปรไฟล์', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/profile');
      await expect(page.locator(ids.profile.signOut)).toBeVisible();
    });

    await test.step('Act — กดออกจากระบบ', async () => {
      await page.locator(ids.profile.signOut).click();
    });

    await test.step('Assert — กลับมาหน้าเข้าสู่ระบบ และเปิดหน้าในไม่ได้แล้ว', async () => {
      await expectSignedOut(page);
      await gotoApp(page, '/subscriptions');
      await expectSignedOut(page);
    });
  },
);

/* ==========================================================================
 * ลืมรหัสผ่าน (feature 01 · W01)
 *
 * ตัว token จริงมีอยู่ที่เดียวคือในอีเมล — DB เก็บแค่ sha256 และ e2e ไม่มีกล่องเมล
 * ให้เปิด · เทสจึงแบ่งเป็นสองครึ่งตามความจริงข้อนั้น:
 *   - ครึ่งขอลิงก์  ยืนยันผลที่ **DB** ว่าตั๋วเกิดขึ้นจริง (ไม่ใช่แค่ข้อความบนจอ)
 *   - ครึ่งตั้งรหัส  เทสหว่าน token ที่รู้ค่าเองลง DB แล้วเปิดลิงก์เหมือนคนกดจากเมล
 *     ทาง API ที่เดินจริงยังเป็นเส้นเดียวกับของผู้ใช้ทุกประการ
 * ========================================================================== */

/** สร้างบัญชีใหม่ผ่าน API จริง — ห้ามใช้บัญชี seed เพราะเคสพวกนี้เปลี่ยนรหัสผ่าน */
async function registerThrowawayUser(tag: string): Promise<{ id: string; email: string }> {
  const email = uniqueEmail(tag);
  const res = await fetch(`${apiBaseUrl()}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: THROWAWAY_PASSWORD, displayName: `เทส ${tag}` }),
  });
  if (!res.ok) throw new Error(`สมัคร ${email} ไม่สำเร็จ: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { user: { id: string } };
  return { id: body.user.id, email };
}

/**
 * หว่านตั๋วรีเซ็ตลง DB แล้วคืน token ดิบที่ควรอยู่ในอีเมล
 *
 * เขียน `token_hash` เป็น sha256 เอง — ตรงกับที่ `AuthService` ทำ และตรงกับ CHECK
 * `password_reset_tokens_hash_fmt` ที่บังคับว่าคอลัมน์นี้ต้องเป็น hex 64 ตัว
 */
async function seedResetToken(
  userId: string,
  opts?: { used?: boolean; expired?: boolean },
): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  // CHECK `expires_at > created_at` — ตั๋วหมดอายุต้องดันวันที่สร้างถอยไปด้วย
  const createdAt = opts?.expired ? 'now() - interval \'2 hours\'' : 'now()';
  const expiresAt = opts?.expired ? 'now() - interval \'1 hour\'' : 'now() + interval \'30 minutes\'';
  const usedAt = opts?.used === true ? 'now()' : 'null';

  await queryTestDatabase(
    `insert into password_reset_tokens (user_id, token_hash, created_at, expires_at, used_at)
     values ($1, $2, ${createdAt}, ${expiresAt}, ${usedAt})`,
    [userId, hash],
  );
  return raw;
}

const THROWAWAY_PASSWORD = 'E2ePassword2026!';

testCase(
  { id: 'TC-094', priority: 'P0', feature: FEATURE },
  '★ ขอลิงก์ลืมรหัสผ่านจากหน้าเข้าสู่ระบบ แล้วมีตั๋วเกิดขึ้นจริงใน DB',
  async ({ page }) => {
    let user = { id: '', email: '' };

    await test.step('Arrange — สมัครบัญชีใหม่ (ห้ามแตะบัญชี seed เพราะเคสนี้เกี่ยวกับรหัสผ่าน)', async () => {
      user = await registerThrowawayUser('forgot');
      await gotoApp(page, '/login');
    });

    await test.step('Act — กดลิงก์ "ลืมรหัสผ่าน?" แล้วกรอกอีเมลที่เพิ่งสมัคร', async () => {
      await page.locator(ids.login.linkForgot).click();
      await expect(page.locator(ids.forgotPassword.submit)).toBeVisible();
      await page.locator(ids.forgotPassword.email).fill(user.email);
      await page.locator(ids.forgotPassword.submit).click();
    });

    await test.step('Assert — หน้าจอยืนยันว่าส่งแล้ว', async () => {
      await expect(page.locator(ids.forgotPassword.sent)).toBeVisible();
    });

    await test.step('Assert — DB มีตั๋วที่ยังไม่ถูกใช้ 1 ใบ และเก็บเป็น hash ไม่ใช่ token', async () => {
      const rows = await queryTestDatabase<{ token_hash: string; used_at: string | null }>(
        `select token_hash, used_at from password_reset_tokens
         where user_id = $1 and expires_at > now()`,
        [user.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.used_at).toBeNull();
      // CHECK ที่ DB บังคับรูปแบบนี้อยู่แล้ว — assert ไว้ให้เห็นเจตนาในรายงาน
      expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  },
);

testCase(
  { id: 'TC-096', priority: 'P0', feature: FEATURE },
  '★ ตั้งรหัสผ่านใหม่จากลิงก์ในอีเมล → รหัสใหม่ล็อกอินได้ · ตั๋วถูกปิด · session เดิมถูกเพิกถอนใน DB',
  async ({ page }) => {
    const newPassword = 'ResetThroughUi2026!';
    let user = { id: '', email: '' };
    let token = '';

    await test.step('Arrange — บัญชีใหม่ที่ล็อกอินค้างไว้ 1 session + ตั๋วรีเซ็ตที่ยังใช้ได้', async () => {
      user = await registerThrowawayUser('reset-ui');
      // ล็อกอินเพิ่มอีกใบ เพื่อพิสูจน์ทีหลังว่า "ทุกเครื่องหลุด" ไม่ใช่แค่ใบเดียว
      await apiLogin(user.email, THROWAWAY_PASSWORD);
      token = await seedResetToken(user.id);
    });

    await test.step('Act — เปิดลิงก์จากอีเมลแล้วตั้งรหัสผ่านใหม่', async () => {
      await gotoApp(page, `/reset-password?token=${encodeURIComponent(token)}`);
      await page.locator(ids.resetPassword.password).fill(newPassword);
      await page.locator(ids.resetPassword.confirm).fill(newPassword);
      await page.locator(ids.resetPassword.submit).click();
      await expect(page.locator(ids.resetPassword.done)).toBeVisible();
    });

    await test.step('Assert — DB: ตั๋วถูกปิด และ refresh token ทุกใบถูกเพิกถอนด้วยเหตุ password_reset', async () => {
      const [ticket] = await queryTestDatabase<{ used_at: string | null }>(
        'select used_at from password_reset_tokens where user_id = $1',
        [user.id],
      );
      expect(ticket!.used_at).not.toBeNull();

      const [tokens] = await queryTestDatabase<{ alive: string; reset: string }>(
        `select count(*) filter (where revoked_at is null)::text                 as alive,
                count(*) filter (where revoked_reason = 'password_reset')::text  as reset
         from refresh_tokens where user_id = $1`,
        [user.id],
      );
      expect(Number(tokens!.alive)).toBe(0);
      expect(Number(tokens!.reset)).toBeGreaterThan(0);
    });

    await test.step('Assert — ล็อกอินด้วยรหัสใหม่ผ่านฟอร์มจริงได้ (รหัสเก่าใช้ไม่ได้แล้ว)', async () => {
      await page.locator(ids.resetPassword.gotoLogin).click();
      await expect(page.locator(ids.login.submit)).toBeVisible();

      await loginThroughUi(page, { email: user.email, password: THROWAWAY_PASSWORD });
      await expect(page.locator(ids.login.formError)).toBeVisible();

      await loginThroughUi(page, { email: user.email, password: newPassword });
      await expectSignedIn(page);
    });
  },
);

/* ==========================================================================
 * ที่เก็บ refresh token ของฝั่งเว็บ (feature 01 · docs/security-design.md §5)
 *
 * สองเคสนี้ไม่ได้ทดสอบ "ล็อกอินได้ไหม" — อันนั้นมี TC-001 อยู่แล้ว แต่ทดสอบว่า
 * **token ไปนอนอยู่ที่ไหน** ซึ่งเป็นสิ่งที่หน้าจอไม่แสดงและคนกดเองมองไม่เห็นเลย
 * ถ้าวันหนึ่งมีคนย้ายกลับไป localStorage เพื่อความสะดวก ทุกเคสอื่นในชุดนี้จะยัง
 * เขียวหมด — เหลือสองเคสนี้ที่จะแดง
 * ========================================================================== */

/** ชื่อเดียวกับ `anan-api/src/common/http/refresh-cookie.ts` */
const REFRESH_COOKIE = 'anan_rt';

/** คีย์ที่เคยใช้สมัยเก็บลง localStorage — ต้องไม่กลับมาอีก */
const LEGACY_KEY = 'anan.refreshToken';

/** JWT = สาม segment คั่นด้วยจุด · ใช้ดมว่ามีอะไรหน้าตาเป็น token หลุดอยู่ไหม */
const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;

testCase(
  { id: 'TC-100', priority: 'P0', feature: FEATURE },
  'ล็อกอินแล้ว refresh token ต้องไม่อยู่ใน localStorage — อยู่ใน httpOnly cookie เท่านั้น',
  async ({ page }) => {
    await test.step('Arrange — เปิดหน้าเข้าสู่ระบบโดยยังไม่มี session', async () => {
      await gotoApp(page, '/login');
      await expect(page.locator(ids.login.submit)).toBeVisible();
    });

    await test.step('Act — ล็อกอินผ่านฟอร์มจริง', async () => {
      await loginThroughUi(page, {
        email: USERS.buyer.email,
        password: USERS.buyer.password,
      });
      await expectSignedIn(page);
    });

    await test.step('Assert — ไม่มีอะไรที่หน้าตาเป็น token เหลืออยู่ใน localStorage', async () => {
      const stored = await page.evaluate(() => {
        const out: Record<string, string> = {};
        for (let i = 0; i < window.localStorage.length; i += 1) {
          const key = window.localStorage.key(i);
          if (key != null) out[key] = window.localStorage.getItem(key) ?? '';
        }
        return out;
      });

      expect(stored[LEGACY_KEY]).toBeUndefined();
      // กว้างกว่าการเช็คคีย์เดียว: ห้ามมี token หลุดไปอยู่ใต้ชื่อคีย์อื่นด้วย
      expect(Object.values(stored).filter((v) => JWT_SHAPE.test(v))).toEqual([]);
    });

    await test.step('Assert — cookie มีอยู่จริง เป็น HttpOnly และ JavaScript อ่านไม่เห็น', async () => {
      const cookie = (await page.context().cookies()).find(
        (c) => c.name === REFRESH_COOKIE,
      );

      expect(cookie).toBeDefined();
      // ★ ข้อเดียวที่ทำให้ XSS ขโมย token ออกไปใช้ต่อไม่ได้ ★
      expect(cookie?.httpOnly).toBe(true);
      // จำกัด path ไว้ที่ /auth — ไม่ติดไปกับทุก request ของแอป
      expect(cookie?.path).toBe('/api/v1/auth');

      // พิสูจน์จากมุมของโค้ดในหน้าเว็บเอง ไม่ใช่แค่เชื่อ flag ที่เบราว์เซอร์รายงาน
      const visibleToJs = await page.evaluate(() => document.cookie);
      expect(visibleToJs).not.toContain(REFRESH_COOKIE);
    });
  },
);

testCase(
  { id: 'TC-101', priority: 'P1', feature: FEATURE },
  'ออกจากระบบแล้ว cookie ถูกลบ และใบนั้นถูกเพิกถอนใน DB',
  async ({ page }) => {
    let tokenHash = '';

    await test.step('Arrange — ล็อกอินแล้วเปิดหน้าโปรไฟล์', async () => {
      await loginThroughUi(page, {
        email: USERS.buyer.email,
        password: USERS.buyer.password,
      });
      await expectSignedIn(page);
      await gotoApp(page, '/profile');
      await expect(page.locator(ids.profile.signOut)).toBeVisible();
    });

    await test.step('Act — จำ cookie ใบที่ถืออยู่ แล้วกดออกจากระบบ', async () => {
      const cookie = (await page.context().cookies()).find(
        (c) => c.name === REFRESH_COOKIE,
      );
      expect(cookie).toBeDefined();
      // DB เก็บแค่ sha256 ไม่ได้เก็บตัว token — ต้องแฮชก่อนถึงจะหาแถวเจอ
      tokenHash = createHash('sha256')
        .update(cookie?.value ?? '')
        .digest('hex');

      await page.locator(ids.profile.signOut).click();
      await expectSignedOut(page);
    });

    await test.step('Assert — เบราว์เซอร์ไม่มี cookie แล้ว', async () => {
      const after = (await page.context().cookies()).find(
        (c) => c.name === REFRESH_COOKIE,
      );
      expect(after).toBeUndefined();
    });

    await test.step('Assert — ★ ที่ DB ★ ใบนั้นถูกปิดด้วยเหตุผล logout', async () => {
      // หน้าจอกลับไปหน้า login ไม่ได้แปลว่า session ตายจริง — ถ้า server ยังไม่
      // เพิกถอน ใครที่ถือสำเนา cookie อยู่ก็ใช้ต่อได้อีก 7 วัน
      const rows = await queryTestDatabase<{ revoked_reason: string | null }>(
        'SELECT revoked_reason FROM refresh_tokens WHERE token_hash = $1',
        [tokenHash],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.revoked_reason).toBe('logout');
    });
  },
);
