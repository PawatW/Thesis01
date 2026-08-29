/**
 * Feature 08 — การแจ้งเตือน + งานโพลิชที่เกี่ยวข้อง (บัตร · หน้าร้าน · แก้สินค้า)
 *
 * แจ้งเตือนถูกเขียนไว้ตั้งแต่ Phase 2 ทุก flow แต่เพิ่งมีหน้าจอให้อ่านในรอบนี้ —
 * เคสจึงเน้นว่า "ของที่เขียนไว้ถึงมือผู้ใช้จริงไหม" และ "กดแล้วพาไปที่ที่ถูก"
 */
import { testCase, test, expect } from '../helpers/test-case';
import { gotoApp, loginAs } from '../helpers/login';
import * as ids from '../helpers/selectors';
import {
  CARD_EXPIRY_INPUT,
  PRODUCTS,
  SHOPS,
  TEST_CARDS,
  USERS,
} from '../helpers/test-data';
import { queryTestDatabase } from '../setup/database';

const FEATURE = '08/09/10/11 — Notifications & polish';

testCase(
  { id: 'TC-082', priority: 'P0', feature: FEATURE },
  '★ ผู้ซื้อเห็นการแจ้งเตือนของตัวเอง กดแล้วถูกทำเครื่องหมายว่าอ่านใน DB',
  async ({ page }) => {
    let id = 0;

    await test.step('Arrange — สร้างแจ้งเตือนที่ยังไม่อ่านให้ผู้ซื้อ', async () => {
      const [row] = await queryTestDatabase<{ id: number }>(
        `insert into notifications (user_id, type, title, body, link_path)
         values ($1, 'upcoming_cycle', 'เทสแจ้งเตือน', 'รอบส่งใกล้ถึงแล้ว', '/subscriptions')
         returning id`,
        [USERS.buyer.id],
      );
      id = row!.id;

      await loginAs(page, 'buyer');
      await gotoApp(page, '/(buyer)/notifications');
    });

    await test.step('Assert — ใบใหม่ขึ้นพร้อมจุดสีว่ายังไม่อ่าน', async () => {
      await expect(page.locator(ids.notifications.item(id))).toBeVisible();
      await expect(page.locator(ids.notifications.unreadDot(id))).toBeVisible();
    });

    await test.step('Act/Assert — กดแล้ว DB บันทึกเวลาที่อ่าน และพาไปหน้าที่ลิงก์ชี้ไว้', async () => {
      await page.locator(ids.notifications.item(id)).click();
      await expect(page.locator(ids.subscriptions.spend)).toBeVisible();

      const [row] = await queryTestDatabase<{ read_at: string | null }>(
        'select read_at::text as read_at from notifications where id = $1',
        [id],
      );
      expect(row!.read_at).not.toBeNull();
    });

    await test.step('Cleanup — ลบใบที่เทสสร้าง', async () => {
      await queryTestDatabase('delete from notifications where id = $1', [id]);
    });
  },
);

testCase(
  { id: 'TC-083', priority: 'P1', feature: FEATURE },
  'หน้าร้านสาธารณะเปิดจากชื่อร้านบนหน้าสินค้า และแสดงเฉพาะสินค้าที่ยังเปิดขาย',
  async ({ page }) => {
    await test.step('Arrange — เปิดหน้าสินค้า', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, `/product/${PRODUCTS.coffeeMedium.id}`);
    });

    await test.step('Act — กดชื่อร้าน', async () => {
      await page.locator('#product-shop-link').click();
    });

    await test.step('Assert — จำนวนสินค้าตรงกับที่ DB นับได้ (เฉพาะที่เปิดขายและไม่ถูกระงับ)', async () => {
      await expect(page.locator(ids.shopPage.card)).toBeVisible();

      const [row] = await queryTestDatabase<{ n: string }>(
        `select count(*)::text as n from products
          where shop_id = $1 and is_active and suspended_at is null`,
        [SHOPS.beanStory.id],
      );
      await expect(page.locator(ids.shopPage.productCount)).toHaveText(
        `มีสินค้าให้สมัคร ${row!.n} รายการ`,
      );
      await expect(
        page.locator(ids.shopPage.product(PRODUCTS.coffeeMedium.id)),
      ).toBeVisible();
    });
  },
);

testCase(
  { id: 'TC-084', priority: 'P1', feature: FEATURE },
  'ผูกบัตรจากหน้าโปรไฟล์ → DB เก็บแค่ 4 ตัวท้าย + วันหมดอายุ แล้วลบออกได้',
  async ({ page }) => {
    const card = TEST_CARDS.visaAlt;

    await test.step('Arrange — เปิดหน้าบัตรจากโปรไฟล์', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/profile');
      await page.locator(ids.profile.linkCards).click();
      await expect(page.locator(ids.cards.number)).toBeVisible();
    });

    await test.step('Act — กรอกบัตรครบทุกช่องแล้วผูกบัตร', async () => {
      await page.locator(ids.cards.number).fill(card.number);
      await page.locator(ids.cards.expiry).fill(CARD_EXPIRY_INPUT.future);
      await page.locator(ids.cards.cvv).fill('123');
      await page.locator(ids.cards.holder).fill('E2E CARD');
      await page.locator(ids.cards.add).click();
      await expect(page.locator(ids.cards.toast)).toBeVisible();
    });

    await test.step('Assert — DB มีแค่ last4 + วันหมดอายุ ไม่มีเลขเต็มอยู่ที่ไหนเลย', async () => {
      const rows = await queryTestDatabase<{
        id: string;
        brand: string;
        last4: string;
        exp_month: number;
      }>(
        `select id, brand, last4, exp_month from payment_methods
          where user_id = $1 and holder_name = 'E2E CARD'`,
        [USERS.buyer.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.last4).toBe(card.last4);
      expect(rows[0]!.brand).toBe(card.brand);
      expect(rows[0]!.exp_month).toBe(12);

      const full = await queryTestDatabase(
        `select id from payment_methods where last4 like '%1111111111%'`,
      );
      expect(full).toHaveLength(0);
      await expect(page.locator('body')).not.toContainText(card.number);

      await test.step('Cleanup — ลบบัตรที่เพิ่งผูกผ่านปุ่มบนหน้าจอ', async () => {
        await page.locator(ids.cards.remove(rows[0]!.id)).click();
        await expect(page.locator(ids.cards.item(rows[0]!.id))).toHaveCount(0);
        expect(
          await queryTestDatabase('select id from payment_methods where id = $1', [
            rows[0]!.id,
          ]),
        ).toHaveLength(0);
      });
    });
  },
);

testCase(
  { id: 'TC-092', priority: 'P2', feature: FEATURE },
  'ผูกบัตรใบเดิมซ้ำ → API ปฏิเสธ 409 และไม่มีแถวที่สองใน DB',
  async ({ page }) => {
    const card = TEST_CARDS.visa;

    await test.step('Arrange — เปิดหน้าบัตรแล้วผูกบัตรใบแรก', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/profile');
      await page.locator(ids.profile.linkCards).click();
      await expect(page.locator(ids.cards.number)).toBeVisible();

      await page.locator(ids.cards.number).fill(card.number);
      await page.locator(ids.cards.expiry).fill(CARD_EXPIRY_INPUT.future);
      await page.locator(ids.cards.cvv).fill('123');
      await page.locator(ids.cards.holder).fill('E2E DUP');
      await page.locator(ids.cards.add).click();
      await expect(page.locator(ids.cards.toast)).toBeVisible();
    });

    await test.step('Act — ผูกบัตรใบเดิมอีกครั้ง', async () => {
      await page.locator(ids.cards.number).fill(card.number);
      await page.locator(ids.cards.expiry).fill(CARD_EXPIRY_INPUT.future);
      await page.locator(ids.cards.cvv).fill('123');
      await page.locator(ids.cards.holder).fill('E2E DUP');
      await page.locator(ids.cards.add).click();
    });

    await test.step('Assert — ขึ้นข้อความจาก API และ DB มีใบเดียว', async () => {
      await expect(page.locator(ids.cards.formError)).toBeVisible();

      const rows = await queryTestDatabase<{ id: string }>(
        `select id from payment_methods where user_id = $1 and last4 = $2`,
        [USERS.buyer.id, card.last4],
      );
      expect(rows).toHaveLength(1);

      await test.step('Cleanup — ลบบัตรที่ใช้ในเคสนี้', async () => {
        await page.locator(ids.cards.remove(rows[0]!.id)).click();
        await expect(page.locator(ids.cards.item(rows[0]!.id))).toHaveCount(0);
      });
    });
  },
);
