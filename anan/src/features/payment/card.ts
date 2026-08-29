/**
 * ตรรกะของ "บัตร" ทั้งหมดที่ทำงานบนเครื่องผู้ใช้ (feature 09)
 *
 * ★ เลขบัตรเต็มไม่เคยออกจากไฟล์นี้ ★ ทุกฟังก์ชันรับเลขเข้ามาเพื่อ "ตัดสิน" แล้วคืน
 * ค่าที่ปลอดภัยออกไปเท่านั้น (เครือข่าย / 4 ตัวท้าย / ผ่านหรือไม่ผ่าน) — ตัวเรียก
 * เก็บเลขเต็มไว้ได้แค่ใน state ของฟอร์มที่ถูกล้างทิ้งทุกเส้นทาง ทั้งสำเร็จและล้มเหลว
 * (CLAUDE.md กฎข้อ 1 + security-rules C-2)
 */

export type CardBrand = 'visa' | 'mastercard' | 'jcb' | 'amex' | 'unionpay' | 'unknown';

/**
 * ช่วง BIN (6 หลักแรก) ของแต่ละเครือข่าย — ชุดเดียวกับที่ระบบชำระเงินใช้จริง
 * เรียงจากเจาะจงไปกว้าง เพราะ JCB (3528–3589) ซ้อนอยู่ในช่วงที่ขึ้นต้นด้วย 3
 */
const BIN_RULES: readonly { brand: CardBrand; test: RegExp; lengths: number[] }[] = [
  { brand: 'visa', test: /^4/, lengths: [16] },
  { brand: 'mastercard', test: /^(5[1-5]|2[2-7])/, lengths: [16] },
  { brand: 'amex', test: /^3[47]/, lengths: [15] },
  { brand: 'jcb', test: /^35(2[89]|[3-8]\d)/, lengths: [16] },
  { brand: 'unionpay', test: /^62/, lengths: [16, 17, 18, 19] },
];

/** ความยาวที่ยอมรับเมื่อยังไม่รู้เครือข่าย — เผื่อบัตรที่ BIN ไม่อยู่ในตาราง */
const FALLBACK_LENGTHS = [16];

export function onlyDigits(text: string): string {
  return text.replace(/\D/g, '');
}

export function detectBrand(digits: string): CardBrand {
  return BIN_RULES.find((r) => r.test.test(digits))?.brand ?? 'unknown';
}

export function acceptedLengths(digits: string): number[] {
  return BIN_RULES.find((r) => r.test.test(digits))?.lengths ?? FALLBACK_LENGTHS;
}

/** ความยาวสูงสุดที่ยอมให้พิมพ์ต่อ — ใช้คุม maxLength ของช่องกรอก */
export function maxDigitsFor(digits: string): number {
  return Math.max(...acceptedLengths(digits));
}

/**
 * Luhn checksum — ตัวเดียวกับที่ทุก gateway ใช้คัดเลขที่พิมพ์ผิดออกก่อนยิงเครือข่าย
 * จับสลับหลักและสลับตำแหน่งได้เกือบทั้งหมด (เช่น 4242 4242 4242 4241 ไม่ผ่าน)
 */
export function passesLuhn(digits: string): boolean {
  if (digits.length === 0) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** '4242424242424242' → '4242 4242 4242 4242' (Amex เป็น 4-6-5 ตามที่พิมพ์บนบัตรจริง) */
export function formatCardNumber(raw: string): string {
  const digits = onlyDigits(raw).slice(0, 19);
  const groups = detectBrand(digits) === 'amex' ? [4, 6, 5] : [4, 4, 4, 4, 3];

  const out: string[] = [];
  let at = 0;
  for (const size of groups) {
    if (at >= digits.length) break;
    out.push(digits.slice(at, at + size));
    at += size;
  }
  return out.join(' ');
}

/** พิมพ์ตัวเลขไปเรื่อย ๆ แล้วได้ 'MM/YY' — เติม `/` ให้เอง และไม่ต้องกด backspace ข้ามมัน */
export function formatExpiry(raw: string): string {
  const digits = onlyDigits(raw).slice(0, 4);
  if (digits.length === 0) return '';
  // พิมพ์เลขเดียวที่เป็นไปได้แค่เดือน 2 หลัก (เช่น 4 → 04/) ให้กระโดดไปช่องปีเลย
  if (digits.length === 1) return Number(digits) > 1 ? `0${digits}/` : digits;
  const mm = digits.slice(0, 2);
  const yy = digits.slice(2);
  return yy.length > 0 ? `${mm}/${yy}` : mm;
}

/** 'MM/YY' → เดือน + ปี ค.ศ. เต็ม · คืน null ถ้ายังกรอกไม่ครบหรือเดือนไม่มีจริง */
export function parseExpiry(raw: string): { month: number; year: number } | null {
  const digits = onlyDigits(raw);
  if (digits.length !== 4) return null;
  const month = Number(digits.slice(0, 2));
  if (month < 1 || month > 12) return null;
  // บัตรพิมพ์ปีไว้ 2 หลัก — 26 คือ 2026 เสมอ (บัตรไม่มีวันหมดอายุย้อนศตวรรษ)
  return { month, year: 2000 + Number(digits.slice(2)) };
}

/** บัตรใช้ได้ถึง "สิ้นเดือน" ที่พิมพ์บนบัตร — 08/26 ใช้ได้ทั้งเดือนสิงหาคม 2026 */
export function isExpired(
  exp: { month: number; year: number },
  now: Date = new Date(),
): boolean {
  return exp.year * 12 + (exp.month - 1) < now.getFullYear() * 12 + now.getMonth();
}

export type CardDraft = {
  number: string;
  expiry: string;
  cvv: string;
  holder: string;
};

export type CardFieldError = {
  field: 'number' | 'expiry' | 'cvv' | 'holder';
  message: string;
};

/**
 * ด่านฝั่งหน้าจอ — ตอบทันทีโดยไม่ต้องรอ API เหมือนฟอร์มบัตรที่ไหนก็ตาม
 *
 * ไม่ใช่ชั้นความปลอดภัย: กฎที่เป็นความถูกต้องของข้อมูล (รูปแบบ last4, ช่วงวันหมดอายุ,
 * บัตรหมดอายุ, บัตรซ้ำ, เพดานจำนวนใบ) ถูกบังคับซ้ำที่ API และที่ CHECK ของ DB เสมอ
 */
export function validateCard(draft: CardDraft, now: Date = new Date()): CardFieldError | null {
  const digits = onlyDigits(draft.number);

  if (digits.length === 0) return { field: 'number', message: 'กรอกเลขบัตร' };
  if (!acceptedLengths(digits).includes(digits.length)) {
    const expected = acceptedLengths(digits).join(' หรือ ');
    return { field: 'number', message: `เลขบัตรต้องมี ${expected} หลัก` };
  }
  if (!passesLuhn(digits)) {
    return { field: 'number', message: 'เลขบัตรไม่ถูกต้อง — ตรวจอีกครั้ง' };
  }

  const exp = parseExpiry(draft.expiry);
  if (exp == null) return { field: 'expiry', message: 'กรอกวันหมดอายุเป็น ดด/ปป' };
  if (isExpired(exp, now)) return { field: 'expiry', message: 'บัตรนี้หมดอายุแล้ว' };

  const cvvLength = detectBrand(digits) === 'amex' ? 4 : 3;
  if (onlyDigits(draft.cvv).length !== cvvLength) {
    return { field: 'cvv', message: `รหัส CVV มี ${cvvLength} หลัก` };
  }

  if (draft.holder.trim().length < 2) {
    return { field: 'holder', message: 'กรอกชื่อบนบัตร' };
  }

  return null;
}

/**
 * แปลงร่างที่ผ่านด่านแล้วเป็น body ที่ยิงขึ้น API
 *
 * ★ นี่คือจุดที่เลขบัตรถูกทิ้ง ★ ค่าที่คืนออกไปมีแค่เครือข่าย · 4 ตัวท้าย ·
 * เดือน/ปีหมดอายุ · ชื่อบนบัตร — CVV ไม่ถูกส่งและไม่ถูกเก็บที่ไหนเลย เหมือนระบบจริง
 */
export function toCardPayload(draft: CardDraft): {
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
  holderName: string;
} | null {
  const digits = onlyDigits(draft.number);
  const exp = parseExpiry(draft.expiry);
  if (exp == null) return null;

  return {
    brand: detectBrand(digits),
    last4: digits.slice(-4),
    expMonth: exp.month,
    expYear: exp.year,
    holderName: draft.holder.trim(),
  };
}

/** '12' + 2030 → '12/30' — รูปแบบเดียวกับที่พิมพ์บนบัตร */
export function expiryLabel(month: number, year: number): string {
  return `${String(month).padStart(2, '0')}/${String(year % 100).padStart(2, '0')}`;
}

/** เลขบนหน้าบัตร: ปิดหลักหน้าไว้ ให้เหลือ 4 ตัวท้ายที่เก็บจริง */
export function maskedNumber(last4: string, brand: CardBrand): string {
  return brand === 'amex' ? `•••• •••••• •${last4}` : `•••• •••• •••• ${last4}`;
}
