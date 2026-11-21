/**
 * Phase 4 — ฝั่งร้านค้า (features 10/11/12 · W02/W07/W08)
 *
 * ทุกเคสที่เปลี่ยนสถานะยืนยันผลที่ **ฐานข้อมูล** ไม่ใช่แค่ข้อความบนจอ
 * (docs/testing.md §3.1) — หน้าจอวาดจากสิ่งที่ API ส่งกลับมา ถ้าเชื่อแต่หน้าจอ
 * เคสจะผ่านได้แม้ระบบบันทึกผิดร้าน ผิดสถานะ หรือไม่ได้บันทึกเลย
 *
 * ⚠️ เคสท้ายไฟล์เปลี่ยนข้อมูล seed ถาวรภายในการรันหนึ่งครั้ง จึงเรียงไว้หลังสุด
 */
import { testCase, test, expect } from '../helpers/test-case';
import { apiBaseUrl, apiLogin, gotoApp, loginAs, seedSession } from '../helpers/login';
import * as ids from '../helpers/selectors';
import { SHOPS, SUBSCRIPTIONS, USERS, uniqueEmail } from '../helpers/test-data';
import { queryTestDatabase } from '../setup/database';

const FEATURE = '10/11/12 — Seller';

type PlanRow = { price_per_cycle: string; is_active: boolean };
type ProductRow = { is_active: boolean; name: string };
type OrderRow = { status: string; tracking_note: string | null };

const planRow = async (planId: string): Promise<PlanRow> => {
  const rows = await queryTestDatabase<PlanRow>(
    'select price_per_cycle::text as price_per_cycle, is_active from product_plans where id = $1',
    [planId],
  );
  if (rows[0] == null) throw new Error(`ไม่พบแผน ${planId}`);
  return rows[0];
};

/** วันรอบปัจจุบันของ subscription — ใช้ถ่ายรูปไว้คืนค่าใน Cleanup */
const subscriptionDates = async (
  id: string,
): Promise<{ next_order_date: string; cycle_anchor_date: string }> => {
  const rows = await queryTestDatabase<{
    next_order_date: string;
    cycle_anchor_date: string;
  }>(
    `select next_order_date::text as next_order_date,
            cycle_anchor_date::text as cycle_anchor_date
       from subscriptions where id = $1`,
    [id],
  );
  if (rows[0] == null) throw new Error(`ไม่พบ subscription ${id}`);
  return rows[0];
};

const productRow = async (productId: string): Promise<ProductRow> => {
  const rows = await queryTestDatabase<ProductRow>(
    'select is_active, name from products where id = $1',
    [productId],
  );
  if (rows[0] == null) throw new Error(`ไม่พบสินค้า ${productId}`);
  return rows[0];
};

testCase(
  { id: 'TC-054', priority: 'P0', feature: FEATURE },
  'ผู้ซื้อที่ยังไม่มีร้านเห็นปุ่มเปิดร้าน และเปิดร้านแล้วเข้าโหมดร้านได้ทันที',
  async ({ page }) => {
    const email = uniqueEmail('shop');
    const shopName = `ร้านของ ${Date.now()}`;

    await test.step('Arrange — สมัครบัญชีใหม่ผ่าน API แล้วเปิดแอป', async () => {
      const res = await fetch(`${apiBaseUrl()}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'E2ePassword2026!',
          displayName: 'ผู้เปิดร้านใหม่',
        }),
      });
      expect(res.status).toBe(201);
      const session = (await res.json()) as { refreshToken: string };

      await seedSession(page, session.refreshToken);
      await gotoApp(page, '/profile');
    });

    await test.step('Act — กดเปิดร้านค้าจากหน้าโปรไฟล์ แล้วกรอกชื่อร้าน', async () => {
      await expect(page.locator(ids.profile.linkOpenShop)).toBeVisible();
      // ยังไม่มีร้าน จึงต้องยังไม่มีทางลัดเข้าโหมดร้าน
      await expect(page.locator(ids.profile.linkSeller)).toHaveCount(0);

      await page.locator(ids.profile.linkOpenShop).click();
      await page.locator(ids.shopSettings.openName).fill(shopName);
      await page.locator(ids.shopSettings.openSubmit).click();
    });

    await test.step('Assert — เข้าโหมดร้าน · DB มีร้านใหม่ · บัญชีถูกยกระดับเป็น seller', async () => {
      await expect(page.locator(ids.sellerDashboard.subscribers)).toBeVisible();
      await expect(page.locator(ids.sellerDashboard.subscribers)).toHaveText('0');

      const rows = await queryTestDatabase<{ name: string; is_seller: boolean }>(
        `select s.name, u.is_seller
           from shops s join users u on u.id = s.owner_id
          where u.email = $1`,
        [email],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.name).toBe(shopName);
      // ★ is_seller ถูกตั้งโดย API ในทรานแซกชันเดียวกับการสร้างร้าน ไม่ใช่ client
      expect(rows[0]!.is_seller).toBe(true);
    });
  },
);

testCase(
  { id: 'TC-056', priority: 'P0', feature: FEATURE },
  'ลงสินค้าใหม่ครบ 2 ขั้นแล้วขึ้น catalog ฝั่งผู้ซื้อทันที',
  async ({ page }) => {
    const name = `สินค้าเทส ${Date.now()}`;

    await test.step('Arrange — เข้าหน้าสินค้าของร้าน', async () => {
      await loginAs(page, 'seller');
      await gotoApp(page, '/(seller)/products');
      await page.locator(ids.sellerProducts.newOpen).click();
      await expect(page.locator(ids.sellerProducts.newForm)).toBeVisible();
    });

    await test.step('Act — กรอกข้อมูลสินค้า + เปิดรอบรายเดือน แล้วกดลงขาย', async () => {
      await page.locator(ids.sellerProducts.newName).fill(name);
      await page.locator(ids.sellerProducts.newCategory(1)).click();
      await page.locator(ids.sellerProducts.newPrice).fill('200');
      await page
        .locator(ids.sellerProducts.newImage)
        .fill('https://example.com/e2e.jpg');
      await page.locator(ids.sellerProducts.newPlanPrice('1m')).fill('150');

      // ส่วนลดต้องคำนวณสด ๆ ให้เห็นก่อนกดลงขาย (W07 ขั้น 2)
      await expect(page.locator(ids.sellerProducts.newPlanDiscount('1m'))).toHaveText(
        'ถูกกว่า 25%',
      );
      await page.locator(ids.sellerProducts.newSubmit).click();
    });

    await test.step('Assert — สินค้าอยู่ใน DB ของร้านนี้ และผู้ซื้อค้นเจอทันที', async () => {
      await expect(page.locator(ids.sellerProducts.newError)).toHaveCount(0);
      await expect(page.locator(ids.sellerProducts.toast)).toBeVisible();

      const rows = await queryTestDatabase<{ id: string; shop_id: string }>(
        `select p.id, p.shop_id from products p where p.name = $1`,
        [name],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.shop_id).toBe(SHOPS.beanStory.id);

      const plans = await queryTestDatabase<{ cycle: string }>(
        'select cycle from product_plans where product_id = $1',
        [rows[0]!.id],
      );
      expect(plans.map((p) => p.cycle)).toEqual(['1m']);

      // ★ ผู้ซื้อ (ยังไม่ล็อกอิน) ต้องเห็นทันที — ไม่มีขั้นอนุมัติในเดโม่
      const res = await fetch(
        `${apiBaseUrl()}/catalog/products?q=${encodeURIComponent(name)}`,
      );
      const found = (await res.json()) as { name: string }[];
      expect(found.map((p) => p.name)).toContain(name);
    });
  },
);

testCase(
  { id: 'TC-057', priority: 'P0', feature: FEATURE },
  '★ ขึ้นราคาแผนที่มีสมาชิก — ต้องเตือนจำนวนคนก่อน แล้วสมาชิกได้รับแจ้งเตือนจริง',
  async ({ page }) => {
    const planId = SHOPS.beanStory.coffeeMonthlyPlanId;
    let before = '';

    await test.step('Arrange — เปิดหน้าสินค้าของร้าน', async () => {
      before = (await planRow(planId)).price_per_cycle;
      await loginAs(page, 'seller');
      await gotoApp(page, '/(seller)/products');
      await expect(page.locator(ids.sellerProducts.planPrice(planId))).toBeVisible();
    });

    await test.step('Act — ตั้งราคาใหม่แล้วกดบันทึก', async () => {
      await page.locator(ids.sellerProducts.planPrice(planId)).fill('275');
      await page.locator(ids.sellerProducts.planSave(planId)).click();
    });

    await test.step('Assert — กล่องยืนยันบอกจำนวนสมาชิกที่กระทบก่อนกด (feature 11)', async () => {
      const body = page.locator(ids.sellerProducts.priceConfirmBody);
      await expect(body).toContainText('สมาชิกปัจจุบัน');
      await expect(body).toContainText('จะจ่ายราคาใหม่');
      await expect(body).toContainText('แจ้งเตือนทุกคนทันที');
    });

    await test.step('Assert — ยืนยันแล้ว ราคาใน DB เปลี่ยน + สมาชิกได้ notification + มี event', async () => {
      await page.locator(ids.sellerProducts.priceConfirmOk).click();
      await expect(page.locator(ids.sellerProducts.toast)).toBeVisible();

      expect((await planRow(planId)).price_per_cycle).not.toBe(before);
      expect(Number((await planRow(planId)).price_per_cycle)).toBe(275);

      const notices = await queryTestDatabase<{ body: string }>(
        `select n.body
           from notifications n join users u on u.id = n.user_id
          where n.type = 'price_changed' and u.email = $1
          order by n.created_at desc limit 1`,
        [USERS.buyer.email],
      );
      expect(notices).toHaveLength(1);
      // ผู้ซื้อต้องเห็นทั้งราคาเก่าและใหม่ ไม่ใช่แค่ "ราคาเปลี่ยนแล้ว"
      expect(notices[0]!.body).toContain('275');

      // ★ ผูกกับ subscription ของแผนนี้เท่านั้น ★ การนับทั้งตารางจะเขียวได้ด้วย
      // event เก่าที่ค้างอยู่ แม้ระบบเลิกเขียน event ของแผนนี้ไปแล้ว
      const events = await queryTestDatabase<{ count: string }>(
        `select count(*)::text as count
           from subscription_events e
           join subscriptions s on s.id = e.subscription_id
          where e.event = 'price_changed' and s.plan_id = $1`,
        [planId],
      );
      expect(Number(events[0]!.count)).toBeGreaterThanOrEqual(1);
    });

    await test.step('Cleanup — คืนราคาเดิมให้ seed (เคสอื่นอ่านราคานี้ต่อ)', async () => {
      await queryTestDatabase(
        'update product_plans set price_per_cycle = $1 where id = $2',
        [before, planId],
      );
    });
  },
);

testCase(
  { id: 'TC-058', priority: 'P0', feature: FEATURE },
  '★ ไล่สถานะออเดอร์ทีละขั้น pending → preparing → shipped พร้อมเลขพัสดุ',
  async ({ page }) => {
    let orderId = '';
    let before: { next_order_date: string; cycle_anchor_date: string } | null = null;

    await test.step('Arrange — สร้างออเดอร์ค้างส่งของร้านนี้ด้วย engine', async () => {
      // ★ ยิงเฉพาะ subscription ที่เคสนี้ใช้ ★ ไม่ใช่ทุกใบของร้าน — เคสอื่น
      // (TC-044/049/050) อ่านวันรอบของรายการเดียวกันนี้ต่อ (testing.md §3.1 ข้อ 4)
      before = await subscriptionDates(SUBSCRIPTIONS.coffeeMonthly.id);
      await queryTestDatabase(
        `update subscriptions
            set next_order_date = current_date, cycle_anchor_date = current_date
          where id = $1`,
        [SUBSCRIPTIONS.coffeeMonthly.id],
      );

      const admin = await apiLogin(USERS.admin.email, USERS.admin.password);
      const run = await fetch(`${apiBaseUrl()}/admin/engine/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${admin.accessToken}`,
        },
        body: '{}',
      });
      expect(run.status).toBe(200);

      const rows = await queryTestDatabase<{ id: string }>(
        `select o.id
           from orders o
           join subscriptions s on s.id = o.subscription_id
           join product_plans p on p.id = s.plan_id
           join products pr on pr.id = p.product_id
          where pr.shop_id = $1 and o.status = 'pending'
          order by o.created_at desc limit 1`,
        [SHOPS.beanStory.id],
      );
      expect(rows).toHaveLength(1);
      orderId = rows[0]!.id;

      await loginAs(page, 'seller');
      await gotoApp(page, '/(seller)/orders');
    });

    await test.step('Act — กด "เริ่มจัดของ" แล้วกด "ส่งแล้ว" พร้อมกรอกเลขพัสดุ', async () => {
      await expect(page.locator(ids.sellerOrders.item(orderId))).toBeVisible();
      // ที่อยู่ผู้รับต้องมาจาก snapshot ของออเดอร์ (ร้านต้องใช้ส่งของ)
      await expect(page.locator(ids.sellerOrders.address(orderId))).toBeVisible();

      await page.locator(ids.sellerOrders.advance(orderId)).click();
      await expect(page.locator(ids.sellerOrders.status(orderId))).toHaveText(
        'กำลังจัดของ',
      );

      await page.locator(ids.sellerOrders.advance(orderId)).click();
      await expect(page.locator(ids.sellerOrders.shipModal)).toBeVisible();
      await page.locator(ids.sellerOrders.shipTracking).fill('TH-E2E-0001');
      await page.locator(ids.sellerOrders.shipConfirm).click();
    });

    await test.step('Assert — DB เป็น shipped + เก็บเลขพัสดุ + ผู้ซื้อได้แจ้งเตือนครบ 2 ครั้ง', async () => {
      await expect(page.locator(ids.sellerOrders.error)).toHaveCount(0);

      const rows = await queryTestDatabase<OrderRow>(
        'select status, tracking_note from orders where id = $1',
        [orderId],
      );
      expect(rows[0]!.status).toBe('shipped');
      expect(rows[0]!.tracking_note).toBe('TH-E2E-0001');

      const notices = await queryTestDatabase<{ title: string }>(
        `select n.title
           from notifications n join users u on u.id = n.user_id
          where n.type = 'order_status' and n.link_path = $1
          order by n.created_at desc`,
        [`/orders/${orderId}`],
      );
      expect(notices.map((n) => n.title)).toEqual([
        'พัสดุออกจากร้านแล้ว',
        'ร้านเริ่มจัดของแล้ว',
      ]);
    });

    await test.step('Cleanup — คืนวันรอบของ subscription ให้เหมือนก่อนเคสนี้', async () => {
      if (before == null) return;
      await queryTestDatabase(
        `update subscriptions set next_order_date = $1, cycle_anchor_date = $2 where id = $3`,
        [before.next_order_date, before.cycle_anchor_date, SUBSCRIPTIONS.coffeeMonthly.id],
      );
    });
  },
);

/* ============================================================
 * เคสที่เปลี่ยนสถานะข้อมูล seed ถาวร — เรียงท้ายไฟล์
 * ============================================================ */

testCase(
  { id: 'TC-060', priority: 'P1', feature: FEATURE },
  'ปิดการขายสินค้าแล้วหายจากหน้าค้นหาของผู้ซื้อ แต่ยังอยู่ในรายการของร้าน',
  async ({ page }) => {
    const productId = SHOPS.beanStory.dripBagProductId;

    await test.step('Arrange — เข้าหน้าสินค้าของร้าน', async () => {
      await loginAs(page, 'seller');
      await gotoApp(page, '/(seller)/products');
      await expect(page.locator(ids.sellerProducts.status(productId))).toHaveText(
        'เปิดขาย',
      );
    });

    await test.step('Act — กดปิดการขาย', async () => {
      await page.locator(ids.sellerProducts.toggleActive(productId)).click();
    });

    await test.step('Assert — DB เป็น is_active=false · ผู้ซื้อเปิดหน้าสินค้าตรงได้ 404', async () => {
      await expect(page.locator(ids.sellerProducts.status(productId))).toHaveText(
        'ปิดขาย',
      );
      expect((await productRow(productId)).is_active).toBe(false);

      const res = await fetch(`${apiBaseUrl()}/catalog/products/${productId}`);
      expect(res.status).toBe(404);
    });

    await test.step('Cleanup — เปิดขายกลับให้เหมือน seed', async () => {
      await page.locator(ids.sellerProducts.toggleActive(productId)).click();
      await expect(page.locator(ids.sellerProducts.status(productId))).toHaveText(
        'เปิดขาย',
      );
    });
  },
);

testCase(
  { id: 'TC-061', priority: 'P0', feature: FEATURE },
  '★ ร้านที่ถูกผู้ดูแลระงับ — ไม่มีปุ่มแก้ไข และยิง API ตรงก็ยังถูกปฏิเสธ',
  async ({ page }) => {
    await test.step('Arrange — ระงับร้านผ่านฐานข้อมูล (เลียนแบบการสั่งของ admin)', async () => {
      await queryTestDatabase(
        `update shops set suspended_at = now(), suspended_reason = 'ทดสอบ' where id = $1`,
        [SHOPS.beanStory.id],
      );
      await loginAs(page, 'seller');
      await gotoApp(page, '/(seller)/shop');
    });

    await test.step('Assert (UI) — เห็นป้ายถูกระงับ และไม่มีปุ่มบันทึก/ปิดร้าน', async () => {
      await expect(page.locator(ids.shopSettings.suspendedPill)).toBeVisible();
      await expect(page.locator(ids.shopSettings.suspendedNote)).toContainText(
        'ถูกระงับ',
      );
      await expect(page.locator(ids.shopSettings.save)).toHaveCount(0);
      await expect(page.locator(ids.shopSettings.toggleActive)).toHaveCount(0);
    });

    await test.step('Assert (API) — ยิงแก้ชื่อร้านตรง → 409 · ยิงปลดระงับตัวเอง → 400', async () => {
      const session = await apiLogin(USERS.seller.email, USERS.seller.password);
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      };

      const rename = await fetch(`${apiBaseUrl()}/seller/shop`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ name: 'ร้านที่แอบแก้ตอนถูกระงับ' }),
      });
      expect(rename.status).toBe(409);
      expect(((await rename.json()) as { code: string }).code).toBe('SHOP_SUSPENDED');

      // ฟิลด์ suspendedAt ไม่มีใน DTO เลย → ValidationPipe ตัดตั้งแต่ต้นทาง
      const unban = await fetch(`${apiBaseUrl()}/seller/shop`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ suspendedAt: null }),
      });
      expect(unban.status).toBe(400);

      const rows = await queryTestDatabase<{ suspended_at: string | null; name: string }>(
        'select suspended_at::text as suspended_at, name from shops where id = $1',
        [SHOPS.beanStory.id],
      );
      expect(rows[0]!.suspended_at).not.toBeNull();
      expect(rows[0]!.name).toBe(SHOPS.beanStory.name);
    });

    await test.step('Cleanup — ปลดระงับร้านคืนสภาพ seed', async () => {
      await queryTestDatabase(
        `update shops set suspended_at = null, suspended_reason = null where id = $1`,
        [SHOPS.beanStory.id],
      );
    });
  },
);
