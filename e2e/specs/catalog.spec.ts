/**
 * Feature 02/03 — หน้าแรก, หมวดสินค้า, หน้ารายละเอียดสินค้า
 *
 * เคสกลุ่มนี้เป็นการ "อ่านอย่างเดียว" ทั้งหมด ไม่เขียนอะไรลงฐานข้อมูล
 * จึงไม่ต้องคืนสภาพข้อมูลหลังรัน
 */
import { testCase, test, expect } from '../helpers/test-case';
import { gotoApp, loginAs } from '../helpers/login';
import * as ids from '../helpers/selectors';
import { CATEGORIES, PRODUCTS, SHOPS, USERS } from '../helpers/test-data';
import { queryTestDatabase } from '../setup/database';

const FEATURE = '02/03 — Catalog';

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

testCase(
  { id: 'TC-127', priority: 'P1', feature: FEATURE },
  'หน้าแรกโฉมใหม่: ดีลคุ้ม + แผงรอบส่งถัดไปตรงกับ DB + ช่องทางลัดพาไปหน้าของฉัน',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อแล้วเปิดหน้าแรก', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/');
      await expect(page.locator(ids.home.hero)).toBeVisible();
    });

    await test.step('Assert — ส่วน "ดีลคุ้มเมื่อสมัครรับ" มีการ์ดอย่างน้อย 1 ใบ', async () => {
      await expect(page.locator(`${ids.home.deals} ${ids.home.anyDealCard}`).first()).toBeVisible();
    });

    await test.step('Assert — จำนวนแถวในแผงรอบส่งเท่ากับ subscription ของผู้ซื้อใน DB (ไม่ hardcode)', async () => {
      const [row] = await queryTestDatabase<{ n: string }>(
        'select count(*)::text as n from subscriptions where buyer_id = $1',
        [USERS.buyer.id],
      );
      await expect(page.locator(`${ids.home.nextPanel} ${ids.home.anySubscriptionRow}`)).toHaveCount(
        Number(row!.n),
      );
      // ยอดเงินทุกจุดต้องมีป้าย DEMO (กฎข้อ 1) — สรุปยอดขึ้นเฉพาะเดือนที่มีรอบตัดเงิน
      // (ใกล้สิ้นเดือนอาจไม่มี) จึงเช็คป้ายเมื่อกล่องสรุปมีอยู่จริงเท่านั้น
      if ((await page.locator(ids.home.monthSummary).count()) > 0) {
        await expect(page.locator(ids.home.monthSummary)).toContainText('DEMO — ไม่มีการตัดเงินจริง');
      }
    });

    await test.step('Act — กดช่องทางลัด "ข้าม หยุด เลื่อนได้เอง"', async () => {
      await page.locator(ids.home.tileManage).click();
    });

    await test.step('Assert — มาถึงหน้า "ของฉัน" (สรุปยอดเดือนนี้ของ subscription)', async () => {
      await expect(page.locator(ids.subscriptions.spend)).toBeVisible();
    });
  },
);
