/**
 * คอนโซลตามบทบาท (W01/W02) — "ล็อกอินแล้วต้องอยู่ในบ้านของตัวเอง"
 *
 * ก่อนหน้านี้ทุกบัญชีถูกส่งไป `(buyer)` เหมือนกันหมด บัญชีร้านจึงเปิดแอปมาเจอ
 * เมนูของผู้ซื้อทุกครั้ง · ชุดนี้กันไม่ให้ย้อนกลับไปเป็นแบบเดิม และกันไม่ให้
 * ตัวสลับโหมดหาย (ถ้าหาย บัญชีที่มีสองบทบาทจะออกจากคอนโซลไม่ได้เลย)
 */
import { testCase, test, expect } from '../helpers/test-case';
import { gotoApp, loginAs, loginThroughUi, expectSignedOut } from '../helpers/login';
import * as ids from '../helpers/selectors';
import { DEMO_PASSWORD, SHOPS, USERS } from '../helpers/test-data';
import { queryTestDatabase } from '../setup/database';

const FEATURE = '01/02/10 — Role consoles';

testCase(
  { id: 'TC-085', priority: 'P0', feature: FEATURE },
  '★ บัญชีร้านล็อกอินแล้วตกที่คอนโซลร้าน (ไม่ใช่หน้าผู้ซื้อ) และหัวคอนโซลเป็นชื่อร้านจริงจาก DB',
  async ({ page }) => {
    await test.step('Act — ล็อกอินผ่านฟอร์มจริงด้วยบัญชีร้าน', async () => {
      await loginThroughUi(page, { email: USERS.seller.email, password: DEMO_PASSWORD });
    });

    await test.step('Assert — ได้เมนูของร้าน ไม่ใช่เมนูผู้ซื้อ', async () => {
      await expect(page.locator(ids.shell.navSeller.overview)).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(ids.shell.navSeller.orders)).toBeVisible();
      await expect(page.locator(ids.shell.navSeller.notifications)).toBeVisible();
      await expect(page.locator(ids.shell.role)).toHaveText('โหมดร้านค้า');
      // เมนูผู้ซื้อต้องไม่มีอยู่บนหน้าเลย ไม่ใช่แค่ถูกซ่อน
      await expect(page.locator(ids.shell.navBuyer.home)).toHaveCount(0);
    });

    await test.step('Assert — ชื่อบนหัวคอนโซลคือชื่อร้านที่อยู่ใน DB จริง', async () => {
      const [row] = await queryTestDatabase<{ name: string }>(
        'select name from shops where owner_id = $1',
        [USERS.seller.id],
      );
      expect(row!.name).toBe(SHOPS.beanStory.name);
      await expect(page.locator(ids.shell.brand)).toHaveText(row!.name);
    });
  },
);

testCase(
  { id: 'TC-086', priority: 'P1', feature: FEATURE },
  'บัญชีผู้ดูแลล็อกอินแล้วตกที่คอนโซลผู้ดูแล',
  async ({ page }) => {
    await test.step('Act — ล็อกอินผ่านฟอร์มจริงด้วยบัญชีผู้ดูแล', async () => {
      await loginThroughUi(page, { email: USERS.admin.email, password: DEMO_PASSWORD });
    });

    await test.step('Assert — เมนูผู้ดูแลครบ และป้ายบอกโหมดถูกต้อง', async () => {
      await expect(page.locator(ids.admin.navOverview)).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(ids.admin.navEngine)).toBeVisible();
      await expect(page.locator(ids.shell.role)).toHaveText('โหมดผู้ดูแลระบบ');
      await expect(page.locator(ids.admin.statUsers)).toBeVisible();
    });
  },
);

testCase(
  { id: 'TC-087', priority: 'P1', feature: FEATURE },
  'บัญชีผู้ซื้อล้วนได้คอนโซลผู้ซื้อ และไม่มีปุ่มสลับไปโหมดที่ตัวเองไม่มี',
  async ({ page }) => {
    await test.step('Act — ล็อกอินผ่านฟอร์มจริงด้วยบัญชีผู้ซื้อ', async () => {
      await loginThroughUi(page, { email: USERS.buyer.email, password: DEMO_PASSWORD });
    });

    await test.step('Assert — อยู่หน้าผู้ซื้อ และไม่มีทางลัดเข้าโหมดร้าน/ผู้ดูแล', async () => {
      await expect(page.locator(ids.home.greeting)).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(ids.shell.navBuyer.home)).toBeVisible();
      await expect(page.locator(ids.shell.switchTo('seller'))).toHaveCount(0);
      await expect(page.locator(ids.shell.switchTo('admin'))).toHaveCount(0);
    });
  },
);

testCase(
  { id: 'TC-088', priority: 'P1', feature: FEATURE },
  '★ สลับโหมดร้าน ↔ ผู้ซื้อ จากแถบนำทางได้ด้วย session เดียว (W02)',
  async ({ page }) => {
    await test.step('Arrange — เข้าคอนโซลร้าน', async () => {
      await loginAs(page, 'seller');
      await gotoApp(page, '/(seller)');
      await expect(page.locator(ids.shell.navSeller.overview)).toBeVisible();
    });

    await test.step('Act/Assert — กดสลับไปโหมดผู้ซื้อ ได้หน้าซื้อของโดยไม่ต้องล็อกอินใหม่', async () => {
      await page.locator(ids.shell.switchTo('buyer')).click();
      await expect(page.locator(ids.home.greeting)).toBeVisible();
      await expect(page.locator(ids.shell.role)).toHaveText('โหมดผู้ซื้อ');
    });

    await test.step('Act/Assert — กดกลับเข้าโหมดร้าน ได้คอนโซลร้านคืน', async () => {
      await page.locator(ids.shell.switchTo('seller')).click();
      await expect(page.locator(ids.shell.navSeller.overview)).toBeVisible();
      await expect(page.locator(ids.shell.brand)).toHaveText(SHOPS.beanStory.name);
    });
  },
);

testCase(
  { id: 'TC-089', priority: 'P1', feature: FEATURE },
  '★ แจ้งเตือนของร้านอยู่ในกล่องของร้านเท่านั้น — ไม่ปนเข้ากล่องของผู้ซื้อ',
  async ({ page }) => {
    let sellerNotiId = 0;
    let buyerNotiId = 0;

    await test.step('Arrange — ใส่แจ้งเตือนคนละฝั่งให้บัญชีเดียวกัน', async () => {
      const [sellerRow] = await queryTestDatabase<{ id: number }>(
        `insert into notifications (user_id, type, title, link_path)
         values ($1, 'new_subscriber', 'เทส — มีผู้สมัครใหม่', '/orders')
         returning id`,
        [USERS.seller.id],
      );
      sellerNotiId = sellerRow!.id;

      const [buyerRow] = await queryTestDatabase<{ id: number }>(
        `insert into notifications (user_id, type, title, link_path)
         values ($1, 'upcoming_cycle', 'เทส — ใกล้ถึงรอบส่ง', '/subscriptions')
         returning id`,
        [USERS.seller.id],
      );
      buyerNotiId = buyerRow!.id;

      await loginAs(page, 'seller');
    });

    await test.step('Assert — กล่องของร้านเห็นเฉพาะใบของร้าน', async () => {
      await gotoApp(page, '/(seller)/notifications');
      await expect(page.locator(ids.sellerNotifications.item(sellerNotiId))).toBeVisible();
      await expect(page.locator(ids.sellerNotifications.item(buyerNotiId))).toHaveCount(0);
    });

    await test.step('Assert — กล่องของผู้ซื้อเห็นเฉพาะใบของผู้ซื้อ', async () => {
      await gotoApp(page, '/(buyer)/notifications');
      await expect(page.locator(ids.notifications.item(buyerNotiId))).toBeVisible();
      await expect(page.locator(ids.notifications.item(sellerNotiId))).toHaveCount(0);
    });

    await test.step('Assert — ใบที่ขึ้นในกล่องร้านมี type ฝั่งร้านจริงใน DB', async () => {
      const [row] = await queryTestDatabase<{ type: string }>(
        'select type::text as type from notifications where id = $1',
        [sellerNotiId],
      );
      expect(row!.type).toBe('new_subscriber');
    });

    await test.step('Cleanup — ลบใบที่เทสสร้าง', async () => {
      await queryTestDatabase('delete from notifications where id = any($1::int[])', [
        [sellerNotiId, buyerNotiId],
      ]);
    });
  },
);

testCase(
  { id: 'TC-090', priority: 'P2', feature: FEATURE },
  'ออกจากระบบได้จากคอนโซลร้านโดยตรง ไม่ต้องเดินย้อนไปหน้าโปรไฟล์ของผู้ซื้อ',
  async ({ page }) => {
    await test.step('Arrange — เข้าคอนโซลร้าน', async () => {
      await loginAs(page, 'seller');
      await gotoApp(page, '/(seller)');
      await expect(page.locator(ids.shell.navSeller.overview)).toBeVisible();
    });

    await test.step('Act/Assert — กดออกจากระบบแล้วกลับไปหน้าล็อกอิน', async () => {
      await page.locator(ids.shell.signOut).click();
      await expectSignedOut(page);
    });
  },
);

testCase(
  { id: 'TC-099', priority: 'P1', feature: FEATURE },
  '★ ผู้ดูแลระบบสลับดูได้ครบทุกโหมด — ปุ่มมีทั้งผู้ซื้อและร้านค้า และเข้าโหมดร้านได้จริง',
  async ({ page }) => {
    await test.step('Arrange — เข้าคอนโซลผู้ดูแล', async () => {
      await loginAs(page, 'admin');
      await gotoApp(page, '/(admin)');
      await expect(page.locator(ids.admin.navOverview)).toBeVisible({ timeout: 20_000 });
    });

    await test.step('Assert — ตัวสลับโหมดมีครบทั้งสองโหมดที่ไม่ได้อยู่ (ผู้ซื้อ + ร้านค้า)', async () => {
      await expect(page.locator(ids.shell.switchTo('buyer'))).toBeVisible();
      await expect(page.locator(ids.shell.switchTo('seller'))).toBeVisible();
      // โหมดที่ยืนอยู่ต้องไม่โผล่ในตัวสลับ ไม่งั้นกดแล้วไม่มีอะไรเกิดขึ้น
      await expect(page.locator(ids.shell.switchTo('admin'))).toHaveCount(0);
    });

    await test.step('Act/Assert — กดเข้าโหมดร้านค้า ได้หลังร้านของผู้ดูแลเอง (ชื่อร้านตรงกับ DB)', async () => {
      await page.locator(ids.shell.switchTo('seller')).click();
      await expect(page.locator(ids.shell.navSeller.overview)).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(ids.shell.role)).toHaveText('โหมดร้านค้า');

      const [row] = await queryTestDatabase<{ name: string }>(
        'select name from shops where owner_id = $1',
        [USERS.admin.id],
      );
      // ★ ยืนยันว่าเป็นร้าน **ของตัวเอง** ★ ผู้ดูแลเห็นทุกโหมดได้ก็จริง แต่หลังร้าน
      // ยังอ่านจาก shop.ownerId เสมอ — ไม่ใช่ทางลัดเข้าไปดูร้านของคนอื่น
      expect(row!.name).toBe(SHOPS.adminDemo.name);
      await expect(page.locator(ids.shell.brand)).toHaveText(row!.name);
    });

    await test.step('Act/Assert — กดกลับเข้าโหมดผู้ซื้อได้ด้วย session เดียวกัน', async () => {
      await page.locator(ids.shell.switchTo('buyer')).click();
      await expect(page.locator(ids.home.greeting)).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(ids.shell.role)).toHaveText('โหมดผู้ซื้อ');
      // จากโหมดผู้ซื้อก็ต้องกลับเข้าโหมดผู้ดูแลได้ ไม่ใช่ทางเดียว
      await expect(page.locator(ids.shell.switchTo('admin'))).toBeVisible();
    });
  },
);
