import { Platform } from 'react-native';

import { breakpoints, layout, space } from '@/lib/theme';
import { useWindowWidth } from '@/lib/useWindowWidth';

/**
 * One formula for every product grid. Previously the home screen and the category
 * screen each derived card width their own way, so the same card rendered 200px
 * wide on one and 161px on the other at the same window width — and both silently
 * re-derived Screen's padding, so changing that padding broke them with no error.
 *
 * Column count is capped at 4: design-system §4 asks for "2 on phones, 3-4 on web",
 * and an uncapped floor(width / minCol) produced 7-8 cards per row at 1280px.
 *
 * ── สูตรนี้ต้องประมาณ "ขาด" เสมอ ห้ามประมาณ "เกิน" ────────────────────────
 * กริดเป็น `flexWrap` + การ์ดกว้างตายตัว ถ้าคิดเกินจริงแม้แต่ 1px การ์ดใบ
 * สุดท้ายจะตกบรรทัด แล้วเหลือที่ว่างทั้งช่องของการ์ดหนึ่งใบ — เสียที่มากกว่า
 * ตอนคิดขาดหลายสิบเท่า (คิดขาดแค่ทำให้การ์ดแคบลงใบละไม่กี่พิกเซล)
 *
 * ── ตัวเลขจริงที่วัดจาก DOM (Chrome, dpr 1.25, 2026-08-22) ────────────────
 * หน้าแรกที่ innerWidth = 1530
 *
 *   window                        1530.0
 *   └ − sidebar                   1290.0   ← อยู่นอก ScrollView
 *     └ ScrollView clientWidth    1275.0   ← รางสกรอลล์กินไป 15px
 *       └ − contentContainer 24×2 1226.4
 *         └ − gap 24 − rail 340    862.4
 *           └ − Card pad 16×2      830.4
 *             └ − Card border 1×2  828.8   ← พื้นที่จริงของกริด
 *
 * บรรทัดสุดท้ายคือที่สูตรเดิมพลาด: `borderWidth: 1` ของ `<Card>` อยู่ใน
 * box-sizing: border-box จึงกินพื้นที่ด้านในไปอีก 2px สูตรเดิมได้ 830 แล้ว
 * แบ่ง 4 คอลัมน์เป็น 198px → ต้องใช้ 198×4 + 12×3 = 828 ซึ่ง "พอดีเป๊ะ" แค่
 * บางความกว้างเท่านั้น พอเศษของการหารเปลี่ยน (ราวครึ่งหนึ่งของทุกความกว้าง)
 * ก็เกินไป 1-2px แล้วการ์ดใบที่ 4 ตกบรรทัดทันที — บนมือถือชนเงื่อนไขนี้เกือบ
 * ทุกขนาดจอ จึงเหลือการ์ดแถวละใบเดียวทั้งที่ตั้งใจให้ 2 ใบ
 *
 * อีกจุดที่พลาดคือ `maxWidth` ของ `Screen`: มันครอบ **หลัง** padding และปลดเฉพาะ
 * หน้าที่ส่ง `wide` (ตอนนี้มีแค่หน้าแรกบนเดสก์ท็อป) สูตรเดิมครอบก่อน padding และ
 * ใช้เงื่อนไข "จอกว้าง" แทน หน้าหมวดบนจอ 1530 จึงคิดว่ามีที่ 1194px ทั้งที่ของจริง
 * ถูกครอบไว้ 1120px → การ์ดกว้างเกิน ตกเหลือแถวละ 3 ใบ เสียที่ไปฟรี 229px
 *
 * **ทำไมไม่ใช้ `onLayout` วัดของจริง:** ลองแล้ว — `onLayout` ไม่ยิงเลยบน
 * react-native-web 0.21 ชุดนี้ (ใส่ log ในคอลแบ็กแล้วไม่มีอะไรออกมาแม้แต่ครั้งเดียว)
 * จึงกลับมาใช้สูตรที่คำนวณได้แน่นอน ตรวจสอบได้ด้วยการคูณเลข · สิ่งเดียวที่วัดจาก
 * ของจริงคือความกว้างรางสกรอลล์ ซึ่งเดาจากความกว้างหน้าต่างไม่ได้ (ดู `scrollbarWidth`)
 */

/** เส้นขอบ 1px สองด้านของ `<Card>` — border-box จึงกินพื้นที่ด้านในจริง */
const CARD_BORDER = 2;

/**
 * เผื่อเศษที่หายไปตอนเบราว์เซอร์ปัดความกว้างลง device pixel (วัดได้จริงว่าหายไป
 * ~0.6px ต่อชั้นที่ dpr 1.25) — ไม่มีตัวนี้แล้วผลลัพธ์จะพอดีเป๊ะจนพลาดง่าย
 */
const SAFETY = 2;

/**
 * ความกว้างรางสกรอลล์จริงของเบราว์เซอร์ — วัดครั้งเดียวแล้วจำไว้
 *
 * ของเดิมเดาจากความกว้างหน้าต่าง ("กว้าง ≥ 768 ถึงจะนับว่ามีราง") ซึ่งผิดทันที
 * ที่ผู้ใช้ลากหน้าต่างเดสก์ท็อปให้แคบกว่านั้น — รางยังกินที่อยู่ 15px แต่สูตร
 * คิดว่าไม่มี การ์ดสองใบจึงล้นบรรทัดแล้วเหลือแถวละใบเดียว
 *
 * คืน 0 เองเมื่อเป็นสกรอลล์บาร์แบบลอยทับ (มือถือ / macOS) และบน native
 */
let scrollbarCache: number | null = null;

function scrollbarWidth(): number {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return 0;
  if (scrollbarCache != null) return scrollbarCache;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll';
  document.body.appendChild(probe);
  scrollbarCache = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return scrollbarCache;
}

export function useProductGrid({
  rail = false,
  inCard = false,
}: {
  /**
   * `rail` — หน้าที่มีคอลัมน์ "รอบถัดไป" อยู่ขวามือบนจอกว้าง (ตอนนี้มีแค่หน้าแรก)
   * หน้าที่มี rail คือหน้าที่ส่ง `<Screen wide>` ด้วย (จึงไม่โดน maxWidth ครอบ)
   */
  rail?: boolean;
  /**
   * `inCard` — กริดอยู่ใน `<Card>` หรือไม่ (หน้าแรกอยู่ · หน้าหมวด/หน้าร้านไม่อยู่)
   * ถ้าไม่บอก สูตรจะหัก padding + border ของ Card ให้ทั้งที่ไม่มี แล้วเสียที่ฟรี 34px
   */
  inCard?: boolean;
} = {}): {
  cardWidth: number;
  columns: number;
} {
  const width = useWindowWidth();

  const wide = width >= breakpoints.desktop;
  // ต้องตรงกับเงื่อนไข padding ของ `Screen`
  const screenPad = width >= breakpoints.tablet ? space.xxl : space.lg;

  // sidebar อยู่นอก ScrollView จึงหักก่อนราง ส่วน padding อยู่ที่ contentContainer
  const viewport = width - (wide ? layout.sidebarWidth : 0) - scrollbarWidth();
  const inner = viewport - screenPad * 2;

  // `Screen` ครอบ maxWidth ไว้ที่คอลัมน์เนื้อหา **หลัง** padding และปลดเฉพาะหน้าที่
  // ส่ง `wide` (= หน้าที่มี rail) — สูตรเดิมครอบก่อน padding และใช้เงื่อนไข "จอกว้าง"
  // แทน จึงคิดว่าหน้าหมวดบนจอ 1530 มีที่ 1194px ทั้งที่ของจริงถูกครอบไว้ที่ 1120px
  const content = rail && wide ? inner : Math.min(inner, layout.contentMaxWidth);
  const main = rail && wide ? content - space.xxl - layout.railWidth : content;

  const available = Math.max(1, main - (inCard ? space.lg * 2 + CARD_BORDER : 0) - SAFETY);

  // +gap on both sides of the division so the gaps between cards are accounted for
  const raw = Math.floor((available + space.md) / (layout.productGridMinCol + space.md));
  const columns = Math.min(4, Math.max(2, raw));
  const cardWidth = Math.floor((available - space.md * (columns - 1)) / columns);

  return { cardWidth, columns };
}
