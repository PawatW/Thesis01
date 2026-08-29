import type { Request } from 'express';
import {
  isBrowserRequest,
  parseDurationMs,
  readRefreshCookie,
  REFRESH_COOKIE,
} from './refresh-cookie';

/** พอสำหรับฟังก์ชันที่อ่านแค่ `headers` — ไม่ต้องปั้น Request ทั้งก้อน */
function req(headers: Record<string, string>): Request {
  return { headers } as unknown as Request;
}

describe('isBrowserRequest', () => {
  it('มี Origin = เบราว์เซอร์', () => {
    expect(isBrowserRequest(req({ origin: 'http://localhost:8081' }))).toBe(
      true,
    );
  });

  it('ไม่มี Origin = ไม่ใช่เบราว์เซอร์ (Expo native / supertest / curl)', () => {
    expect(isBrowserRequest(req({}))).toBe(false);
    expect(isBrowserRequest(req({ origin: '' }))).toBe(false);
  });

  /**
   * sandboxed iframe ส่ง `Origin: null` มาเป็นสตริง — ต้องนับเป็นเบราว์เซอร์
   * (ได้ cookie อย่างเดียว ไม่ได้ token ลง body) ซึ่งเป็นด้านที่ปลอดภัยกว่า
   */
  it("Origin: 'null' ยังนับเป็นเบราว์เซอร์", () => {
    expect(isBrowserRequest(req({ origin: 'null' }))).toBe(true);
  });
});

describe('readRefreshCookie', () => {
  it('อ่านค่าเมื่อมี cookie ใบเดียว', () => {
    expect(
      readRefreshCookie(req({ cookie: `${REFRESH_COOKIE}=abc.def` })),
    ).toBe('abc.def');
  });

  it('หยิบใบที่ถูกต้องออกจากหลายใบ ไม่สนลำดับหรือช่องว่าง', () => {
    const header = `theme=dark; ${REFRESH_COOKIE}=tok123 ;lang=th`;
    expect(readRefreshCookie(req({ cookie: header }))).toBe('tok123');
  });

  /** กันการจับผิดใบเพราะชื่อขึ้นต้นเหมือนกัน */
  it('ไม่หลงกับ cookie ที่ชื่อขึ้นต้นเหมือนกัน', () => {
    const header = `${REFRESH_COOKIE}_old=เก่า; ${REFRESH_COOKIE}=ใหม่`;
    expect(readRefreshCookie(req({ cookie: header }))).toBe('ใหม่');
  });

  it('ไม่มี header หรือไม่มีใบนี้ → undefined', () => {
    expect(readRefreshCookie(req({}))).toBeUndefined();
    expect(readRefreshCookie(req({ cookie: 'theme=dark' }))).toBeUndefined();
    expect(
      readRefreshCookie(req({ cookie: `${REFRESH_COOKIE}=` })),
    ).toBeUndefined();
  });

  /** `%` เดี่ยว ๆ ทำให้ decodeURIComponent โยน — ต้องคืนค่าดิบ ไม่ใช่พังทั้ง request */
  it('ค่าที่ decode ไม่ได้ ต้องไม่ทำให้ทั้ง request ล้ม', () => {
    expect(readRefreshCookie(req({ cookie: `${REFRESH_COOKIE}=100%` }))).toBe(
      '100%',
    );
  });
});

describe('parseDurationMs', () => {
  it.each([
    ['7d', 7 * 86_400_000],
    ['12h', 12 * 3_600_000],
    ['15m', 900_000],
    ['60s', 60_000],
    ['500ms', 500],
    // ไม่มีหน่วย = วินาที ตามที่ไลบรารี jwt ตีความ
    ['3600', 3_600_000],
  ])('%s → %d ms', (input, expected) => {
    expect(parseDurationMs(input)).toBe(expected);
  });

  it('รูปแบบที่อ่านไม่ออกต้องพังตั้งแต่ตอนบูต ไม่ใช่เงียบแล้วได้ NaN', () => {
    expect(() => parseDurationMs('เจ็ดวัน')).toThrow('JWT_REFRESH_TTL');
    expect(() => parseDurationMs('7 weeks')).toThrow('JWT_REFRESH_TTL');
  });
});
