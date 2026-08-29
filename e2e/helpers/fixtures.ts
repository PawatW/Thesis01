/**
 * fixture กลางของทุกเทส — ดัก exception ที่หลุดออกมาจากตัวแอป
 *
 * RN บนเว็บกลืน error หลายอย่างไว้ในหน้าจอเปล่า ๆ เทสจึงอาจ "ผ่าน" ทั้งที่แอปพัง
 * ตรงกลาง fixture นี้จับ `pageerror` (exception ที่ไม่มีใคร catch) ไว้ แล้ว
 * ทำให้เคสแดงพร้อมข้อความจริง แทนที่จะแดงเพราะ `waitFor` หมดเวลาแบบไม่บอกสาเหตุ
 */
import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      await use(errors);

      if (errors.length === 0) return;
      await testInfo.attach('page-errors.txt', {
        body: errors.join('\n'),
        contentType: 'text/plain',
      });
      // เทสที่แดงอยู่แล้วไม่ต้องซ้ำ — ข้อความแรกคือสาเหตุที่อ่านง่ายกว่า
      if (testInfo.status === testInfo.expectedStatus) {
        expect(errors, 'แอปโยน exception ที่ไม่มีใคร catch ระหว่างเทสนี้').toEqual([]);
      }
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
