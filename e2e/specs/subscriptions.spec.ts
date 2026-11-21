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
  quantity: number;
  resume_on: string | null;
  cancel_reason: string | null;
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
            address_id,
            quantity,
            resume_on::text as resume_on,
            cancel_reason::text as cancel_reason
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
  { id: 'TC-125', priority: 'P1', feature: FEATURE },
  'ปฏิทินการตัดเงินของเดือนนี้ลงวันตรงกับ next_order_date และยอดตรงกับราคาคูณจำนวนใน DB',
  async ({ page }) => {
    /*
     * ★ เลือกเป้าหมายจาก DB ตอนรัน ไม่ใช่ผูกกับ subscription ใบใดใบหนึ่งของ seed ★
     * เคสของ engine/coupons ที่รันก่อนหน้าเลื่อน `next_order_date` ของ seed ไปได้
     * (เจอจริงตอนรันทั้งชุด: ยาสีฟันขยับจาก "วันนี้" ไปเป็นเดือนถัดไป) — ผูกกับใบเดิม
     * แล้วเคสจะแดงเพราะลำดับการรัน ไม่ใช่เพราะหน้าจอผิด
     *
     * สิ่งที่เคสนี้การันตีคือ **หน้าจอตรงกับ DB**: รอบแรกที่ตกในเดือนปฏิทินนี้ต้อง
     * ปรากฏในปฏิทินด้วยวันและยอดเดียวกับที่ฐานข้อมูลถืออยู่
     */
    const rows = await queryTestDatabase<{
      id: string;
      next_order_date: string;
      amount: string;
    }>(
      // ยอดที่คาดหวังต้องหักคูปองที่ "จองไว้" กับรอบถัดไปด้วย เพราะนั่นคือยอดที่จะถูก
      // ตัดจริง (เคสของ feature 18 ที่รันก่อนหน้าจองคูปองค้างไว้ได้)
      //
      // `greatest(next_order_date, วันนี้)` = วันที่ engine จะตัดจริง — รอบที่ค้างจาก
      // อดีต (engine ยังไม่ได้รัน) ถูกเก็บตกในวันที่รันครั้งถัดไป ไม่ใช่ข้ามไป จึงต้อง
      // เทียบด้วยวันที่หนีบแล้วให้ตรงกับที่หน้าจอลงในปฏิทิน
      `select s.id,
              greatest(s.next_order_date, $2::date)::text as next_order_date,
              (p.price_per_cycle * s.quantity
                 - coalesce((select sum(r.discount_amount)
                               from coupon_redemptions r
                              where r.subscription_id = s.id
                                and r.status = 'reserved'), 0))::numeric::text as amount
         from subscriptions s
         join product_plans p on p.id = s.plan_id
        where s.buyer_id = $1
          and s.status = 'active'
          and s.next_order_date is not null
          and date_trunc('month', greatest(s.next_order_date, $2::date))
              = date_trunc('month', $2::date)
        order by 2`,
      [USERS.buyer.id, todayISO()],
    );

    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อของ seed', async () => {
      await loginAs(page, 'buyer');
    });

    await test.step('Act — เปิดหน้ารายการของฉัน', async () => {
      await gotoApp(page, '/subscriptions');
    });

    const first = rows[0];
    if (first == null) {
      await test.step('Assert — ไม่มีรอบในเดือนนี้ → ต้องไม่มีปฏิทินให้เข้าใจผิด', async () => {
        await expect(page.locator(ids.subscriptions.schedule)).toHaveCount(0);
        await expect(page.locator(ids.subscriptions.spend)).toContainText(
          'ไม่มีรอบที่ต้องจ่าย',
        );
      });
      return;
    }

    await test.step('Assert — รอบแรกของเดือนนี้ปรากฏในปฏิทิน พร้อมวันและยอดที่ตรงกับ DB', async () => {
      await expect(page.locator(ids.subscriptions.schedule)).toBeVisible();

      const row = page.locator(
        ids.subscriptions.scheduleRow(first.id, first.next_order_date),
      );
      await expect(row).toBeVisible();
      await expect(row).toContainText(
        `฿${Number(first.amount).toLocaleString('en-US')}`,
      );
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

    await test.step('Act — กดหยุดชั่วคราว เลือก "ไม่กำหนด" แล้วยืนยัน', async () => {
      await page.locator(ids.subscriptions.action.pause(id)).click();
      await expect(page.locator(ids.subscriptions.pauseModal)).toContainText('ไม่ตัดเงิน');
      // Phase 8.3: กล่องหยุดมีตัวเลือก N รอบ — เคสนี้คือการหยุดแบบไม่มีกำหนด (พฤติกรรมเดิม)
      await page.locator(ids.subscriptions.pauseOption('open')).click();
      await page.locator(ids.subscriptions.pauseConfirm).click();
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
      expect(row.resume_on).toBeNull();
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

    await test.step('Act — กดยกเลิก เลือกเหตุผลแล้วยืนยัน', async () => {
      await page.locator(ids.subscriptions.action.cancel(id)).click();
      await expect(page.locator(ids.subscriptions.cancelModal)).toContainText('ยกเลิกถาวร');
      // ยังไม่เลือกเหตุผล → ปุ่มยืนยันกดไม่ได้ (API ก็ตอบ 400 ถ้ายิงตรง — TC-131)
      await expect(page.locator(ids.subscriptions.cancelConfirm)).toBeDisabled();
      await page.locator(ids.subscriptions.cancelReason('other')).click();
      // รายการที่หยุดอยู่ไม่มีข้อเสนอ — ข้อเสนอทุกตัวเป็น action ของรายการ active
      await expect(page.locator(ids.subscriptions.cancelOffer)).toHaveCount(0);
      await page.locator(ids.subscriptions.cancelConfirm).click();
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
      expect(row.cancel_reason).toBe('other');
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

/* ============================================================
 * Phase 8.3 — retention (feature 06 R1–R3)
 *
 * ทุกเคสสร้างรายการของตัวเองผ่าน API (ที่อยู่ใหม่ทุกครั้ง) แทนการใช้ seed —
 * รายการของ seed ถูก spec อื่นใช้ร่วมกันจนลำดับการรันกลายเป็นเงื่อนไขของเทส
 * ============================================================ */

/**
 * บวกเดือนแบบหนีบปลายเดือน — **เขียนซ้ำในเทสโดยตั้งใจ** (เหมือน engine.e2e-spec)
 * ถ้า import ของแอปมาใช้ เทสจะยืนยันได้แค่ว่าโค้ดเท่ากับตัวมันเอง
 */
function addMonthsISO(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const last = new Date(Date.UTC(y, m + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m + months, Math.min(d.getUTCDate(), last)))
    .toISOString()
    .slice(0, 10);
}

/** ยิง API ตรงด้วย token ของผู้ซื้อเดโม่ */
async function buyerApi<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const session = await apiLogin(USERS.buyer.email, USERS.buyer.password);
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** รายการกาแฟรายเดือนใบใหม่ของผู้ซื้อเดโม่ — เริ่มพรุ่งนี้ ส่งไปที่อยู่ใหม่ */
async function freshSubscription(label: string): Promise<string> {
  const address = await buyerApi<{ id: string }>('/me/addresses', {
    label,
    recipientName: 'ผู้รับ retention',
    phone: '0812345678',
    addressLine: `${label} ถนนทดสอบ`,
    province: 'กรุงเทพมหานคร',
    postcode: '10900',
  });
  const cards = await buyerApi<{ id: string; last4: string }[]>('/me/payment-methods');
  // บัตรลงท้าย 0000 ถูกปฏิเสธเสมอ (payments.spec ผูกไว้) — เลือกใบที่จ่ายผ่าน
  const card = cards.find((c) => c.last4 !== '0000');
  if (card == null) throw new Error('ผู้ซื้อเดโม่ไม่มีบัตรที่จ่ายผ่าน');

  const tomorrow = new Date(`${todayISO()}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const res = await buyerApi<{ subscription: { id: string } }>('/subscriptions', {
    planId: PRODUCTS.coffeeMedium.plans['1m'].id,
    quantity: 1,
    addressId: address.id,
    paymentMethodId: card.id,
    startDate: tomorrow.toISOString().slice(0, 10),
  });
  return res.subscription.id;
}

testCase(
  { id: 'TC-128', priority: 'P0', feature: FEATURE },
  '★ ยกเลิกด้วยเหตุผล "ขอพักก่อน" → ระบบเสนอหยุด 1 รอบ กดรับแล้วรายการไม่ถูกยกเลิก และ DB จำได้ว่ามาจากหน้ายกเลิก',
  async ({ page }) => {
    let id = '';

    await test.step('Arrange — รายการใหม่ที่กำลังใช้งาน', async () => {
      id = await freshSubscription('TC128');
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
      await expect(page.locator(ids.subscriptions.action.cancel(id))).toBeVisible();
    });

    await test.step('Act — กดยกเลิก → เลือก "ขอพักก่อน" → กดรับข้อเสนอ', async () => {
      await page.locator(ids.subscriptions.action.cancel(id)).click();
      await page.locator(ids.subscriptions.cancelReason('taking_break')).click();
      await expect(page.locator(ids.subscriptions.cancelOffer)).toBeVisible();
      // ★ ปุ่มยืนยันยกเลิกยังอยู่ในกล่องเดียวกัน — ข้อเสนอไม่ใช่ด่านบังคับ
      await expect(page.locator(ids.subscriptions.cancelConfirm)).toBeEnabled();
      await page.locator(ids.subscriptions.cancelOfferAccept).click();
    });

    await test.step('Assert — รายการหยุดพักพร้อมวันกลับ ไม่ใช่ยกเลิก + event ระบุ source', async () => {
      await expect(
        page.locator(`${ids.subscriptions.groupPaused} ${ids.subscriptions.item(id)}`),
      ).toBeVisible();
      await expect(page.locator(ids.subscriptions.resumeOn(id))).toBeVisible();

      const row = await subscriptionRow(id);
      expect(row.status).toBe('paused');
      // หมุด = วันเริ่ม · รอบถัดไป = หมุด+1 เดือน · พัก 1 รอบ = หมุด+2 เดือน
      expect(row.resume_on).toBe(addMonthsISO(row.cycle_anchor_date, 2));
      expect(row.cancel_reason).toBeNull();

      const [event] = await queryTestDatabase<{ source: string | null }>(
        `select detail->>'source' as source from subscription_events
          where subscription_id = $1 and event = 'paused' order by id desc limit 1`,
        [id],
      );
      expect(event!.source).toBe('cancel_flow');
    });
  },
);

testCase(
  { id: 'TC-129', priority: 'P0', feature: FEATURE },
  '★ ส่งรอบนี้เลย → เกิดออเดอร์วันนี้ที่จ่ายแล้วด้วยราคาจาก DB และรอบถัดไปนับจากวันนี้',
  async ({ page }) => {
    let id = '';

    await test.step('Arrange — รายการใหม่ที่กำลังใช้งาน', async () => {
      id = await freshSubscription('TC129');
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
    });

    await test.step('Act — กดส่งรอบนี้เลยแล้วยืนยัน', async () => {
      await page.locator(ids.subscriptions.action.shipNow(id)).click();
      await expect(page.locator(ids.subscriptions.confirmBody)).toContainText('ตัดเงินจำลอง');
      // หน้าจอที่พูดถึงยอดเงินต้องมีป้าย DEMO (กฎข้อ 1)
      await expect(page.locator(ids.subscriptions.confirm)).toContainText('DEMO');
      await page.locator(ids.subscriptions.confirmOk).click();
      await expect(page.locator(ids.subscriptions.toast)).toBeVisible();
    });

    await test.step('Assert — DB มีออเดอร์วันนี้ ยอด 255 จ่ายแล้ว · หมุดคือวันนี้', async () => {
      const today = todayISO();
      const orders = await queryTestDatabase<{ amount: string; status: string }>(
        `select o.amount::text as amount, p.status::text as status
           from orders o join payments p on p.order_id = o.id
          where o.subscription_id = $1 and o.cycle_date = $2::date`,
        [id, today],
      );
      expect(orders).toHaveLength(1);
      expect(Number(orders[0]!.amount)).toBe(PRODUCTS.coffeeMedium.plans['1m'].pricePerCycle);
      expect(orders[0]!.status).toBe('paid');

      const row = await subscriptionRow(id);
      expect(row.cycle_anchor_date).toBe(today);
      // ★ ต้องเลื่อนไป 1 รอบจากวันนี้เป๊ะ ไม่ใช่แค่ "อยู่ในอนาคต"
      expect(row.next_order_date).toBe(addMonthsISO(today, 1));
    });
  },
);

testCase(
  { id: 'TC-130', priority: 'P1', feature: FEATURE },
  'เปลี่ยนจำนวนต่อรอบเป็น 3 ชิ้น → ยอดในกล่องคำนวณตาม และ DB บันทึกจำนวนใหม่',
  async ({ page }) => {
    let id = '';

    await test.step('Arrange — รายการใหม่ 1 ชิ้นต่อรอบ', async () => {
      id = await freshSubscription('TC130');
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
    });

    await test.step('Act — เปิดกล่องจำนวน กด + สองครั้ง แล้วบันทึก', async () => {
      await page.locator(ids.subscriptions.action.quantity(id)).click();
      await expect(page.locator(ids.subscriptions.qtyValue)).toHaveText('1');
      // ค่าเดิม = ปุ่มบันทึกกดไม่ได้ (ไม่ยิง request ที่ไม่เปลี่ยนอะไร)
      await expect(page.locator(ids.subscriptions.qtySave)).toBeDisabled();
      await page.locator(ids.subscriptions.qtyPlus).click();
      await page.locator(ids.subscriptions.qtyPlus).click();
      await expect(page.locator(ids.subscriptions.qtyValue)).toHaveText('3');
      await expect(page.locator(ids.subscriptions.qtyTotal)).toContainText('765');
      await page.locator(ids.subscriptions.qtySave).click();
    });

    await test.step('Assert — DB quantity = 3 และการ์ดแสดง 3 ชิ้น/รอบ', async () => {
      await expect(page.locator(ids.subscriptions.item(id))).toContainText('3 ชิ้น/รอบ');
      expect((await subscriptionRow(id)).quantity).toBe(3);
    });
  },
);

testCase(
  { id: 'TC-131', priority: 'P1', feature: FEATURE },
  'ยกเลิกด้วยเหตุผล "ราคาสูงไป" พร้อมข้อความ → DB เก็บหมวดเหตุผล · ยิง API ไม่ส่งเหตุผลถูกปฏิเสธ',
  async ({ page }) => {
    let id = '';

    await test.step('Arrange — รายการใหม่ที่กำลังใช้งาน', async () => {
      id = await freshSubscription('TC131');
      await loginAs(page, 'buyer');
      await gotoApp(page, '/subscriptions');
    });

    await test.step('Act + Assert (API) — ยิง cancel ตรงโดยไม่มีเหตุผล → 400 รายการไม่ถูกแตะ', async () => {
      const session = await apiLogin(USERS.buyer.email, USERS.buyer.password);
      const res = await fetch(`${apiBaseUrl()}/subscriptions/${id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: '{}',
      });
      expect(res.status).toBe(400);
      expect((await subscriptionRow(id)).status).toBe('active');
    });

    await test.step('Act (UI) — เลือก "ราคาสูงไป" เห็นข้อเสนอคูปอง แต่กดยืนยันยกเลิก', async () => {
      await page.locator(ids.subscriptions.action.cancel(id)).click();
      await page.locator(ids.subscriptions.cancelReason('too_expensive')).click();
      await expect(page.locator(ids.subscriptions.cancelOffer)).toBeVisible();
      await page.locator(ids.subscriptions.cancelNote).fill('งบเดือนนี้ไม่พอ');
      await page.locator(ids.subscriptions.cancelConfirm).click();
    });

    await test.step('Assert — กลุ่มยกเลิกแล้ว และ DB เก็บ too_expensive', async () => {
      await expect(
        page.locator(`${ids.subscriptions.groupCancelled} ${ids.subscriptions.item(id)}`),
      ).toBeVisible();
      const row = await subscriptionRow(id);
      expect(row.status).toBe('cancelled');
      expect(row.cancel_reason).toBe('too_expensive');
      const [noted] = await queryTestDatabase<{ cancel_note: string | null }>(
        'select cancel_note from subscriptions where id = $1',
        [id],
      );
      expect(noted!.cancel_note).toBe('งบเดือนนี้ไม่พอ');
    });
  },
);
