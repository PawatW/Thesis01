/**
 * Feature 08 — ที่อยู่จัดส่ง (เพิ่ม / แก้ / ตั้งเป็นหลัก / ลบ)
 *
 * ข้อจำกัดสองข้อที่บังคับอยู่ที่ฐานข้อมูล ไม่ใช่แค่ในแอป — เคสในไฟล์นี้พิสูจน์
 * ว่าผู้ใช้เห็นผลของมันเป็นภาษาไทยที่อ่านรู้เรื่อง:
 *   1. ที่อยู่หลักมีได้อันเดียว (migration `*_one_default_address`)
 *   2. ที่อยู่ที่ยังมี subscription ผูกอยู่ ลบไม่ได้ (FK)
 */
import { testCase, test, expect } from '../helpers/test-case';
import { gotoApp, loginAs } from '../helpers/login';
import * as ids from '../helpers/selectors';
import { ADDRESSES, USERS } from '../helpers/test-data';
import { queryTestDatabase } from '../setup/database';

const FEATURE = '08 — Addresses';

const NEW_ADDRESS = {
  label: 'ที่อยู่ e2e',
  recipient: 'ผู้รับทดสอบ',
  phone: '0900000000',
  line: '1 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ',
  province: 'กรุงเทพมหานคร',
  postcode: '10110',
};

/**
 * คืนสภาพให้ spec ถัดไป — ลบที่อยู่ที่เคสสร้างไว้ และตั้ง "บ้าน" กลับเป็นที่อยู่หลัก
 * ทำผ่าน SQL ตรงเพราะเป็นงานทำความสะอาด ไม่ใช่สิ่งที่กำลังทดสอบ
 */
test.afterAll(async () => {
  await queryTestDatabase(
    `delete from addresses where user_id = $1 and label = $2`,
    [USERS.buyer.id, NEW_ADDRESS.label],
  );
  await queryTestDatabase(`update addresses set is_default = false where user_id = $1`, [
    USERS.buyer.id,
  ]);
  await queryTestDatabase(`update addresses set is_default = true where id = $1`, [
    ADDRESSES.home.id,
  ]);
});

testCase(
  { id: 'TC-032', priority: 'P1', feature: FEATURE },
  'หน้าที่อยู่แสดงที่อยู่ทั้งหมดของผู้ใช้ พร้อมป้ายที่อยู่หลัก',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อ', async () => {
      await loginAs(page, 'buyer');
    });

    await test.step('Act — เปิดหน้าที่อยู่จัดส่ง', async () => {
      await gotoApp(page, '/profile/addresses');
    });

    await test.step('Assert — เห็นที่อยู่ทั้งสองของ seed และ "บ้าน" ถูกทำเครื่องหมายเป็นหลัก', async () => {
      await expect(page.locator(ids.addresses.item(ADDRESSES.home.id))).toBeVisible();
      await expect(page.locator(ids.addresses.item(ADDRESSES.work.id))).toBeVisible();
      await expect(page.locator(ids.addresses.defaultBadge(ADDRESSES.home.id))).toBeVisible();
      await expect(page.locator(ids.addresses.defaultBadge(ADDRESSES.work.id))).toHaveCount(0);
    });
  },
);

testCase(
  { id: 'TC-033', priority: 'P0', feature: FEATURE },
  'เพิ่มที่อยู่ใหม่แล้วโผล่ในรายการทันที',
  async ({ page }) => {
    await test.step('Arrange — เปิดหน้าที่อยู่แล้วกดเพิ่มที่อยู่ใหม่', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/profile/addresses');
      await page.locator(ids.addresses.create).click();
      await expect(page.locator(ids.addresses.form)).toBeVisible();
    });

    await test.step('Act — กรอกข้อมูลครบทุกช่องแล้วบันทึก', async () => {
      await page.locator(ids.addresses.label).fill(NEW_ADDRESS.label);
      await page.locator(ids.addresses.recipient).fill(NEW_ADDRESS.recipient);
      await page.locator(ids.addresses.phone).fill(NEW_ADDRESS.phone);
      await page.locator(ids.addresses.line).fill(NEW_ADDRESS.line);
      await page.locator(ids.addresses.province).fill(NEW_ADDRESS.province);
      await page.locator(ids.addresses.postcode).fill(NEW_ADDRESS.postcode);
      await page.locator(ids.addresses.submit).click();
    });

    await test.step('Assert — ฟอร์มปิดลง และที่อยู่ใหม่อยู่ในฐานข้อมูลกับบนหน้าจอ', async () => {
      await expect(page.locator(ids.addresses.form)).toHaveCount(0);

      const rows = await queryTestDatabase<{ id: string; recipient_name: string }>(
        `select id, recipient_name from addresses where user_id = $1 and label = $2`,
        [USERS.buyer.id, NEW_ADDRESS.label],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.recipient_name).toBe(NEW_ADDRESS.recipient);
      await expect(page.locator(ids.addresses.item(rows[0]!.id))).toBeVisible();
    });
  },
);

testCase(
  { id: 'TC-034', priority: 'P1', feature: FEATURE },
  'แก้ไขที่อยู่เดิมแล้วข้อมูลใหม่ถูกบันทึก',
  async ({ page }) => {
    const updatedRecipient = 'ผู้รับที่แก้แล้ว';
    let targetId = '';

    await test.step('Arrange — เปิดหน้าที่อยู่แล้วกดแก้ไขที่อยู่ที่เคสก่อนสร้างไว้', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/profile/addresses');

      const rows = await queryTestDatabase<{ id: string }>(
        `select id from addresses where user_id = $1 and label = $2`,
        [USERS.buyer.id, NEW_ADDRESS.label],
      );
      expect(rows, 'ต้องมีที่อยู่จาก TC-033 อยู่ก่อน').toHaveLength(1);
      targetId = rows[0]!.id;

      await page.locator(ids.addresses.edit(targetId)).click();
      await expect(page.locator(ids.addresses.form)).toBeVisible();
    });

    await test.step('Act — เปลี่ยนชื่อผู้รับแล้วบันทึก', async () => {
      await page.locator(ids.addresses.recipient).fill(updatedRecipient);
      await page.locator(ids.addresses.submit).click();
    });

    await test.step('Assert — ชื่อผู้รับใหม่ถูกเก็บลงฐานข้อมูล', async () => {
      await expect(page.locator(ids.addresses.form)).toHaveCount(0);
      const rows = await queryTestDatabase<{ recipient_name: string }>(
        `select recipient_name from addresses where id = $1`,
        [targetId],
      );
      expect(rows[0]!.recipient_name).toBe(updatedRecipient);
    });
  },
);

testCase(
  { id: 'TC-035', priority: 'P0', feature: FEATURE },
  'ตั้งที่อยู่อื่นเป็นหลักแล้วที่อยู่หลักเดิมถูกปลดให้เหลืออันเดียว',
  async ({ page }) => {
    await test.step('Arrange — เปิดหน้าที่อยู่ โดย "บ้าน" เป็นที่อยู่หลักอยู่', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/profile/addresses');
      await expect(page.locator(ids.addresses.defaultBadge(ADDRESSES.home.id))).toBeVisible();
    });

    await test.step('Act — กดตั้ง "ที่ทำงาน" เป็นที่อยู่หลัก', async () => {
      await page.locator(ids.addresses.setDefault(ADDRESSES.work.id)).click();
    });

    await test.step('Assert — ที่ทำงานเป็นหลัก บ้านถูกปลด และ DB มีที่อยู่หลักอันเดียว', async () => {
      await expect(page.locator(ids.addresses.defaultBadge(ADDRESSES.work.id))).toBeVisible();
      await expect(page.locator(ids.addresses.defaultBadge(ADDRESSES.home.id))).toHaveCount(0);

      const rows = await queryTestDatabase<{ id: string }>(
        `select id from addresses where user_id = $1 and is_default = true`,
        [USERS.buyer.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(ADDRESSES.work.id);
    });
  },
);

testCase(
  { id: 'TC-036', priority: 'P0', feature: FEATURE },
  'ลบที่อยู่ที่ยังมีรายการสมัครผูกอยู่ไม่ได้ และได้ข้อความบอกเหตุผล',
  async ({ page }) => {
    await test.step('Arrange — เปิดหน้าที่อยู่ (seed ผูก subscription ไว้กับที่อยู่บ้าน)', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/profile/addresses');
      await expect(page.locator(ids.addresses.item(ADDRESSES.home.id))).toBeVisible();
    });

    await test.step('Act — กดลบที่อยู่บ้าน', async () => {
      await page.locator(ids.addresses.remove(ADDRESSES.home.id)).click();
    });

    await test.step('Assert — ขึ้นข้อความปฏิเสธ และที่อยู่ยังอยู่ทั้งบนจอและใน DB', async () => {
      await expect(page.locator(ids.addresses.listError)).toBeVisible();
      await expect(page.locator(ids.addresses.item(ADDRESSES.home.id))).toBeVisible();

      const rows = await queryTestDatabase<{ id: string }>(
        `select id from addresses where id = $1`,
        [ADDRESSES.home.id],
      );
      expect(rows).toHaveLength(1);
    });
  },
);

testCase(
  { id: 'TC-037', priority: 'P1', feature: FEATURE },
  'ลบที่อยู่ที่ไม่มีใครใช้อยู่ได้สำเร็จ',
  async ({ page }) => {
    let targetId = '';

    await test.step('Arrange — หาที่อยู่ที่เคสก่อนสร้างไว้ (ยังไม่มี subscription ผูก)', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/profile/addresses');

      const rows = await queryTestDatabase<{ id: string }>(
        `select id from addresses where user_id = $1 and label = $2`,
        [USERS.buyer.id, NEW_ADDRESS.label],
      );
      expect(rows).toHaveLength(1);
      targetId = rows[0]!.id;
      await expect(page.locator(ids.addresses.item(targetId))).toBeVisible();
    });

    await test.step('Act — กดลบที่อยู่นั้น', async () => {
      await page.locator(ids.addresses.remove(targetId)).click();
    });

    await test.step('Assert — หายไปจากหน้าจอและจากฐานข้อมูล', async () => {
      await expect(page.locator(ids.addresses.item(targetId))).toHaveCount(0);
      const rows = await queryTestDatabase(`select id from addresses where id = $1`, [targetId]);
      expect(rows).toHaveLength(0);
    });
  },
);

testCase(
  { id: 'TC-038', priority: 'P2', feature: FEATURE },
  'บันทึกที่อยู่โดยไม่กรอกช่องบังคับแล้วถูกปฏิเสธรายช่อง',
  async ({ page }) => {
    await test.step('Arrange — เปิดฟอร์มเพิ่มที่อยู่ใหม่', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/profile/addresses');
      await page.locator(ids.addresses.create).click();
      await expect(page.locator(ids.addresses.form)).toBeVisible();
    });

    await test.step('Act — กดบันทึกทั้งที่ยังไม่กรอกอะไร', async () => {
      await page.locator(ids.addresses.submit).click();
    });

    await test.step('Assert — ขึ้น error ที่ช่องผู้รับ และฟอร์มยังเปิดอยู่', async () => {
      await expect(page.locator(ids.addresses.recipientError)).toBeVisible();
      await expect(page.locator(ids.addresses.form)).toBeVisible();
    });
  },
);
