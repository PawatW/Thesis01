/**
 * ตั้งค่าเมล + log ระบบ ของผู้ดูแล (feature 14)
 *
 * ★ ไฟล์นี้เปลี่ยน "สภาพร่วม" ของทั้งระบบ ★ แถว `mail_settings` มีแถวเดียว และ
 * โหมดเปลี่ยนเส้นทางกระทบอีเมลของทุก spec ที่รันทีหลัง — ทุกเคสที่เปิดโหมดจึงต้อง
 * ปิดคืนใน step ชื่อ `Cleanup` เสมอ (กติกาเดียวกับ e2e/README §เคสที่เปลี่ยนสภาพร่วม)
 *
 * เรียงก่อน `admin.spec.ts` ตามตัวอักษร (`-` < `.`) จึงรันก่อนเคสที่ระงับร้าน
 */
import { testCase, test, expect } from '../helpers/test-case';
import { apiBaseUrl, gotoApp, loginAs } from '../helpers/login';
import * as ids from '../helpers/selectors';
import { queryTestDatabase } from '../setup/database';

const FEATURE = '14 — Admin settings & logs';

/** ปิดโหมดคืนเสมอ — spec อื่นที่รันทีหลังต้องได้ระบบที่ส่งเมลถึงผู้รับจริง */
async function resetMailSettings(): Promise<void> {
  await queryTestDatabase(
    `update mail_settings
        set redirect_enabled = false, redirect_to = null, redirect_cc = null,
            smtp_host = null, smtp_port = null, smtp_secure = false, mail_from = null,
            updated_at = now()
      where id = 1`,
  );
}

testCase(
  { id: 'TC-102', priority: 'P0', feature: FEATURE },
  '★ เปิดโหมดเปลี่ยนเส้นทางอีเมลจากหน้าจอ แล้วค่าถูกบันทึกใน DB จริง',
  async ({ page }) => {
    await test.step('Arrange — เข้าหน้าตั้งค่าเมลในคอนโซลผู้ดูแล', async () => {
      await resetMailSettings();
      await loginAs(page, 'admin');
      await gotoApp(page, '/settings');
      await expect(page.locator(ids.mailSettings.save)).toBeVisible({ timeout: 20_000 });
    });

    await test.step('Assert — เครื่องทดสอบอนุญาตให้เปิดโหมด (ไม่มีแถบล็อก)', async () => {
      await expect(page.locator(ids.mailSettings.lockedNote)).toHaveCount(0);
    });

    await test.step('Act — เปิดสวิตช์ กรอกปลายทาง + Cc แล้วกดบันทึก', async () => {
      await page.locator(ids.mailSettings.toggle).click();
      await page.locator(ids.mailSettings.redirectTo).fill('qa-e2e@test.local');
      await page.locator(ids.mailSettings.redirectCc).fill('dev-e2e@test.local');
      await page.locator(ids.mailSettings.save).click();
      await expect(page.locator(ids.mailSettings.toast)).toBeVisible();
    });

    await test.step('Assert — DB เก็บค่าจริง และหน้าจอขึ้นแถบเตือนว่าโหมดกำลังทำงาน', async () => {
      const [row] = await queryTestDatabase<{
        redirect_enabled: boolean;
        redirect_to: string;
        redirect_cc: string;
      }>(
        'select redirect_enabled, redirect_to, redirect_cc from mail_settings where id = 1',
      );
      expect(row!.redirect_enabled).toBe(true);
      expect(row!.redirect_to).toBe('qa-e2e@test.local');
      expect(row!.redirect_cc).toBe('dev-e2e@test.local');

      await expect(page.locator(ids.mailSettings.activeWarning)).toBeVisible();
    });

    await test.step('Cleanup — ปิดโหมดคืนผ่านหน้าจอ แล้วยืนยันว่าปลายทางถูกล้าง', async () => {
      await page.locator(ids.mailSettings.toggle).click();
      await page.locator(ids.mailSettings.save).click();
      await expect(page.locator(ids.mailSettings.activeWarning)).toHaveCount(0);

      const [row] = await queryTestDatabase<{
        redirect_enabled: boolean;
        redirect_to: string | null;
      }>('select redirect_enabled, redirect_to from mail_settings where id = 1');
      expect(row!.redirect_enabled).toBe(false);
      // ค่าที่ค้างไว้คือกับดักรอวันที่มีคนกดเปิดอีกครั้ง — ต้องถูกล้าง
      expect(row!.redirect_to).toBeNull();
    });
  },
);

testCase(
  { id: 'TC-103', priority: 'P0', feature: FEATURE },
  '★ เปิดโหมดแล้วอีเมลถูกเปลี่ยนเส้นทางจริง — log บอกทั้งผู้รับตัวจริงและปลายทาง',
  async ({ page }) => {
    const victim = `redirect-target.${Date.now()}@e2e.local`;

    await test.step('Arrange — เปิดโหมดเปลี่ยนเส้นทางไว้ก่อน', async () => {
      await queryTestDatabase(
        `update mail_settings
            set redirect_enabled = true, redirect_to = 'qa-inbox@test.local', updated_at = now()
          where id = 1`,
      );
      // บัญชีที่จะเป็นเจ้าของอีเมล — ต้องมีจริงไม่งั้น API ไม่ส่งอะไรเลย (204 เงียบ)
      // สมัครผ่าน API จริง ไม่ใช่ insert ตรง: `users.updated_at` เป็น NOT NULL ที่ไม่มี
      // default ใน DB (Prisma เป็นคนเติมให้) การ insert ดิบจึงล้มด้วย 23502
      const res = await fetch(`${apiBaseUrl()}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: victim,
          password: 'E2ePassword2026!',
          displayName: 'เหยื่อเทสเปลี่ยนเส้นทาง',
        }),
      });
      expect(res.ok).toBe(true);
    });

    await test.step('Act — กดขอลิงก์ลืมรหัสผ่านผ่านหน้าจอจริง', async () => {
      await gotoApp(page, '/forgot-password');
      await page.locator(ids.forgotPassword.email).fill(victim);
      await page.locator(ids.forgotPassword.submit).click();
      await expect(page.locator(ids.forgotPassword.sent)).toBeVisible();
    });

    await test.step('Assert — DB บันทึกว่าเมลถูกส่งไปที่กล่องทดสอบ ไม่ใช่เจ้าตัว', async () => {
      // การส่งเมลถูกยิงแบบไม่ await — ให้เวลามันเขียน log ให้จบก่อน
      await expect
        .poll(
          async () => {
            const rows = await queryTestDatabase<{ to_actual: string }>(
              'select to_actual from email_logs where to_intended = $1',
              [victim],
            );
            return rows.length;
          },
          { timeout: 10_000 },
        )
        .toBeGreaterThan(0);

      const [log] = await queryTestDatabase<{
        to_actual: string;
        redirected: boolean;
        kind: string;
      }>(
        'select to_actual, redirected, kind from email_logs where to_intended = $1',
        [victim],
      );
      expect(log!.to_actual).toBe('qa-inbox@test.local');
      expect(log!.redirected).toBe(true);
      expect(log!.kind).toBe('password_reset');
    });

    await test.step('Assert — หน้า log ของผู้ดูแลแสดงทั้งผู้รับตัวจริงและปลายทาง', async () => {
      await loginAs(page, 'admin');
      await gotoApp(page, '/logs');
      await page.locator(ids.adminLogs.tab('email')).click();

      const [row] = await queryTestDatabase<{ id: number }>(
        'select id from email_logs where to_intended = $1',
        [victim],
      );
      await expect(page.locator(ids.adminLogs.emailIntended(row!.id))).toContainText(victim);
      await expect(page.locator(ids.adminLogs.emailActual(row!.id))).toContainText(
        'qa-inbox@test.local',
      );
      await expect(page.locator(ids.adminLogs.emailRedirected(row!.id))).toBeVisible();
    });

    await test.step('Cleanup — ปิดโหมดคืนและลบบัญชีที่เทสสร้าง', async () => {
      await resetMailSettings();
      await queryTestDatabase('delete from users where email = $1', [victim]);
    });
  },
);

testCase(
  { id: 'TC-104', priority: 'P1', feature: FEATURE },
  '★ การกระทำของผู้ดูแลถูกบันทึกลง audit log และกรองตามชนิดได้',
  async ({ page }) => {
    const categoryName = `หมวดเทส log ${Date.now()}`;

    await test.step('Arrange — เข้าคอนโซลผู้ดูแล', async () => {
      await loginAs(page, 'admin');
    });

    await test.step('Act — เพิ่มหมวดสินค้าใหม่จากหน้าจอจริง', async () => {
      await gotoApp(page, '/categories');
      await page.locator(ids.admin.categoryName).fill(categoryName);
      await page.locator(ids.admin.categoryAdd).click();
      await expect(page.locator(ids.admin.categoryName)).toHaveValue('');
    });

    await test.step('Assert — มีแถวใน audit_logs พร้อมชื่อหมวดและผู้กระทำ', async () => {
      const [row] = await queryTestDatabase<{
        id: number;
        summary: string;
        actor_id: string;
      }>(
        `select id, summary, actor_id from audit_logs
          where action = 'category_created' and summary like $1`,
        [`%${categoryName}%`],
      );
      expect(row).toBeDefined();
      expect(row!.actor_id).not.toBeNull();
    });

    await test.step('Assert — หน้า log แสดงเหตุการณ์นั้น และตัวกรองทำงาน', async () => {
      await gotoApp(page, '/logs');
      const [row] = await queryTestDatabase<{ id: number }>(
        `select id from audit_logs where action = 'category_created' and summary like $1`,
        [`%${categoryName}%`],
      );
      await expect(page.locator(ids.adminLogs.auditSummary(row!.id))).toContainText(
        categoryName,
      );

      // กรองด้วยชนิดอื่นแล้วแถวนี้ต้องหายไป — พิสูจน์ว่าตัวกรองยิงถึง API จริง
      await page.locator(ids.adminLogs.filter('mail_settings_updated')).click();
      await expect(page.locator(ids.adminLogs.auditRow(row!.id))).toHaveCount(0);
    });

    await test.step('Cleanup — ลบหมวดที่เทสสร้าง (log ยังต้องอยู่)', async () => {
      await queryTestDatabase('delete from categories where name = $1', [categoryName]);
      const rows = await queryTestDatabase(
        `select 1 from audit_logs where action = 'category_created' and summary like $1`,
        [`%${categoryName}%`],
      );
      // ★ log ต้องไม่หายตามของที่ถูกลบ ★ นั่นคือเหตุผลที่ `summary` ถูกสรุปไว้ตอนเขียน
      expect(rows).toHaveLength(1);
    });
  },
);
