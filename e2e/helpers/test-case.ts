/**
 * `testCase()` — ห่อ `test()` ของ Playwright ให้ทุกเคสมีรหัสประจำตัว
 *
 * เหตุผล: รายงานในเล่ม thesis ต้องอ้างเคสได้ว่า "TC-014 ครอบคลุมอะไร ผลเป็นยังไง"
 * ชื่อเทสอย่างเดียวอ้างไม่ได้เพราะเปลี่ยนถ้อยคำเมื่อไหร่ตารางก็เพี้ยน
 * metadata ที่ผูกไว้ตรงนี้ถูกอ่านต่อโดย `e2e/reporters/markdown-reporter.ts`
 * เพื่อสร้าง `reports/report.md` แบบ 1 แถวต่อ 1 TC
 */
import { test } from './fixtures';

export type Priority = 'P0' | 'P1' | 'P2';

export interface TestCaseMeta {
  /** รูปแบบ TC-001 — ห้ามซ้ำทั้งชุด */
  id: string;
  /** P0 = พังแล้วระบบใช้งานไม่ได้ · P1 = flow หลัก · P2 = ขอบเคส */
  priority: Priority;
  /** ชื่อ feature ตาม context/planing — ใช้จัดกลุ่มในรายงาน */
  feature: string;
}

const ID_PATTERN = /^TC-\d{3}$/;

/** รหัสซ้ำแปลว่ารายงานจะมีสองแถวชนกัน — จับตั้งแต่ตอน collect ไม่ใช่ตอนรัน */
const registered = new Map<string, string>();

export function testCase(meta: TestCaseMeta, title: string, body: Parameters<typeof test>[2]): void {
  if (!ID_PATTERN.test(meta.id)) {
    throw new Error(`รหัสเคส "${meta.id}" ผิดรูปแบบ — ต้องเป็น TC-001`);
  }
  const clash = registered.get(meta.id);
  if (clash != null) {
    throw new Error(`รหัสเคส ${meta.id} ถูกใช้ไปแล้วกับ "${clash}"`);
  }
  registered.set(meta.id, title);

  test(
    `${meta.id} · ${title}`,
    {
      annotation: [
        { type: 'tc-id', description: meta.id },
        { type: 'priority', description: meta.priority },
        { type: 'feature', description: meta.feature },
      ],
    },
    body,
  );
}

/** spec ใช้ `test.step()` จากตัวนี้ — การประกาศเคสให้ใช้ `testCase()` เสมอ */
export { test, expect } from './fixtures';
