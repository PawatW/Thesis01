/**
 * Feature 06 — หน้ารายการของฉัน (W05)
 *
 * ตั้งแต่ Phase 3 ปุ่มทั้ง 7 actions ยิง endpoint จริงแล้ว เคสในไฟล์นี้จึงต้อง
 * **ยืนยันผลที่ฐานข้อมูล** ไม่ใช่แค่ดูตัวเลขบนจอ (docs/testing.md §3.1) —
 * หน้าจอวาดจากค่าที่ API ส่งกลับมา ถ้าเชื่อแต่หน้าจอ เคสจะผ่านได้แม้ระบบ
 * บันทึกผิดคน ผิดสถานะ หรือไม่ได้บันทึกเลย
 *
 * ⚠️ เคสท้ายไฟล์เปลี่ยนสถานะของข้อมูล seed ถาวรภายในการรันหนึ่งครั้ง
 * (seed ใหม่ทุกครั้งที่รันทั้งชุด) จึงต้องเรียงไว้ **หลัง** เคสที่อ่านสถานะเดิม
 * และแต่ละเคสเลือกใช้รายการที่เคสอื่นไม่ได้ใช้ต่อ
 */
import { testCase, test, expect } from '../helpers/test-case';
import { apiBaseUrl, apiLogin, gotoApp, loginAs } from '../helpers/login';
import * as ids from '../helpers/selectors';
import { ADDRESSES, PRODUCTS, SUBSCRIPTIONS, USERS } from '../helpers/test-data';
import { queryTestDatabase } from '../setup/database';

const FEATURE = '06 — Subscriptions';

type SubscriptionRow = {
  status: string;
  paused_reason: string | null;
  /** ★ เป็น string เสมอ ★ ดูเหตุผลใน `subscriptionRow()` */
  next_order_date: string | null;
  cycle_anchor_date: string;
  plan_id: string;
  address_id: string;
};

/**
 * อ่านสถานะจริงจากฐานข้อมูลทดสอบ — คำตอบสุดท้ายของทุกเคสที่เปลี่ยนสถานะ
 *
 * ★ cast วันที่เป็น `::text` ★ ไม่งั้น driver `pg` จะแปลงคอลัมน์ `date` เป็น
 * `Date` ที่เที่ยงคืน **local** (เครื่องนี้คือ Asia/Bangkok) พอเรียก
 * `.toISOString()` ต่อ จะได้วันก่อนหน้าเสมอ — บั๊กเดียวกับ B-12 ที่ย้ายมาอยู่ในเทส
 * และทำให้การเทียบ "ต้องเป็นวันในอนาคต" คลาดไป 1 วันโดยไม่มีใครเห็น
 */
async function subscriptionRow(id: string): Promise<SubscriptionRow> {
  const rows = await queryTestDatabase<SubscriptionRow>(
    `select status,
            paused_reason,
            next_order_date::text  as next_order_date,
            cycle_anchor_date::text as cycle_anchor_date,
            plan_id,
            address_id
       from subscriptions where id = $1`,
    [id],
  );
  const row = rows[0];
  if (row == null) throw new Error(`ไม่พบ subscription ${id} ในฐานข้อมูลทดสอบ`);
  return row;
}

/** วันนี้ตามปฏิทินไทย — เทสรันด้วย timezone Asia/Bangkok (playwright.config.ts) */
function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(
    new Date(),
  );
}

testCase(
  { id: 'TC-039', priority: 'P0', feature: FEATURE },
  'รายการของฉันแยกกลุ่มตามสถานะได้ถูกต้อง',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อที่มีทั้งรายการใช้งานอยู่และหยุดไว้', async () => {
      await loginAs(page, 'buyer');
    });

    await test.step('Act — เปิดหน้ารายการของฉัน', async () => {
      await gotoApp(page, '/subscriptions');
    });

    await test.step('Assert — รายการ active อยู่กลุ่มกำลังใช้งาน รายการ paused อยู่กลุ่มหยุดชั่วคราว', async () => {
      await expect(page.locator(ids.subscriptions.groupActive)).toBeVisible();
      await expect(page.locator(ids.subscriptions.groupPaused)).toBeVisible();

      const active = ids.subscriptions.item(SUBSCRIPTIONS.coffeeMonthly.id);
      const paused = ids.subscriptions.item(SUBSCRIPTIONS.catFoodPaused.id);

      await expect(page.locator(`${ids.subscriptions.groupActive} ${active}`)).toBeVisible();
      await expect(page.locator(`${ids.subscriptions.groupPaused} ${paused}`)).toBeVisible();

      await expect(
        page.locator(ids.subscriptions.status(SUBSCRIPTIONS.coffeeMonthly.id)),
      ).toHaveText('กำลังใช้งาน');
      await expect(
        page.locator(ids.subscriptions.status(SUBSCRIPTIONS.catFoodPaused.id)),
      ).toHaveText('หยุดชั่วคราว');
    });
  },
);

testCase(
  { id: 'TC-040', priority: 'P1', feature: FEATURE },
  'รายการที่กำลังใช้งานมีปุ่มครบทุก action ของ W05',
  async ({ page }) => {
    const id = SUBSCRIPTIONS.coffeeMonthly.id;

    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อ', async () => {
      await loginAs(page, 'buyer');
    });

    await test.step('Act — เปิดหน้ารายการของฉัน', async () => {
      await gotoApp(page, '/subscriptions');
      await expect(page.locator(ids.subscriptions.item(id))).toBeVisible();
    });

    await test.step('Assert — เห็นปุ่มข้ามรอบ เลื่อน หยุด เปลี่ยนรอบส่ง เปลี่ยนที่อยู่ และยกเลิก', async () => {
      await expect(page.locator(ids.subscriptions.action.skip(id))).toBeVisible();
      await expect(page.locator(ids.subscriptions.action.reschedule(id))).toBeVisible();
      await expect(page.locator(ids.subscriptions.action.pause(id))).toBeVisible();
      await expect(page.locator(ids.subscriptions.action.plan(id))).toBeVisible();
      await expect(page.locator(ids.subscriptions.action.address(id))).toBeVisible();
      await expect(page.locator(ids.subscriptions.action.cancel(id))).toBeVisible();
      // ยังใช้งานอยู่ จึงต้องไม่มีปุ่มกลับมาใช้งาน
      await expect(page.locator(ids.subscriptions.action.resume(id))).toHaveCount(0);
    });
  },
);

testCase(
  { id: 'TC-041', priority: 'P1', feature: FEATURE },
  'รายการที่หยุดไว้เองมีปุ่มกลับมาใช้งาน แต่ไม่มีปุ่มข้ามรอบหรือหยุดซ้ำ',
  async ({ page }) => {
    const id = SUBSCRIPTIONS.catFoodPaused.id;

    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อ', async () => {
      await loginAs(page, 'buyer');
    });

    await test.step('Act — เปิดหน้ารายการของฉัน', async () => {
      await gotoApp(page, '/subscriptions');
      await expect(page.locator(ids.subscriptions.item(id))).toBeVisible();
    });

    await test.step('Assert — มีเฉพาะ action ที่ทำได้ในสถานะ paused', async () => {
      await expect(page.locator(ids.subscriptions.action.resume(id))).toBeVisible();
      await expect(page.locator(ids.subscriptions.action.cancel(id))).toBeVisible();
      await expect(page.locator(ids.subscriptions.action.skip(id))).toHaveCount(0);
      await expect(page.locator(ids.subscriptions.action.pause(id))).toHaveCount(0);
    });
  },
);

testCase(
  { id: 'TC-042', priority: 'P0', feature: FEATURE },
  'กดข้ามรอบแล้วต้องบอกวันที่ก่อนและหลังก่อนให้ยืนยัน (ข้อบังคับ W05)',
  async ({ page }) => {
    const id = SUBSCRIPTIONS.coffeeMonthly.id;

    await test.step('Arrange — เปิดหน้ารายการของฉัน', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
      await expect(page.locator(ids.subscriptions.action.skip(id))).toBeVisible();
    });

    await test.step('Act — กดปุ่มข้ามรอบ', async () => {
      await page.locator(ids.subscriptions.action.skip(id)).click();
    });

    await test.step('Assert — กล่องยืนยันบอกทั้งรอบที่ข้ามและรอบถัดไป ก่อนผู้ใช้กดยืนยัน', async () => {
      await expect(page.locator(ids.subscriptions.confirmTitle)).toHaveText('ข้ามรอบถัดไป');
      const body = page.locator(ids.subscriptions.confirmBody);
      await expect(body).toContainText('ข้ามรอบวันที่');
      await expect(body).toContainText('รอบถัดไปจะเป็น');
    });
  },
);

testCase(
  { id: 'TC-043', priority: 'P1', feature: FEATURE },
  'กล่องยืนยันการยกเลิกบอกว่าเป็นการยกเลิกถาวร และปิดได้โดยไม่ทำอะไร',
  async ({ page }) => {
    const id = SUBSCRIPTIONS.coffeeMonthly.id;

    await test.step('Arrange — เปิดหน้ารายการของฉัน', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
      await expect(page.locator(ids.subscriptions.action.cancel(id))).toBeVisible();
    });

    await test.step('Act — กดยกเลิกเพื่อเปิดกล่องยืนยัน แล้วกดปิด', async () => {
      await page.locator(ids.subscriptions.action.cancel(id)).click();
      await expect(page.locator(ids.subscriptions.confirmBody)).toContainText('ยกเลิกถาวร');
      await page.locator(ids.subscriptions.confirmClose).click();
    });

    await test.step('Assert — รายการยังอยู่ในสถานะเดิม ไม่ถูกยกเลิก', async () => {
      await expect(page.locator(ids.subscriptions.status(id))).toHaveText('กำลังใช้งาน');
      await expect(page.locator(ids.subscriptions.error)).toHaveCount(0);
    });
  },
);

testCase(
  { id: 'TC-044', priority: 'P0', feature: FEATURE },
  'ยืนยันข้ามรอบแล้ววันรอบถัดไปขยับจริงทั้งบนจอและในฐานข้อมูล',
  async ({ page }) => {
    const id = SUBSCRIPTIONS.coffeeMonthly.id;
    let before: string | null = null;
    /** ข้อความในกล่องยืนยัน เช่น "…รอบถัดไปจะเป็น 27 ก.ย. 69" */
    let promised = '';

    await test.step('Arrange — จำวันรอบเดิมจากฐานข้อมูล แล้วกดข้ามรอบ', async () => {
      before = (await subscriptionRow(id)).next_order_date;
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
      await page.locator(ids.subscriptions.action.skip(id)).click();
      await expect(page.locator(ids.subscriptions.confirmOk)).toBeVisible();
      promised = (await page.locator(ids.subscriptions.confirmBody).innerText()).trim();
    });

    await test.step('Act — กดยืนยันในกล่อง', async () => {
      await page.locator(ids.subscriptions.confirmOk).click();
    });

    await test.step('Assert — ไม่มี error · ยังใช้งานอยู่ · วันรอบใน DB เลื่อนไปข้างหน้า', async () => {
      await expect(page.locator(ids.subscriptions.toast)).toBeVisible();
      await expect(page.locator(ids.subscriptions.error)).toHaveCount(0);
      await expect(page.locator(ids.subscriptions.status(id))).toHaveText('กำลังใช้งาน');

      const after = (await subscriptionRow(id)).next_order_date;
      expect(after).not.toBeNull();
      expect(after! > before!).toBe(true);
    });

    await test.step('Assert — ★ วันที่กล่องยืนยันสัญญาไว้ ต้องเป็นวันเดียวกับที่ DB เก็บจริง', async () => {
      // W05 บังคับว่าทุก dialog ต้องบอกผลลัพธ์ล่วงหน้า — ถ้าฝั่ง client คำนวณ
      // กริดรอบคนละแบบกับ API (เช่น ไม่หนีบปลายเดือน) ผู้ใช้จะเห็นคนละวันกับที่เกิดขึ้นจริง
      const stored = (await subscriptionRow(id)).next_order_date!;
      const thai = new Intl.DateTimeFormat('th-TH', {
        day: 'numeric',
        month: 'short',
        year: '2-digit',
      }).format(new Date(`${stored}T00:00:00`));

      expect(promised).toContain(thai);
    });
  },
);

testCase(
  { id: 'TC-045', priority: 'P0', feature: FEATURE },
  'กดกลับมาใช้งานแล้วรายการย้ายไปกลุ่มกำลังใช้งาน และ DB เป็น active',
  async ({ page }) => {
    const id = SUBSCRIPTIONS.catFoodPaused.id;

    await test.step('Arrange — ดันวันรอบให้เลยมาแล้ว เหมือนหยุดไว้นานจนรอบเก่าผ่านไป', async () => {
      // ถ้าไม่ทำขั้นนี้ กิ่ง `max(next, พรุ่งนี้)` ของ resume จะไม่ถูกรันเลย
      // (seed ตั้งวันรอบไว้ +12 วัน) แล้วเคสนี้จะเขียวต่อให้ลบกฎนั้นทิ้งทั้งก้อน
      await queryTestDatabase(
        `update subscriptions
            set next_order_date = current_date - 20,
                cycle_anchor_date = current_date - 20
          where id = $1`,
        [id],
      );
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
      await expect(page.locator(ids.subscriptions.action.resume(id))).toBeVisible();
    });

    await test.step('Act — กดปุ่มกลับมาใช้งาน (ไม่มีกล่องยืนยัน — ยิงทันที)', async () => {
      await page.locator(ids.subscriptions.action.resume(id)).click();
    });

    await test.step('Assert — active และวันรอบถูกดันเป็นพรุ่งนี้ (ไม่มีออเดอร์ย้อนหลัง)', async () => {
      await expect(page.locator(ids.subscriptions.status(id))).toHaveText('กำลังใช้งาน');
      await expect(
        page.locator(`${ids.subscriptions.groupActive} ${ids.subscriptions.item(id)}`),
      ).toBeVisible();

      const row = await subscriptionRow(id);
      expect(row.status).toBe('active');
      expect(row.paused_reason).toBeNull();
      // ★ ต้องเป็น "พรุ่งนี้" เป๊ะ ไม่ใช่แค่ "อนาคต" — ถ้าปล่อยวันเดิมไว้
      // engine จะยิงออเดอร์ย้อนหลังทันทีในรอบถัดไป (ข้อบังคับใน W05)
      const tomorrow = new Date(`${todayISO()}T00:00:00Z`);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      expect(row.next_order_date).toBe(tomorrow.toISOString().slice(0, 10));
      expect(row.cycle_anchor_date).toBe(row.next_order_date);
    });
  },
);

testCase(
  { id: 'TC-046', priority: 'P2', feature: FEATURE },
  'กล่องเปลี่ยนที่อยู่แสดงที่อยู่ทั้งหมดให้เลือก',
  async ({ page }) => {
    const id = SUBSCRIPTIONS.coffeeMonthly.id;

    await test.step('Arrange — เปิดหน้ารายการของฉัน', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
      await expect(page.locator(ids.subscriptions.action.address(id))).toBeVisible();
    });

    await test.step('Act — กดปุ่มเปลี่ยนที่อยู่', async () => {
      await page.locator(ids.subscriptions.action.address(id)).click();
    });

    await test.step('Assert — เห็นที่อยู่ของ seed ทั้งสองเป็นตัวเลือก', async () => {
      await expect(page.locator(ids.subscriptions.addressModal)).toBeVisible();
      await expect(page.locator(ids.subscriptions.addressOption(ADDRESSES.home.id))).toBeVisible();
      await expect(page.locator(ids.subscriptions.addressOption(ADDRESSES.work.id))).toBeVisible();
    });
  },
);

testCase(
  { id: 'TC-047', priority: 'P1', feature: FEATURE },
  'ยอดใช้จ่ายต่อเดือนโดยประมาณถูกแสดงพร้อมป้าย DEMO',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อที่มีรายการใช้งานอยู่', async () => {
      await loginAs(page, 'buyer');
    });

    await test.step('Act — เปิดหน้ารายการของฉัน', async () => {
      await gotoApp(page, '/subscriptions');
    });

    await test.step('Assert — เห็นยอดรวมเป็นจำนวนเงิน และมีป้ายบอกว่าเป็นเดโม่ (กฎเหล็กข้อ 1)', async () => {
      await expect(page.locator(ids.subscriptions.spend)).toContainText('฿');
      await expect(page.locator(ids.subscriptions.spend)).toContainText('เดือนนี้จ่ายรวม');
      await expect(page.getByText('DEMO — ไม่มีการตัดเงินจริง').first()).toBeVisible();
    });
  },
);

/* ============================================================
 * ตั้งแต่จุดนี้เป็นเคสที่ **เปลี่ยนสถานะจริง** (Phase 3)
 * เรียงไว้ท้ายไฟล์เพราะข้อมูล seed ถูกแก้ถาวรจนกว่าจะ seed ใหม่รอบหน้า
 * ============================================================ */

testCase(
  { id: 'TC-048', priority: 'P0', feature: FEATURE },
  'หยุดชั่วคราวแล้วรายการย้ายไปกลุ่มหยุดชั่วคราว และ DB บันทึกว่าผู้ซื้อเป็นคนหยุดเอง',
  async ({ page }) => {
    const id = SUBSCRIPTIONS.toothpaste.id;

    await test.step('Arrange — เปิดหน้ารายการของฉัน', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
      await expect(page.locator(ids.subscriptions.action.pause(id))).toBeVisible();
    });

    await test.step('Act — กดหยุดชั่วคราวแล้วยืนยัน', async () => {
      await page.locator(ids.subscriptions.action.pause(id)).click();
      await expect(page.locator(ids.subscriptions.confirmBody)).toContainText(
        'ไม่สร้างออเดอร์และไม่ตัดเงิน',
      );
      await page.locator(ids.subscriptions.confirmOk).click();
    });

    await test.step('Assert — อยู่กลุ่มหยุดชั่วคราวบนจอ และ DB เป็น paused/user', async () => {
      await expect(
        page.locator(`${ids.subscriptions.groupPaused} ${ids.subscriptions.item(id)}`),
      ).toBeVisible();
      await expect(page.locator(ids.subscriptions.status(id))).toHaveText('หยุดชั่วคราว');

      const row = await subscriptionRow(id);
      expect(row.status).toBe('paused');
      // 'user' เท่านั้น — 'shop_suspended' เป็นการแช่แข็งของระบบที่ผู้ซื้อตั้งเองไม่ได้
      expect(row.paused_reason).toBe('user');
    });
  },
);

testCase(
  { id: 'TC-049', priority: 'P1', feature: FEATURE },
  'เลื่อนวันส่ง 7 วันแล้ววันรอบใน DB ตรงกับที่กล่องยืนยันบอกไว้',
  async ({ page }) => {
    const id = SUBSCRIPTIONS.coffeeMonthly.id;
    let expected = '';

    await test.step('Arrange — คำนวณวันที่คาดหวังจากวันรอบปัจจุบันใน DB', async () => {
      const before = (await subscriptionRow(id)).next_order_date;
      const shifted = new Date(`${before!}T00:00:00Z`);
      shifted.setUTCDate(shifted.getUTCDate() + 7);
      expected = shifted.toISOString().slice(0, 10);

      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
    });

    await test.step('Act — กดเลื่อน 7 วันแล้วยืนยัน', async () => {
      await page.locator(ids.subscriptions.action.reschedule(id)).click();
      await expect(page.locator(ids.subscriptions.confirmBody)).toContainText('เลื่อนจาก');
      await page.locator(ids.subscriptions.confirmOk).click();
    });

    await test.step('Assert — DB เก็บวันใหม่ตรงเป๊ะ ไม่ใช่แค่ข้อความบนจอ', async () => {
      await expect(page.locator(ids.subscriptions.error)).toHaveCount(0);
      expect((await subscriptionRow(id)).next_order_date).toBe(expected);
    });
  },
);

testCase(
  { id: 'TC-050', priority: 'P0', feature: FEATURE },
  'เปลี่ยนรอบส่งเป็นราย 2 เดือน — แผนใน DB เปลี่ยน แต่วันรอบถัดไปคงเดิม (W05)',
  async ({ page }) => {
    const id = SUBSCRIPTIONS.coffeeMonthly.id;
    const target = PRODUCTS.coffeeMedium.plans['2m'].id;
    let before: string | null = null;

    await test.step('Arrange — เปิดหน้ารายการของฉัน', async () => {
      before = (await subscriptionRow(id)).next_order_date;
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
    });

    await test.step('Act — กดเปลี่ยนรอบส่งแล้วเลือกรอบ 2 เดือน', async () => {
      await page.locator(ids.subscriptions.action.plan(id)).click();
      await expect(page.locator(ids.subscriptions.planModal)).toBeVisible();
      await page.locator(ids.subscriptions.planOption(target)).click();
    });

    await test.step('Assert — plan_id ใน DB เป็นแผนใหม่ และ next_order_date ไม่ขยับ', async () => {
      await expect(page.locator(ids.subscriptions.error)).toHaveCount(0);

      const row = await subscriptionRow(id);
      expect(row.plan_id).toBe(target);
      expect(row.next_order_date).toBe(before);
      await expect(page.locator(ids.subscriptions.item(id))).toContainText('ทุก 2 เดือน');
    });
  },
);

testCase(
  { id: 'TC-051', priority: 'P1', feature: FEATURE },
  'เปลี่ยนที่อยู่จัดส่งแล้ว address_id ใน DB เปลี่ยนตาม',
  async ({ page }) => {
    /**
     * ใช้รายการอาหารแมว (ส่งไปที่ทำงาน) ย้ายมาที่บ้าน — ไม่ใช่รายการกาแฟ
     * เพราะเทส checkout ก่อนหน้าสมัครกาแฟไว้ที่ทั้งสองที่อยู่แล้ว การย้ายจะชนกฎ
     * "แผนเดียวกัน + ที่อยู่เดียวกันห้ามซ้ำ" ซึ่งเป็นคนละเรื่องกับที่เคสนี้ทดสอบ
     */
    const id = SUBSCRIPTIONS.catFoodPaused.id;

    await test.step('Arrange — เปิดกล่องเปลี่ยนที่อยู่', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
      await page.locator(ids.subscriptions.action.address(id)).click();
      await expect(page.locator(ids.subscriptions.addressModal)).toBeVisible();
    });

    await test.step('Act — เลือกที่อยู่บ้าน', async () => {
      await page.locator(ids.subscriptions.addressOption(ADDRESSES.home.id)).click();
    });

    await test.step('Assert — DB ชี้ไปที่อยู่ใหม่', async () => {
      await expect(page.locator(ids.subscriptions.error)).toHaveCount(0);
      expect((await subscriptionRow(id)).address_id).toBe(ADDRESSES.home.id);
    });
  },
);

testCase(
  { id: 'TC-052', priority: 'P0', feature: FEATURE },
  'ยกเลิกรายการที่หยุดไว้ → ย้ายไปกลุ่มยกเลิกแล้ว ปุ่มหายหมด และ DB ไม่มีรอบถัดไป',
  async ({ page }) => {
    const id = SUBSCRIPTIONS.toothpaste.id;

    await test.step('Arrange — เปิดหน้ารายการของฉัน (รายการนี้ถูกหยุดไว้จาก TC-048)', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
      await expect(page.locator(ids.subscriptions.action.cancel(id))).toBeVisible();
    });

    await test.step('Act — กดยกเลิกแล้วยืนยัน', async () => {
      await page.locator(ids.subscriptions.action.cancel(id)).click();
      await expect(page.locator(ids.subscriptions.confirmBody)).toContainText('ยกเลิกถาวร');
      await page.locator(ids.subscriptions.confirmOk).click();
    });

    await test.step('Assert — อยู่กลุ่มยกเลิกแล้ว ไม่มีปุ่ม action เหลือ และ DB เป็น cancelled', async () => {
      await expect(
        page.locator(`${ids.subscriptions.groupCancelled} ${ids.subscriptions.item(id)}`),
      ).toBeVisible();
      await expect(page.locator(ids.subscriptions.action.resume(id))).toHaveCount(0);
      await expect(page.locator(ids.subscriptions.action.cancel(id))).toHaveCount(0);

      const row = await subscriptionRow(id);
      expect(row.status).toBe('cancelled');
      // CHECK subs_state_consistent บังคับไว้ที่ DB ด้วย: ยกเลิกแล้วต้องไม่มีรอบค้าง
      expect(row.next_order_date).toBeNull();
    });
  },
);

testCase(
  { id: 'TC-053', priority: 'P0', feature: FEATURE },
  '★ รายการที่ระบบแช่แข็งเพราะร้านถูกระงับ — ไม่มีปุ่ม และยิง API ตรงข้าม UI ก็ยังถูกปฏิเสธ',
  async ({ page }) => {
    const id = SUBSCRIPTIONS.catFoodPaused.id;

    await test.step('Arrange — ทำให้รายการถูกแช่แข็งแบบที่แอดมินระงับร้าน', async () => {
      await queryTestDatabase(
        `update subscriptions
            set status = 'paused', paused_at = now(), paused_reason = 'shop_suspended'
          where id = $1`,
        [id],
      );
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
    });

    await test.step('Act + Assert (UI) — เห็นป้ายร้านถูกระงับ และไม่มีปุ่มกลับมาใช้งาน', async () => {
      await expect(page.locator(ids.subscriptions.status(id))).toHaveText('ร้านถูกระงับ');
      await expect(page.locator(ids.subscriptions.frozenNote(id))).toBeVisible();
      await expect(page.locator(ids.subscriptions.action.resume(id))).toHaveCount(0);
    });

    await test.step('Act + Assert (API) — ยิง resume ตรงด้วย token จริง → 409 (ปุ่มที่ซ่อนไม่ใช่ security)', async () => {
      const session = await apiLogin(USERS.buyer.email, USERS.buyer.password);
      const res = await fetch(`${apiBaseUrl()}/subscriptions/${id}/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: '{}',
      });

      expect(res.status).toBe(409);
      expect(((await res.json()) as { code: string }).code).toBe('SHOP_SUSPENDED');

      const row = await subscriptionRow(id);
      expect(row.status).toBe('paused');
      expect(row.paused_reason).toBe('shop_suspended');
    });

    await test.step('Cleanup — คืนเป็นการหยุดโดยผู้ใช้เองตามสภาพเดิมของ seed', async () => {
      await queryTestDatabase(
        `update subscriptions set paused_reason = 'user' where id = $1`,
        [id],
      );
    });
  },
);
