/**
 * ยก API + Expo web ขึ้นเอง แล้วคืนวิธีปิดกลับไปให้ globalSetup
 *
 * ทำไมไม่ใช้ `webServer` block ของ Playwright: block นั้นสั่งได้แค่ "รันคำสั่งนี้"
 * ซึ่ง `npm run start:dev` จะไปอ่าน `anan-api/.env` เอง = ชี้ไป DB ของงานจริง
 * ที่นี่เราประกอบ env ของ child process เองทีละตัว DB ทดสอบจึงเป็นทางเดียวที่
 * process ลูกรู้จัก
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { API_DIR, WEB_DIR, loadE2EConfig } from './env';

export interface ManagedServer {
  /** true = มี server ตัวนี้อยู่ก่อนแล้ว เราไม่ได้ยกขึ้นเอง จึงไม่ปิดตอนจบ */
  reused: boolean;
  stop: () => void;
}

const API_READY_TIMEOUT_MS = 90_000;
const WEB_HTML_TIMEOUT_MS = 120_000;
/** bundle แรกของ Metro บนเครื่องนี้ใช้เวลา 2-5 นาที (docs/working-agreement.md §5) */
const WEB_BUNDLE_TIMEOUT_MS = 420_000;

async function waitFor(
  label: string,
  probe: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(
    `รอ ${label} เกิน ${Math.round(timeoutMs / 1000)} วินาทีแล้วยังไม่พร้อม${lastError !== '' ? `\nข้อผิดพลาดล่าสุด: ${lastError}` : ''}`,
  );
}

/** ปิดทั้ง process tree — บน Windows การ kill ตัวแม่อย่างเดียวทิ้ง node ลูกค้างไว้ */
function killTree(child: ChildProcess): void {
  if (child.pid == null || child.exitCode != null) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    // ปิดไปแล้วหรือ pid หายไปก่อน — ไม่ใช่ความผิดพลาดที่ต้องรายงาน
  }
}

function pipeOutput(child: ChildProcess, prefix: string): void {
  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[${prefix}] ${chunk.toString()}`);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[${prefix}] ${chunk.toString()}`);
  });
}

async function apiHealthy(): Promise<boolean> {
  const config = loadE2EConfig();
  const res = await fetch(`${config.apiBaseUrl}/health`);
  if (!res.ok) return false;
  const body = (await res.json()) as { status?: string; db?: string };
  return body.status === 'ok' && body.db === 'up';
}

/**
 * หาไฟล์ entry ที่ `nest build` เพิ่งสร้าง
 *
 * ปกติจะเป็น `dist/main.js` แต่โปรเจกต์นี้ compile `prisma/seed.ts` เข้าไปด้วย
 * tsc จึงยก rootDir ขึ้นมาหนึ่งชั้นแล้วออกเป็น `dist/src/main.js`
 * เช็คทั้งสองที่ ดีกว่าเดาที่เดียวแล้วพังแบบ MODULE_NOT_FOUND ที่อ่านไม่ออก
 */
function apiEntryPoint(): string {
  const candidates = ['dist/main.js', 'dist/src/main.js'];
  for (const candidate of candidates) {
    if (existsSync(join(API_DIR, candidate))) return candidate;
  }
  throw new Error(
    [
      'หาไฟล์ที่ build แล้วของ API ไม่เจอ',
      `ลองหาที่: ${candidates.join(' และ ')}`,
      'สั่ง `npm run build` ในโฟลเดอร์ anan-api ดูว่าผ่านไหม',
    ].join('\n'),
  );
}

export async function startApi(): Promise<ManagedServer> {
  const config = loadE2EConfig();

  if (await apiHealthy().catch(() => false)) {
    console.log(`[e2e] พบ API ที่ port ${config.apiPort} อยู่แล้ว — ใช้ตัวเดิม`);
    return { reused: true, stop: () => {} };
  }

  if (!config.skipApiBuild) {
    console.log('[e2e] nest build …');
    execFileSync('npm', ['run', 'build'], {
      cwd: API_DIR,
      stdio: 'inherit',
      shell: true,
    });
  }

  const child = spawn('node', [apiEntryPoint()], {
    cwd: API_DIR,
    shell: false,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      // ★ จุดสำคัญ ★ DB ทดสอบมาจากที่นี่ที่เดียว
      // @nestjs/config ให้ process.env ชนะค่าในไฟล์ .env เสมอ
      DATABASE_URL: config.databaseUrl,
      PORT: String(config.apiPort),
      // /auth/login จำกัด 10 ครั้ง/นาที/IP — suite จะโดน 429 ถ้าไม่ปิด
      // สวิตช์นี้ทำงานเฉพาะเมื่อ NODE_ENV=test (AppThrottlerGuard เป็น allowlist)
      THROTTLE_DISABLED: 'true',
      // หน้า "ตั้งค่าเมล" ของผู้ดูแลเปิดโหมดเปลี่ยนเส้นทางได้ก็ต่อเมื่อเครื่องอนุญาต —
      // ถ้าไม่ตั้งตรงนี้ สวิตช์จะถูกล็อกและ TC ที่ทดสอบโหมดนี้จะแดงทั้งที่โค้ดถูก
      MAIL_UAT_MODE_AVAILABLE: 'true',
      CORS_ORIGINS: `${config.webBaseUrl},http://localhost:${config.webPort}`,
      ...config.jwt,
    },
  });
  pipeOutput(child, 'api');

  await waitFor(`API ที่ ${config.apiBaseUrl}`, apiHealthy, API_READY_TIMEOUT_MS);
  console.log(`[e2e] API พร้อมที่ ${config.apiBaseUrl}`);

  return { reused: false, stop: () => killTree(child) };
}

async function webServing(): Promise<boolean> {
  const config = loadE2EConfig();
  const res = await fetch(config.webBaseUrl);
  if (!res.ok) return false;
  return (await res.text()).toLowerCase().includes('<html');
}

export async function startWeb(): Promise<ManagedServer> {
  const config = loadE2EConfig();

  if (await webServing().catch(() => false)) {
    console.log(`[e2e] พบ Expo web ที่ port ${config.webPort} อยู่แล้ว — ใช้ตัวเดิม`);
    return { reused: true, stop: () => {} };
  }

  const child = spawn(
    'npx',
    ['expo', 'start', '--web', '--port', String(config.webPort)],
    {
      cwd: WEB_DIR,
      shell: true, // npx บน Windows เป็น .cmd
      env: {
        ...process.env,
        // EXPO_PUBLIC_* ถูก inline เข้า bundle ตอน build — ค่านี้คือสิ่งที่ทำให้
        // แอปที่เทสยิงไปหา API ทดสอบ ไม่ใช่ API ที่ port 3000 ของ dev
        EXPO_PUBLIC_API_URL: config.apiBaseUrl,
        CI: '1',
        BROWSER: 'none',
      },
    },
  );
  pipeOutput(child, 'web');

  await waitFor(`Expo web ที่ ${config.webBaseUrl}`, webServing, WEB_HTML_TIMEOUT_MS);
  return { reused: false, stop: () => killTree(child) };
}

/**
 * บังคับให้ Metro bundle ให้จบตั้งแต่ตอน setup
 *
 * ถ้าไม่ทำ เทสเคสแรกจะเป็นตัวที่ต้องรอ bundle 2-5 นาทีคนเดียวแล้ว timeout
 * ตายทั้งที่โค้ดไม่ได้ผิด · เจอปัญหาตอน setup ยังอ่านง่ายกว่าเจอตอน assert
 */
export async function warmUpWeb(): Promise<void> {
  const config = loadE2EConfig();
  console.log('[e2e] กำลัง bundle หน้าเว็บครั้งแรก (ครั้งแรกใช้เวลา 2-5 นาที) …');

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${config.webBaseUrl}/login`, {
      waitUntil: 'domcontentloaded',
      timeout: WEB_BUNDLE_TIMEOUT_MS,
    });
    await page.locator('#login-submit').waitFor({
      state: 'visible',
      timeout: WEB_BUNDLE_TIMEOUT_MS,
    });
    console.log('[e2e] หน้าเว็บ bundle เสร็จแล้ว');
  } finally {
    await browser.close();
  }
}
