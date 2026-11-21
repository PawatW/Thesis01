/**
 * Feature 01 — หน้าโปรไฟล์ (แก้ชื่อที่แสดง / เบอร์โทร)
 *
 * ชื่อของ buyer ถูก globalSetup ประทับเป็น canary ไว้ เคสที่แก้ชื่อจึงต้อง
 * คืนค่าเดิมกลับให้ด้วย มิฉะนั้นเคสอื่นที่เทียบ canary จะแดงตามกันไปหมด
 */
import { testCase, test, expect } from '../helpers/test-case';
import { gotoApp, loginAs } from '../helpers/login';
import * as ids from '../helpers/selectors';
import { CANARY_DISPLAY_NAME } from '../helpers/test-data';

const FEATURE = '01 — Profile';

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
