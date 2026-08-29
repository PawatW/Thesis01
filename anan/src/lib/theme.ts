/**
 * ANAN design tokens.
 * Doc + rationale: docs/design-system.md
 *
 * Rules:
 *  - Components read from here. No raw hex / magic numbers in feature code.
 *  - Values are plain objects (no runtime deps) so they work on native and web.
 *
 * ── ทิศทางภาพ (2026-08-19) ───────────────────────────────────────────────
 * เดิมเป็น violet #8B5CF6 + gradient ม่วง→ชมพู ซึ่งยกมาจาก mockup NovaShop
 * ทั้งชุด — ไม่มีสีไหนอธิบายได้ว่าทำไมต้องเป็นสีนี้กับกาแฟ ยาสีฟัน อาหารแมว
 * และม่วงในตลาดไทยอ่านว่า "แอปการเงิน" ไม่ใช่ "ของใช้เข้าบ้าน"
 *
 * ของใหม่ยืนอยู่บนสองอย่างที่ผู้ใช้เห็นทุกวัน:
 *  1. ชั้นวางของในร้านชำ → เขียวสน + เหลืองดาวเรืองบนพื้นกระดาษอุ่น
 *  2. ฉลากสินค้า → สีประจำหมวด (`categoryTones`) ที่ใช้แทนรูปสินค้าได้จริง
 *
 * กฎที่ห้ามละเมิด:
 *  - `marigold` ใช้เป็นแท่ง/จุด/พื้นเท่านั้น ห้ามเป็นตัวอักษร (2.2:1 บนขาว)
 *  - สี "เวลา" (`timeUrgent/timeSoon/timeCalm`) สงวนไว้ให้การนับถอยหลังเท่านั้น
 *    ห้ามหยิบไปตกแต่ง ไม่งั้นการกวาดตาหา "อะไรจะมาก่อน" จะพัง
 *  - ห้ามใส่ `letterSpacing` กับข้อความที่มีอักษรไทย — สระบนกับวรรณยุกต์
 *    ผูกตำแหน่งกับฐาน การถ่างช่องไฟทำให้ลอยหลุด (ใส่ได้เฉพาะละตินล้วน เช่น "DEMO")
 */

import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/* ---------------- palette ---------------- */

export const palette = {
  // ground — กระดาษอุ่น แทน #F3F3F7 ที่อมฟ้า (จอ LCD Android ราคาถูกจะดันให้ออกม่วง)
  paper: '#F6F3EC',
  shelf: '#EFEAE0', // กรอบรูปสินค้า, แถวย่อย, หัวตาราง
  white: '#FFFFFF',

  // brand — เขียวสน = ทะเบียนของ "ของกินของใช้/สมุนไพร"
  pine: '#1F5F4B', // 6.7:1 บนกระดาษ
  pineDeep: '#154237',
  pineSoft: '#E3EDE8',
  pineFaint: '#F1F6F3',

  // เวลา — accent เดียวของระบบ ผูกกับ next_order_date เท่านั้น
  marigold: '#E8A317', // แท่ง/จุด/พื้น เท่านั้น — ห้ามเป็นตัวอักษร
  amberInk: '#8A5A00', // 5.3:1 — ข้อความ "อีก 4-7 วัน"
  clay: '#C2410C', // 4.6:1 — "วันนี้ / อีก 1-3 วัน" และการทำลาย
  claySoft: '#FBEDE6',
  clayBorder: '#F2D6C7',

  // neutrals โทนอุ่น — ทุกค่าผ่าน WCAG AA บนพื้นกระดาษ
  ink: '#1C1917', // 15.6:1
  inkMuted: '#57504A', // 7.0:1
  inkFaint: '#6E675E', // 5.0:1 ← ค่าต่ำสุดที่ยอมให้ใช้กับตัวอักษร
  line: '#DDD5C7', // เส้นคั่น/ขอบการ์ด (decorative)
  lineStrong: '#8E857A', // ขอบ input + ปุ่ม outlined (ต้อง ≥3:1)

  // พื้นเข้มของแถบนำทางฝั่งหลังร้าน/ผู้ดูแล (ดู `roleShells`)
  pineNight: '#0E2E26', // เส้นขอบบนพื้น pineDeep
  inkNight: '#332F2B', // เส้นขอบบนพื้น ink
} as const;

/* ---------------- semantic colors ----------------
 * ชื่อคีย์ทั้งหมดคงเดิมจากชุด violet เพื่อให้ทุกหน้าจอเปลี่ยนพร้อมกันโดยไม่ต้องแก้ทีละไฟล์
 */

export const colors = {
  primary: palette.pine,
  primaryStrong: palette.pineDeep,
  primarySoft: palette.pineSoft,
  onPrimary: palette.white,

  background: palette.paper,
  surface: palette.white,
  surfaceAlt: palette.shelf,

  text: palette.ink,
  textMuted: palette.inkMuted,
  /** ค่าต่ำสุดที่ยังผ่าน AA — เดิมเป็น #A1A1AA ซึ่งได้แค่ 2.56:1 */
  textFaint: palette.inkFaint,
  border: palette.line,
  /** ขอบที่ต้องมองเห็นจริง: input, ปุ่ม outlined, ตัวเลือกที่ถูกเลือก */
  borderStrong: palette.lineStrong,

  /** ส่วนลด/ประหยัด = เขียว การประหยัดเงินไม่ใช่เรื่องน่าตกใจ
   *  ปล่อยให้แดงแปลว่า "ระวัง" อย่างเดียวทั้งระบบ */
  sale: palette.pine,
  rating: palette.marigold,
  success: palette.pine,
  danger: palette.clay,
  dangerSoft: palette.claySoft,
  dangerSoftBorder: palette.clayBorder,
  dangerInk: palette.clay,

  onPrimaryMuted: 'rgba(255,255,255,0.88)',
  scrim: 'rgba(28,25,23,0.45)',

  /** subscription status pills (W05 state machine) */
  statusActive: palette.pine,
  statusPaused: palette.amberInk,
  statusFrozen: '#B4530C',
  statusCancelled: palette.inkFaint,

  /** นับถอยหลังรอบส่ง — สงวนไว้ให้เวลาเท่านั้น (ดูหัวไฟล์) */
  timeUrgent: palette.clay, // ≤3 วัน หรือ ส่งวันนี้
  timeSoon: palette.amberInk, // 4-7 วัน
  timeCalm: palette.ink, // >7 วัน
  timeIdle: palette.inkFaint, // paused / cancelled
  timeTrack: palette.shelf, // รางของแถบจังหวะรอบ
  timeFill: palette.marigold, // ส่วนที่เดินไปแล้วของแถบ
} as const;

/** Background + foreground pairs for status pills and the success toast. */
export const statusTones = {
  active: { bg: palette.pineSoft, fg: palette.pine },
  paused: { bg: '#FBEED4', fg: palette.amberInk },
  frozen: { bg: '#FBE3D3', fg: '#B4530C' },
  cancelled: { bg: palette.shelf, fg: palette.inkFaint },
  sale: { bg: palette.pineSoft, fg: palette.pine },
  neutral: { bg: palette.shelf, fg: palette.inkMuted },
} as const;

/* ---------------- card brands ----------------
 * สีของเครือข่ายบัตร — ใช้ได้ที่หน้าบัตรเท่านั้น (หน้าบัตรของฉัน + ขั้นตอนจ่ายเงิน)
 *
 * เป็นสีนอกระบบชุดเดียวที่ยอมให้มี เพราะมันไม่ใช่การตกแต่ง: ผู้ใช้จำบัตรของตัวเอง
 * จากสีกับโลโก้ ไม่ใช่จาก 4 ตัวท้าย — การ์ดสองใบที่ลงท้าย 4242 กับ 4243 บนพื้น
 * สีเดียวกันคือจุดที่คนกดผิดใบ · ทุกคู่เป็นตัวอักษรขาวบนพื้นเข้ม ผ่าน AA ทั้งหมด
 */

export const cardBrands = {
  visa: { face: '#1A1F71', label: 'VISA' },
  mastercard: { face: '#2B1A12', label: 'Mastercard' },
  jcb: { face: '#123C7A', label: 'JCB' },
  amex: { face: '#0B5B8F', label: 'AMEX' },
  unionpay: { face: '#0D3B66', label: 'UnionPay' },
  unknown: { face: palette.ink, label: 'บัตร' },
} as const;

export type CardBrandKey = keyof typeof cardBrands;

/* ---------------- role shells ----------------
 * เปลือกของแต่ละบทบาท (buyer / seller / admin)
 *
 * ปัญหาเดิม: ล็อกอินด้วยบัญชีร้านแล้วได้หน้าตาเดียวกับผู้ซื้อเป๊ะ — แถบนำทาง
 * ขาวเหมือนกัน โลโก้เดียวกัน ต่างกันแค่ข้อความในเมนู ผู้ใช้จึงไม่มีทางรู้ว่า
 * ตอนนี้ "สวมหมวกใบไหนอยู่" นอกจากอ่านชื่อเมนูทีละบรรทัด
 *
 * ทางแก้คือให้พื้นของแถบนำทางเป็นตัวบอกบทบาท ไม่ใช่ตัวอักษร:
 *   buyer  — พื้นขาวบนกระดาษอุ่น = หน้าร้าน เดินดูของ
 *   seller — เขียวสนเข้ม        = หลังร้าน ที่ทำงาน
 *   admin  — ดำหมึก            = ห้องเครื่อง ของระบบ
 *
 * เป็นสีจาก palette เดิมทั้งหมด (ไม่มีสีใหม่เข้าระบบ) และตัวอักษรทุกคู่ผ่าน AA
 * บนพื้นของตัวเอง · `accent` ใช้กับไอคอนของเมนูที่เลือกอยู่และแถบ badge
 */

export type RoleShell = {
  navBg: string;
  navBorder: string;
  brand: string;
  brandMuted: string;
  label: string;
  labelActive: string;
  icon: string;
  iconActive: string;
  itemActiveBg: string;
  itemPressedBg: string;
  accent: string;
  /** ตัวนับที่ยังไม่ได้อ่านบนเมนู — พื้นกับตัวอักษรต้องมาคู่กันเสมอ */
  badgeBg: string;
  badgeInk: string;
  /** พื้นของแถบบนจอแคบ — ใช้สีเดียวกับ sidebar เพื่อให้บทบาทอ่านออกทั้งสองขนาดจอ */
  barBg: string;
};

export const roleShells = {
  buyer: {
    navBg: palette.white,
    navBorder: palette.line,
    brand: palette.pine,
    brandMuted: palette.inkFaint,
    label: palette.inkMuted,
    labelActive: palette.pineDeep,
    icon: palette.inkMuted,
    iconActive: palette.pineDeep,
    itemActiveBg: palette.pineSoft,
    itemPressedBg: palette.shelf,
    accent: palette.pine,
    badgeBg: palette.pine,
    badgeInk: palette.white,
    barBg: palette.white,
  },
  seller: {
    navBg: palette.pineDeep,
    navBorder: palette.pineNight,
    brand: palette.white,
    brandMuted: 'rgba(255,255,255,0.66)',
    label: 'rgba(255,255,255,0.78)',
    labelActive: palette.white,
    icon: 'rgba(255,255,255,0.78)',
    iconActive: palette.marigold,
    itemActiveBg: 'rgba(255,255,255,0.14)',
    itemPressedBg: 'rgba(255,255,255,0.07)',
    accent: palette.marigold,
    badgeBg: palette.marigold,
    badgeInk: palette.ink,
    barBg: palette.pineDeep,
  },
  admin: {
    navBg: palette.ink,
    navBorder: palette.inkNight,
    brand: palette.white,
    brandMuted: 'rgba(255,255,255,0.62)',
    label: 'rgba(255,255,255,0.76)',
    labelActive: palette.white,
    icon: 'rgba(255,255,255,0.76)',
    iconActive: palette.marigold,
    itemActiveBg: 'rgba(255,255,255,0.13)',
    itemPressedBg: 'rgba(255,255,255,0.07)',
    accent: palette.marigold,
    badgeBg: palette.marigold,
    badgeInk: palette.ink,
    barBg: palette.ink,
  },
} as const satisfies Record<string, RoleShell>;

/* ---------------- category tones ----------------
 * สินค้าจริงยังไม่มีรูป (seed เก็บเป็นชื่อไฟล์เปล่า ไม่ใช่ URL) และของเดิมวาด
 * อักษรตัวแรกด้วยสี #EDE9FE บนพื้น #F7F7FA = contrast 1.11:1 → มองไม่เห็นเลย
 * ช่องรูป 120px จึงเป็นสี่เหลี่ยมเทาเปล่าจริง ๆ
 *
 * แทนที่จะรอรูป ใช้ `categories.icon` ที่ seed ไว้แล้ว (ชื่อ Ionicons จริง) เป็นตัวระบุ
 * หมวด แล้วให้สีประจำหมวดทำงาน 3 ที่พร้อมกัน: ชิปหมวด · กรอบรูปในการ์ด · แถบรอบส่ง
 * สินค้าชิ้นเดียวกันจึงมีสีเดียวกันทั้งแอป — เป็นคำตอบถาวร ไม่ใช่ placeholder
 */

export type CategoryTone = { solid: string; tint: string };

const categoryToneByIcon: Record<string, CategoryTone> = {
  cafe: { solid: '#7A4A21', tint: '#F1E8DF' }, // กาแฟ
  sparkles: { solid: '#0B6C86', tint: '#DFEEF2' }, // สกินแคร์
  medical: { solid: '#1C6B5A', tint: '#DFEDE9' }, // ยาสีฟัน
  water: { solid: '#2A5C97', tint: '#E2EAF4' }, // แชมพู
  fitness: { solid: '#9A6212', tint: '#F5EBDA' }, // วิตามิน
  paw: { solid: '#A33564', tint: '#F5E3EB' }, // อาหารสัตว์เลี้ยง
  happy: { solid: '#8A4B8F', tint: '#F0E5F1' }, // ผ้าอ้อม
  home: { solid: '#2E6B34', tint: '#E3EDE2' }, // ของใช้ในบ้าน
  shirt: { solid: '#4A4E8C', tint: '#E6E7F2' }, // ชุดชั้นใน
  footsteps: { solid: '#4C5866', tint: '#E6E9ED' }, // ถุงเท้า
};

const categoryToneFallback: CategoryTone = { solid: palette.inkMuted, tint: palette.shelf };

/** ไอคอนที่ยังไม่มีในตารางต้องได้สีกลาง ไม่ใช่จอขาว — หมวดใหม่เพิ่มได้โดยไม่ต้องแก้ที่เรียก */
export function categoryTone(icon: string | null | undefined): CategoryTone {
  if (icon == null) return categoryToneFallback;
  return categoryToneByIcon[icon] ?? categoryToneFallback;
}

/* ---------------- spacing / radius ---------------- */

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, section: 48 } as const;

/**
 * `pill` สงวนไว้ให้ **status badge กับชิปหมวด** เท่านั้น
 * ปุ่ม action ใช้ `md` — เมื่อปุ่มเป็น pill ด้วย สายตาแยกไม่ออกว่าอันไหนกดได้
 * อันไหนคือสถานะ (ปัญหาจริงบนหน้า subscriptions ที่มีทั้งสองอย่างในการ์ดใบเดียว)
 */
export const radius = { xs: 4, sm: 6, md: 10, lg: 14, xl: 18, xxl: 24, pill: 999 } as const;

/* ---------------- typography ----------------
 * Thai UI copy (CLAUDE.md rule 6) rules out Inter/Plus Jakarta alone — they have no
 * Thai glyphs and fall back to a mismatched system face mid-sentence.
 * IBM Plex Sans Thai covers Latin + Thai in one family with the same geometric feel.
 *
 * ชั้น display ใช้ Plex Bold ตัวเดิมดันขนาดขึ้น แทนที่จะลงฟอนต์ใหม่ — ทุก Playwright
 * spec รอ `#splash` หายก่อนเริ่ม assert ถ้าฟอนต์ใหม่โหลดพลาดจะแดงพร้อมกันทั้ง 84 เคส
 *
 * line-height ทุกตัว ≥1.55 ให้สระบน (ิ ี ึ ื ั ็) กับวรรณยุกต์ที่ซ้อนสองชั้นหายใจได้
 */

export const fonts = {
  regular: 'IBMPlexSansThai_400Regular',
  medium: 'IBMPlexSansThai_500Medium',
  semibold: 'IBMPlexSansThai_600SemiBold',
  bold: 'IBMPlexSansThai_700Bold',
} as const;

/** ตัวเลขที่ต้องเรียงเป็นคอลัมน์หรือนับถอยหลังต้องกว้างเท่ากันทุกหลัก ไม่งั้นกระตุก */
const tabular: Pick<TextStyle, 'fontVariant'> = { fontVariant: ['tabular-nums'] };

export const type = {
  /** ตัวเลขนับถอยหลังบนการ์ด "ถัดไป" — องค์ประกอบที่ใหญ่ที่สุดในแอป */
  display: { fontFamily: fonts.bold, fontSize: 40, lineHeight: 46, ...tabular },
  h1: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 38 },
  h2: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 32 },
  h3: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 28 },
  h4: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 26 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 26 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 26 },
  small: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 22 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  /** แบกคำว่า "ร้านถูกระงับ" — 11px ภาษาไทยเล็กเกินขีดอ่านออก */
  label: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17 },
  price: { fontFamily: fonts.bold, fontSize: 19, lineHeight: 26, ...tabular },
} satisfies Record<string, TextStyle>;

/* ---------------- elevation ----------------
 * Shadows differ per platform; one helper keeps cards identical everywhere
 * (CLAUDE.md rule 3 — no platform-specific API without a fallback).
 *
 * เดิมทั้งแอปมีเงาค่าเดียว (`0 2px 8px rgba(0,0,0,.06)`) ใช้กับทุกพื้นผิว → ทุกอย่าง
 * ลอยเท่ากันหมด สายตาไม่มีที่ลง และเกิดการ์ดลอยซ้อนการ์ดลอยบนหน้าแรก
 * ตอนนี้ความลึกมาจาก **เส้น hairline** เป็นหลัก และเงาจริงถูกสงวนไว้ให้ของที่ลอย
 * เหนือหน้าจริง ๆ (Modal, ถาดเทียบ) จอหนึ่งควรมีไม่เกินหนึ่งชิ้น
 */

type Elevation = 'card' | 'floating';

export const shadow = (level: Elevation = 'card'): ViewStyle => {
  const spec =
    level === 'card'
      ? { y: 1, blur: 3, opacity: 0.04, android: 1 }
      : { y: 12, blur: 32, opacity: 0.16, android: 10 };

  return Platform.select<ViewStyle>({
    web: { boxShadow: `0 ${spec.y}px ${spec.blur}px rgba(28,25,23,${spec.opacity})` } as ViewStyle,
    android: { elevation: spec.android },
    default: {
      shadowColor: palette.ink,
      shadowOffset: { width: 0, height: spec.y },
      shadowRadius: spec.blur / 2,
      shadowOpacity: spec.opacity,
    },
  }) as ViewStyle;
};

/* ---------------- layout ----------------
 * ≥1200px ใช้โครง 3 คอลัมน์ตาม design-system §4 (sidebar / content / rail)
 * ต่ำกว่านั้นเหลือคอลัมน์เดียว + bottom tabs ของ expo-router
 */

export const breakpoints = { tablet: 768, desktop: 1200 } as const;

export const layout = {
  sidebarWidth: 240,
  railWidth: 340, // คอลัมน์ขวา: "รอบถัดไป"
  /** ความกว้างของคอลัมน์เนื้อหาเมื่อไม่มี rail — 1440 เดิมทำให้เว็บเป็นมือถือยืด */
  contentMaxWidth: 1120,
  gutter: space.lg,
  productGridMinCol: 168, // ~2 cols on phones, 3-4 on web
} as const;

export const theme = {
  palette,
  colors,
  space,
  radius,
  fonts,
  type,
  shadow,
  breakpoints,
  layout,
  roleShells,
} as const;

export type Theme = typeof theme;
