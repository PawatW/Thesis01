/**
 * body ของ `POST /me/payment-methods` ที่ผ่าน DTO ครบทุก field
 *
 * มีไว้เพื่อไม่ให้ทุก spec ต้องพิมพ์ชุดเดิมซ้ำ และเวลาเพิ่ม field ใหม่ของบัตร
 * จะได้แก้ที่เดียว — spec ไหนสนใจแค่ last4 ก็ override เฉพาะตัวนั้น
 */
export function cardBody(
  over: Partial<{
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
    holderName: string;
  }> = {},
): Record<string, unknown> {
  return {
    brand: 'visa',
    last4: '4242',
    expMonth: 12,
    // อิงปีปัจจุบัน ไม่ใช่ปีคงที่ — ไม่งั้นชุด test จะพังเองเมื่อถึงปีนั้นจริง
    expYear: new Date().getUTCFullYear() + 4,
    holderName: 'TEST USER',
    ...over,
  };
}

/** ค่าที่ใส่ให้ Prisma ตรง ๆ (ข้าม API) — ใช้ใน db-invariants */
export function cardRow(
  over: Partial<{
    brand: 'visa' | 'mastercard' | 'jcb' | 'amex' | 'unionpay' | 'unknown';
    last4: string;
    expMonth: number;
    expYear: number;
  }> = {},
) {
  return {
    last4: '4242',
    expMonth: 12,
    expYear: new Date().getUTCFullYear() + 4,
    ...over,
  };
}
