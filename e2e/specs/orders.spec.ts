/**
 * Phase 4.5 — ออเดอร์ของผู้ซื้อ · ข้อยกเว้น · รีวิว (features 07/15/16/17 · W11/W12)
 *
 * ⚠️ **ลำดับของเคสในไฟล์นี้มีความหมาย** ⚠️
 * TC-063 ตรวจว่ารายการที่ยังไม่เคยได้รับของ "รีวิวไม่ได้" ซึ่งจริงเฉพาะก่อนที่
 * TC-064 จะกดยืนยันรับของใบนั้น — สลับที่กันเมื่อไหร่เคสจะแดงแบบงง ๆ
 * (playwright.config ตั้ง workers: 1 + fullyParallel: false ไว้แล้ว)
 *
 * ทุกเคสที่เปลี่ยนสถานะยืนยันผลที่ **ฐานข้อมูล** ไม่ใช่แค่ข้อความบนจอ
 * (docs/testing.md §3.1) — โดยเฉพาะ `confirmed_at` และการคืนเงิน ซึ่งเป็นสองจุด
 * ที่หน้าจอโกหกได้ง่ายที่สุดถ้า API บันทึกผิด
 */
import { testCase, test, expect } from '../helpers/test-case';
import { apiBaseUrl, apiLogin, gotoApp, loginAs } from '../helpers/login';
import * as ids from '../helpers/selectors';
import {
  ADDRESSES,
  ORDERS,
  SHOPS,
  SUBSCRIPTIONS,
  USERS,
  DEMO_PASSWORD,
} from '../helpers/test-data';
import { queryTestDatabase } from '../setup/database';

const FEATURE = '07/15/16/17 — Orders & Reviews';

type OrderRow = {
  status: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
};

type PaymentRow = { status: string; refunded_at: string | null };

const orderRow = async (id: string): Promise<OrderRow> => {
  const rows = await queryTestDatabase<OrderRow>(
    `select status, confirmed_at::text as confirmed_at,
            cancelled_at::text as cancelled_at, cancel_reason
       from orders where id = $1`,
    [id],
  );
  if (rows[0] == null) throw new Error(`ไม่พบออเดอร์ ${id}`);
  return rows[0];
};

const paymentRow = async (orderId: string): Promise<PaymentRow> => {
  const rows = await queryTestDatabase<PaymentRow>(
    `select status, refunded_at::text as refunded_at from payments where order_id = $1`,
    [orderId],
  );
  if (rows[0] == null) throw new Error(`ไม่พบการจ่ายเงินของออเดอร์ ${orderId}`);
  return rows[0];
};

/**
 * สร้างออเดอร์ค้างส่งของร้าน Bean Story 1 ใบ (คัดลอก address_snapshot จากใบเดิม)
 *
 * เลือก `cycleDaysAgo` เป็นวันในอดีตโดยตั้งใจ เพื่อไม่ให้ชนกับออเดอร์วันนี้ที่
 * เคส engine ของ seller.spec สร้างขึ้น — unique (subscription_id, cycle_date)
 */
async function seedPendingOrder(cycleDaysAgo: number): Promise<string> {
  const rows = await queryTestDatabase<{ id: string }>(
    `insert into orders (subscription_id, buyer_id, cycle_date, status, amount, address_snapshot, created_at)
     select subscription_id, buyer_id, current_date - $2::int, 'pending', 255, address_snapshot, now()
       from orders where id = $1
     returning id`,
    [ORDERS.coffeeRecent.id, cycleDaysAgo],
  );
  const id = rows[0]?.id;
  if (id == null) throw new Error('สร้างออเดอร์สำหรับเทสไม่สำเร็จ');

  await queryTestDatabase(
    `insert into payments (order_id, amount, status, paid_at) values ($1, 255, 'paid', now())`,
    [id],
  );
  return id;
}

/** ยิง API ตรงในฐานะผู้ใช้จริง — ใช้กับขั้น Arrange ที่ไม่ได้ทดสอบหน้าจอนั้น */
async function apiPost(
  path: string,
  token: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

testCase(
  { id: 'TC-062', priority: 'P1', feature: FEATURE },
  'ประวัติออเดอร์แยก 2 แท็บถูกต้อง และที่อยู่บนออเดอร์เก่ามาจาก snapshot ไม่ใช่ที่อยู่ปัจจุบัน',
  async ({ page }) => {
    let recipientBefore = '';

    await test.step('Arrange — ล็อกอินผู้ซื้อแล้วเปิดหน้าออเดอร์', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/(buyer)/orders');
    });

    await test.step('Act/Assert — แท็บกำลังดำเนินการมีใบที่ยังส่งไม่ถึง ไม่มีใบที่จบแล้ว', async () => {
      await expect(
        page.locator(ids.orders.status(ORDERS.toothpasteShipped.id)),
      ).toHaveText('อยู่ระหว่างจัดส่ง');
      await expect(page.locator(ids.orders.card(ORDERS.coffeeOld.id))).toHaveCount(0);
    });

    await test.step('Act/Assert — แท็บสำเร็จมีใบที่ส่งถึงแล้ว พร้อมป้ายว่าผู้ซื้อยืนยันเอง', async () => {
      await page.locator(ids.orders.tab('done')).click();
      await expect(page.locator(ids.orders.card(ORDERS.coffeeOld.id))).toBeVisible();
      await expect(
        page.locator(ids.orders.confirmedPill(ORDERS.coffeeOld.id)),
      ).toBeVisible();
      await expect(
        page.locator(ids.orders.card(ORDERS.toothpasteShipped.id)),
      ).toHaveCount(0);
    });

    await test.step('Act — เปลี่ยนชื่อผู้รับในที่อยู่ปัจจุบัน แล้วเปิดออเดอร์เก่าอีกครั้ง', async () => {
      const rows = await queryTestDatabase<{ recipient_name: string }>(
        'select recipient_name from addresses where id = $1',
        [ADDRESSES.home.id],
      );
      recipientBefore = rows[0]!.recipient_name;
      await queryTestDatabase(
        'update addresses set recipient_name = $1 where id = $2',
        ['ชื่อใหม่หลังออเดอร์เกิด', ADDRESSES.home.id],
      );

      await gotoApp(page, `/(buyer)/orders/${ORDERS.coffeeOld.id}`);
    });

    await test.step('Assert — ออเดอร์เก่ายังแสดงชื่อผู้รับเดิมจาก snapshot', async () => {
      await expect(page.locator(ids.orders.address)).toBeVisible();
      await expect(page.locator(ids.orders.address)).toContainText(recipientBefore);
      await expect(page.locator(ids.orders.address)).not.toContainText(
        'ชื่อใหม่หลังออเดอร์เกิด',
      );
    });

    await test.step('Cleanup — คืนชื่อผู้รับเดิม', async () => {
      if (recipientBefore === '') return;
      await queryTestDatabase(
        'update addresses set recipient_name = $1 where id = $2',
        [recipientBefore, ADDRESSES.home.id],
      );
    });
  },
);

testCase(
  { id: 'TC-063', priority: 'P0', feature: FEATURE },
  'รายการที่ยังไม่เคยได้รับของรีวิวไม่ได้ — ทั้งบนหน้าจอและเมื่อยิง API ตรง',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินผู้ซื้อแล้วเปิดหน้ารายการของฉัน', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
    });

    await test.step('Assert — รายการยาสีฟัน (ยังไม่มีออเดอร์ที่ส่งถึง) ถูกล็อกพร้อมเหตุผล', async () => {
      await expect(
        page.locator(ids.subscriptions.reviewLocked(SUBSCRIPTIONS.toothpaste.id)),
      ).toHaveText('รีวิวได้หลังได้รับสินค้ารอบแรก');
      await expect(
        page.locator(ids.subscriptions.action.review(SUBSCRIPTIONS.toothpaste.id)),
      ).toHaveCount(0);
    });

    await test.step('Assert — รายการกาแฟที่รับมาแล้วเปิดให้รีวิว พร้อมจำนวนรอบจริง', async () => {
      const [row] = await queryTestDatabase<{ delivered: string }>(
        `select count(*)::text as delivered
           from orders where subscription_id = $1 and status = 'delivered'`,
        [SUBSCRIPTIONS.coffeeMonthly.id],
      );
      await expect(
        page.locator(ids.subscriptions.reviewCycles(SUBSCRIPTIONS.coffeeMonthly.id)),
      ).toHaveText(`รับมาแล้ว ${row!.delivered} รอบ`);
    });

    await test.step('Assert — ยิง API ตรงข้ามหน้าจอก็ยังถูกปฏิเสธ (กฎอยู่ที่ API ไม่ใช่ที่ปุ่ม)', async () => {
      const session = await apiLogin(USERS.buyer.email, DEMO_PASSWORD);
      const res = await apiPost(
        `/subscriptions/${SUBSCRIPTIONS.toothpaste.id}/review`,
        session.accessToken,
        { rating: 5, comment: 'ยังไม่ได้ของแต่ขอรีวิวก่อน' },
      );
      expect(res.status).toBe(422);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe('NOTHING_RECEIVED_YET');

      const rows = await queryTestDatabase(
        'select id from reviews where subscription_id = $1',
        [SUBSCRIPTIONS.toothpaste.id],
      );
      expect(rows).toHaveLength(0);
    });
  },
);

testCase(
  { id: 'TC-064', priority: 'P0', feature: FEATURE },
  'ผู้ซื้อกด "ได้รับแล้ว" แล้ว confirmed_at ถูกบันทึกจริงและออเดอร์กลายเป็นส่งถึงแล้ว',
  async ({ page }) => {
    const orderId = ORDERS.toothpasteShipped.id;

    await test.step('Arrange — ยืนยันว่าใบนี้ยังไม่เคยถูกยืนยัน', async () => {
      const before = await orderRow(orderId);
      expect(before.status).toBe('shipped');
      expect(before.confirmed_at).toBeNull();

      await loginAs(page, 'buyer');
      await gotoApp(page, `/(buyer)/orders/${orderId}`);
    });

    await test.step('Act — กดปุ่มยืนยันรับของ', async () => {
      await expect(page.locator(ids.orders.detailStatus)).toHaveText('อยู่ระหว่างจัดส่ง');
      await page.locator(ids.orders.confirm).click();
    });

    await test.step('Assert — DB มี confirmed_at + status delivered · หน้าจอเปลี่ยนเป็นป้ายเวลา', async () => {
      await expect(page.locator(ids.orders.confirmedAt)).toBeVisible();
      await expect(page.locator(ids.orders.detailStatus)).toHaveText('ส่งถึงแล้ว');
      // ยืนยันแล้วต้องไม่มีปุ่มให้กดซ้ำ (กดซ้ำไม่ error แต่ไม่ควรมีให้กด)
      await expect(page.locator(ids.orders.confirm)).toHaveCount(0);
      await expect(page.locator(ids.orders.detailError)).toHaveCount(0);

      const after = await orderRow(orderId);
      expect(after.status).toBe('delivered');
      // ★ ตัวเลขเดียวที่พิสูจน์ว่า "ของถึงมือจริง" ★ ร้านไม่มี endpoint ไหนตั้งค่านี้ได้
      expect(after.confirmed_at).not.toBeNull();
    });
  },
);

testCase(
  { id: 'TC-065', priority: 'P0', feature: FEATURE },
  'แจ้งปัญหาออเดอร์แล้วเคสถูกเปิดในฐานข้อมูล ร้านได้แจ้งเตือน และแจ้งซ้ำไม่ได้',
  async ({ page }) => {
    const orderId = ORDERS.catFoodDelivered.id;
    const detail = 'กล่องมาถึงแต่ข้างในว่างเปล่า ไม่มีถุงอาหารแมวเลย';

    await test.step('Arrange — เปิดออเดอร์ที่ส่งถึงแล้วและยังไม่มีเคส', async () => {
      const existing = await queryTestDatabase(
        'select id from order_issues where order_id = $1',
        [orderId],
      );
      expect(existing).toHaveLength(0);

      await loginAs(page, 'buyer');
      await gotoApp(page, `/(buyer)/orders/${orderId}`);
    });

    await test.step('Act — เลือกประเภทปัญหาแล้วส่งเรื่องให้ร้าน', async () => {
      await page.locator(ids.orders.report).click();
      await expect(page.locator(ids.orders.issueSheet)).toBeVisible();
      await page.locator(ids.orders.issueType('not_received')).click();
      await page.locator(ids.orders.issueDetail).fill(detail);
      await page.locator(ids.orders.issueSubmit).click();
    });

    await test.step('Assert — DB มีเคสของผู้ซื้อคนนี้ + เจ้าของร้านได้รับแจ้งเตือน', async () => {
      await expect(page.locator(ids.orders.issueStatus)).toHaveText('รอร้านตอบกลับ');
      await expect(page.locator(ids.orders.detailError)).toHaveCount(0);

      const rows = await queryTestDatabase<{
        type: string;
        detail: string;
        status: string;
        reporter_id: string;
      }>(
        'select type, detail, status, reporter_id from order_issues where order_id = $1',
        [orderId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.type).toBe('not_received');
      expect(rows[0]!.detail).toBe(detail);
      expect(rows[0]!.status).toBe('open');
      // ★ ผู้แจ้งมาจาก token ไม่ใช่ body ★ ปลอมเป็นคนอื่นไม่ได้
      expect(rows[0]!.reporter_id).toBe(USERS.buyer.id);

      // แจ้งเตือนต้องไปถึง "เจ้าของร้านของออเดอร์ใบนั้น" ไม่ใช่ร้านไหนก็ได้
      const [shop] = await queryTestDatabase<{ owner_id: string }>(
        `select sh.owner_id
           from orders o
           join subscriptions s on s.id = o.subscription_id
           join product_plans p on p.id = s.plan_id
           join products pr on pr.id = p.product_id
           join shops sh on sh.id = pr.shop_id
          where o.id = $1`,
        [orderId],
      );
      const notices = await queryTestDatabase<{ user_id: string }>(
        `select user_id from notifications
          where title = 'มีผู้ซื้อแจ้งปัญหาออเดอร์'
          order by created_at desc limit 1`,
      );
      expect(notices).toHaveLength(1);
      expect(notices[0]!.user_id).toBe(shop!.owner_id);
    });

    await test.step('Assert — 1 ออเดอร์ = 1 เคส: ปุ่มแจ้งปัญหาหายไปแล้ว', async () => {
      await gotoApp(page, `/(buyer)/orders/${orderId}`);
      await expect(page.locator(ids.orders.issueCard)).toBeVisible();
      await expect(page.locator(ids.orders.report)).toHaveCount(0);
    });
  },
);

testCase(
  { id: 'TC-066', priority: 'P0', feature: FEATURE },
  'ร้านยกเลิกออเดอร์แล้วคืนเงินจำลองทันที และ subscription ของผู้ซื้อไม่ถูกแตะ',
  async ({ page }) => {
    let orderId = '';
    let nextBefore = '';
    const reason = 'ของหมดสต๊อกรอบนี้ ขออภัยจริง ๆ';

    await test.step('Arrange — มีออเดอร์ค้างส่งของร้าน Bean Story ที่จ่ายเงินแล้ว', async () => {
      orderId = await seedPendingOrder(5);
      const [sub] = await queryTestDatabase<{ next_order_date: string }>(
        'select next_order_date::text as next_order_date from subscriptions where id = $1',
        [SUBSCRIPTIONS.coffeeMonthly.id],
      );
      nextBefore = sub!.next_order_date;

      await loginAs(page, 'seller');
      await gotoApp(page, '/(seller)/orders');
    });

    await test.step('Act — กดยกเลิกออเดอร์ เลือกเหตุผลสำเร็จรูปแล้วยืนยัน', async () => {
      await expect(page.locator(ids.sellerOrders.item(orderId))).toBeVisible();
      await page.locator(ids.sellerOrders.cancel(orderId)).click();
      await expect(page.locator(ids.sellerOrders.cancelModal)).toBeVisible();
      await page.locator(ids.sellerOrders.cancelPreset('out-of-stock')).click();
      await page.locator(ids.sellerOrders.cancelReason).fill(reason);
      await page.locator(ids.sellerOrders.cancelConfirm).click();
      await expect(page.locator(ids.sellerOrders.toast)).toBeVisible();
    });

    await test.step('Assert — DB: ออเดอร์ยกเลิก + เงินคืน + event ครบในทรานแซกชันเดียว', async () => {
      await expect(page.locator(ids.sellerOrders.error)).toHaveCount(0);

      const order = await orderRow(orderId);
      expect(order.status).toBe('cancelled');
      expect(order.cancel_reason).toBe(reason);
      expect(order.cancelled_at).not.toBeNull();

      const payment = await paymentRow(orderId);
      expect(payment.status).toBe('refunded');
      expect(payment.refunded_at).not.toBeNull();

      const events = await queryTestDatabase<{ event: string }>(
        `select event from subscription_events
          where subscription_id = $1 and event = 'order_cancelled'`,
        [SUBSCRIPTIONS.coffeeMonthly.id],
      );
      expect(events.length).toBeGreaterThan(0);
    });

    await test.step('Assert — รอบถัดไปของผู้ซื้อยังเดินตามปกติ (ปัญหาสต๊อกรอบเดียวไม่ควรกินทั้ง subscription)', async () => {
      const [sub] = await queryTestDatabase<{ status: string; next_order_date: string }>(
        `select status, next_order_date::text as next_order_date
           from subscriptions where id = $1`,
        [SUBSCRIPTIONS.coffeeMonthly.id],
      );
      expect(sub!.status).toBe('active');
      expect(sub!.next_order_date).toBe(nextBefore);
    });
  },
);

testCase(
  { id: 'TC-067', priority: 'P1', feature: FEATURE },
  'ผู้ซื้อเห็นเหตุผลที่ร้านยกเลิกและป้ายคืนเงิน DEMO แทน stepper',
  async ({ page }) => {
    let orderId = '';
    const reason = 'ปิดร้านชั่วคราวช่วงสงกรานต์';

    await test.step('Arrange — ร้านยกเลิกออเดอร์ใบหนึ่งผ่าน API (ทดสอบฝั่งผู้ซื้อ)', async () => {
      orderId = await seedPendingOrder(6);
      const seller = await apiLogin(USERS.seller.email, DEMO_PASSWORD);
      const res = await apiPost(`/seller/orders/${orderId}/cancel`, seller.accessToken, {
        reason,
      });
      expect(res.status).toBe(200);

      await loginAs(page, 'buyer');
      await gotoApp(page, `/(buyer)/orders/${orderId}`);
    });

    await test.step('Assert — banner ยกเลิก + เหตุผล + ป้ายคืนเงิน · ไม่มี stepper ให้เข้าใจผิด', async () => {
      await expect(page.locator(ids.orders.cancelBanner)).toBeVisible();
      await expect(page.locator(ids.orders.cancelReason)).toContainText(reason);
      await expect(page.locator(ids.orders.refundBadge)).toContainText('คืนเงินจำลองแล้ว');
      await expect(page.locator(ids.orders.stepper)).toHaveCount(0);
      // ยกเลิกแล้วไม่มีของให้ยืนยันและไม่มีอะไรให้แจ้ง
      await expect(page.locator(ids.orders.confirm)).toHaveCount(0);
      await expect(page.locator(ids.orders.report)).toHaveCount(0);
    });

    await test.step('Assert — ป้ายคืนเงินโผล่ตั้งแต่หน้ารายการ (แท็บสำเร็จ/ยกเลิก)', async () => {
      await gotoApp(page, '/(buyer)/orders');
      await page.locator(ids.orders.tab('done')).click();
      await expect(page.locator(ids.orders.refundedPill(orderId))).toBeVisible();
    });
  },
);

testCase(
  { id: 'TC-068', priority: 'P1', feature: FEATURE },
  'ร้านตอบเคสปัญหาจากแท็บ "ปัญหา" แล้วผู้ซื้อเห็นหมายเหตุบนออเดอร์ของตัวเอง',
  async ({ page }) => {
    const orderId = ORDERS.coffeeRecent.id;
    const note = 'ส่งของชุดใหม่ให้แล้ววันนี้ พร้อมเลขพัสดุ TH-FIX-0001';
    let issueId = '';

    await test.step('Arrange — ผู้ซื้อแจ้งปัญหาออเดอร์ของร้าน Bean Story ผ่าน API', async () => {
      const buyer = await apiLogin(USERS.buyer.email, DEMO_PASSWORD);
      const res = await apiPost(`/orders/${orderId}/issues`, buyer.accessToken, {
        type: 'damaged',
        detail: 'ถุงกาแฟรั่ว เมล็ดหกเต็มกล่อง',
      });
      expect(res.status).toBe(201);

      const [row] = await queryTestDatabase<{ id: string }>(
        'select id from order_issues where order_id = $1',
        [orderId],
      );
      issueId = row!.id;

      await loginAs(page, 'seller');
      await gotoApp(page, '/(seller)/orders');
    });

    await test.step('Act — เปิดแท็บปัญหาแล้วตอบเคส', async () => {
      await page.locator(ids.sellerOrders.tab('issues')).click();
      await expect(page.locator(ids.sellerOrders.issue(issueId))).toBeVisible();
      await expect(page.locator(ids.sellerOrders.issueStatus(issueId))).toHaveText('รอตอบ');

      await page.locator(ids.sellerOrders.issueAnswer(issueId)).click();
      await expect(page.locator(ids.sellerOrders.issueModal)).toBeVisible();
      await page.locator(ids.sellerOrders.issueNote).fill(note);
      await page.locator(ids.sellerOrders.issueResolve).click();
    });

    await test.step('Assert — DB ปิดเคสพร้อมชื่อผู้ปิด และผู้ซื้อได้รับแจ้งเตือน', async () => {
      await expect(page.locator(ids.sellerOrders.error)).toHaveCount(0);
      await expect(page.locator(ids.sellerOrders.issuesEmpty)).toBeVisible();

      const [row] = await queryTestDatabase<{
        status: string;
        resolution_note: string;
        resolved_by: string;
        resolved_at: string | null;
      }>(
        `select status, resolution_note, resolved_by, resolved_at::text as resolved_at
           from order_issues where id = $1`,
        [issueId],
      );
      expect(row!.status).toBe('resolved');
      expect(row!.resolution_note).toBe(note);
      expect(row!.resolved_by).toBe(USERS.seller.id);
      expect(row!.resolved_at).not.toBeNull();

      const notices = await queryTestDatabase<{ user_id: string }>(
        `select user_id from notifications
          where link_path = $1 and type = 'order_status'
          order by created_at desc limit 1`,
        [`/orders/${orderId}`],
      );
      expect(notices[0]!.user_id).toBe(USERS.buyer.id);
    });

    await test.step('Assert — ฝั่งผู้ซื้อเห็นคำตอบของร้านบนออเดอร์ใบนั้น', async () => {
      const buyerPage = await page.context().browser()!.newContext();
      const view = await buyerPage.newPage();
      try {
        await loginAs(view, 'buyer');
        await gotoApp(view, `/(buyer)/orders/${orderId}`);
        await expect(view.locator(ids.orders.issueStatus)).toHaveText('ร้านแก้ไขให้แล้ว');
        await expect(view.locator(ids.orders.issueNote)).toContainText(note);
      } finally {
        await buyerPage.close();
      }
    });
  },
);

testCase(
  { id: 'TC-069', priority: 'P1', feature: FEATURE },
  'แก้รีวิวบนรายการเดิมเป็นการแก้ ไม่ใช่รีวิวใบใหม่ และจำนวนรอบถูกคำนวณใหม่จากออเดอร์จริง',
  async ({ page }) => {
    const subscriptionId = SUBSCRIPTIONS.coffeeMonthly.id;
    let ratingBefore = 0;

    await test.step('Arrange — รายการกาแฟมีรีวิวเดิมอยู่แล้ว', async () => {
      const [row] = await queryTestDatabase<{ rating: number; count: string }>(
        `select rating, (select count(*)::text from reviews where subscription_id = $1) as count
           from reviews where subscription_id = $1`,
        [subscriptionId],
      );
      ratingBefore = row!.rating;
      expect(row!.count).toBe('1');

      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
    });

    await test.step('Act — เปิดกล่องรีวิว เปลี่ยนเป็น 4 ดาว แล้วบันทึก', async () => {
      await expect(page.locator(ids.subscriptions.action.review(subscriptionId))).toContainText(
        `★${ratingBefore}`,
      );
      await page.locator(ids.subscriptions.action.review(subscriptionId)).click();
      await expect(page.locator(ids.subscriptions.reviewEdited)).toBeVisible();
      await page.locator(ids.subscriptions.reviewStar(4)).click();
      await page.locator(ids.subscriptions.reviewComment).fill('ใช้มาหลายรอบ คุณภาพคงที่ ส่งตรงเวลา');
      await page.locator(ids.subscriptions.reviewSubmit).click();
    });

    await test.step('Assert — DB ยังมีรีวิวใบเดียว คะแนนใหม่ และรอบที่รับมาถูกนับใหม่', async () => {
      await expect(page.locator(ids.subscriptions.toast)).toBeVisible();

      const rows = await queryTestDatabase<{
        rating: number;
        comment: string;
        cycles_received: number;
      }>(
        'select rating, comment, cycles_received from reviews where subscription_id = $1',
        [subscriptionId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rating).toBe(4);
      expect(rows[0]!.comment).toContain('คุณภาพคงที่');

      const [delivered] = await queryTestDatabase<{ count: string }>(
        `select count(*)::text as count
           from orders where subscription_id = $1 and status = 'delivered'`,
        [subscriptionId],
      );
      // ★ จำนวนรอบเป็นข้อเท็จจริงจากออเดอร์ ไม่ใช่ตัวเลขที่ผู้รีวิวประกาศเอง ★
      expect(String(rows[0]!.cycles_received)).toBe(delivered!.count);

      const events = await queryTestDatabase<{ event: string }>(
        `select event from subscription_events
          where subscription_id = $1 and event = 'reviewed'`,
        [subscriptionId],
      );
      expect(events.length).toBeGreaterThan(0);
    });

    await test.step('Cleanup — คืนคะแนนเดิมให้ข้อมูล seed', async () => {
      await queryTestDatabase('update reviews set rating = $1 where subscription_id = $2', [
        ratingBefore,
        subscriptionId,
      ]);
    });
  },
);

testCase(
  { id: 'TC-070', priority: 'P2', feature: FEATURE },
  'ผู้ใช้คนอื่นเปิดออเดอร์ของเราไม่ได้ — หน้าจอบอกว่าไม่พบ ไม่ใช่แสดงข้อมูล',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินด้วยบัญชีอื่น (ร้านค้า) แล้วเดาลิงก์ออเดอร์ของผู้ซื้อ', async () => {
      await loginAs(page, 'seller');
      await gotoApp(page, `/(buyer)/orders/${ORDERS.coffeeOld.id}`);
    });

    await test.step('Assert — เห็นสถานะ "ไม่พบออเดอร์นี้" และไม่มีข้อมูลผู้รับหลุดออกมา', async () => {
      await expect(page.locator(ids.orders.notFound)).toBeVisible();
      await expect(page.locator(ids.orders.address)).toHaveCount(0);
      await expect(page.locator(ids.orders.detail)).toHaveCount(0);
    });
  },
);
