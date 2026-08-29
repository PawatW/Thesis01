/**
 * Feature 02/03 — หน้าแรก, หมวดสินค้า, หน้ารายละเอียดสินค้า
 *
 * เคสกลุ่มนี้เป็นการ "อ่านอย่างเดียว" ทั้งหมด ไม่เขียนอะไรลงฐานข้อมูล
 * จึงไม่ต้องคืนสภาพข้อมูลหลังรัน
 */
import type { Page } from '@playwright/test';

import { testCase, test, expect } from '../helpers/test-case';
import { gotoApp, loginAs } from '../helpers/login';
import * as ids from '../helpers/selectors';
import { CATEGORIES, PRODUCTS } from '../helpers/test-data';

const FEATURE = '02/03 — Catalog';

testCase(
  { id: 'TC-010', priority: 'P1', feature: FEATURE },
  'หน้าแรกแสดงหมวดสินค้าและสินค้าแนะนำหลังล็อกอิน',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อ', async () => {
      await loginAs(page, 'buyer');
    });

    await test.step('Act — เปิดหน้าแรก', async () => {
      await gotoApp(page, '/');
    });

    await test.step('Assert — เห็นหมวดกาแฟ และสินค้าแนะนำอย่างน้อย 1 ชิ้น', async () => {
      await expect(page.locator(ids.home.category(CATEGORIES.coffee.id))).toBeVisible();
      await expect(
        page.locator(`${ids.home.featured} ${ids.home.anyProductCard}`).first(),
      ).toBeVisible();
    });
  },
);

testCase(
  { id: 'TC-011', priority: 'P1', feature: FEATURE },
  'กดหมวดสินค้าแล้วเห็นเฉพาะสินค้าในหมวดนั้น',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินแล้วเปิดหน้าแรก', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/');
      await expect(page.locator(ids.home.category(CATEGORIES.coffee.id))).toBeVisible();
    });

    await test.step('Act — กดหมวด "กาแฟ"', async () => {
      await page.locator(ids.home.category(CATEGORIES.coffee.id)).click();
    });

    await test.step('Assert — เข้าหน้าหมวดและมีสินค้ากาแฟของ seed อยู่ในรายการ', async () => {
      await expect(page.locator(ids.category.grid)).toBeVisible();
      await expect(page.locator(ids.category.productCard(PRODUCTS.coffeeMedium.id))).toBeVisible();
      // ทิชชู่อยู่หมวด "ของใช้ในบ้าน" — ต้องไม่โผล่ในหมวดกาแฟ
      await expect(page.locator(ids.category.productCard(PRODUCTS.tissue.id))).toHaveCount(0);
    });
  },
);

testCase(
  { id: 'TC-012', priority: 'P2', feature: FEATURE },
  'ค้นหาในหมวดแล้วกรองรายการตามคำค้น',
  async ({ page }) => {
    await test.step('Arrange — เปิดหน้าหมวดกาแฟ', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, `/category/${CATEGORIES.coffee.id}`);
      await expect(page.locator(ids.category.productCard(PRODUCTS.coffeeMedium.id))).toBeVisible();
    });

    await test.step('Act — พิมพ์คำที่ตรงกับสินค้าตัวเดียว', async () => {
      await page.locator(ids.category.search).fill('ดริปแบ็ก');
    });

    await test.step('Assert — เหลือเฉพาะสินค้าที่ตรงคำค้น (debounce 300ms)', async () => {
      await expect(page.locator(ids.category.productCard(PRODUCTS.dripBag.id))).toBeVisible();
      await expect(page.locator(ids.category.productCard(PRODUCTS.coffeeMedium.id))).toHaveCount(0);
    });
  },
);

testCase(
  { id: 'TC-013', priority: 'P2', feature: FEATURE },
  'ค้นหาคำที่ไม่มีสินค้าตรงแล้วขึ้นสถานะว่างเปล่า',
  async ({ page }) => {
    await test.step('Arrange — เปิดหน้าหมวดกาแฟ', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, `/category/${CATEGORIES.coffee.id}`);
      await expect(page.locator(ids.category.grid)).toBeVisible();
    });

    await test.step('Act — ค้นด้วยคำที่ไม่มีทางตรงกับสินค้าใด', async () => {
      await page.locator(ids.category.search).fill('ไม่มีสินค้าชื่อนี้แน่นอน');
    });

    await test.step('Assert — เห็นสถานะว่างเปล่า ไม่ใช่ตารางเปล่า', async () => {
      await expect(page.locator(ids.category.empty)).toBeVisible();
      await expect(page.locator(ids.category.grid)).toHaveCount(0);
    });
  },
);

testCase(
  { id: 'TC-014', priority: 'P1', feature: FEATURE },
  'หน้าสินค้าแสดงครบทุกแผนรอบส่งของสินค้านั้น',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อ', async () => {
      await loginAs(page, 'buyer');
    });

    await test.step('Act — เปิดหน้าสินค้าที่มีครบ 3 รอบส่ง', async () => {
      await gotoApp(page, `/product/${PRODUCTS.coffeeMedium.id}`);
    });

    await test.step('Assert — เห็นชื่อสินค้าและแผน 2w / 1m / 2m ครบ', async () => {
      await expect(page.locator(ids.product.title)).toHaveText(PRODUCTS.coffeeMedium.name);
      await expect(page.locator(ids.product.plan('2w'))).toBeVisible();
      await expect(page.locator(ids.product.plan('1m'))).toBeVisible();
      await expect(page.locator(ids.product.plan('2m'))).toBeVisible();
    });
  },
);

testCase(
  { id: 'TC-015', priority: 'P1', feature: FEATURE },
  'แผนที่ร้านปิดรับสมาชิกใหม่ไม่ถูกแสดงให้เลือก',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อ', async () => {
      await loginAs(page, 'buyer');
    });

    await test.step('Act — เปิดสินค้าที่มีแผน 2w ตั้ง isActive=false ไว้ใน seed', async () => {
      await gotoApp(page, `/product/${PRODUCTS.dripBag.id}`);
      await expect(page.locator(ids.product.title)).toHaveText(PRODUCTS.dripBag.name);
    });

    await test.step('Assert — เห็นเฉพาะแผนรายเดือน แผนที่ปิดไว้ต้องไม่โผล่', async () => {
      await expect(page.locator(ids.product.plan('1m'))).toBeVisible();
      await expect(page.locator(ids.product.plan('2w'))).toHaveCount(0);
    });
  },
);

testCase(
  { id: 'TC-016', priority: 'P1', feature: FEATURE },
  'เปลี่ยนจำนวนต่อรอบแล้วยอดรวมคำนวณตามราคาของแผนที่เลือก',
  async ({ page }) => {
    const plan = PRODUCTS.coffeeMedium.plans['1m'];

    await test.step('Arrange — เปิดหน้าสินค้าแล้วเลือกแผนรายเดือน', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, `/product/${PRODUCTS.coffeeMedium.id}`);
      await page.locator(ids.product.plan('1m')).click();
      await expect(page.locator(ids.product.qtyValue)).toHaveText('1');
    });

    await test.step('Act — กดเพิ่มจำนวนหนึ่งครั้ง', async () => {
      await page.locator(ids.product.qtyIncrease).click();
    });

    await test.step('Assert — จำนวนเป็น 2 และยอดรวมเป็นราคาต่อรอบ × 2', async () => {
      await expect(page.locator(ids.product.qtyValue)).toHaveText('2');
      const expected = (plan.pricePerCycle * 2).toLocaleString('th-TH');
      await expect(page.locator(ids.product.total)).toContainText(expected);
    });
  },
);

testCase(
  { id: 'TC-017', priority: 'P2', feature: FEATURE },
  'ลดจำนวนต่ำกว่า 1 ไม่ได้',
  async ({ page }) => {
    await test.step('Arrange — เปิดหน้าสินค้าโดยจำนวนเริ่มต้นเป็น 1', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, `/product/${PRODUCTS.coffeeMedium.id}`);
      await expect(page.locator(ids.product.qtyValue)).toHaveText('1');
    });

    await test.step('Act — กดปุ่มลดจำนวน', async () => {
      await page.locator(ids.product.qtyDecrease).click({ force: true });
    });

    await test.step('Assert — จำนวนยังเป็น 1 เท่าเดิม', async () => {
      await expect(page.locator(ids.product.qtyValue)).toHaveText('1');
    });
  },
);

testCase(
  { id: 'TC-018', priority: 'P2', feature: FEATURE },
  'เปิดสินค้าที่ไม่มีอยู่จริงแล้วขึ้นข้อความว่าไม่พบสินค้า',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อ', async () => {
      await loginAs(page, 'buyer');
    });

    await test.step('Act — เปิด URL ของสินค้าด้วย id ที่ไม่มีในระบบ', async () => {
      await gotoApp(page, '/product/00000000-0000-4000-8000-999999999999');
    });

    await test.step('Assert — เห็นสถานะไม่พบสินค้า ไม่ใช่หน้าขาวหรือ error ดิบ', async () => {
      await expect(page.locator(ids.product.notFound)).toBeVisible();
    });
  },
);

/**
 * กันบั๊กที่เคยเกิด: สูตร `useProductGrid` คำนวณความกว้างการ์ดจากค่าคงที่ของ layout
 * ถ้าคิดเกินจริงแม้แต่ 1px การ์ดใบสุดท้ายจะตกบรรทัดแล้วเหลือช่องว่างทั้งช่อง
 * ถ้าคิดขาดมากไปก็เสียที่ว่างพอที่จะวางการ์ดได้อีกใบ — ทั้งสองแบบไม่มี error ให้เห็น
 *
 * เคสนี้จึงวัด DOM จริงแทนการ assert ตัวเลขตายตัว (ตัวเลขเปลี่ยนตาม breakpoint)
 */
async function measureGrid(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const grid = document.querySelector(sel);
    if (grid == null) throw new Error(`ไม่พบกริดสินค้า ${sel}`);
    const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
    const gridWidth = grid.getBoundingClientRect().width;
    const cards = Array.from(grid.children).map((c) => c.getBoundingClientRect());
    /** การ์ดที่ขอบบนตรงกัน = อยู่บรรทัดเดียวกัน */
    const perRow = new Map<number, number>();
    for (const r of cards) {
      const top = Math.round(r.top);
      perRow.set(top, (perRow.get(top) ?? 0) + 1);
    }
    return {
      gridWidth,
      gap,
      cardWidth: cards[0]?.width ?? 0,
      widths: cards.map((c) => Math.round(c.width)),
      columns: Math.max(...perRow.values()),
    };
  }, selector);
}

testCase(
  { id: 'TC-093', priority: 'P2', feature: FEATURE },
  'กริดสินค้าแนะนำเรียงเต็มแถวพอดี ทั้งบนจอเดสก์ท็อปและจอมือถือ',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อ', async () => {
      await loginAs(page, 'buyer');
    });

    for (const screen of [
      { name: 'เดสก์ท็อป', width: 1280, height: 900, minColumns: 3 },
      { name: 'มือถือ', width: 390, height: 844, minColumns: 2 },
    ]) {
      await test.step(`Act — เปิดหน้าแรกบนจอ${screen.name} ${screen.width}px`, async () => {
        await page.setViewportSize({ width: screen.width, height: screen.height });
        await gotoApp(page, '/');
        await expect(
          page.locator(`${ids.home.featured} ${ids.home.anyProductCard}`).first(),
        ).toBeVisible();
      });

      await test.step(`Assert — จอ${screen.name}: การ์ดเต็มแถวโดยไม่ล้นและไม่เหลือที่พอวางอีกใบ`, async () => {
        const grid = await measureGrid(page, ids.home.featured);
        const used = grid.cardWidth * grid.columns + grid.gap * (grid.columns - 1);

        // การ์ดทุกใบต้องกว้างเท่ากัน — ถ้าไม่เท่าแปลว่ามีใบไหนถูกบีบ
        expect(new Set(grid.widths).size).toBe(1);
        // ได้คอลัมน์ครบตาม design-system §5 (2 บนมือถือ · 3-4 บนเว็บ)
        expect(grid.columns).toBeGreaterThanOrEqual(screen.minColumns);
        // ไม่ล้น: แถวเต็มต้องใส่ในกริดได้จริง (เผื่อ sub-pixel 0.5px)
        expect(used).toBeLessThanOrEqual(grid.gridWidth + 0.5);
        // ไม่เหลือเปล่า: ที่ว่างท้ายแถวต้องแคบกว่าการ์ดอีกหนึ่งใบ
        expect(grid.gridWidth - used).toBeLessThan(grid.cardWidth + grid.gap);
      });
    }
  },
);
