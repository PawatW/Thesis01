/**
 * Date helpers for the client side.
 *
 * Never use `Date.toISOString().slice(0, 10)` to produce a calendar date in this
 * app: it converts to UTC first, so any time after 17:00 in Asia/Bangkok yields
 * *yesterday's* date. Every date the user sees or sends to an RPC is a calendar
 * date in their own timezone, so build the string from local parts.
 */

export function toISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseISODate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/**
 * Add months the way the API does: clamp to the end of the target month.
 *
 * `setMonth()` overflows instead of clamping — 31 Jan + 1 month becomes 3 Mar,
 * while the API writes 28 Feb. A preview that says a different date than the one
 * the server is about to store breaks the whole point of W05's confirm dialogs.
 * This must stay in step with `addMonths()` in `anan-api/src/common/date.ts`.
 */
function addMonths(d: Date, n: number): Date {
  const lastDayOfTarget = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
  return new Date(
    d.getFullYear(),
    d.getMonth() + n,
    Math.min(d.getDate(), lastDayOfTarget),
  );
}

/** The k-th cycle counted from an anchor — mirrors `addCycles()` in the API. */
export function addCycles(anchorIso: string, cycle: string, k: number): string {
  const anchor = parseISODate(anchorIso);
  if (cycle === '2w') return addDays(anchorIso, 14 * k);
  return toISODate(addMonths(anchor, cycle === '2m' ? 2 * k : k));
}

export function addCycle(iso: string, cycle: string): string {
  return addCycles(iso, cycle, 1);
}

/**
 * First cycle date on the anchor's grid that falls strictly after `afterIso`.
 *
 * Mirrors `nextCycleAfter()` in the API — the preview has to walk the same grid,
 * not add a cycle to the current date, or a subscription anchored on the 31st
 * shows "28 Mar" while the server stores "31 Mar".
 */
export function nextCycleAfter(anchorIso: string, cycle: string, afterIso: string): string {
  const perCycle = cycle === '2w' ? 14 : cycle === '2m' ? 60 : 30;
  const gap = Math.floor(
    (parseISODate(afterIso).getTime() - parseISODate(anchorIso).getTime()) / 86_400_000,
  );

  let k = Math.max(0, Math.floor(gap / perCycle));
  while (k > 0 && addCycles(anchorIso, cycle, k - 1) > afterIso) k--;
  for (let step = 0; step < 8; step++) {
    const candidate = addCycles(anchorIso, cycle, k);
    if (candidate > afterIso) return candidate;
    k++;
  }
  // Unreachable in practice; falling back to a wrong date silently would be worse.
  return addCycle(afterIso, cycle);
}

/**
 * "Today" in Asia/Bangkok, which is the only timezone the database reasons about
 * (CLAUDE.md rule 5). Using the device timezone here would let a user abroad — or
 * a user in Thailand between 00:00 and 07:00 — pick a start date the RPC rejects.
 * Thailand has no DST, so a fixed offset is exact.
 */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

export function todayISO(): string {
  return new Date(Date.now() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

export function formatThaiDate(iso: string | null): string {
  if (iso == null) return '—';
  return parseISODate(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}

/**
 * แสดง **เวลาจริง** (timestamptz) เป็น "วันตามปฏิทินไทย" โดยไม่โชว์เวลา
 *
 * ใช้กับช่วงเวลาของคูปอง (feature 18) ที่ API ส่งมาเป็น ISO เต็ม — ส่งเข้า
 * `formatThaiDate` ตรง ๆ ไม่ได้เพราะตัวนั้นรับเฉพาะ `YYYY-MM-DD` แล้วจะได้
 * "Invalid Date" · และใช้ `formatThaiDateTime` ก็เกินจำเป็น (คูปองหมดอายุ
 * สิ้นวันอยู่แล้ว การโชว์ "23:59" ทุกใบเป็นเสียงรบกวน)
 */
export function formatThaiDay(iso: string | null): string {
  if (iso == null) return '—';
  return new Date(iso).toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  });
}

/**
 * "เดือน ปี" ไม่มีวัน — ใช้กับ "เข้าร่วมเมื่อ" ของร้าน (feature 02/10)
 *
 * วันที่เปิดร้านแบบเจาะจงวันไม่ได้ช่วยผู้ซื้อตัดสินใจ (และเป็นรายละเอียดของ
 * เจ้าของร้านที่ไม่จำเป็นต้องประกาศ) — สิ่งที่สื่อความน่าเชื่อถือคือ "อยู่มานานแค่ไหน"
 * · รับ ISO เต็มจาก API จึงระบุ `timeZone` เหมือน `formatThaiDay`
 */
export function formatThaiMonthYear(iso: string | null): string {
  if (iso == null) return '—';
  return new Date(iso).toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * แสดง **เวลาจริง** (timestamptz) ตามเขตเวลาไทย — ใช้กับ log ที่ต้องรู้ว่าเกิดกี่โมง
 *
 * ต่างจาก `formatThaiDate` ที่รับวันที่ปฏิทิน (`YYYY-MM-DD`) — ตัวนั้นแปลง ISO date
 * แบบไม่มีเวลา ส่วนตัวนี้รับ ISO เต็มจาก API แล้วบอกเบราว์เซอร์ตรง ๆ ว่าให้แปลง
 * เป็นเวลาไทย ไม่ใช่เวลาของเครื่องผู้ใช้ (เครื่องที่ตั้ง timezone อื่นจะเห็นเวลาที่
 * ไม่ตรงกับที่ engine กับ log ฝั่ง server พูดถึง แล้วไล่ปัญหาไม่ตรงกันทั้งทีม)
 */
export function formatThaiDateTime(iso: string | null): string {
  if (iso == null) return '—';
  return new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Counted against the Bangkok calendar day, so "ส่งรอบนี้วันนี้" agrees with the engine. */
export function daysUntil(iso: string | null): number | null {
  if (iso == null) return null;
  const from = parseISODate(todayISO()).getTime();
  return Math.round((parseISODate(iso).getTime() - from) / 86_400_000);
}
