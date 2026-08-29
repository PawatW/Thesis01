/**
 * เตรียมฐานข้อมูลทดสอบ: สร้าง → migrate → seed → ประทับ canary
 *
 * ทุกคำสั่งที่ยิงออกไปใช้ `E2E_DATABASE_URL` ที่ผ่านด่านของ `env.ts` มาแล้วเท่านั้น
 * และส่งผ่าน env ของ child process ตรง ๆ — ไม่พึ่ง `.env` ของ anan-api เลย
 */
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { API_DIR, loadE2EConfig, withDatabase } from './env';

/** รัน CLI ในโฟลเดอร์ anan-api โดยบังคับ DATABASE_URL เป็นของ test */
function runInApi(command: string, args: string[]): void {
  const config = loadE2EConfig();
  execFileSync(command, args, {
    cwd: API_DIR,
    stdio: 'inherit',
    shell: true, // npx/prisma บน Windows เป็น .cmd
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: config.databaseUrl,
    },
  });
}

/** สร้าง database ถ้ายังไม่มี — role anan_app มีสิทธิ์ CREATEDB อยู่แล้ว */
export async function ensureTestDatabase(): Promise<void> {
  const config = loadE2EConfig();
  const admin = new Client({ connectionString: config.adminDatabaseUrl });

  try {
    await admin.connect();
  } catch (cause) {
    throw new Error(
      [
        `ต่อ PostgreSQL ไม่ได้ที่ ${withDatabase(config.databaseUrl, '<admin>')}`,
        'ตรวจว่า service postgresql-x64-17 กำลังทำงาน และรหัสผ่านใน e2e/.env ถูกต้อง',
        `สาเหตุเดิม: ${String(cause)}`,
      ].join('\n'),
    );
  }

  try {
    const existing = await admin.query<{ datname: string }>(
      'select datname from pg_database where datname = $1',
      [config.databaseName],
    );
    if (existing.rowCount === 0) {
      // ชื่อผ่านด่าน /_test$/ มาแล้ว แต่ยังต้อง quote เพราะ identifier ต่อสตริงเอง
      await admin.query(`create database "${config.databaseName.replace(/"/g, '""')}"`);
      console.log(`[e2e] สร้างฐานข้อมูล ${config.databaseName} แล้ว`);
    }
  } finally {
    await admin.end();
  }
}

/** โครงสร้างตาราง + CHECK ทั้งหมดต้องตรงกับ production เป๊ะ จึงใช้ migrate deploy */
export function migrateTestDatabase(): void {
  runInApi('npx', ['prisma', 'migrate', 'deploy']);
}

/** ข้อมูลเดโม่ชุดเดียวกับที่ใช้พัฒนา — seed ลบของเก่าให้เองก่อนเสมอ */
export function seedTestDatabase(): void {
  runInApi('npm', ['run', 'db:seed']);
}

/**
 * ประทับชื่อ canary ลง buyer ในฐานข้อมูล **ทดสอบ**
 *
 * globalSetup จะล็อกอินผ่าน API จริงแล้วอ่านชื่อนี้กลับมาเทียบ ถ้า API ดันไป
 * ต่อฐานข้อมูลตัวอื่น (เช่น `anan` ของงานจริง) ชื่อจะไม่ตรงแล้ว setup ล้มทันที
 * — เป็นการพิสูจน์ว่าต่อถูกตัว ไม่ใช่แค่ "ตั้ง env ไว้แล้วน่าจะถูก"
 */
export async function stampCanary(): Promise<string> {
  const config = loadE2EConfig();
  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      'update users set display_name = $1 where email = $2',
      [config.canaryDisplayName, 'buyer.demo@anan.local'],
    );
    if (result.rowCount !== 1) {
      throw new Error(
        `ประทับ canary ไม่สำเร็จ — ไม่พบ buyer.demo@anan.local ใน ${config.databaseName} (seed ล้มหรือเปล่า)`,
      );
    }
    return config.canaryDisplayName;
  } finally {
    await client.end();
  }
}

/** ใช้ในเทสที่ต้องยืนยันผลที่ระดับ DB (เช่น ยอดเงินต้องมาจากราคาใน DB) */
export async function queryTestDatabase<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const config = loadE2EConfig();
  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    const result = await client.query<T>(sql, params);
    return result.rows;
  } finally {
    await client.end();
  }
}
