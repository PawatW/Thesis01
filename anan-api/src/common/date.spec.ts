import {
  addCycle,
  addCycles,
  addDays,
  addMonths,
  cyclesPerMonth,
  daysUntil,
  isCycle,
  nextCycleAfter,
  parseISODate,
  startOfThaiMonth,
  toISODate,
  todayInBangkok,
  tryParseISODate,
} from './date';

/**
 * unit test ตัวแรกของโปรเจกต์ (ชั้น L1 ใน docs/testing.md)
 *
 * ไฟล์นี้คือต้นทางของ "วันไหนถึงรอบส่ง" ทั้งระบบ — engine, checkout, การแจ้งเตือน
 * T-3 พึ่งมันหมด คำนวณผิดวันเดียว = ผู้ซื้อโดนตัดเงินผิดวัน ซึ่งเป็นบั๊กที่
 * e2e จับไม่ได้เพราะมันจะ "ผ่าน" ตามค่าที่ผิดนั่นแหละ
 */
describe('date — ปฏิทิน Asia/Bangkok', () => {
  describe('todayInBangkok', () => {
    // เคสที่เคยพังจริง (B-12): ช่วง 00:00–07:00 ตามเวลาไทย UTC ยังเป็นเมื่อวาน
    it.each([
      ['2026-08-15T16:59:59Z', '2026-08-15'], // 23:59 ไทย — ยังวันเดิม
      ['2026-08-15T17:00:00Z', '2026-08-16'], // 00:00 ไทย — ขึ้นวันใหม่แล้ว
      ['2026-08-15T20:30:00Z', '2026-08-16'], // 03:30 ไทย — ช่วงที่เคยพัง
      ['2026-08-15T23:59:59Z', '2026-08-16'], // 06:59 ไทย
      ['2026-08-16T00:00:00Z', '2026-08-16'], // 07:00 ไทย
    ])('%s → %s', (utc, expected) => {
      expect(toISODate(todayInBangkok(new Date(utc)))).toBe(expected);
    });

    it('ตรงกับที่ Intl คำนวณให้สำหรับเขตเวลา Asia/Bangkok', () => {
      const now = new Date();
      const viaIntl = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok',
      }).format(now);
      expect(toISODate(todayInBangkok(now))).toBe(viaIntl);
    });

    it('ห้ามได้ผลเท่ากับ toISOString() ตอนที่ UTC กับไทยคนละวัน', () => {
      const at3amBangkok = new Date('2026-08-15T20:30:00Z');
      expect(toISODate(todayInBangkok(at3amBangkok))).not.toBe(
        at3amBangkok.toISOString().slice(0, 10),
      );
    });
  });

  describe('tryParseISODate / parseISODate', () => {
    it.each(['2026-08-16', '2028-02-29'])('รับ %s', (s) => {
      expect(toISODate(parseISODate(s))).toBe(s);
    });

    // ค่าพวกนี้มาจาก client ได้จริง ต้องคืน null ไม่ใช่โยน error หรือรับไปเงียบ ๆ
    it.each([
      '2026-02-30',
      '2027-02-29', // ไม่ใช่ปีอธิกสุรทิน
      '2026-13-01',
      '2026-00-10',
      '0000-00-00',
      '16/08/2026',
      '2026-8-16',
      '',
      'วันนี้',
    ])('ปฏิเสธ %s', (s) => {
      expect(tryParseISODate(s)).toBeNull();
    });
  });

  describe('addMonths — หนีบปลายเดือน', () => {
    it.each([
      ['2026-01-31', 1, '2026-02-28'],
      ['2028-01-31', 1, '2028-02-29'], // ปีอธิกสุรทิน
      ['2028-02-29', 12, '2029-02-28'],
      ['2026-12-31', 1, '2027-01-31'],
      ['2026-12-31', 2, '2027-02-28'],
      ['2026-03-31', 1, '2026-04-30'],
      ['2026-08-16', 1, '2026-09-16'],
    ])('%s + %i เดือน = %s', (from, n, expected) => {
      expect(toISODate(addMonths(parseISODate(from), n))).toBe(expected);
    });

    it('ยึดหมุดเดิมแล้ววันที่กลับมาเต็มเดือน (เหตุผลที่ห้าม chain)', () => {
      const anchor = parseISODate('2026-01-31');
      const fromAnchor = [1, 2, 3, 4].map((k) =>
        toISODate(addMonths(anchor, k)),
      );
      expect(fromAnchor).toEqual([
        '2026-02-28',
        '2026-03-31',
        '2026-04-30',
        '2026-05-31',
      ]);

      // เทียบกับการเรียกต่อกันเป็นทอด ๆ ซึ่งยุบเป็นวันที่ 28 ถาวร
      let chained = anchor;
      const drifted: string[] = [];
      for (let k = 0; k < 4; k++) {
        chained = addMonths(chained, 1);
        drifted.push(toISODate(chained));
      }
      expect(drifted).toEqual([
        '2026-02-28',
        '2026-03-28',
        '2026-04-28',
        '2026-05-28',
      ]);
    });
  });

  describe('addCycle', () => {
    it.each([
      ['2w', '2026-08-16', '2026-08-30'],
      ['1m', '2026-08-16', '2026-09-16'],
      ['2m', '2026-08-16', '2026-10-16'],
      ['1m', '2026-01-31', '2026-02-28'],
    ] as const)('%s: %s → %s', (cycle, from, expected) => {
      expect(toISODate(addCycle(parseISODate(from), cycle))).toBe(expected);
    });
  });

  describe('addCycles — กริดรอบจากหมุด (หัวใจของ engine)', () => {
    it.each([
      ['2w', '2026-08-16', 3, '2026-09-27'],
      ['1m', '2026-01-31', 3, '2026-04-30'],
      ['2m', '2026-01-31', 2, '2026-05-31'],
      ['1m', '2026-08-16', 0, '2026-08-16'],
    ] as const)('%s: %s + %i รอบ = %s', (cycle, anchor, k, expected) => {
      expect(toISODate(addCycles(parseISODate(anchor), cycle, k))).toBe(
        expected,
      );
    });

    it('เดินครบปีจากหมุดวันที่ 31 แล้ววันที่ไม่ยุบ (บั๊กที่คอลัมน์ anchor มีไว้แก้)', () => {
      const anchor = parseISODate('2026-01-31');
      const grid = [1, 2, 3, 4, 5, 6].map((k) =>
        toISODate(addCycles(anchor, '1m', k)),
      );
      expect(grid).toEqual([
        '2026-02-28',
        '2026-03-31',
        '2026-04-30',
        '2026-05-31',
        '2026-06-30',
        '2026-07-31',
      ]);
    });
  });

  describe('nextCycleAfter — นิยามเดียวของ "รอบถัดไป"', () => {
    it.each([
      // ปกติ: engine รันวันที่ถึงรอบพอดี → ได้รอบถัดไปอีก 1 เดือน
      ['1m', '2026-01-31', '2026-02-28', '2026-03-31'],
      // ข้ามรอบ: after = รอบปัจจุบัน → ขยับไป 1 ช่องบนกริดเดิม
      ['2w', '2026-08-16', '2026-08-30', '2026-09-13'],
      // เก็บตกหลัง cron หยุดไปหลายเดือน → ข้ามไปรอบแรกที่ยังไม่ถึง ไม่ไล่เก็บย้อนหลัง
      ['1m', '2026-01-31', '2026-06-15', '2026-06-30'],
      ['2m', '2026-01-31', '2026-02-01', '2026-03-31'],
    ] as const)('%s หมุด %s หลัง %s = %s', (cycle, anchor, after, expected) => {
      expect(
        toISODate(
          nextCycleAfter(parseISODate(anchor), cycle, parseISODate(after)),
        ),
      ).toBe(expected);
    });

    it('ผลลัพธ์มากกว่า after เสมอ ไม่ว่าจะเริ่มจากตรงไหนของกริด', () => {
      const anchor = parseISODate('2026-01-31');
      for (let d = 0; d < 400; d += 7) {
        const after = addDays(anchor, d);
        const next = nextCycleAfter(anchor, '1m', after);
        expect(next.getTime()).toBeGreaterThan(after.getTime());
        // ต้องอยู่บนกริดจริง ไม่ใช่วันที่คำนวณลอย ๆ
        expect(daysUntil(next, after)).toBeLessThanOrEqual(31);
      }
    });

    it('หมุดที่ยังไม่ถึง (สมัครล่วงหน้า) คืนตัวหมุดเอง', () => {
      const anchor = parseISODate('2026-09-01');
      expect(
        toISODate(nextCycleAfter(anchor, '1m', parseISODate('2026-08-20'))),
      ).toBe('2026-09-01');
    });
  });

  describe('addDays / daysUntil', () => {
    it('ข้ามเดือนและข้ามปีได้ถูกต้อง', () => {
      expect(toISODate(addDays(parseISODate('2026-12-31'), 1))).toBe(
        '2027-01-01',
      );
      expect(toISODate(addDays(parseISODate('2026-03-01'), -1))).toBe(
        '2026-02-28',
      );
    });

    it('นับจำนวนวันได้ทั้งอนาคตและอดีต', () => {
      const from = parseISODate('2026-08-16');
      expect(daysUntil(parseISODate('2026-08-19'), from)).toBe(3);
      expect(daysUntil(parseISODate('2026-08-13'), from)).toBe(-3);
      expect(daysUntil(from, from)).toBe(0);
    });
  });

  describe('startOfThaiMonth — ขอบเดือนของ churn', () => {
    it.each([
      // 1 ส.ค. 03:00 เวลาไทย (= 31 ก.ค. 20:00Z) ยังต้องอยู่ในเดือนสิงหาคม
      ['2026-07-31T20:00:00Z', '2026-07-31T17:00:00.000Z'],
      ['2026-08-15T10:00:00Z', '2026-07-31T17:00:00.000Z'],
      // ต้นเดือนกันยายน (ไทย) = 31 ส.ค. 17:00Z
      ['2026-08-31T17:30:00Z', '2026-08-31T17:00:00.000Z'],
    ])('%s → ต้นเดือน %s', (now, expected) => {
      expect(startOfThaiMonth(new Date(now)).toISOString()).toBe(expected);
    });

    it('เหตุการณ์ตอน 03:00 ของวันที่ 1 (เวลาไทย) ต้องถูกนับเข้าเดือนใหม่', () => {
      const at3amThai = new Date('2026-08-31T20:00:00Z'); // = 1 ก.ย. 03:00 ไทย
      expect(startOfThaiMonth(at3amThai).getTime()).toBeLessThanOrEqual(
        at3amThai.getTime(),
      );
      // และต้องเป็นขอบของเดือนกันยายน ไม่ใช่สิงหาคม
      expect(startOfThaiMonth(at3amThai).toISOString()).toBe(
        '2026-08-31T17:00:00.000Z',
      );
    });
  });

  describe('isCycle / cyclesPerMonth', () => {
    it('รับเฉพาะ 3 ค่าที่ CHECK ใน DB ยอมรับ', () => {
      expect(['2w', '1m', '2m'].every(isCycle)).toBe(true);
      expect(['3m', '1w', '', 'monthly', null].some(isCycle)).toBe(false);
    });

    it('normalize ตามที่ประกาศใน CLAUDE.md ข้อ 5', () => {
      expect(cyclesPerMonth('2w')).toBe(2);
      expect(cyclesPerMonth('1m')).toBe(1);
      expect(cyclesPerMonth('2m')).toBe(0.5);
    });
  });
});
