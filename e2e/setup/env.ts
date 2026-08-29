/**
 * env ของชุด e2e — และ **ด่านกันยิงใส่ฐานข้อมูลจริง**
 *
 * ชุดนี้ล้างและ seed ฐานข้อมูลทุกครั้งที่รัน ถ้าเผลอชี้ไป DB `anan` ของงานจริง
 * ข้อมูลที่กดสะสมไว้ตอนพัฒนาจะหายทั้งหมด — ทุกกฎในไฟล์นี้จึงเป็นแบบ
 * **fail-closed**: ไม่แน่ใจเมื่อไหร่ให้โยน error ห้ามเดาค่าให้เอง
 *
 * เจตนา: ไม่มีที่ไหนในชุด e2e อ่าน `DATABASE_URL` จาก `anan-api/.env` เลย
 * ตัวแปรที่ยกมาจากไฟล์นั้นมีแค่ที่อยู่ใน ALLOWED_FROM_API_ENV เท่านั้น
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseDotenv } from 'dotenv';

export const REPO_ROOT = resolve(__dirname, '..', '..');
export const API_DIR = resolve(REPO_ROOT, 'anan-api');
export const WEB_DIR = resolve(REPO_ROOT, 'anan');
export const E2E_DIR = resolve(REPO_ROOT, 'e2e');

/**
 * ชื่อฐานข้อมูลต้องลงท้ายด้วย `_test` — ตั้งใจให้ไม่มีทางสะกด `anan` ผ่านได้
 * แม้จะพิมพ์ผิดหรือ copy ค่ามาจาก .env ของ API
 */
const TEST_DB_PATTERN = /_test$/;

/**
 * ค่าที่ยอมให้ยืมจาก `anan-api/.env` ได้ — เป็นความลับที่ไม่เกี่ยวกับ "ชี้ไป DB ไหน"
 * ห้ามเติม DATABASE_URL / PORT / NODE_ENV เข้าลิสต์นี้เด็ดขาด
 */
const ALLOWED_FROM_API_ENV = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_ACCESS_TTL',
  'JWT_REFRESH_TTL',
] as const;

export interface E2EConfig {
  /** connection string ของฐานข้อมูลทดสอบ (ลงท้าย `_test` เสมอ) */
  databaseUrl: string;
  /** ชื่อ database ที่แกะจาก URL แล้ว */
  databaseName: string;
  /** connection string ไปยัง DB ที่ใช้ออกคำสั่ง CREATE DATABASE */
  adminDatabaseUrl: string;
  apiPort: number;
  webPort: number;
  apiBaseUrl: string;
  webBaseUrl: string;
  /** ชื่อที่ประทับลง buyer ใน DB ทดสอบ เพื่อพิสูจน์ว่า API ต่อ DB ถูกตัว */
  canaryDisplayName: string;
  jwt: Record<string, string>;
  skipApiBuild: boolean;
}

function loadDotenvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return parseDotenv(readFileSync(path));
}

function parseDatabaseName(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`E2E_DATABASE_URL ไม่ใช่ URL ที่ถูกต้อง: ${url}`);
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (name === '') throw new Error('E2E_DATABASE_URL ไม่มีชื่อฐานข้อมูลต่อท้าย');
  return name;
}

/** เปลี่ยนชื่อ database ใน connection string เดิม (ที่เหลือคงค่าเดิมทุกอย่าง) */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

let cached: E2EConfig | null = null;

export function loadE2EConfig(): E2EConfig {
  if (cached != null) return cached;

  const own = { ...loadDotenvFile(resolve(E2E_DIR, '.env')), ...process.env };

  const databaseUrl = own.E2E_DATABASE_URL;
  if (databaseUrl == null || databaseUrl.trim() === '') {
    throw new Error(
      [
        'ไม่พบ E2E_DATABASE_URL',
        '',
        'ชุด e2e จะไม่เดาค่าให้ เพราะการเดาผิดแปลว่าล้างฐานข้อมูลงานจริงทิ้ง',
        'คัดลอก e2e/.env.example เป็น e2e/.env แล้วใส่ค่าให้ครบก่อนรัน',
      ].join('\n'),
    );
  }

  const databaseName = parseDatabaseName(databaseUrl);

  // ── ด่านที่ 1: ชื่อต้องลงท้าย `_test` ────────────────────────────────────
  if (!TEST_DB_PATTERN.test(databaseName)) {
    throw new Error(
      [
        `ปฏิเสธการรัน: ฐานข้อมูล "${databaseName}" ไม่ได้ลงท้ายด้วย _test`,
        '',
        'ชุด e2e ล้างและ seed ข้อมูลใหม่ทุกครั้งที่รัน จึงยอมให้ชี้ได้เฉพาะ DB',
        'ที่ตั้งชื่อไว้สำหรับทดสอบเท่านั้น (เช่น anan_test)',
      ].join('\n'),
    );
  }

  // ── ด่านที่ 2: ต้องไม่ใช่ DB เดียวกับที่ anan-api/.env ใช้อยู่ ─────────────
  const apiEnv = loadDotenvFile(resolve(API_DIR, '.env'));
  const devUrl = apiEnv.DATABASE_URL;
  if (devUrl != null && devUrl.trim() !== '') {
    const devName = parseDatabaseName(devUrl.replace(/^["']|["']$/g, ''));
    if (devName === databaseName) {
      throw new Error(
        [
          `ปฏิเสธการรัน: E2E_DATABASE_URL ชี้ไปที่ "${databaseName}"`,
          'ซึ่งเป็นฐานข้อมูลตัวเดียวกับที่ anan-api/.env ใช้อยู่',
          '',
          'ต้องแยกคนละ database เสมอ — สร้าง anan_test แล้วชี้มาที่ตัวนั้น',
        ].join('\n'),
      );
    }
  }

  // ── ความลับที่ API ต้องใช้: ยืมได้เฉพาะที่อยู่ใน allowlist ────────────────
  const jwt: Record<string, string> = {};
  for (const key of ALLOWED_FROM_API_ENV) {
    const value = own[key] ?? apiEnv[key];
    if (value != null && value !== '') jwt[key] = value;
  }
  for (const required of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    if (jwt[required] == null) {
      throw new Error(
        `ไม่พบ ${required} — ตั้งใน e2e/.env หรือให้มีอยู่ใน anan-api/.env ก่อนรัน e2e`,
      );
    }
  }

  const apiPort = Number(own.E2E_API_PORT ?? 3100);
  const webPort = Number(own.E2E_WEB_PORT ?? 8082);
  for (const [label, port] of [
    ['E2E_API_PORT', apiPort],
    ['E2E_WEB_PORT', webPort],
  ] as const) {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`${label} ไม่ใช่หมายเลข port ที่ใช้ได้: ${String(port)}`);
    }
  }

  cached = {
    databaseUrl,
    databaseName,
    // CREATE DATABASE ออกจาก connection ไหนก็ได้ — ใช้ postgres ซึ่งมีอยู่เสมอ
    adminDatabaseUrl: withDatabase(databaseUrl, own.E2E_ADMIN_DATABASE ?? 'postgres'),
    apiPort,
    webPort,
    apiBaseUrl: `http://127.0.0.1:${apiPort}/api/v1`,
    webBaseUrl: `http://127.0.0.1:${webPort}`,
    canaryDisplayName: 'E2E CANARY BUYER',
    jwt,
    skipApiBuild: own.E2E_SKIP_API_BUILD === 'true',
  };
  return cached;
}
