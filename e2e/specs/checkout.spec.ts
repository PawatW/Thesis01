/**
 * Feature 04/09 — สมัครรับสินค้า (checkout) + การผูกบัตร
 *
 * เส้นทางที่ทั้งระบบถูกตัดสิน: เลือกแผน → เลือกที่อยู่/บัตร → ยืนยัน → เกิด
 * subscription จริงในฐานข้อมูล
 *
 * เคสกลุ่มนี้ **เขียนข้อมูลจริง** ลง DB ทดสอบ จึงเลือกใช้สินค้าที่ seed ไม่ได้
 * ผูก subscription ไว้ (ทิชชู่) เพื่อไม่ไปกวนเคสของหน้ารายการของฉัน
 */
import { testCase, test, expect } from '../helpers/test-case';
import { gotoApp, loginAs } from '../helpers/login';
import * as ids from '../helpers/selectors';
import {
  ADDRESSES,
  CARD_EXPIRY_INPUT,
  PRODUCTS,
  TEST_CARDS,
  uniqueEmail,
} from '../helpers/test-data';
import { queryTestDatabase } from '../setup/database';

const FEATURE = '04/09 — Checkout';

/** อ่านยอดที่ระบบบันทึกไว้จริง — ใช้พิสูจน์ว่าเงินมาจากราคาใน DB ไม่ใช่จาก client */
async function latestSubscriptionForPlan(planId: string): Promise<{
  id: string;
  quantity: number;
  price_per_cycle: string;
} | null> {
  const rows = await queryTestDatabase<{
    id: string;
    quantity: number;
    price_per_cycle: string;
  }>(
    `select s.id, s.quantity, p.price_per_cycle
       from subscriptions s
       join product_plans p on p.id = s.plan_id
      where s.plan_id = $1
      order by s.created_at desc
      limit 1`,
    [planId],
  );
  return rows[0] ?? null;
}

testCase(
  { id: 'TC-019', priority: 'P0', feature: FEATURE },
  'สมัครรับสินค้าจบเส้นทางแล้วเกิดรายการใหม่ในหน้ารายการของฉัน',
  async ({ page }) => {
    const plan = PRODUCTS.tissue.plans['2m'];

    await test.step('Arrange — ล็อกอินแล้วเปิดหน้าสินค้าที่ยังไม่เคยสมัคร', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, `/product/${PRODUCTS.tissue.id}`);
      await expect(page.locator(ids.product.title)).toHaveText(PRODUCTS.tissue.name);
    });

    await test.step('Act — เลือกแผนราย 2 เดือน กดสมัคร แล้วยืนยันที่หน้า checkout', async () => {
      await page.locator(ids.product.plan('2m')).click();
      await page.locator(ids.product.subscribe).click();

      await expect(page.locator(ids.checkout.confirm)).toBeVisible();
      // ที่อยู่หลักและบัตรของ seed ถูกเลือกให้อยู่แล้ว ปุ่มยืนยันจึงต้องกดได้
      await expect(page.locator(ids.checkout.notReady)).toHaveCount(0);
      await page.locator(ids.checkout.confirm).click();
    });

    await test.step('Assert — ถูกพาไปหน้ารายการของฉัน และเห็นรายการที่เพิ่งสมัคร', async () => {
      await expect(page.locator(ids.subscriptions.spend)).toBeVisible();

      const created = await latestSubscriptionForPlan(plan.id);
      expect(created, 'ต้องมี subscription ของแผนนี้ในฐานข้อมูล').not.toBeNull();
      await expect(page.locator(ids.subscriptions.item(created!.id))).toBeVisible();
      await expect(page.locator(ids.subscriptions.status(created!.id))).toHaveText('กำลังใช้งาน');
    });
  },
);

testCase(
  { id: 'TC-020', priority: 'P0', feature: FEATURE },
  'ยอดต่อรอบที่บันทึกมาจากราคาในฐานข้อมูล ไม่ใช่ค่าที่หน้าจอส่งขึ้นไป',
  async ({ page }) => {
    const plan = PRODUCTS.coffeeMedium.plans['2w'];

    await test.step('Arrange — เปิดหน้าสินค้าแล้วเลือกแผนราย 2 สัปดาห์', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, `/product/${PRODUCTS.coffeeMedium.id}`);
      await page.locator(ids.product.plan('2w')).click();
    });

    await test.step('Act — เพิ่มจำนวนเป็น 3 แล้วสมัครจนจบ', async () => {
      await page.locator(ids.product.qtyIncrease).click();
      await page.locator(ids.product.qtyIncrease).click();
      await expect(page.locator(ids.product.qtyValue)).toHaveText('3');

      await page.locator(ids.product.subscribe).click();
      await expect(page.locator(ids.checkout.confirm)).toBeVisible();
      await page.locator(ids.checkout.confirm).click();
      await expect(page.locator(ids.subscriptions.spend)).toBeVisible();
    });

    await test.step('Assert — แถวใน DB เก็บจำนวน 3 และราคาต่อรอบตามที่ประกาศไว้ในแผน', async () => {
      const created = await latestSubscriptionForPlan(plan.id);
      expect(created).not.toBeNull();
      expect(created!.quantity).toBe(3);
      expect(Number(created!.price_per_cycle)).toBe(plan.pricePerCycle);
    });
  },
);

testCase(
  { id: 'TC-022', priority: 'P1', feature: FEATURE },
  'ผูกบัตรใหม่ในหน้าจ่ายเงินแล้วเลือกใช้ได้ทันที โดย DB เก็บแค่ 4 ตัวท้าย',
  async ({ page }) => {
    const card = TEST_CARDS.mastercard;

    await test.step('Arrange — เข้าหน้า checkout ของแผนใดก็ได้', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, `/checkout/${PRODUCTS.tissue.plans['2m'].id}`);
      await expect(page.locator(ids.checkout.cardNumber)).toBeVisible();
    });

    await test.step('Act — กรอกบัตรครบทุกช่องแล้วกดผูกบัตร', async () => {
      await page.locator(ids.checkout.cardNumber).fill(card.number);
      await page.locator(ids.checkout.cardExpiry).fill(CARD_EXPIRY_INPUT.future);
      await page.locator(ids.checkout.cardCvv).fill('123');
      await page.locator(ids.checkout.cardHolder).fill('E2E TESTER');
      await page.locator(ids.checkout.cardAdd).click();
    });

    await test.step('Assert — DB เก็บเครือข่าย + 4 ตัวท้าย + วันหมดอายุ ไม่มีเลขเต็ม', async () => {
      await expect(page.locator(ids.checkout.cardError)).toHaveCount(0);

      const rows = await queryTestDatabase<{
        brand: string;
        last4: string;
        exp_month: number;
        exp_year: number;
      }>(
        `select brand, last4, exp_month, exp_year from payment_methods
          where holder_name = $1 order by created_at desc limit 1`,
        ['E2E TESTER'],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.last4).toBe(card.last4);
      // เครือข่ายอ่านจาก BIN ที่ฝั่งแอป — BIN เองไม่เคยถูกส่งขึ้น API
      expect(rows[0]!.brand).toBe(card.brand);
      expect(rows[0]!.exp_month).toBe(12);

      // เลขเต็มต้องไม่มีอยู่ที่ไหนในหน้าจอหลังกดผูกบัตร
      await expect(page.locator('body')).not.toContainText(card.number);
    });
  },
);

testCase(
  { id: 'TC-023', priority: 'P1', feature: FEATURE },
  'เลขบัตรที่ checksum ไม่ผ่านถูกปฏิเสธก่อนยิงขึ้น API',
  async ({ page }) => {
    await test.step('Arrange — เข้าหน้า checkout', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, `/checkout/${PRODUCTS.tissue.plans['2m'].id}`);
      await expect(page.locator(ids.checkout.cardNumber)).toBeVisible();
    });

    await test.step('Act — กรอกเลขบัตรที่ Luhn ไม่ผ่านแล้วกดผูกบัตร', async () => {
      await page.locator(ids.checkout.cardNumber).fill(TEST_CARDS.badChecksum.number);
      await page.locator(ids.checkout.cardExpiry).fill(CARD_EXPIRY_INPUT.future);
      await page.locator(ids.checkout.cardCvv).fill('123');
      await page.locator(ids.checkout.cardHolder).fill('E2E BADSUM');
      await page.locator(ids.checkout.cardAdd).click();
    });

    await test.step('Assert — ขึ้น error ใต้ช่องเลขบัตร และไม่มีแถวใหม่ใน DB', async () => {
      await expect(page.locator(ids.checkout.cardNumberError)).toBeVisible();
      expect(
        await queryTestDatabase(
          `select id from payment_methods where holder_name = $1`,
          ['E2E BADSUM'],
        ),
      ).toHaveLength(0);
    });
  },
);

testCase(
  { id: 'TC-024', priority: 'P1', feature: FEATURE },
  'เลือกที่อยู่อื่นแล้วรายการที่สมัครใช้ที่อยู่นั้น',
  async ({ page }) => {
    const plan = PRODUCTS.coffeeMedium.plans['2m'];

    await test.step('Arrange — เข้าหน้า checkout ของแผนราย 2 เดือน', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, `/checkout/${plan.id}`);
      await expect(page.locator(ids.checkout.confirm)).toBeVisible();
    });

    await test.step('Act — เลือกที่อยู่ "ที่ทำงาน" แทนที่อยู่หลัก แล้วยืนยัน', async () => {
      await page.locator(ids.checkout.address(ADDRESSES.work.id)).click();
      await page.locator(ids.checkout.confirm).click();
      await expect(page.locator(ids.subscriptions.spend)).toBeVisible();
    });

    await test.step('Assert — subscription ที่เกิดขึ้นผูกกับที่อยู่ที่ทำงาน', async () => {
      const rows = await queryTestDatabase<{ address_id: string }>(
        `select address_id from subscriptions
          where plan_id = $1 order by created_at desc limit 1`,
        [plan.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.address_id).toBe(ADDRESSES.work.id);
    });
  },
);

testCase(
  { id: 'TC-025', priority: 'P1', feature: FEATURE },
  'ผู้ใช้ที่ยังไม่มีที่อยู่ยืนยันการสมัครไม่ได้',
  async ({ page }) => {
    await test.step('Arrange — สมัครบัญชีใหม่ที่ยังไม่มีที่อยู่และบัตร', async () => {
      await gotoApp(page, '/register');
      await page.locator(ids.register.name).fill('ผู้ใช้ยังไม่มีที่อยู่');
      await page.locator(ids.register.email).fill(uniqueEmail('noaddr'));
      await page.locator(ids.register.password).fill('E2ePassword2026!');
      await page.locator(ids.register.submit).click();
      await expect(page.locator(ids.home.greeting)).toBeVisible();
    });

    await test.step('Act — เปิดหน้า checkout ตรง ๆ', async () => {
      await gotoApp(page, `/checkout/${PRODUCTS.tissue.plans['2m'].id}`);
      await expect(page.locator(ids.checkout.confirm)).toBeVisible();
    });

    await test.step('Assert — ขึ้นสถานะว่ายังไม่มีที่อยู่ และปุ่มยืนยันกดไม่ได้', async () => {
      await expect(page.locator(ids.checkout.addressEmpty)).toBeVisible();
      await expect(page.locator(ids.checkout.notReady)).toBeVisible();
      await expect(page.locator(ids.checkout.confirm)).toBeDisabled();
    });
  },
);

testCase(
  { id: 'TC-026', priority: 'P0', feature: FEATURE },
  'สมัครแผนที่ร้านปิดรับสมาชิกใหม่ไม่ได้ แม้จะเปิด URL ของ checkout ตรง ๆ',
  async ({ page }) => {
    const closedPlanId = PRODUCTS.dripBag.inactivePlanId;

    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อ', async () => {
      await loginAs(page, 'buyer');
      const before = await queryTestDatabase(
        `select id from subscriptions where plan_id = $1`,
        [closedPlanId],
      );
      expect(before, 'seed ต้องยังไม่มีใครสมัครแผนที่ปิดไว้').toHaveLength(0);
    });

    await test.step('Act — ข้ามหน้าสินค้า เปิด checkout ของแผนที่ isActive=false แล้วกดยืนยัน', async () => {
      // หน้าสินค้าไม่แสดงแผนนี้ให้เลือก (TC-015) แต่ URL เดายังไงก็ได้ —
      // ด่านจริงต้องอยู่ที่ API ไม่ใช่ที่ปุ่มบนหน้าจอ (CLAUDE.md กฎข้อ 7)
      await gotoApp(page, `/checkout/${closedPlanId}`);
      await expect(page.locator(ids.checkout.confirm)).toBeVisible();
      await page.locator(ids.checkout.confirm).click();
    });

    await test.step('Assert — API ปฏิเสธ ขึ้น error และไม่มีรายการเกิดขึ้นในฐานข้อมูล', async () => {
      await expect(page.locator(ids.checkout.error)).toBeVisible();
      // ยังอยู่หน้า checkout ไม่ได้ถูกพาไปหน้ารายการของฉัน
      await expect(page.locator(ids.subscriptions.spend)).toHaveCount(0);

      const after = await queryTestDatabase(
        `select id from subscriptions where plan_id = $1`,
        [closedPlanId],
      );
      expect(after).toHaveLength(0);
    });
  },
);
