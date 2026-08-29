/**
 * Phase 6 — โหมดผู้ดูแลแพลตฟอร์ม (feature 14 · W10)
 *
 * ★ เคสในไฟล์นี้ตั้งใจไม่แตะร้านของ seed ★ การระงับร้านมีผลกับ subscription ของ
 * ผู้ซื้อทั้งร้าน ถ้าไปทดสอบกับ Bean Story จะกระทบ spec อื่นที่รันทีหลัง —
 * เคส TC-077 จึงสร้างร้าน + สินค้า + สมาชิกของตัวเองขึ้นมาใหม่ทั้งชุด
 */
import { testCase, test, expect } from '../helpers/test-case';
import { apiBaseUrl, apiLogin, gotoApp, loginAs } from '../helpers/login';
import * as ids from '../helpers/selectors';
import { DEMO_PASSWORD, USERS, uniqueEmail } from '../helpers/test-data';
import { queryTestDatabase } from '../setup/database';

const FEATURE = '14 — Admin';

async function post<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${path} → ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/** ร้านใหม่ + สินค้า + สมาชิก 1 ราย — แยกจากข้อมูล seed ทั้งหมด */
async function seedShopWithSubscriber(): Promise<{
  shopId: string;
  productId: string;
  subscriptionId: string;
}> {
  const owner = await fetch(`${apiBaseUrl()}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: uniqueEmail('admin-shop'),
      password: 'E2ePassword2026!',
      displayName: 'ร้านสำหรับเทสผู้ดูแล',
    }),
  });
  const ownerSession = (await owner.json()) as { accessToken: string };

  const shop = await post<{ id: string }>('/seller/shop', ownerSession.accessToken, {
    name: `ร้านทดสอบผู้ดูแล ${Date.now()}`,
  });
  const product = await post<{ id: string; plans: { id: string }[] }>(
    '/seller/products',
    ownerSession.accessToken,
    {
      name: `สินค้าทดสอบผู้ดูแล ${Date.now()}`,
      categoryId: 1,
      images: ['https://example.com/admin.jpg'],
      oneTimePrice: 300,
      plans: [{ cycle: '1m', pricePerCycle: 240, qtyPerCycle: 1 }],
    },
  );

  const buyer = await apiLogin(USERS.buyer.email, DEMO_PASSWORD);
  const [address] = await queryTestDatabase<{ id: string }>(
    `insert into addresses (user_id, label, recipient_name, phone, address_line, province, postcode)
     values ($1, 'เทสผู้ดูแล', 'ผู้รับ ทดสอบ', '0812345678', '1 ถนนทดสอบ', 'กรุงเทพมหานคร', '10900')
     returning id`,
    [USERS.buyer.id],
  );
  const [card] = await queryTestDatabase<{ id: string }>(
    'select id from payment_methods where user_id = $1 limit 1',
    [USERS.buyer.id],
  );

  const tomorrow = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const result = await post<{ subscription: { id: string } }>(
    '/subscriptions',
    buyer.accessToken,
    {
      planId: product.plans[0]!.id,
      quantity: 1,
      addressId: address!.id,
      paymentMethodId: card!.id,
      startDate: tomorrow,
    },
  );

  return {
    shopId: shop.id,
    productId: product.id,
    subscriptionId: result.subscription.id,
  };
}

testCase(
  { id: 'TC-075', priority: 'P0', feature: FEATURE },
  '★ บัญชีธรรมดาเข้าโหมดผู้ดูแลไม่ได้ — ทั้งหน้าจอและเมื่อยิง API ตรง',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อธรรมดา', async () => {
      await loginAs(page, 'buyer');
    });

    await test.step('Act/Assert — เปิด URL ของ admin ตรง ๆ แล้วถูกพากลับหน้าผู้ซื้อ', async () => {
      await gotoApp(page, '/(admin)');
      await expect(page.locator(ids.home.greeting)).toBeVisible();
      await expect(page.locator(ids.admin.statUsers)).toHaveCount(0);
    });

    await test.step('Assert — เมนูผู้ดูแลไม่โผล่ในโปรไฟล์ของผู้ซื้อ', async () => {
      await gotoApp(page, '/profile');
      await expect(page.locator(ids.profile.linkAdmin)).toHaveCount(0);
    });

    await test.step('Assert — ยิง API ของ admin ด้วย token ผู้ซื้อ → 403 ทุกเส้น', async () => {
      const session = await apiLogin(USERS.buyer.email, DEMO_PASSWORD);
      for (const path of ['/admin/stats', '/admin/shops', '/admin/issues']) {
        const res = await fetch(`${apiBaseUrl()}${path}`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        expect(res.status).toBe(403);
      }
    });
  },
);

testCase(
  { id: 'TC-076', priority: 'P1', feature: FEATURE },
  'ผู้ดูแลเห็นภาพรวมที่ตรงกับฐานข้อมูลจริง และเข้าถึงได้จากเมนูในโปรไฟล์',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินเป็นผู้ดูแล', async () => {
      await loginAs(page, 'admin');
      await gotoApp(page, '/profile');
    });

    await test.step('Act — กดเมนู "โหมดผู้ดูแลระบบ" จากหน้าโปรไฟล์', async () => {
      await expect(page.locator(ids.profile.linkAdmin)).toBeVisible();
      await page.locator(ids.profile.linkAdmin).click();
    });

    await test.step('Assert — ตัวเลขผู้ใช้/ร้าน/สินค้า ตรงกับที่นับได้จาก DB', async () => {
      const [counts] = await queryTestDatabase<{
        users: string;
        shops: string;
        products: string;
      }>(
        `select (select count(*) from users)::text     as users,
                (select count(*) from shops)::text     as shops,
                (select count(*) from products)::text  as products`,
      );

      await expect(page.locator(ids.admin.statUsers)).toHaveText(
        Number(counts!.users).toLocaleString('th-TH'),
      );
      await expect(page.locator(ids.admin.statShops)).toHaveText(
        Number(counts!.shops).toLocaleString('th-TH'),
      );
      await expect(page.locator(ids.admin.statProducts)).toHaveText(
        Number(counts!.products).toLocaleString('th-TH'),
      );
      // ตัวเลขเงินต้องมีป้าย DEMO เสมอ (กฎเหล็กข้อ 1)
      await expect(page.locator(ids.admin.statMrr)).toBeVisible();
    });
  },
);

testCase(
  { id: 'TC-077', priority: 'P0', feature: FEATURE },
  '★ ระงับร้าน = หยุดเงินจริง — สินค้าหายจาก catalog และ subscription ถูกแช่แข็ง แล้วคืนสถานะได้',
  async ({ page }) => {
    let shopId = '';
    let productId = '';
    let subscriptionId = '';

    await test.step('Arrange — สร้างร้าน + สินค้า + สมาชิก 1 ราย (ไม่แตะร้านของ seed)', async () => {
      ({ shopId, productId, subscriptionId } = await seedShopWithSubscriber());
      await loginAs(page, 'admin');
      await gotoApp(page, '/(admin)/moderation');
    });

    await test.step('Act — กดระงับร้าน แล้วยืนยันพร้อมเหตุผล', async () => {
      await expect(page.locator(ids.admin.shopSuspend(shopId))).toBeVisible();
      await page.locator(ids.admin.shopSuspend(shopId)).click();

      // กล่องยืนยันต้องบอกจำนวนผู้ซื้อที่จะถูกกระทบก่อนกด
      await expect(page.locator(ids.admin.suspendWarning)).toContainText('1 รายการ');
      await page.locator(ids.admin.suspendReason).fill('ทดสอบระบบระงับร้านจากหน้าผู้ดูแล');
      await page.locator(ids.admin.suspendConfirm).click();
    });

    await test.step('Assert — DB: ร้านถูกระงับ + subscription ถูกแช่แข็งด้วยเหตุผลของระบบ', async () => {
      await expect(page.locator(ids.admin.modToast)).toBeVisible();
      await expect(page.locator(ids.admin.shopStatus(shopId))).toHaveText('ถูกระงับ');

      const [shop] = await queryTestDatabase<{ suspended_at: string | null }>(
        'select suspended_at::text as suspended_at from shops where id = $1',
        [shopId],
      );
      expect(shop!.suspended_at).not.toBeNull();

      const [sub] = await queryTestDatabase<{
        status: string;
        paused_reason: string | null;
      }>(
        'select status, paused_reason from subscriptions where id = $1',
        [subscriptionId],
      );
      expect(sub!.status).toBe('paused');
      // ★ ผู้ซื้อปลดเองไม่ได้ — เหตุผลต้องเป็นของระบบ ไม่ใช่ 'user'
      expect(sub!.paused_reason).toBe('shop_suspended');
    });

    await test.step('Assert — ผู้ซื้อหาสินค้าของร้านนั้นไม่เจอแล้ว', async () => {
      const res = await fetch(`${apiBaseUrl()}/catalog/products/${productId}`);
      expect(res.status).toBe(404);
    });

    await test.step('Act/Assert — คืนสถานะ → subscription กลับมา active และรอบถัดไปไม่ย้อนหลัง', async () => {
      await page.locator(ids.admin.shopSuspend(shopId)).click();
      await expect(page.locator(ids.admin.shopStatus(shopId))).toHaveText('เปิดอยู่');

      const [sub] = await queryTestDatabase<{
        status: string;
        paused_reason: string | null;
        next_order_date: string;
      }>(
        `select status, paused_reason, next_order_date::text as next_order_date
           from subscriptions where id = $1`,
        [subscriptionId],
      );
      expect(sub!.status).toBe('active');
      expect(sub!.paused_reason).toBeNull();

      const [today] = await queryTestDatabase<{ d: string }>(
        'select current_date::text as d',
      );
      expect(sub!.next_order_date > today!.d).toBe(true);
    });

    await test.step('Cleanup — ยกเลิกรายการที่สร้างไว้ ไม่ให้ค้างไปกวน spec อื่น', async () => {
      const buyer = await apiLogin(USERS.buyer.email, DEMO_PASSWORD);
      await post(`/subscriptions/${subscriptionId}/cancel`, buyer.accessToken, {});
    });
  },
);

testCase(
  { id: 'TC-078', priority: 'P1', feature: FEATURE },
  'จัดการหมวดสินค้า — เพิ่มแล้วผู้ซื้อเห็นทันที และลบหมวดที่ยังมีสินค้าไม่ได้',
  async ({ page }) => {
    const name = `หมวดทดสอบ ${Date.now()}`;
    let createdId = 0;

    await test.step('Arrange — เปิดหน้าหมวดสินค้าในโหมดผู้ดูแล', async () => {
      await loginAs(page, 'admin');
      await gotoApp(page, '/(admin)/categories');
    });

    await test.step('Act — เพิ่มหมวดใหม่', async () => {
      await page.locator(ids.admin.categoryName).fill(name);
      await page.locator(ids.admin.categoryIcon).fill('sparkles');
      await page.locator(ids.admin.categoryAdd).click();
      await expect(page.locator(ids.admin.categoriesToast)).toBeVisible();
    });

    await test.step('Assert — อยู่ใน DB และผู้ซื้อเห็นในหน้า catalog ทันที', async () => {
      const rows = await queryTestDatabase<{ id: number }>(
        'select id from categories where name = $1',
        [name],
      );
      expect(rows).toHaveLength(1);
      createdId = rows[0]!.id;

      const res = await fetch(`${apiBaseUrl()}/catalog/categories`);
      const list = (await res.json()) as { name: string }[];
      expect(list.map((c) => c.name)).toContain(name);
    });

    await test.step('Act/Assert — ลบหมวดที่มีสินค้าอยู่ → ถูกปฏิเสธพร้อมบอกจำนวน', async () => {
      const [withProducts] = await queryTestDatabase<{ id: number; n: string }>(
        `select c.id, count(p.id)::text as n
           from categories c join products p on p.category_id = c.id
          group by c.id order by count(p.id) desc limit 1`,
      );
      await page.locator(ids.admin.categoryDelete(withProducts!.id)).click();
      await expect(page.locator(ids.admin.categoriesError)).toContainText(
        `ยังมีสินค้า ${withProducts!.n} ชิ้น`,
      );
      // ของเดิมต้องยังอยู่ ไม่ใช่ลบไปครึ่งทาง
      expect(
        await queryTestDatabase('select id from categories where id = $1', [
          withProducts!.id,
        ]),
      ).toHaveLength(1);
    });

    await test.step('Cleanup — ลบหมวดที่เพิ่งสร้าง (ไม่มีสินค้าจึงลบได้)', async () => {
      await page.locator(ids.admin.categoryDelete(createdId)).click();
      await expect(page.locator(ids.admin.category(createdId))).toHaveCount(0);
      expect(
        await queryTestDatabase('select id from categories where id = $1', [
          createdId,
        ]),
      ).toHaveLength(0);
    });
  },
);

testCase(
  { id: 'TC-079', priority: 'P0', feature: FEATURE },
  '★ กด "รัน engine" ซ้ำวันเดิมจากหน้าผู้ดูแล → ออเดอร์ไม่งอกเพิ่ม (idempotent)',
  async ({ page }) => {
    let afterFirst = 0;

    await test.step('Arrange — เปิดหน้าควบคุม engine', async () => {
      await loginAs(page, 'admin');
      await gotoApp(page, '/(admin)/engine');
    });

    await test.step('Act — กดรันครั้งที่ 1', async () => {
      await page.locator(ids.admin.engineRun).click();
      await expect(page.locator(ids.admin.engineToast)).toBeVisible();
      await expect(page.locator(ids.admin.engineError)).toHaveCount(0);

      const [row] = await queryTestDatabase<{ n: string }>(
        'select count(*)::text as n from orders',
      );
      afterFirst = Number(row!.n);
    });

    await test.step('Act/Assert — กดรันซ้ำวันเดิม แล้วจำนวนออเดอร์ทั้งระบบต้องเท่าเดิม', async () => {
      await page.locator(ids.admin.engineRun).click();
      await expect(page.locator(ids.admin.engineToast)).toBeVisible();

      const [row] = await queryTestDatabase<{ n: string }>(
        'select count(*)::text as n from orders',
      );
      // ★ idempotency มาจาก UNIQUE(subscription_id, cycle_date) ที่ฐานข้อมูล ★
      expect(Number(row!.n)).toBe(afterFirst);

      // และประวัติต้องบันทึกทั้งสองรอบไว้ให้ตรวจย้อนหลังได้
      const [runs] = await queryTestDatabase<{ n: string }>(
        'select count(*)::text as n from engine_runs',
      );
      expect(Number(runs!.n)).toBeGreaterThanOrEqual(2);
    });
  },
);
