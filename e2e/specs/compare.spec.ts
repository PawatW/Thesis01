/**
 * Feature 04 — เปรียบเทียบสินค้าข้ามร้าน (W03)
 *
 * เคสในไฟล์นี้อยู่ที่ฝั่งหน้าจอล้วน (ถาดเทียบเป็น client state ไม่แตะฐานข้อมูล)
 * สิ่งที่ต้องพิสูจน์คือ **ตัวเลขในตารางตรงกับข้อมูลจริง** และกติกาของถาด
 * (หมวดเดียวกัน · ไม่เกิน 4 · ต่ำกว่า 2 เทียบไม่ได้) บอกเหตุผลทุกครั้งที่กดไม่ได้
 */
import { testCase, test, expect } from '../helpers/test-case';
import { gotoApp, loginAs } from '../helpers/login';
import * as ids from '../helpers/selectors';
import { CATEGORIES, PRODUCTS } from '../helpers/test-data';
import { queryTestDatabase } from '../setup/database';

const FEATURE = '04 — Compare';

testCase(
  { id: 'TC-080', priority: 'P0', feature: FEATURE },
  '★ เลือก 2 ชิ้นในหมวดเดียวกันแล้วเทียบได้ — ราคาต่อหน่วยตรงกับข้อมูลใน DB',
  async ({ page }) => {
    const coffee = PRODUCTS.coffeeMedium.id;
    let second = '';

    await test.step('Arrange — เปิดหน้าหมวดกาแฟ', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, `/category/${CATEGORIES.coffee.id}`);

      const [other] = await queryTestDatabase<{ id: string }>(
        `select p.id from products p
          where p.category_id = $1 and p.id <> $2 and p.is_active and p.suspended_at is null
          order by p.created_at limit 1`,
        [CATEGORIES.coffee.id, coffee],
      );
      second = other!.id;
    });

    await test.step('Act — กดปุ่มเทียบบนสินค้า 2 ชิ้น แล้วเปิดตาราง', async () => {
      await page.locator(ids.compare.toggle(coffee)).click();
      // ชิ้นเดียวยังเทียบไม่ได้ — ปุ่มต้องยังกดไม่ได้
      await expect(page.locator(ids.compare.tray)).toBeVisible();
      await expect(page.locator(ids.compare.trayOpen)).toBeDisabled();

      await page.locator(ids.compare.toggle(second)).click();
      await page.locator(ids.compare.trayOpen).click();
    });

    await test.step('Assert — ตารางมีทั้ง 2 คอลัมน์ และราคาต่อรอบตรงกับแผนใน DB', async () => {
      await expect(page.locator(ids.compare.column(coffee))).toBeVisible();
      await expect(page.locator(ids.compare.column(second))).toBeVisible();

      const [plan] = await queryTestDatabase<{ price: string; qty: number }>(
        `select price_per_cycle::numeric::text as price, qty_per_cycle as qty
           from product_plans where product_id = $1 and cycle = '1m' and is_active
          limit 1`,
        [coffee],
      );
      const baht = Number(plan!.price).toLocaleString('th-TH');
      await expect(page.locator(ids.compare.cell('price-1m', coffee))).toContainText(
        `฿${baht}`,
      );
    });

    await test.step('Cleanup — ล้างถาด (เป็น state ในเครื่อง ไม่ได้แตะ DB)', async () => {
      await page.locator(ids.compare.clear).click();
      await expect(page.locator(ids.compare.empty)).toBeVisible();
    });
  },
);

testCase(
  { id: 'TC-081', priority: 'P1', feature: FEATURE },
  'เทียบข้ามหมวดไม่ได้ และมีปุ่มล้างถาดเริ่มใหม่ให้ทันที',
  async ({ page }) => {
    await test.step('Arrange — เข้าหมวดกาแฟจากหน้าแรก แล้วใส่สินค้าลงถาด', async () => {
      await loginAs(page, 'buyer');
      // ★ ต้องเดินในแอป ไม่ใช่ goto ★ ถาดเป็น client state ล้วน — การเปิด URL ใหม่
      // คือ reload ทั้งหน้า ซึ่งล้างถาดเป็นเรื่องปกติ (ไม่ใช่บั๊ก) · ผู้ใช้จริง
      // กดข้ามหมวดในแอปโดยไม่ reload ถาดจึงต้องอยู่ต่อ
      await gotoApp(page, '/');
      await page.locator(ids.home.category(CATEGORIES.coffee.id)).click();
      await page.locator(ids.compare.toggle(PRODUCTS.coffeeMedium.id)).click();
      await expect(page.locator(ids.compare.tray)).toBeVisible();
    });

    await test.step('Act — ย้อนกลับไปหน้าแรกแล้วเข้าหมวดอื่น กดเทียบสินค้าคนละหมวด', async () => {
      await page.goBack();
      await page.locator(ids.home.category(CATEGORIES.household.id)).click();
      await expect(page.locator(ids.compare.toggle(PRODUCTS.tissue.id))).toBeVisible();
      await page.locator(ids.compare.toggle(PRODUCTS.tissue.id)).click();
    });

    await test.step('Assert — บอกเหตุผล + มีทางออกให้เริ่มใหม่ด้วยชิ้นนี้', async () => {
      await expect(page.locator(ids.compare.toast)).toContainText('หมวดเดียวกัน');

      await page.locator(ids.compare.restart).click();
      // ถาดถูกล้างแล้วเริ่มใหม่ด้วยชิ้นในหมวดปัจจุบัน
      await expect(page.locator(ids.compare.tray)).toContainText('เทียบ 1 ชิ้น');
      await page.locator(ids.compare.trayClear).click();
      await expect(page.locator(ids.compare.tray)).toHaveCount(0);
    });
  },
);
