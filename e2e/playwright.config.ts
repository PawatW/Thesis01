/**
 * Playwright config ของ ANAN
 *
 * ★ ไม่มี `webServer` block โดยตั้งใจ ★
 * block นั้นสั่งได้แค่ "รันคำสั่งนี้" ซึ่งคำสั่งจะไปอ่าน `anan-api/.env` เอง =
 * ชี้ไปฐานข้อมูล `anan` ของงานจริงแล้วโดน seed ล้างทิ้ง
 * `globalSetup` จึงยกเซิร์ฟเวอร์เองโดยประกอบ env ทีละตัว และมีด่านตรวจว่า
 * API ต่อกับ DB ทดสอบจริงก่อนปล่อยให้เทสรัน (setup/global-setup.ts)
 */
import { defineConfig, devices } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

loadDotenv({ path: resolve(__dirname, '.env'), quiet: true });

const WEB_PORT = process.env.E2E_WEB_PORT ?? '8082';

export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  globalSetup: require.resolve('./setup/global-setup'),

  /**
   * เทสทุกเคสใช้ฐานข้อมูลก้อนเดียวกันและ seed ชุดเดียวกัน — รันขนานกันเมื่อไหร่
   * เคสที่แก้ที่อยู่จะไปทำให้เคส checkout เห็นข้อมูลคนละแบบ (เหตุผลเดียวกับที่
   * e2e ฝั่ง API ใช้ `--runInBand`)
   */
  workers: 1,
  fullyParallel: false,

  /** เทสที่ `.only` ค้างอยู่ต้องไม่ทำให้ชุดผ่านแบบเงียบ ๆ */
  forbidOnly: process.env.CI === 'true',
  retries: 0,

  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['./reporters/markdown-reporter.ts', { outputFile: 'reports/report.md' }],
  ],

  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    /** artifact เฉพาะตอนพัง — เก็บทุกเคสจะกินดิสก์เป็นกิกะไบต์โดยไม่มีใครเปิดดู */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
  },

  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
});
