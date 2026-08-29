/**
 * ค่าคงที่จาก seed — **ทุกค่าคัดลอกมาจาก `anan-api/prisma/seed.ts` ตรง ๆ**
 *
 * seed ใช้ UUID ที่เขียนไว้ตายตัว (ไม่ได้สุ่ม) ข้อมูลหลัง `npm run db:seed`
 * จึงเหมือนเดิมทุกครั้ง — เทสอ้าง id ได้โดยไม่ต้องไล่หาจากข้อความบนจอ
 *
 * แก้ seed เมื่อไหร่ต้องมาแก้ไฟล์นี้ด้วย ไม่งั้นเทสจะแดงแบบงง ๆ
 */

/** รหัสผ่านเดียวกันหมดทุกบัญชีเดโม่ — seed.ts บรรทัด `DEMO_PASSWORD` */
export const DEMO_PASSWORD = 'DemoPass2026!';

export const USERS = {
  buyer: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'buyer.demo@anan.local',
    password: DEMO_PASSWORD,
  },
  seller: {
    id: '00000000-0000-4000-8000-000000000002',
    email: 'seller.demo@anan.local',
    password: DEMO_PASSWORD,
  },
  admin: {
    id: '00000000-0000-4000-8000-000000000003',
    email: 'admin.demo@anan.local',
    password: DEMO_PASSWORD,
  },
} as const;

export type Role = keyof typeof USERS;

/** ชื่อที่ globalSetup ประทับทับให้ buyer เพื่อพิสูจน์ว่า API ต่อ DB ทดสอบ */
export const CANARY_DISPLAY_NAME = 'E2E CANARY BUYER';

const product = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plan = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const address = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const subscription = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const order = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const PRODUCTS = {
  /** P(1) — มี 3 แผน (2w/1m/2m) ครบที่สุด เหมาะกับเทสเลือกแผน */
  coffeeMedium: {
    id: product(1),
    name: 'กาแฟคั่วกลาง Arabica',
    shopName: 'Bean Story',
    oneTimePrice: 320,
    categoryId: 1,
    plans: {
      '2w': { id: plan(1), pricePerCycle: 279 },
      '1m': { id: plan(2), pricePerCycle: 255 },
      '2m': { id: plan(3), pricePerCycle: 590 },
    },
  },
  /** P(3) — แผน 2w ถูกปิดรับสมาชิกใหม่ไว้ (isActive: false) โดยตั้งใจ */
  dripBag: {
    id: product(3),
    name: 'ดริปแบ็ก 10 ซอง',
    plans: { '1m': { id: plan(6), pricePerCycle: 199 } },
    inactivePlanId: plan(5),
  },
  /** P(12) — ยังไม่มีใครสมัคร ใช้เป็นสินค้า "สะอาด" สำหรับเทส checkout */
  tissue: {
    id: product(12),
    name: 'กระดาษทิชชู่ 12 ม้วน',
    shopName: 'Pet & Home',
    categoryId: 8,
    plans: { '2m': { id: plan(18), pricePerCycle: 320 } },
  },
} as const;

const shop = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** ร้านของ seed — `seller.demo` เป็นเจ้าของ Bean Story เท่านั้น (1 บัญชี = 1 ร้าน) */
export const SHOPS = {
  beanStory: {
    id: shop(1),
    name: 'Bean Story',
    ownerEmail: USERS.seller.email,
    /** สินค้าของร้านนี้ที่มีสมาชิกอยู่จริง — ใช้ทดสอบการเตือนก่อนขึ้นราคา */
    coffeeProductId: product(1),
    coffeeMonthlyPlanId: plan(2),
    /** สินค้าที่ยังไม่มีสมาชิก — ปิด/เปิดการขายได้โดยไม่กระทบเคสอื่น */
    dripBagProductId: product(3),
  },
  /**
   * ร้านของบัญชีผู้ดูแล — มีไว้ให้ผู้ดูแลสลับเข้าโหมดร้านค้าแล้วมีของให้ดูจริง
   * **ไม่มีสินค้าโดยตั้งใจ** (ถ้ามี สินค้าจะไปขยับลำดับที่ spec ของ catalog จับไว้)
   */
  adminDemo: {
    id: shop(4),
    name: 'ร้านตัวอย่างของผู้ดูแล',
    ownerEmail: USERS.admin.email,
  },
} as const;

export const ADDRESSES = {
  home: { id: address(1), label: 'บ้าน', isDefault: true },
  work: { id: address(2), label: 'ที่ทำงาน', isDefault: false },
} as const;

export const SUBSCRIPTIONS = {
  /** active · รอบถัดไปอีก 3 วัน */
  coffeeMonthly: { id: subscription(1), status: 'active', planId: plan(2) },
  /** active · ถึงรอบวันนี้ · quantity 2 */
  toothpaste: { id: subscription(2), status: 'active', planId: plan(7), quantity: 2 },
  /** paused โดยผู้ใช้เอง (ไม่ใช่ shop_suspended) → ต้องมีปุ่ม "กลับมาใช้งาน" */
  catFoodPaused: { id: subscription(3), status: 'paused', planId: plan(14) },
} as const;

/**
 * ออเดอร์ของ seed — สถานะเริ่มต้นก่อนเทสแตะ (seed.ts หัวข้อ 7)
 *
 * ⚠️ เทสในไฟล์ orders.spec.ts เปลี่ยนสถานะบางใบถาวรภายในการรันหนึ่งครั้ง
 * ลำดับของเคสในไฟล์นั้นจึงมีความหมาย (อ่านหมายเหตุหัวไฟล์)
 */
export const ORDERS = {
  /** SUB(1) กาแฟ · delivered + ผู้ซื้อยืนยันแล้ว */
  coffeeOld: { id: order(1), subscriptionId: subscription(1) },
  coffeeRecent: { id: order(2), subscriptionId: subscription(1) },
  /** SUB(2) ยาสีฟัน · shipped และยังไม่ยืนยัน — ใบเดียวที่กด "ได้รับแล้ว" ได้ */
  toothpasteShipped: { id: order(3), subscriptionId: subscription(2) },
  /** SUB(3) อาหารแมว · delivered แล้วแต่ยังไม่มีเคสปัญหา */
  catFoodDelivered: { id: order(4), subscriptionId: subscription(3) },
} as const;

const coupon = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * คูปองของ seed (feature 18) — ผู้ดูแลออกไว้ 2 ใบ แล้วร้านติ๊กสินค้าเข้าร่วม
 *
 * ★ ยังไม่มีใครจองทั้งคู่ ★ เทสจึงจองเองได้จากสภาพตั้งต้นทุกครั้ง
 * `enrolledProducts` คือสินค้าที่ร้านติ๊กเข้าร่วมไว้แล้วใน seed
 */
export const COUPONS = {
  /** percent + เพดาน — ร้าน Bean Story (P1, P2) และ Herbal Care (P5) เข้าร่วม */
  percent20: {
    id: coupon(1),
    code: 'NEWROUND20',
    discountValue: 20,
    maxDiscountAmount: 80,
    enrolledProducts: [product(1), product(2), product(5)],
  },
  /** fixed 50 บาท ยอดขั้นต่ำ 250 — เข้าร่วมเฉพาะ P1 */
  fixed50: {
    id: coupon(2),
    code: 'SAVE50',
    discountValue: 50,
    minOrderAmount: 250,
    enrolledProducts: [product(1)],
  },
  /** ★ คูปองของร้าน Bean Story ★ ครอบทุกสินค้าของร้าน (รวมที่เพิ่มทีหลัง) */
  shopBean10: {
    id: coupon(3),
    code: 'BEAN10',
    tier: 'shop' as const,
    discountValue: 10,
    maxDiscountAmount: 60,
    appliesToAllProducts: true,
  },
  /** คูปองของร้าน Herbal Care แบบเลือกสินค้าเอง (เฉพาะแชมพูมะกรูด P5) */
  shopHerbal30: {
    id: coupon(4),
    code: 'HERBAL30',
    tier: 'shop' as const,
    discountValue: 30,
    appliesToAllProducts: false,
    enrolledProducts: [product(5)],
  },
} as const;

/**
 * นโยบายคูปองรายสินค้าที่ seed ตั้งไว้ (feature 18 รอบ 2)
 * — สินค้าที่ไม่ได้อยู่ในนี้เป็น `both` ตามค่าปริยาย
 */
export const COUPON_POLICIES = {
  /** P(2) กาแฟคั่วเข้ม — รับเฉพาะคูปองของแพลตฟอร์ม */
  platformOnlyProductId: product(2),
  /** P(3) ดริปแบ็ก — ไม่ร่วมรายการคูปองเลย */
  noneProductId: product(3),
} as const;

export const CATEGORIES = {
  coffee: { id: 1, name: 'กาแฟ' },
  household: { id: 8, name: 'ของใช้ในบ้าน' },
} as const;

/** อีเมลใหม่ที่ไม่ชนกันข้ามการรัน — ใช้กับเทสสมัครสมาชิก */
export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 10_000)}@e2e.local`;
}

/* ---------------- บัตร (feature 09) ----------------
 * ฟอร์มผูกบัตรตรวจ Luhn เหมือนฟอร์มจริง — เลขมั่ว ๆ อย่าง 4111111111111234
 * จะไม่ผ่านด่านฝั่งหน้าจอ ทุกเลขในนี้จึงคำนวณ checksum มาแล้ว
 */

export const TEST_CARDS = {
  /** Visa · ลงท้าย 1111 */
  visa: { number: '4111111111111111', last4: '1111', brand: 'visa' },
  /** Mastercard · ลงท้าย 4444 */
  mastercard: { number: '5555555555554444', last4: '4444', brand: 'mastercard' },
  /** Visa · ลงท้าย 7777 (ใช้ที่หน้า "บัตรของฉัน") */
  visaAlt: { number: '4111000000047777', last4: '7777', brand: 'visa' },
  /** Luhn ไม่ผ่าน — ต้องถูกปฏิเสธก่อนยิงขึ้น API */
  badChecksum: { number: '4111111111111112' },
} as const;

/** 'MMYY' ที่กรอกลงช่องวันหมดอายุ — อิงปีปัจจุบันเพื่อไม่ให้ชุดเทสหมดอายุตามเวลาจริง */
export const CARD_EXPIRY_INPUT = {
  future: `12${String((new Date().getFullYear() + 4) % 100).padStart(2, '0')}`,
  past: `01${String((new Date().getFullYear() - 2) % 100).padStart(2, '0')}`,
} as const;
