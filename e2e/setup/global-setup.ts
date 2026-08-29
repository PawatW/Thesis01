/**
 * globalSetup — ลำดับที่ทุกอย่างต้องผ่านก่อนเทสเคสแรกจะได้รัน
 *
 *   1. อ่าน env + ด่านกัน DB งานจริง (env.ts)
 *   2. สร้าง / migrate / seed ฐานข้อมูลทดสอบ
 *   3. ประทับ canary ลง DB ทดสอบ
 *   4. ยก API ขึ้นโดยบังคับ DATABASE_URL เป็นของ test
 *   5. **ล็อกอินผ่าน API จริงแล้วอ่าน canary กลับมาเทียบ** ← ด่านสุดท้าย
 *   6. ยก Expo web ขึ้นโดยชี้ไป API ทดสอบ แล้ว bundle ให้เสร็จ
 *
 * ข้อ 5 คือหัวใจ: ข้อ 1-4 พิสูจน์แค่ว่า "เราตั้งค่าไว้ถูก" แต่ข้อ 5 พิสูจน์ว่า
 * process ที่กำลังรับ request อยู่ **ต่อกับฐานข้อมูลทดสอบจริง ๆ** ถ้าไม่ตรง
 * setup ล้มทันทีโดยยังไม่มีเทสไหนได้แตะข้อมูล
 */
import type { FullConfig } from '@playwright/test';
import {
  ensureTestDatabase,
  migrateTestDatabase,
  seedTestDatabase,
  stampCanary,
} from './database';
import { loadE2EConfig } from './env';
import { startApi, startWeb, warmUpWeb, type ManagedServer } from './servers';

const DEMO_BUYER = { email: 'buyer.demo@anan.local', password: 'DemoPass2026!' };

/** ยิง /auth/login ของจริง แล้วยืนยันว่าได้ชื่อที่เราเพิ่งประทับลง DB ทดสอบกลับมา */
async function verifyApiUsesTestDatabase(expectedName: string): Promise<void> {
  const config = loadE2EConfig();
  const res = await fetch(`${config.apiBaseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(DEMO_BUYER),
  });

  if (!res.ok) {
    throw new Error(
      `ล็อกอินบัญชีเดโม่ไม่สำเร็จ (${res.status}) — seed ของ ${config.databaseName} อาจไม่สมบูรณ์`,
    );
  }

  const body = (await res.json()) as { user?: { displayName?: string } };
  const actual = body.user?.displayName;

  if (actual !== expectedName) {
    throw new Error(
      [
        '╔══════════════════════════════════════════════════════════╗',
        '║  หยุดการรัน: API ไม่ได้ต่อกับฐานข้อมูลทดสอบ              ║',
        '╚══════════════════════════════════════════════════════════╝',
        '',
        `คาดว่าจะได้ชื่อ canary : ${expectedName}`,
        `แต่ API ตอบกลับมาว่า   : ${actual ?? '(ไม่มีค่า)'}`,
        '',
        `ตั้งใจให้ต่อกับ: ${config.databaseName}`,
        '',
        'แปลว่ามี API ตัวอื่นค้างอยู่ที่ port นี้ และตัวนั้นชี้ไปฐานข้อมูลอื่น',
        `ปิด process ที่จับ port ${config.apiPort} ไว้ แล้วรันใหม่`,
        'หยุดก่อนที่เทสจะได้เขียนอะไรลงฐานข้อมูลผิดตัว',
      ].join('\n'),
    );
  }

  console.log(`[e2e] ยืนยันแล้ว: API ต่ออยู่กับ ${config.databaseName}`);
}

export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  const started = Date.now();
  const config = loadE2EConfig();
  console.log(`[e2e] ฐานข้อมูลทดสอบ: ${config.databaseName}`);

  await ensureTestDatabase();
  migrateTestDatabase();
  seedTestDatabase();
  const canary = await stampCanary();

  const servers: ManagedServer[] = [];
  try {
    servers.push(await startApi());
    await verifyApiUsesTestDatabase(canary);
    servers.push(await startWeb());
    await warmUpWeb();
  } catch (error) {
    // setup ล้มกลางคัน = ต้องไม่ทิ้ง server ค้างไว้ให้ผู้ใช้ตามปิดเอง
    for (const server of servers.reverse()) server.stop();
    throw error;
  }

  console.log(`[e2e] พร้อมรันใน ${Math.round((Date.now() - started) / 1000)} วินาที`);

  return async () => {
    for (const server of servers.reverse()) server.stop();
    console.log('[e2e] ปิด server ที่ยกขึ้นเองเรียบร้อย');
  };
}
