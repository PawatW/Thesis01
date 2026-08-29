/**
 * Feature 01 — หน้าโปรไฟล์ (แก้ชื่อที่แสดง / เบอร์โทร)
 *
 * ชื่อของ buyer ถูก globalSetup ประทับเป็น canary ไว้ เคสที่แก้ชื่อจึงต้อง
 * คืนค่าเดิมกลับให้ด้วย มิฉะนั้นเคสอื่นที่เทียบ canary จะแดงตามกันไปหมด
 */
import { testCase, test, expect } from '../helpers/test-case';
import { gotoApp, loginAs } from '../helpers/login';
import * as ids from '../helpers/selectors';
import { CANARY_DISPLAY_NAME, USERS } from '../helpers/test-data';

const FEATURE = '01 — Profile';

testCase(
  { id: 'TC-027', priority: 'P1', feature: FEATURE },
  'หน้าโปรไฟล์แสดงอีเมลและชื่อของบัญชีที่ล็อกอินอยู่',
  async ({ page }) => {
    await test.step('Arrange — ล็อกอินเป็นผู้ซื้อ', async () => {
      await loginAs(page, 'buyer');
    });

    await test.step('Act — เปิดหน้าโปรไฟล์', async () => {
      await gotoApp(page, '/profile');
    });

    await test.step('Assert — เห็นอีเมลและชื่อตรงกับบัญชีที่ล็อกอิน', async () => {
      await expect(page.locator(ids.profile.email)).toHaveText(USERS.buyer.email);
      await expect(page.locator(ids.profile.displayName)).toHaveText(CANARY_DISPLAY_NAME);
    });
  },
);

testCase(
  { id: 'TC-028', priority: 'P1', feature: FEATURE },
  'แก้ชื่อที่แสดงแล้วบันทึกสำเร็จและมีผลทันทีทั้งแอป',
  async ({ page }) => {
    const newName = 'ชื่อใหม่จาก e2e';

    await test.step('Arrange — เปิดหน้าโปรไฟล์', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/profile');
      await expect(page.locator(ids.profile.save)).toBeVisible();
    });

    await test.step('Act — เปลี่ยนชื่อที่แสดงแล้วกดบันทึก', async () => {
      await page.locator(ids.profile.name).fill(newName);
      await page.locator(ids.profile.save).click();
    });

    await test.step('Assert — ขึ้นว่าบันทึกแล้ว และชื่อใหม่ถูกใช้ทันทีในหน้าแรก', async () => {
      await expect(page.locator(ids.profile.saved)).toBeVisible();
      await expect(page.locator(ids.profile.displayName)).toHaveText(newName);

      await gotoApp(page, '/');
      await expect(page.locator(ids.home.greeting)).toContainText(newName);
    });

    await test.step('Cleanup — คืนชื่อ canary กลับ เพื่อไม่ให้เคสอื่นแดงตาม', async () => {
      await gotoApp(page, '/profile');
      await page.locator(ids.profile.name).fill(CANARY_DISPLAY_NAME);
      await page.locator(ids.profile.save).click();
      await expect(page.locator(ids.profile.saved)).toBeVisible();
    });
  },
);

testCase(
  { id: 'TC-029', priority: 'P2', feature: FEATURE },
  'ชื่อที่แสดงว่างเปล่าถูกปฏิเสธและไม่บันทึกทับของเดิม',
  async ({ page }) => {
    await test.step('Arrange — เปิดหน้าโปรไฟล์', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/profile');
      await expect(page.locator(ids.profile.save)).toBeVisible();
    });

    await test.step('Act — ล้างช่องชื่อแล้วกดบันทึก', async () => {
      await page.locator(ids.profile.name).fill('');
      await page.locator(ids.profile.save).click();
    });

    await test.step('Assert — ขึ้น error ที่ช่องชื่อ และชื่อเดิมยังอยู่', async () => {
      await expect(page.locator(ids.profile.nameError)).toBeVisible();
      await expect(page.locator(ids.profile.saved)).toHaveCount(0);
      await expect(page.locator(ids.profile.displayName)).toHaveText(CANARY_DISPLAY_NAME);
    });
  },
);

testCase(
  { id: 'TC-030', priority: 'P2', feature: FEATURE },
  'เบอร์โทรผิดรูปแบบถูกปฏิเสธที่ระดับฟอร์ม',
  async ({ page }) => {
    await test.step('Arrange — เปิดหน้าโปรไฟล์', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/profile');
      await expect(page.locator(ids.profile.save)).toBeVisible();
    });

    await test.step('Act — ใส่เบอร์โทรที่มีตัวอักษรปนแล้วกดบันทึก', async () => {
      await page.locator(ids.profile.phone).fill('abcdefg');
      await page.locator(ids.profile.save).click();
    });

    await test.step('Assert — ขึ้น error ระดับฟอร์ม ไม่ขึ้นว่าบันทึกแล้ว', async () => {
      await expect(page.locator(ids.profile.error)).toBeVisible();
      await expect(page.locator(ids.profile.saved)).toHaveCount(0);
    });
  },
);

testCase(
  { id: 'TC-031', priority: 'P2', feature: FEATURE },
  'ลิงก์ในหน้าโปรไฟล์พาไปหน้าจัดการที่อยู่ได้',
  async ({ page }) => {
    await test.step('Arrange — เปิดหน้าโปรไฟล์', async () => {
      await loginAs(page, 'buyer');
      await gotoApp(page, '/profile');
      await expect(page.locator(ids.profile.linkAddresses)).toBeVisible();
    });

    await test.step('Act — กดลิงก์ที่อยู่จัดส่ง', async () => {
      await page.locator(ids.profile.linkAddresses).click();
    });

    await test.step('Assert — เข้าหน้าที่อยู่และเห็นที่อยู่ของ seed', async () => {
      await expect(page.locator(ids.addresses.create)).toBeVisible();
    });
  },
);
