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
import { CATEGORIES, PRODUCTS, SHOPS } from '../helpers/test-data';
import { queryTestDatabase } from '../setup/database';

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
  'ติ๊กหมวดเดียวแล้วกรองการ์ดในหน้าแรกเลย ไม่เด้งไปหน้าหมวด',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินแล้วเปิดหน้าแรก', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/');
      await expect(page.locator(ids.home.category(CATEGORIES.coffee.id))).toBeVisible();
    });

    await test.step('Act — ติ๊กหมวด "กาแฟ"', async () => {
      await page.locator(ids.home.category(CATEGORIES.coffee.id)).click();
      await expect(page.locator(ids.home.featuredCount)).toBeVisible();
    });

    await test.step('Assert — ยังอยู่หน้าแรก และเห็นเฉพาะสินค้ากาแฟ', async () => {
      // ไม่มีการ navigate — หน้าหมวดต้องไม่ถูกเปิด
      await expect(page.locator(ids.category.grid)).toHaveCount(0);
      await expect(page.locator(ids.home.productCard(PRODUCTS.coffeeMedium.id))).toBeVisible();
      // ทิชชู่อยู่หมวด "ของใช้ในบ้าน" — ต้องไม่โผล่ตอนติ๊กเฉพาะกาแฟ
      await expect(page.locator(ids.home.productCard(PRODUCTS.tissue.id))).toHaveCount(0);
    });
  },
);

testCase(
  { id: 'TC-126', priority: 'P1', feature: FEATURE },
  'ติ๊กได้หลายหมวดพร้อมกัน — ผลลัพธ์เป็นยูเนียน และล้างตัวกรองกลับสภาพเดิม',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินแล้วติ๊กหมวด "กาแฟ"', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/');
      await page.locator(ids.home.category(CATEGORIES.coffee.id)).click();
      await expect(page.locator(ids.home.productCard(PRODUCTS.coffeeMedium.id))).toBeVisible();
      await expect(page.locator(ids.home.productCard(PRODUCTS.tissue.id))).toHaveCount(0);
    });

    await test.step('Act — ติ๊กหมวด "ของใช้ในบ้าน" เพิ่มอีกหมวด', async () => {
      await page.locator(ids.home.category(CATEGORIES.household.id)).click();
    });

    await test.step('Assert — เห็นสินค้าของทั้งสองหมวดพร้อมกัน (ยูเนียน ไม่ใช่ AND)', async () => {
      await expect(page.locator(ids.home.productCard(PRODUCTS.coffeeMedium.id))).toBeVisible();
      await expect(page.locator(ids.home.productCard(PRODUCTS.tissue.id))).toBeVisible();
      await expect(page.locator(ids.home.categoryClear)).toContainText('2');
    });

    await test.step('Assert — ล้างตัวกรองแล้วกลับไปแสดง "คนสมัครเยอะที่สุด"', async () => {
      await page.locator(ids.home.categoryClear).click();
      await expect(page.locator(ids.home.categoryClear)).toHaveCount(0);
      await expect(page.locator(ids.home.featuredCount)).toHaveCount(0);
      await expect(
        page.locator(`${ids.home.featured} ${ids.home.anyProductCard}`).first(),
      ).toBeVisible();
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

/**
 * ค้นหาร้านค้า (feature 02, 2026-08-30) — ช่องเดียวค้นได้ทั้งชื่อสินค้าและชื่อร้าน
 * เข้าได้จากช่องค้นหาในหน้าแรก (hero) หรือพิมพ์ตรงในหน้า `/search` เอง
 *
 * เคสกลุ่มนี้ก็เป็นการ "อ่านอย่างเดียว" เหมือนเคสข้างบน — ไม่เขียนอะไรลง DB
 */
testCase(
  { id: 'TC-121', priority: 'P0', feature: FEATURE },
  'พิมพ์ชื่อร้านจากหน้าแรกแล้วกดเข้าหน้าร้านได้ พร้อมจำนวนสินค้าตรงกับ DB จริง',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อแล้วเปิดหน้าแรก', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/');
    });

    await test.step('Act — พิมพ์ "Bean" ในช่องค้นหาหน้าแรกแล้วกด Enter', async () => {
      await page.locator(ids.home.search).fill('Bean');
      await page.locator(ids.home.search).press('Enter');
    });

    await test.step('Assert — เข้าหน้า /search แล้วเห็นการ์ดร้าน Bean Story', async () => {
      await expect(page.locator(ids.search.shops)).toBeVisible();
      await expect(page.locator(ids.search.shop(SHOPS.beanStory.id))).toBeVisible();
    });

    await test.step('Act — กดการ์ดร้าน Bean Story', async () => {
      await page.locator(ids.search.shop(SHOPS.beanStory.id)).click();
    });

    await test.step('Assert — เข้าหน้าร้าน Bean Story และจำนวนสินค้าตรงกับที่นับได้จาก DB (ไม่ hardcode)', async () => {
      await expect(page.locator(ids.shopPage.name)).toHaveText('Bean Story');

      // productCount ของ API นับเฉพาะสินค้าที่ isActive และไม่ถูกระงับ (PRODUCT_SELF_VISIBLE)
      const [row] = await queryTestDatabase<{ n: string }>(
        `select count(*)::text as n
           from products
          where shop_id = $1 and is_active = true and suspended_at is null`,
        [SHOPS.beanStory.id],
      );
      await expect(page.locator(ids.shopPage.statProducts)).toContainText(
        Number(row!.n).toLocaleString('th-TH'),
      );
    });
  },
);

testCase(
  { id: 'TC-122', priority: 'P2', feature: FEATURE },
  'ค้นหาคำที่ไม่มีทั้งร้านและสินค้าใดตรงในหน้าค้นหารวม',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินแล้วเปิดหน้าค้นหา', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/search');
    });

    await test.step('Act — พิมพ์คำที่ไม่มีทางตรงกับร้านหรือสินค้าใด', async () => {
      await page.locator(ids.search.input).fill('zzzznotfound');
    });

    await test.step('Assert — เห็นสถานะไม่พบผลลัพธ์ที่อ้างคำค้นจริง ไม่ใช่สถานะ "ยังไม่ค้นหา"', async () => {
      // #search-empty ใช้ร่วมกัน 2 สถานะ (ยังไม่พิมพ์คำค้น vs. ค้นแล้วไม่พบ) — ต้อง assert ข้อความด้วย
      await expect(page.locator(ids.search.empty)).toContainText('ไม่พบ "zzzznotfound"');
      await expect(page.locator(ids.search.shops)).toHaveCount(0);
    });
  },
);

testCase(
  { id: 'TC-123', priority: 'P1', feature: FEATURE },
  'ค้นด้วยชื่อร้านแล้วกริดสินค้าโชว์เฉพาะสินค้าของร้านนั้น',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินแล้วเปิดหน้าค้นหา', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/search');
    });

    await test.step('Act — ค้นด้วยชื่อร้าน "Herbal" (ไม่ใช่ชื่อสินค้า)', async () => {
      await page.locator(ids.search.input).fill('Herbal');
    });

    await test.step('Assert — กริดมีสินค้าของ Herbal Care และไม่มีสินค้าของร้านอื่น (กาแฟของ Bean Story)', async () => {
      await expect(page.locator(ids.search.grid)).toBeVisible();
      await expect(page.locator(ids.search.product(PRODUCTS.herbalShampoo.id))).toBeVisible();
      await expect(page.locator(ids.search.product(PRODUCTS.coffeeMedium.id))).toHaveCount(0);
    });
  },
);
