/**
 * Phase 5 — การจ่ายเงินจำลอง (feature 09 · W04/W06)
 *
 * โจทย์ของไฟล์นี้คือ "เงินที่ไม่ได้เข้า ต้องไม่ทำให้ระบบเดินต่อเหมือนเข้าแล้ว":
 * บัตรที่ถูกปฏิเสธต้องไม่ทิ้ง subscription ค้างไว้ · ออเดอร์ที่ยังไม่ได้เงินต้องไม่
 * โผล่ในรายการของร้าน · และใบเสร็จออกได้เฉพาะรอบที่จ่ายสำเร็จจริง
 *
 * **บัตรที่ลงท้าย 0000 = ถูกปฏิเสธเสมอ** (`DemoPaymentProvider`) — เป็นค่าที่ตั้งใจ
 * ให้ทำซ้ำได้ทุกครั้ง ไม่ใช่การสุ่ม จึงเขียนเป็นเทสอัตโนมัติได้
 */
import { testCase, test, expect } from '../helpers/test-case';
import { apiBaseUrl, apiLogin, gotoApp, loginAs } from '../helpers/login';
import * as ids from '../helpers/selectors';
import {
  ADDRESSES,
  DEMO_PASSWORD,
  ORDERS,
  PRODUCTS,
  USERS,
} from '../helpers/test-data';
import { queryTestDatabase } from '../setup/database';

const FEATURE = '09 — Payment (demo)';

/** บัตรจำลองที่ provider ปฏิเสธเสมอ — ตรงกับ `DEMO_DECLINE_LAST4` ฝั่ง API */
const DECLINE_LAST4 = '0000';

/** ผูกบัตรผ่าน API แล้วคืน id — หน้าจอผูกบัตรไม่ใช่สิ่งที่เคสนี้ทดสอบ */
async function addCard(token: string, last4: string): Promise<string> {
  const res = await fetch(`${apiBaseUrl()}/me/payment-methods`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      brand: 'visa',
      last4,
      expMonth: 12,
      expYear: new Date().getFullYear() + 4,
      holderName: 'E2E CARD',
    }),
  });
  if (!res.ok) throw new Error(`เพิ่มบัตรไม่สำเร็จ: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

/** ออเดอร์ค้างจ่ายของร้าน Bean Story 1 ใบ (payment = failed ตาม CHECK lifecycle) */
async function seedUnpaidOrder(cycleDaysAgo: number): Promise<string> {
  const rows = await queryTestDatabase<{ id: string }>(
    `insert into orders (subscription_id, buyer_id, cycle_date, status, amount, quantity, address_snapshot, created_at)
     select subscription_id, buyer_id, current_date - $2::int, 'pending', 255, 1, address_snapshot, now()
       from orders where id = $1
     returning id`,
    [ORDERS.coffeeRecent.id, cycleDaysAgo],
  );
  const id = rows[0]?.id;
  if (id == null) throw new Error('สร้างออเดอร์สำหรับเทสไม่สำเร็จ');

  await queryTestDatabase(
    `insert into payments (order_id, amount, status) values ($1, 255, 'failed')`,
    [id],
  );
  return id;
}

testCase(
  { id: 'TC-071', priority: 'P0', feature: FEATURE },
  '★ บัตรถูกปฏิเสธตอนสมัคร → ขึ้นข้อความบอกเหตุผล และไม่มีรายการค้างในฐานข้อมูล',
  async ({ page }) => {
    const plan = PRODUCTS.dripBag.plans['1m'];
    let cardId = '';

    await test.step('Arrange — เพิ่มบัตรจำลองที่ถูกปฏิเสธ แล้วเปิดหน้า checkout', async () => {
      const session = await apiLogin(USERS.buyer.email, DEMO_PASSWORD);
      cardId = await addCard(session.accessToken, DECLINE_LAST4);

      await loginAs(page, 'buyer');
      await gotoApp(page, `/checkout/${plan.id}`);
    });

    await test.step('Act — เลือกที่อยู่ + บัตรใบนั้น แล้วกดยืนยัน', async () => {
      await page.locator(ids.checkout.address(ADDRESSES.home.id)).click();
      await page.locator(ids.checkout.card(cardId)).click();
      await page.locator(ids.checkout.confirm).click();
    });

    await test.step('Assert — เห็นเหตุผลบนหน้าจอ และ DB ไม่มี subscription ของแผนนี้', async () => {
      await expect(page.locator(ids.checkout.error)).toContainText('บัตรถูกปฏิเสธ');

      // ★ ทั้งก้อน rollback ★ ไม่มีสมาชิกที่ไม่เคยจ่ายรอบไหนสำเร็จค้างอยู่
      const subs = await queryTestDatabase(
        'select id from subscriptions where buyer_id = $1 and plan_id = $2',
        [USERS.buyer.id, plan.id],
      );
      expect(subs).toHaveLength(0);
    });

    await test.step('Cleanup — ลบบัตรที่เพิ่มไว้', async () => {
      if (cardId !== '') {
        await queryTestDatabase('delete from payment_methods where id = $1', [
          cardId,
        ]);
      }
    });
  },
);

testCase(
  { id: 'TC-072', priority: 'P0', feature: FEATURE },
  '★ รอบที่ตัดเงินไม่ผ่าน — ร้านยังไม่เห็นออเดอร์ · ผู้ซื้อกดจ่ายซ้ำแล้วร้านถึงเห็น',
  async ({ page }) => {
    let orderId = '';

    await test.step('Arrange — มีออเดอร์ที่ payment เป็น failed อยู่ 1 ใบ', async () => {
      orderId = await seedUnpaidOrder(7);
      await loginAs(page, 'buyer');
      await gotoApp(page, `/(buyer)/orders/${orderId}`);
    });

    await test.step('Assert — ผู้ซื้อเห็นแถบค้างชำระ และยังไม่มีใบเสร็จให้เปิด', async () => {
      await expect(page.locator(ids.orders.unpaidCard)).toBeVisible();
      await expect(page.locator(ids.orders.receiptOpen)).toHaveCount(0);
    });

    await test.step('Assert — ร้านยังไม่เห็นออเดอร์ใบนี้ในแท็บค้างส่ง', async () => {
      const seller = await apiLogin(USERS.seller.email, DEMO_PASSWORD);
      const res = await fetch(`${apiBaseUrl()}/seller/orders?tab=open`, {
        headers: { Authorization: `Bearer ${seller.accessToken}` },
      });
      const list = (await res.json()) as { id: string }[];
      expect(list.map((o) => o.id)).not.toContain(orderId);
    });

    await test.step('Act — ผู้ซื้อกด "จ่ายอีกครั้ง"', async () => {
      await page.locator(ids.orders.retryPayment).click();
      await expect(page.locator(ids.orders.toast)).toBeVisible();
    });

    await test.step('Assert — DB: payment เป็น paid + มีเวลาจ่าย · ร้านเห็นออเดอร์แล้ว', async () => {
      await expect(page.locator(ids.orders.detailError)).toHaveCount(0);

      const [payment] = await queryTestDatabase<{
        status: string;
        paid_at: string | null;
      }>(
        'select status, paid_at::text as paid_at from payments where order_id = $1',
        [orderId],
      );
      expect(payment!.status).toBe('paid');
      expect(payment!.paid_at).not.toBeNull();

      const seller = await apiLogin(USERS.seller.email, DEMO_PASSWORD);
      const res = await fetch(`${apiBaseUrl()}/seller/orders?tab=open`, {
        headers: { Authorization: `Bearer ${seller.accessToken}` },
      });
      const list = (await res.json()) as { id: string }[];
      expect(list.map((o) => o.id)).toContain(orderId);
    });
  },
);

testCase(
  { id: 'TC-073', priority: 'P1', feature: FEATURE },
  'ใบเสร็จจำลองเปิดได้จากออเดอร์ที่จ่ายแล้ว — เลขที่ตรงกับรหัสออเดอร์ และมีป้าย DEMO',
  async ({ page }) => {
    const orderId = ORDERS.coffeeOld.id;

    await test.step('Arrange — เปิดออเดอร์เก่าที่จ่ายสำเร็จแล้ว', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, `/(buyer)/orders/${orderId}`);
    });

    await test.step('Act — กดดูใบเสร็จ', async () => {
      await page.locator(ids.orders.receiptOpen).click();
    });

    await test.step('Assert — เลขที่ใบเสร็จมาจากรหัสออเดอร์ · ยอดตรงกับ DB · มีป้าย DEMO', async () => {
      const expected = `RC-${orderId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
      await expect(page.locator(ids.orders.receiptNo)).toHaveText(
        `เลขที่ ${expected}`,
      );

      const [row] = await queryTestDatabase<{ amount: string }>(
        'select amount::numeric::text as amount from orders where id = $1',
        [orderId],
      );
      const baht = Number(row!.amount).toLocaleString('th-TH');
      await expect(page.locator(ids.orders.receiptAmount)).toHaveText(
        `รวม ฿${baht}`,
      );
      await expect(page.locator(ids.orders.receipt)).toContainText('DEMO');
    });
  },
);
