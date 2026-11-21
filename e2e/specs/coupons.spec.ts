/**
 * Feature 18 — คูปองส่วนลดรายรอบ (W13)
 *
 * ★ สิ่งที่ไฟล์นี้ต้องพิสูจน์ ★ คูปองที่นี่ไม่ใช่ "ลดตอน checkout แล้วจบ" แต่เป็น
 * ของที่ผู้ซื้อ **จองไว้กับรอบหนึ่ง** แล้ว engine เป็นคนใช้จริงตอนตัดเงิน —
 * ทุกเคสที่แตะเงินหรือสถานะจึงยืนยันผลใน **ฐานข้อมูล** ไม่ใช่แค่ตัวเลขบนจอ
 * (docs/testing.md §3.1)
 *
 * ⚠️ ลำดับของเคสในไฟล์นี้มีความหมาย — เคสหลัง ๆ อาศัยสถานะที่เคสก่อนหน้าทิ้งไว้
 * (จองคูปอง → ข้ามรอบให้คืน → จองใหม่ → รัน engine → ใช้ไปแล้วจึงหายจากรายการ)
 * `workers: 1` + `fullyParallel: false` ใน playwright.config.ts ทำให้ลำดับนี้เชื่อถือได้
 */
import { testCase, test, expect } from '../helpers/test-case';
import { apiBaseUrl, apiLogin, gotoApp, loginAs } from '../helpers/login';
import * as ids from '../helpers/selectors';
import {
  ADDRESSES,
  COUPON_POLICIES,
  COUPONS,
  DEMO_PASSWORD,
  SHOPS,
  SUBSCRIPTIONS,
  USERS,
} from '../helpers/test-data';
import { queryTestDatabase } from '../setup/database';

const FEATURE = '18 — Coupons';

/** โค้ดคูปองที่เคส admin สร้างเอง — ต่างจากทุกครั้งที่รันเพื่อไม่ชน UNIQUE */
const NEW_CODE = `E2ENEW${String(Date.now()).slice(-6)}`;
/** โค้ดคูปองที่เคสฝั่งร้านสร้างเอง (feature 18 รอบ 2) */
const SHOP_CODE = `E2ESHOP${String(Date.now()).slice(-5)}`;
/** คูปองแพลตฟอร์มของเคสซ้อน — ต้องเป็นใบใหม่เพราะ 1 คนใช้คูปองใบหนึ่งได้ครั้งเดียว */
const STACK_CODE = `E2ESTK${String(Date.now()).slice(-6)}`;
let stackCouponId = '';

async function put<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** พรุ่งนี้ตามปฏิทินไทย — เทสรันด้วย timezone Asia/Bangkok (playwright.config.ts) */
function tomorrowISO(): string {
  const d = new Date(Date.now() + 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d);
}

type RedemptionRow = {
  status: string;
  /** ★ cast เป็น ::text ★ เหตุผลเดียวกับ subscriptions.spec.ts (B-12) */
  cycle_date: string;
  released_reason: string | null;
  in_use_count: number;
  code: string;
};

async function redemptionsOf(subscriptionId: string): Promise<RedemptionRow[]> {
  return queryTestDatabase<RedemptionRow>(
    `select r.status,
            r.cycle_date::text as cycle_date,
            r.released_reason,
            c.in_use_count,
            c.code
       from coupon_redemptions r
       join coupons c on c.id = r.coupon_id
      where r.subscription_id = $1
      order by r.reserved_at`,
    [subscriptionId],
  );
}

async function nextOrderDateOf(subscriptionId: string): Promise<string> {
  const [row] = await queryTestDatabase<{ d: string | null }>(
    'select next_order_date::text as d from subscriptions where id = $1',
    [subscriptionId],
  );
  const value = row?.d;
  if (value == null) throw new Error(`subscription ${subscriptionId} ไม่มีรอบถัดไป`);
  return value;
}

async function post<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/**
 * จองคูปองผ่าน UI จริง — เปิดกล่อง เลือกใบของระดับนั้น แล้วรอให้กล่องยืนยัน
 * (กล่องแยกเป็น 2 ช่องตามระดับตั้งแต่ feature 18 รอบ 2)
 */
async function applyCouponThroughUi(
  page: Parameters<Parameters<typeof testCase>[2]>[0]['page'],
  subscriptionId: string,
  couponId: string,
  tier: 'platform' | 'shop' = 'platform',
): Promise<void> {
  await page.locator(ids.subscriptions.action.coupon(subscriptionId)).click();
  await expect(page.locator(ids.subscriptions.couponModal)).toBeVisible();
  await page.locator(ids.subscriptions.couponOption(couponId)).click();
  await expect(page.locator(ids.subscriptions.couponApplied(tier))).toBeVisible();
  await page.locator(ids.subscriptions.couponClose).click();
}

// ==========================================================
// Flow A — ผู้ดูแลออกคูปอง
// ==========================================================

testCase(
  { id: 'TC-106', priority: 'P1', feature: FEATURE },
  'ผู้ดูแลออกคูปองจากหน้าจอได้ และมีร่องรอยใน audit log',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินเป็นผู้ดูแลแล้วเปิดหน้าคูปอง', async () => {
      await loginAs(page, 'admin');
      await gotoApp(page, '/(admin)/coupons');
      await expect(page.locator(ids.admin.couponCreate)).toBeVisible();
    });

    await test.step('Act — กรอกคูปองแบบเปอร์เซ็นต์พร้อมเพดานแล้วกดออกคูปอง', async () => {
      await page.locator(ids.admin.couponCode).fill(NEW_CODE);
      await page.locator(ids.admin.couponTitle).fill('คูปองจากเทส L4');
      await page.locator(ids.admin.couponValue).fill('15');
      await page.locator(ids.admin.couponCap).fill('40');
      await page.locator(ids.admin.couponEnds).fill('2027-12-31');
      await page.locator(ids.admin.couponQuota).fill('5');
      await page.locator(ids.admin.couponCreate).click();
      await expect(page.locator(ids.admin.couponsToast)).toBeVisible();
    });

    await test.step('Assert — คูปองถูกบันทึกจริง โควตาเริ่มที่ 0 และมี audit log', async () => {
      const [row] = await queryTestDatabase<{
        id: string;
        discount_value: string;
        max_discount_amount: string | null;
        max_redemptions: number;
        in_use_count: number;
        is_active: boolean;
      }>(
        `select id, discount_value::text, max_discount_amount::text,
                max_redemptions, in_use_count, is_active
           from coupons where code = $1`,
        [NEW_CODE],
      );
      expect(row, 'ต้องมีคูปองใบใหม่ในฐานข้อมูล').toBeDefined();
      expect(Number(row!.discount_value)).toBe(15);
      expect(Number(row!.max_discount_amount)).toBe(40);
      expect(row!.max_redemptions).toBe(5);
      // ★ โควตาขยับได้จากการจองเท่านั้น ★ ไม่ใช่จากค่าที่ฟอร์มส่งมา
      expect(row!.in_use_count).toBe(0);
      expect(row!.is_active).toBe(true);

      const [log] = await queryTestDatabase<{ n: string }>(
        `select count(*)::text as n from audit_logs
          where action = 'coupon_created' and target_id = $1`,
        [row!.id],
      );
      expect(Number(log!.n)).toBe(1);
    });
  },
);

// ==========================================================
// Flow B — ร้านเลือกสินค้าที่เข้าร่วม
// ==========================================================

testCase(
  { id: 'TC-107', priority: 'P1', feature: FEATURE },
  'ร้านตั้งนโยบายคูปองรายสินค้า และติ๊กเข้าร่วมแคมเปญได้ในบันทึกเดียว',
  async ({ page }) => {
    // ★ ดริปแบ็กถูก seed ตั้งเป็น `none` ★ (สินค้ากำไรบางที่ร้านกันไว้)
    // เคสนี้จึงพิสูจน์ทั้งการเปลี่ยนนโยบายและการเข้าร่วมในคำสั่งเดียว
    const productId = COUPON_POLICIES.noneProductId;

    await test.step('Arrange — ล็อกอินเป็นร้านแล้วเปิดหน้าแก้สินค้าที่ปิดคูปองไว้', async () => {
      await loginAs(page, 'seller');
      await gotoApp(page, `/(seller)/products/${productId}`);
      await expect(page.locator(ids.sellerEdit.couponsCard)).toBeVisible();
    });

    await test.step('Assert — ร้านเห็นตัวเลขภาระส่วนลดต่อรอบก่อนตัดสินใจ', async () => {
      await expect(
        page.locator(ids.sellerEdit.couponCost(COUPONS.percent20.id)),
      ).toContainText('เสียส่วนลดสูงสุด');
      // ทั้งสองระดับต้องมีหัวข้อของตัวเอง ไม่ใช่รายการเดียวปนกัน
      await expect(
        page.locator(ids.sellerEdit.couponGroup('platform')),
      ).toBeVisible();
      await expect(
        page.locator(ids.sellerEdit.couponGroup('shop')),
      ).toBeVisible();
    });

    await test.step('Act — เปลี่ยนนโยบายเป็นรับทั้งสองระดับ + ติ๊กเข้าร่วมแคมเปญ แล้วบันทึก', async () => {
      await page.locator(ids.sellerEdit.couponPolicy('both')).click();
      await page.locator(ids.sellerEdit.coupon(COUPONS.percent20.id)).click();
      await page.locator(ids.sellerEdit.couponsSave).click();
      await expect(page.locator(ids.sellerEdit.couponsSaved)).toBeVisible();
    });

    await test.step('Assert — ★ ฐานข้อมูล ★ นโยบายเปลี่ยนจริง และมีแถวเข้าร่วม', async () => {
      const [product] = await queryTestDatabase<{ coupon_policy: string }>(
        'select coupon_policy from products where id = $1',
        [productId],
      );
      expect(product!.coupon_policy).toBe('both');

      const [row] = await queryTestDatabase<{ n: string }>(
        'select count(*)::text as n from coupon_products where coupon_id = $1 and product_id = $2',
        [COUPONS.percent20.id, productId],
      );
      expect(Number(row!.n)).toBe(1);
    });

    await test.step('Act/Assert — คืนสภาพเดิม (ปิดคูปองสินค้าชิ้นนี้) แล้วแถวหายไป', async () => {
      await page.locator(ids.sellerEdit.couponPolicy('none')).click();
      await page.locator(ids.sellerEdit.coupon(COUPONS.percent20.id)).click();
      await page.locator(ids.sellerEdit.couponsSave).click();
      await expect(page.locator(ids.sellerEdit.couponsSaved)).toBeVisible();

      const [row] = await queryTestDatabase<{ n: string }>(
        'select count(*)::text as n from coupon_products where coupon_id = $1 and product_id = $2',
        [COUPONS.percent20.id, productId],
      );
      expect(Number(row!.n)).toBe(0);
    });
  },
);

// ==========================================================
// Flow C — ผู้ซื้อจองคูปองกับรอบ
// ==========================================================

testCase(
  { id: 'TC-108', priority: 'P1', feature: FEATURE },
  'ผู้ซื้อเห็นเฉพาะคูปองที่ร้านเข้าร่วม พร้อมยอดที่ server คำนวณให้',
  async ({ page }) => {
    const id = SUBSCRIPTIONS.coffeeMonthly.id;

    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อแล้วเปิดหน้ารายการของฉัน', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
      await expect(page.locator(ids.subscriptions.item(id))).toBeVisible();
    });

    await test.step('Act — เปิดกล่องคูปองของรอบถัดไป', async () => {
      await page.locator(ids.subscriptions.action.coupon(id)).click();
      await expect(page.locator(ids.subscriptions.couponModal)).toBeVisible();
    });

    await test.step('Assert — เห็นทั้งสองใบที่ร้านเข้าร่วม พร้อมยอดลดที่ถูกต้อง', async () => {
      // แผนรายเดือนของกาแฟ = ฿255 → 20% = ฿51 (ยังไม่ถึงเพดาน ฿80)
      await expect(
        page.locator(ids.subscriptions.couponSave(COUPONS.percent20.id)),
      ).toHaveText('−฿51');
      // fixed ฿50 · ยอด ฿255 ผ่านขั้นต่ำ ฿250
      await expect(
        page.locator(ids.subscriptions.couponSave(COUPONS.fixed50.id)),
      ).toHaveText('−฿50');
      // กล่องต้องบอกว่ากำลังจองให้ "รอบไหน" ไม่ใช่ใช้ทันที
      await expect(page.locator(ids.subscriptions.couponCycle)).toContainText(
        'รอบวันที่',
      );
      await page.locator(ids.subscriptions.couponClose).click();
    });
  },
);

testCase(
  { id: 'TC-109', priority: 'P0', feature: FEATURE },
  'จองคูปองกับรอบถัดไป → บันทึกเป็น reserved และกินโควตาทันที',
  async ({ page }) => {
    const id = SUBSCRIPTIONS.coffeeMonthly.id;
    let cycleDate = '';

    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อและจำวันรอบถัดไปไว้', async () => {
      await loginAs(page, 'buyer');
      cycleDate = await nextOrderDateOf(id);
      await gotoApp(page, '/subscriptions');
      await expect(page.locator(ids.subscriptions.item(id))).toBeVisible();
    });

    await test.step('Act — เลือกคูปอง 20% กับรอบถัดไป', async () => {
      await applyCouponThroughUi(page, id, COUPONS.percent20.id);
    });

    await test.step('Assert — การ์ดโชว์ยอดหลังลด', async () => {
      await expect(page.locator(ids.subscriptions.couponLine(id))).toContainText(
        COUPONS.percent20.code,
      );
      await expect(page.locator(ids.subscriptions.couponLine(id))).toContainText(
        '฿204',
      );
    });

    await test.step('Assert — ★ ฐานข้อมูล ★ ใบจองเป็น reserved ของรอบนั้น และโควตาถูกกิน', async () => {
      const rows = await redemptionsOf(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('reserved');
      expect(rows[0]!.cycle_date).toBe(cycleDate);
      expect(rows[0]!.code).toBe(COUPONS.percent20.code);
      // ★ โควตาถูกกินตั้งแต่ตอนจอง ไม่ใช่ตอนตัดเงิน ★
      expect(rows[0]!.in_use_count).toBe(1);

      const [ev] = await queryTestDatabase<{ n: string }>(
        `select count(*)::text as n from subscription_events
          where subscription_id = $1 and event = 'coupon_applied'`,
        [id],
      );
      expect(Number(ev!.n)).toBe(1);
    });
  },
);

// ==========================================================
// Flow E — กฎเดียว: รอบเปลี่ยนโดยไม่เกิดออเดอร์ = คืนคูปอง
// ==========================================================

testCase(
  { id: 'TC-112', priority: 'P0', feature: FEATURE },
  'ข้ามรอบที่จองคูปองไว้ → ระบบคืนคูปองพร้อมโควตาให้อัตโนมัติ',
  async ({ page }) => {
    const id = SUBSCRIPTIONS.coffeeMonthly.id;

    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อที่จองคูปองไว้แล้ว (จาก TC-109)', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
      await expect(page.locator(ids.subscriptions.couponLine(id))).toBeVisible();
    });

    await test.step('Act — กดข้ามรอบถัดไปแล้วยืนยัน', async () => {
      await page.locator(ids.subscriptions.action.skip(id)).click();
      await expect(page.locator(ids.subscriptions.confirm)).toBeVisible();
      await page.locator(ids.subscriptions.confirmOk).click();
      await expect(page.locator(ids.subscriptions.toast)).toBeVisible();
    });

    await test.step('Assert — บรรทัดคูปองหายจากการ์ด', async () => {
      await expect(page.locator(ids.subscriptions.couponLine(id))).toHaveCount(0);
    });

    await test.step('Assert — ★ ฐานข้อมูล ★ ใบจองเป็น released พร้อมเหตุผล และโควตากลับมาเป็น 0', async () => {
      const rows = await redemptionsOf(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('released');
      expect(rows[0]!.released_reason).toBe('cycle_changed');
      expect(rows[0]!.in_use_count).toBe(0);
    });
  },
);

// ==========================================================
// Flow D — engine ใช้คูปองตอนตัดเงิน
// ==========================================================

testCase(
  { id: 'TC-113', priority: 'P0', feature: FEATURE },
  'engine ตัดเงินยอดหลังลดของรอบที่จองคูปองไว้ และรันซ้ำไม่ใช้คูปองซ้ำ',
  async ({ page }) => {
    const id = SUBSCRIPTIONS.coffeeMonthly.id;
    let cycleDate = '';

    await test.step('Arrange — จองคูปองใบเดิมกับรอบใหม่ (พิสูจน์ว่าคืนแล้วจองใหม่ได้)', async () => {
      await loginAs(page, 'buyer');
      cycleDate = await nextOrderDateOf(id);
      await gotoApp(page, '/subscriptions');
      await applyCouponThroughUi(page, id, COUPONS.percent20.id);
    });

    await test.step('Act — สั่ง engine รันที่วันตัดรอบนั้น (time-travel ของผู้ดูแล)', async () => {
      const admin = await apiLogin(USERS.admin.email, DEMO_PASSWORD);
      await post('/admin/engine/run', admin.accessToken, { runDate: cycleDate });
    });

    await test.step('Assert — ★ ฐานข้อมูล ★ ยอดที่ตัดจริงคือยอดหลังลด และใบจองเป็น consumed', async () => {
      const [order] = await queryTestDatabase<{
        amount: string;
        discount_amount: string;
        platform_redemption_id: string | null;
        paid: string | null;
        redemption_status: string | null;
      }>(
        `select o.amount::text,
                o.discount_amount::text,
                o.platform_redemption_id,
                p.amount::text as paid,
                r.status as redemption_status
           from orders o
           left join payments p on p.order_id = o.id
           left join coupon_redemptions r on r.id = o.platform_redemption_id
          where o.subscription_id = $1 and o.cycle_date = $2::date`,
        [id, cycleDate],
      );
      expect(order, 'engine ต้องสร้างออเดอร์ของรอบนั้น').toBeDefined();
      // ฿255 − 20% = ฿204 · ยอดก่อนลด = amount + discount_amount เสมอ
      expect(Number(order!.amount)).toBe(204);
      expect(Number(order!.discount_amount)).toBe(51);
      expect(Number(order!.amount) + Number(order!.discount_amount)).toBe(255);
      // ★ เงินที่เคลื่อนไหวจริงต้องตรงกับยอดหลังลด ไม่ใช่ราคาป้าย ★
      expect(Number(order!.paid)).toBe(204);
      expect(order!.platform_redemption_id).not.toBeNull();
      expect(order!.redemption_status).toBe('consumed');
    });

    await test.step('Act/Assert — รันซ้ำวันเดิม 2 ครั้ง → ออเดอร์ใบเดียว คูปองถูกใช้ครั้งเดียว', async () => {
      const admin = await apiLogin(USERS.admin.email, DEMO_PASSWORD);
      await post('/admin/engine/run', admin.accessToken, { runDate: cycleDate });
      await post('/admin/engine/run', admin.accessToken, { runDate: cycleDate });

      const [row] = await queryTestDatabase<{ orders: string; used: string }>(
        `select (select count(*)::text from orders
                  where subscription_id = $1 and cycle_date = $2::date) as orders,
                (select count(*)::text from coupon_redemptions
                  where subscription_id = $1 and status = 'consumed') as used`,
        [id, cycleDate],
      );
      // idempotency มาจาก UNIQUE(subscription_id, cycle_date) — คูปองได้ตามไปด้วยฟรี ๆ
      expect(Number(row!.orders)).toBe(1);
      expect(Number(row!.used)).toBe(1);
    });
  },
);

testCase(
  { id: 'TC-114', priority: 'P1', feature: FEATURE },
  'หน้าออเดอร์และใบเสร็จแสดงส่วนลดของรอบนั้นแยกจากยอดที่ตัดจริง',
  async ({ page }) => {
    let orderId = '';

    await test.step('Arrange — หาออเดอร์ที่ใช้คูปองไปแล้ว (จาก TC-113)', async () => {
      const [row] = await queryTestDatabase<{ id: string }>(
        'select id from orders where discount_amount > 0 order by created_at desc limit 1',
      );
      expect(row, 'ต้องมีออเดอร์ที่ใช้คูปอง').toBeDefined();
      orderId = row!.id;
      await loginAs(page, 'buyer');
    });

    await test.step('Act — เปิดหน้าออเดอร์ใบนั้น', async () => {
      await gotoApp(page, `/orders/${orderId}`);
      await expect(page.locator(ids.orders.discount)).toBeVisible();
    });

    await test.step('Assert — บอกทั้งโค้ดคูปอง ยอดที่ลด และยอดก่อนลด', async () => {
      const line = page.locator(ids.orders.discount);
      await expect(line).toContainText(COUPONS.percent20.code);
      await expect(line).toContainText('฿51');
      await expect(line).toContainText('฿255');
    });

    await test.step('Assert — ใบเสร็จจำลองแยกบรรทัดส่วนลดออกจากยอดรวม', async () => {
      await page.locator(ids.orders.receiptOpen).click();
      await expect(page.locator(ids.orders.receiptDiscount)).toContainText('฿51');
      await expect(page.locator(ids.orders.receiptAmount)).toContainText('฿204');
      await page.locator(ids.orders.receiptClose).click();
    });
  },
);

testCase(
  { id: 'TC-115', priority: 'P1', feature: FEATURE },
  'ผู้ดูแลปิดคูปองได้ และคูปองที่ปิดแล้วหายจากตัวเลือกของร้าน',
  async ({ page }) => {
    let couponId = '';

    await test.step('Arrange — ล็อกอินเป็นผู้ดูแลแล้วหาใบที่เทสออกไว้ใน TC-106', async () => {
      const [row] = await queryTestDatabase<{ id: string }>(
        'select id from coupons where code = $1',
        [NEW_CODE],
      );
      expect(row, 'ต้องมีคูปองจาก TC-106').toBeDefined();
      couponId = row!.id;
      await loginAs(page, 'admin');
      await gotoApp(page, '/(admin)/coupons');
    });

    await test.step('Act — กดปิดคูปอง', async () => {
      await page.locator(ids.admin.couponDeactivate(couponId)).click();
      await expect(page.locator(ids.admin.couponsToast)).toBeVisible();
    });

    await test.step('Assert — ★ ฐานข้อมูล ★ is_active เป็น false (ไม่ใช่ถูกลบทิ้ง)', async () => {
      const [row] = await queryTestDatabase<{ n: string; active: boolean }>(
        'select count(*) over ()::text as n, is_active as active from coupons where id = $1',
        [couponId],
      );
      // ★ ห้ามหายไปจากตาราง ★ ออเดอร์ในอดีตต้องชี้กลับมาหาได้เสมอ
      expect(Number(row!.n)).toBe(1);
      expect(row!.active).toBe(false);
    });

    await test.step('Assert — ร้านไม่เห็นใบที่ปิดแล้วในรายการให้เข้าร่วม', async () => {
      // ★ ต้องล้าง access token ของผู้ดูแลก่อน ★ `loginAs` เปลี่ยนแค่ refresh
      // cookie — ถ้าไม่ล้าง แอปจะบูตด้วย token เดิมแล้วเปิดหน้าร้านในฐานะผู้ดูแล
      // (ซึ่งมีร้านของตัวเองที่ไม่มีสินค้าชิ้นนี้) แล้วเคสจะแดงแบบหาสาเหตุไม่เจอ
      await page.evaluate(() => window.localStorage.clear());
      await page.context().clearCookies();
      await loginAs(page, 'seller');
      await gotoApp(page, `/(seller)/products/${SHOPS.beanStory.coffeeProductId}`);
      await expect(page.locator(ids.sellerEdit.couponsCard)).toBeVisible();
      await expect(page.locator(ids.sellerEdit.coupon(couponId))).toHaveCount(0);
    });
  },
);

// ==========================================================
// คูปอง 2 ระดับ (feature 18 รอบ 2) — ร้านออกคูปองเอง + ซ้อนกับของแพลตฟอร์ม
// ==========================================================

testCase(
  { id: 'TC-116', priority: 'P1', feature: FEATURE },
  'ร้านออกคูปองของตัวเองจากหน้าจอได้ และผูกกับร้านผู้เรียกเสมอ',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินเป็นร้านแล้วเปิดหน้าคูปองของร้าน', async () => {
      await loginAs(page, 'seller');
      await gotoApp(page, '/(seller)/coupons');
      await expect(page.locator(ids.sellerCoupons.create)).toBeVisible();
    });

    await test.step('Assert — เห็นคูปองที่ร้านออกไว้แล้วใน seed', async () => {
      await expect(
        page.locator(ids.sellerCoupons.item(COUPONS.shopBean10.id)),
      ).toContainText(COUPONS.shopBean10.code);
    });

    await test.step('Act — ออกคูปองใหม่แบบใช้ได้ทั้งร้าน', async () => {
      await page.locator(ids.sellerCoupons.code).fill(SHOP_CODE);
      await page.locator(ids.sellerCoupons.title).fill('คูปองร้านจากเทส L4');
      await page.locator(ids.sellerCoupons.value).fill('5');
      await page.locator(ids.sellerCoupons.ends).fill('2027-12-31');
      await page.locator(ids.sellerCoupons.scope('all')).click();
      await page.locator(ids.sellerCoupons.create).click();
      await expect(page.locator(ids.sellerCoupons.toast)).toBeVisible();
    });

    await test.step('Assert — ★ ฐานข้อมูล ★ tier = shop และ shop_id เป็นร้านของผู้เรียก', async () => {
      const [row] = await queryTestDatabase<{
        tier: string;
        shop_id: string | null;
        applies_to_all_products: boolean;
        in_use_count: number;
      }>(
        `select tier, shop_id, applies_to_all_products, in_use_count
           from coupons where code = $1`,
        [SHOP_CODE],
      );
      expect(row, 'ต้องมีคูปองของร้านในฐานข้อมูล').toBeDefined();
      expect(row!.tier).toBe('shop');
      expect(row!.shop_id).toBe(SHOPS.beanStory.id);
      expect(row!.applies_to_all_products).toBe(true);
      // ★ โควตาขยับได้จากการจองเท่านั้น ★ ไม่ใช่จากค่าที่ฟอร์มส่งมา
      expect(row!.in_use_count).toBe(0);
    });
  },
);

testCase(
  { id: 'TC-118', priority: 'P0', feature: FEATURE },
  '★ ซ้อนคูปอง 2 ระดับในรอบเดียว — ยอดคิดจากยอดเต็มทั้งคู่แล้วรวม ★',
  async ({ page }) => {
    const id = SUBSCRIPTIONS.coffeeMonthly.id;

    await test.step('Arrange — ออกคูปองแพลตฟอร์มใบใหม่ (ใบเดิมถูกใช้ไปแล้วใน TC-113)', async () => {
      // ★ 1 คน 1 คูปอง ★ ผู้ซื้อคนนี้ใช้ NEWROUND20 ไปแล้ว จึงต้องมีใบใหม่
      // เพื่อทดสอบการซ้อน — ส่วนคูปองร้าน BEAN10 ยังว่างอยู่
      const admin = await apiLogin(USERS.admin.email, DEMO_PASSWORD);
      const created = await post<{ id: string }>('/admin/coupons', admin.accessToken, {
        code: STACK_CODE,
        title: 'คูปองแพลตฟอร์มสำหรับเทสซ้อน',
        discountType: 'percent',
        discountValue: 20,
        startsAt: new Date(Date.now() - 3_600_000).toISOString(),
        endsAt: '2027-12-31T23:59:59+07:00',
      });
      stackCouponId = created.id;

      const seller = await apiLogin(USERS.seller.email, DEMO_PASSWORD);
      const enrolled = await queryTestDatabase<{ coupon_id: string }>(
        'select coupon_id from coupon_products where product_id = $1',
        [SHOPS.beanStory.coffeeProductId],
      );
      await put(
        `/seller/products/${SHOPS.beanStory.coffeeProductId}/coupons`,
        seller.accessToken,
        {
          couponIds: [...enrolled.map((e) => e.coupon_id), stackCouponId],
          couponPolicy: 'both',
        },
      );
    });

    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อแล้วเปิดหน้ารายการของฉัน', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
      await expect(page.locator(ids.subscriptions.item(id))).toBeVisible();
    });

    await test.step('Act — จองคูปองแพลตฟอร์มแล้วจองคูปองร้านต่อในรอบเดียวกัน', async () => {
      await page.locator(ids.subscriptions.action.coupon(id)).click();
      await expect(page.locator(ids.subscriptions.couponModal)).toBeVisible();
      await page.locator(ids.subscriptions.couponOption(stackCouponId)).click();
      await expect(
        page.locator(ids.subscriptions.couponApplied('platform')),
      ).toBeVisible();
      await page
        .locator(ids.subscriptions.couponOption(COUPONS.shopBean10.id))
        .click();
      await expect(
        page.locator(ids.subscriptions.couponApplied('shop')),
      ).toBeVisible();
    });

    await test.step('Assert — ยอดรวมบนกล่องมาจาก server (255 − 51 − 25.5)', async () => {
      // ★ ถ้าคิดต่อยอดจะได้ 51 + 20.40 = 71.40 ★ เลขนี้จึงพิสูจน์สูตรที่ใช้จริง
      await expect(page.locator(ids.subscriptions.couponTotal)).toContainText(
        '178.5',
      );
      await page.locator(ids.subscriptions.couponClose).click();
      await expect(page.locator(ids.subscriptions.couponLine(id))).toContainText(
        COUPONS.shopBean10.code,
      );
    });

    await test.step('Assert — ★ ฐานข้อมูล ★ 2 ใบ คนละระดับ ในรอบเดียวกัน', async () => {
      const rows = await queryTestDatabase<{ tier: string; cycle_date: string }>(
        `select tier, cycle_date::text as cycle_date
           from coupon_redemptions
          where subscription_id = $1 and status = 'reserved'
          order by tier`,
        [id],
      );
      expect(rows.map((r) => r.tier)).toEqual(['platform', 'shop']);
      expect(rows[0]!.cycle_date).toBe(rows[1]!.cycle_date);
    });
  },
);

testCase(
  { id: 'TC-119', priority: 'P0', feature: FEATURE },
  '★ engine ตัดเงินยอดหลังลดของทั้งสองระดับ และใบเสร็จแยกรายใบ ★',
  async ({ page }) => {
    const id = SUBSCRIPTIONS.coffeeMonthly.id;
    let cycleDate = '';
    let orderId = '';

    await test.step('Arrange — อ่านวันรอบที่จองคูปองไว้จาก TC-118', async () => {
      const [row] = await queryTestDatabase<{ d: string | null }>(
        'select next_order_date::text as d from subscriptions where id = $1',
        [id],
      );
      cycleDate = row!.d as string;
    });

    await test.step('Act — สั่ง engine รันที่วันตัดรอบนั้น', async () => {
      const admin = await apiLogin(USERS.admin.email, DEMO_PASSWORD);
      await post('/admin/engine/run', admin.accessToken, { runDate: cycleDate });
    });

    await test.step('Assert — ★ ฐานข้อมูล ★ ยอดที่ตัดจริง = 255 − 76.50 และสองใบรวมกันเท่ากับส่วนลด', async () => {
      const [order] = await queryTestDatabase<{
        id: string;
        amount: string;
        discount_amount: string;
        paid: string | null;
        platform_amount: string | null;
        shop_amount: string | null;
        platform_status: string | null;
        shop_status: string | null;
      }>(
        `select o.id,
                o.amount::text,
                o.discount_amount::text,
                p.amount::text           as paid,
                rp.discount_amount::text as platform_amount,
                rs.discount_amount::text as shop_amount,
                rp.status                as platform_status,
                rs.status                as shop_status
           from orders o
           left join payments p            on p.order_id = o.id
           left join coupon_redemptions rp on rp.id = o.platform_redemption_id
           left join coupon_redemptions rs on rs.id = o.shop_redemption_id
          where o.subscription_id = $1 and o.cycle_date = $2::date`,
        [id, cycleDate],
      );
      expect(order, 'engine ต้องสร้างออเดอร์ของรอบนั้น').toBeDefined();
      orderId = order!.id;

      expect(Number(order!.amount)).toBe(178.5);
      expect(Number(order!.discount_amount)).toBe(76.5);
      expect(Number(order!.platform_amount)).toBe(51);
      expect(Number(order!.shop_amount)).toBe(25.5);
      // ★ invariant ของใบเสร็จ ★ สองใบรวมกัน = ส่วนลดของออเดอร์
      expect(Number(order!.platform_amount) + Number(order!.shop_amount)).toBe(
        Number(order!.discount_amount),
      );
      // ★ เงินที่เคลื่อนไหวจริงต้องตรงกับยอดหลังลด ★
      expect(Number(order!.paid)).toBe(178.5);
      expect(order!.platform_status).toBe('consumed');
      expect(order!.shop_status).toBe('consumed');
    });

    await test.step('Assert — ใบเสร็จบนหน้าจอแยกส่วนลดรายใบ', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, `/orders/${orderId}`);
      await expect(page.locator(ids.orders.discount)).toContainText(STACK_CODE);
      await expect(page.locator(ids.orders.discount)).toContainText(
        COUPONS.shopBean10.code,
      );
      await page.locator(ids.orders.receiptOpen).click();
      await expect(page.locator(ids.orders.receiptAmount)).toContainText(
        '178.5',
      );
      await page.locator(ids.orders.receiptClose).click();
    });
  },
);

testCase(
  { id: 'TC-120', priority: 'P0', feature: FEATURE },
  '★ นโยบายรายสินค้าปิดระดับได้จริง — และยิง API ตรงข้าม UI ก็ยังถูกปฏิเสธ ★',
  async ({ page }) => {
    // P(2) กาแฟคั่วเข้ม ถูก seed ตั้งเป็น `platform_only`
    const productId = COUPON_POLICIES.platformOnlyProductId;
    let subscriptionId = '';

    await test.step('Arrange — สมัครสินค้าที่ร้านปิดคูปองระดับร้านไว้', async () => {
      const buyer = await apiLogin(USERS.buyer.email, DEMO_PASSWORD);
      const [plan] = await queryTestDatabase<{ id: string }>(
        `select id from product_plans
          where product_id = $1 and is_active
          order by price_per_cycle desc limit 1`,
        [productId],
      );
      const created = await post<{ subscription: { id: string } }>(
        '/subscriptions',
        buyer.accessToken,
        {
          planId: plan!.id,
          quantity: 1,
          addressId: ADDRESSES.work.id,
          paymentMethodId: '50000000-0000-4000-8000-000000000001',
          startDate: tomorrowISO(),
        },
      );
      subscriptionId = created.subscription.id;
    });

    await test.step('Assert — ช่องคูปองร้านถูกปิดพร้อมเหตุผลบนหน้าจอ', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
      await page.locator(ids.subscriptions.action.coupon(subscriptionId)).click();
      await expect(page.locator(ids.subscriptions.couponModal)).toBeVisible();
      await expect(
        page.locator(ids.subscriptions.couponTierBlocked('shop')),
      ).toContainText('เฉพาะคูปองของแพลตฟอร์ม');
      await page.locator(ids.subscriptions.couponClose).click();
    });

    await test.step('Assert — ★ ปุ่มที่ซ่อนไม่ใช่ security ★ ยิง API ตรง → 409', async () => {
      const buyer = await apiLogin(USERS.buyer.email, DEMO_PASSWORD);
      const res = await fetch(
        `${apiBaseUrl()}/subscriptions/${subscriptionId}/coupon`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${buyer.accessToken}`,
          },
          body: JSON.stringify({ couponId: COUPONS.shopBean10.id }),
        },
      );
      expect(res.status).toBe(409);

      const [row] = await queryTestDatabase<{ n: string }>(
        'select count(*)::text as n from coupon_redemptions where subscription_id = $1',
        [subscriptionId],
      );
      expect(Number(row!.n)).toBe(0);
    });
  },
);

// ==========================================================
// ปฏิทินเลือกวันของฟอร์มออกคูปอง (`anan/src/components/DateField.tsx`)
// ==========================================================

/** โค้ดคูปองของเคสปฏิทิน — ต้องไม่ชน UNIQUE กับรอบก่อนหน้า */
const PICKER_CODE = `E2ECAL${String(Date.now()).slice(-6)}`;

testCase(
  { id: 'TC-124', priority: 'P1', feature: FEATURE },
  'ร้านเลือก "ใช้ได้ถึง" จากปฏิทินได้ และวันที่ถูกบันทึกตรงกับวันที่กด',
  async ({ page }) => {
    // เลือกวันที่ 15 ของอีก 2 เดือนข้างหน้า — ไกลกว่า `endsMin` (วันพรุ่งนี้) เสมอ
    // ไม่ว่าจะรันเทสวันไหนของเดือน จึงไม่มีวันโดนปิดใช้งานในปฏิทิน
    // ปฏิทินเปิดที่เดือนของ `endsMin` = "พรุ่งนี้" ตามเวลาไทย จึงต้องนับจากวันนั้น
    // ไม่ใช่จากวันนี้ — ไม่งั้นการรันในวันสุดท้ายของเดือนจะเลื่อนไปคนละเดือน
    const tomorrow = new Date(Date.now() + 7 * 60 * 60 * 1000 + 86_400_000);
    const target = new Date(
      Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 2, 15),
    );
    const targetISO = target.toISOString().slice(0, 10);

    await test.step('Arrange — ล็อกอินเป็นร้านแล้วเปิดหน้าคูปองของร้าน', async () => {
      await loginAs(page, 'seller');
      await gotoApp(page, '/(seller)/coupons');
      await expect(page.locator(ids.sellerCoupons.create)).toBeVisible();
    });

    await test.step('Act — กรอกคูปอง แล้วเลือกวันหมดอายุจากปฏิทิน (ไม่พิมพ์เอง)', async () => {
      await page.locator(ids.sellerCoupons.code).fill(PICKER_CODE);
      await page.locator(ids.sellerCoupons.title).fill('คูปองเลือกวันจากปฏิทิน');
      await page.locator(ids.sellerCoupons.value).fill('5');

      await page.locator(ids.sellerCoupons.endsOpen).click();
      await expect(page.locator(ids.sellerCoupons.endsCalendar)).toBeVisible();
      // ปฏิทินเปิดที่เดือนของ `endsMin` — เดินไปข้างหน้า 2 เดือนให้ถึงเดือนเป้าหมาย
      await page.locator(ids.sellerCoupons.endsNextMonth).click();
      await page.locator(ids.sellerCoupons.endsNextMonth).click();
      await page.locator(ids.sellerCoupons.endsDay(targetISO)).click();

      // ปฏิทินต้องปิดเอง และค่าที่เลือกเด้งกลับเข้าช่องกรอกเป็น YYYY-MM-DD
      await expect(page.locator(ids.sellerCoupons.endsCalendar)).toBeHidden();
      await expect(page.locator(ids.sellerCoupons.ends)).toHaveValue(targetISO);

      await page.locator(ids.sellerCoupons.scope('all')).click();
      await page.locator(ids.sellerCoupons.create).click();
      await expect(page.locator(ids.sellerCoupons.toast)).toBeVisible();
    });

    await test.step('Assert — ★ ฐานข้อมูล ★ ends_at เป็นสิ้นวันตามเวลาไทยของวันที่กด', async () => {
      const [row] = await queryTestDatabase<{ ends_day: string }>(
        `select to_char(ends_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') as ends_day
           from coupons where code = $1`,
        [PICKER_CODE],
      );
      expect(row, 'ต้องมีคูปองที่สร้างจากปฏิทินในฐานข้อมูล').toBeDefined();
      expect(row!.ends_day).toBe(targetISO);
    });
  },
);
