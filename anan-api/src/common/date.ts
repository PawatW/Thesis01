/**
 * วันที่แบบ "ปฏิทิน" ทั้งระบบใช้ Asia/Bangkok เป็นเขตเวลาเดียว (CLAUDE.md กฎข้อ 5)
 *
 * ทำไมต้องมีไฟล์นี้: `new Date().toISOString()` ให้วันที่ตาม UTC — ช่วง 00:00–07:00
 * ตามเวลาไทยจะได้ "เมื่อวาน" ซึ่งเคยทำให้ checkout สร้างรอบผิดวันมาแล้ว
 *
 * ข้อตกลงของชนิดข้อมูล: คอลัมน์ `@db.Date` ของ Prisma คืนค่าเป็น Date ที่
 * เที่ยงคืน **UTC** ของวันนั้น ไฟล์นี้จึงใช้ระบบเดียวกันทั้งหมด — สร้างและอ่าน
 * ด้วย getUTC* เสมอ ห้ามใช้ getDate()/getMonth() แบบ local กับค่าพวกนี้
 */

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Cycle = '2w' | '1m' | '2m';
export const CYCLES: readonly Cycle[] = ['2w', '1m', '2m'] as const;

export function isCycle(v: unknown): v is Cycle {
  return typeof v === 'string' && (CYCLES as readonly string[]).includes(v);
}

/** วันนี้ตามปฏิทินไทย คืนเป็น Date ที่เที่ยงคืน UTC */
export function todayInBangkok(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ),
  );
}

/** Date → 'YYYY-MM-DD' (อ่านด้วย UTC เสมอ) */
export function toISODate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 'YYYY-MM-DD' → Date ที่เที่ยงคืน UTC · คืน `null` ถ้ารูปแบบผิดหรือวันที่ไม่มีจริง
 *
 * ★ ใช้ตัวนี้กับค่าที่มาจาก client เสมอ ★ แล้วแปลง `null` เป็น 400 ที่ service
 * ถ้าใช้ `parseISODate` ที่โยน `Error` ธรรมดา ผู้ใช้ที่ส่ง `2026-02-30` มาจะได้
 * 500 INTERNAL_ERROR แทนที่จะเป็น 400 (เจอทีหลังตอน Phase 3 reschedule)
 */
export function tryParseISODate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return toISODate(date) === s ? date : null;
}

/** เหมือน `tryParseISODate` แต่โยน error — ใช้กับค่าที่เรารู้ว่าถูกอยู่แล้ว (seed / test) */
export function parseISODate(s: string): Date {
  const date = tryParseISODate(s);
  if (!date) throw new Error(`วันที่ไม่ถูกต้อง: ${s}`);
  return date;
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/**
 * บวกเดือนแบบหนีบปลายเดือน: 31 ม.ค. + 1 เดือน = 28/29 ก.พ.
 * (ถ้าปล่อยให้ JS ล้นไปเอง จะกลายเป็น 3 มี.ค. = ผู้ซื้อโดนตัดเงินผิดวัน)
 *
 * ★ ห้ามเรียกต่อกันเป็นทอด ๆ ★ `addMonths(addMonths(d,1),1)` จาก 31 ม.ค.
 * จะได้ 28 ก.พ. → 28 มี.ค. → 28 เม.ย. คือวันตัดเงินยุบเป็นวันที่ 28 ถาวร
 * หลังผ่านกุมภาพันธ์ครั้งเดียว
 * engine ต้องคิดจาก `startDate` เป็นหมุดเสมอ: `addMonths(startDate, k)`
 * → 28 ก.พ. → 31 มี.ค. → 30 เม.ย. ตามที่ผู้ใช้คาดหวัง
 */
export function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const lastDayOfTarget = new Date(Date.UTC(y, m + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m + n, Math.min(day, lastDayOfTarget)));
}

/** รอบถัดไปตาม cycle ของแผน — ที่เดียวในระบบที่รู้ว่าแต่ละรอบยาวเท่าไหร่ */
export function addCycle(d: Date, cycle: Cycle): Date {
  switch (cycle) {
    case '2w':
      return addDays(d, 14);
    case '1m':
      return addMonths(d, 1);
    case '2m':
      return addMonths(d, 2);
  }
}

/**
 * รอบที่ k นับจากหมุด — `addCycles(anchor, '1m', 3)` = anchor + 3 เดือน
 *
 * ★ นี่คือวิธีเดียวที่ engine ใช้คำนวณวันตัดรอบ ★ เพราะบวกทีละรอบทบไปเรื่อย ๆ
 * (`addCycle` ซ้อนกัน) ทำให้วันที่ยุบถาวรหลังผ่านเดือนสั้นครั้งเดียว:
 * 31 ม.ค. → 28 ก.พ. → 28 มี.ค. ทั้งที่ควรเป็น 31 มี.ค.
 */
export function addCycles(anchor: Date, cycle: Cycle, k: number): Date {
  switch (cycle) {
    case '2w':
      return addDays(anchor, 14 * k);
    case '1m':
      return addMonths(anchor, k);
    case '2m':
      return addMonths(anchor, 2 * k);
  }
}

/**
 * วันตัดรอบถัดไปบนกริดของหมุดนี้ — ตัวแรกที่ **มากกว่า** `after` เสมอ
 *
 * ใช้ทั้งตอน engine เลื่อนรอบ (after = วันที่รัน) และตอนผู้ใช้กดข้ามรอบ
 * (after = รอบปัจจุบัน) จึงเป็นนิยามเดียวของคำว่า "รอบถัดไป"
 *
 * เดินหาแบบประมาณก่อนแล้วขยับทีละก้าว: เดือนไม่เท่ากันจึงคำนวณ k ตรง ๆ ไม่ได้
 * แต่ประมาณจากจำนวนวันแล้วขยับไม่เกิน 2-3 ก้าวก็ถึงเสมอ (เพดานกันวนไม่รู้จบ)
 */
export function nextCycleAfter(anchor: Date, cycle: Cycle, after: Date): Date {
  const daysPerCycle = cycle === '2w' ? 14 : cycle === '1m' ? 30 : 60;
  const guess = Math.floor(daysUntil(after, anchor) / daysPerCycle);

  let k = Math.max(0, guess);
  // ถอยลงจนอยู่หลัง after ไม่เกินจริง แล้วค่อยเดินหน้าจนพ้น after
  while (k > 0 && addCycles(anchor, cycle, k - 1) > after) k--;
  for (let step = 0; step < 8; step++) {
    if (addCycles(anchor, cycle, k) > after) return addCycles(anchor, cycle, k);
    k++;
  }
  // ไปไม่ถึงในทางปฏิบัติ — แต่ยอมให้ทำงานพลาดเงียบ ๆ ไม่ได้ ยอมพังดังกว่า
  throw new Error('คำนวณรอบถัดไปไม่สำเร็จ');
}

/**
 * จำนวนรอบต่อเดือน — ใช้ normalize รายได้ในหน้า dashboard ของร้าน
 *
 * ใช้ตัวเลขกลม 2 / 1 / 0.5 ตามที่ประกาศไว้ใน CLAUDE.md กฎข้อ 5 ไม่ใช่ค่าจริง
 * ทางปฏิทิน (รอบ 2 สัปดาห์เกิดจริง 30.44/14 ≈ 2.17 ครั้งต่อเดือน)
 * เพราะ MRR ที่แสดงให้ร้านดูต้องตรงกับที่เขานับเองได้ด้วยมือ — ตัวเลขที่
 * "ถูกกว่า" แต่อธิบายไม่ได้ ใช้ไม่ได้กับหน้าจอที่คนต้องเชื่อถือ
 * (ถ้าจะเปลี่ยนต้องแก้ CLAUDE.md + project-plan.md พร้อมกัน)
 */
export function cyclesPerMonth(cycle: Cycle): number {
  switch (cycle) {
    case '2w':
      return 2;
    case '1m':
      return 1;
    case '2m':
      return 0.5;
  }
}

/**
 * เที่ยงคืนวันที่ 1 ของเดือนนี้ **ตามเวลาไทย** คืนเป็น instant จริง (มี offset)
 *
 * ต่างจากฟังก์ชันอื่นในไฟล์นี้ที่คืน "วันปฏิทิน" แบบเที่ยงคืน UTC — ตัวนี้ใช้เทียบ
 * กับคอลัมน์ `timestamptz` (เช่น `subscription_events.created_at`) จึงต้องเป็น
 * เวลาจริง: ต้นเดือนตามไทย = วันสุดท้ายของเดือนก่อน 17:00Z
 * ถ้าใช้ `Date.UTC(y, m, 1)` ตรง ๆ เหตุการณ์ที่เกิดช่วง 00:00–07:00 ของวันที่ 1
 * (เวลาไทย) จะถูกนับเข้าเดือนก่อน แล้วตัวเลข churn ต้นเดือนจะขาดไป 7 ชั่วโมง
 */
export function startOfThaiMonth(now: Date = new Date()): Date {
  const today = todayInBangkok(now);
  return new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1) -
      BANGKOK_OFFSET_MS,
  );
}

/** จำนวนวันจากวันนี้ (ลบ = ผ่านมาแล้ว) */
export function daysUntil(target: Date, from: Date = todayInBangkok()): number {
  return Math.round((target.getTime() - from.getTime()) / DAY_MS);
}
