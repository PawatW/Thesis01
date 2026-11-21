import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DemoBadge } from '@/components/ui';
import type { Category } from '@/features/catalog/api';
import { iconName } from '@/features/catalog/categoryIcon';
import { cycleLabel, daysUntil, type SubscriptionCard } from '@/features/subscriptions/api';
import { categoryTone, colors, palette, radius, space, type } from '@/lib/theme';

/**
 * ชิ้นส่วนของหน้าแรกผู้ซื้อ (feature 02) — layout ตาม mockup ปี 2026-11
 * (docs/mockups/home-redesign.html) แต่ใช้โทนเขียวสนเดิมของ theme.ts
 *
 * ไฟล์นี้ไม่ดึงข้อมูลเอง — หน้า `app/(buyer)/index.tsx` เป็นคนโหลดแล้วส่งเข้ามา
 * เพื่อให้มีจุดเดียวที่รู้ว่า "หน้าแรกยิง API อะไรบ้าง"
 */

/* ---------------- hero ---------------- */

export function HomeHero({
  displayName,
  upNext,
  spendLine,
  wide,
}: {
  displayName: string;
  upNext: SubscriptionCard | undefined;
  /** "เดือนนี้จ่ายรวม ฿x จาก n รอบ" — null เมื่อยังไม่มีรายการที่ใช้งานอยู่ */
  spendLine: string | null;
  /** พื้นที่พอวางการ์ด "ถัดไป" ข้างข้อความหรือไม่ */
  wide: boolean;
}) {
  const router = useRouter();

  return (
    <View id="home-hero" style={[styles.hero, wide && styles.heroWide]}>
      {/* วงกลมตกแต่ง — marigold เป็นพื้นได้ ห้ามเป็นตัวอักษร (theme.ts) */}
      <View style={[styles.blob, styles.blobA]} />
      <View style={[styles.blob, styles.blobB]} />

      <View style={styles.heroCopy}>
        <View style={styles.heroChip}>
          <Text style={styles.heroChipText}>รอบส่งอัตโนมัติ · 2 สัปดาห์ / เดือน / 2 เดือน</Text>
        </View>
        <Text id="home-greeting" style={styles.greeting}>
          สวัสดี {displayName}
        </Text>
        <Text style={styles.heroTitle}>ของใช้ประจำ{'\n'}ให้มาเองตามรอบ</Text>
        <Text style={styles.heroBody}>
          สมัครครั้งเดียวจากหลายร้าน ถูกกว่าซื้อครั้งเดียว ข้ามรอบ หยุดชั่วคราว หรือยกเลิกได้ทุกเมื่อ
        </Text>
        <Pressable
          id="home-hero-cta"
          accessibilityRole="button"
          onPress={() => router.push('/search')}
          style={({ pressed }) => [styles.heroCta, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.heroCtaText}>เริ่มเลือกของ</Text>
          <Ionicons name="arrow-forward" size={16} color={colors.primaryStrong} />
        </Pressable>
      </View>

      {upNext != null || spendLine != null ? (
        <View style={[styles.nextCard, wide && styles.nextCardWide]}>
          {upNext != null ? <UpNext item={upNext} /> : null}
          {spendLine != null ? (
            <View style={styles.spendRow}>
              <Text style={styles.spend}>{spendLine}</Text>
              <DemoBadge compact />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * การ์ด "ถัดไป" — ตัวเลขที่ใหญ่ที่สุดในหน้าคือจำนวนวันที่เหลือ
 * ANAN ขายเวลา ไม่ใช่ราคา
 */
function UpNext({ item }: { item: SubscriptionCard }) {
  const days = daysUntil(item.nextOrderDate);
  if (days == null) return null;

  const toneColor =
    days <= 3 ? colors.timeUrgent : days <= 7 ? colors.timeSoon : colors.timeCalm;

  return (
    <View id="home-upnext" style={styles.upNext}>
      <Text style={styles.upNextLabel}>รอบถัดไป</Text>
      <View style={styles.upNextCount}>
        <Text style={[styles.upNextNumber, { color: toneColor }]}>
          {days <= 0 ? 'วันนี้' : days}
        </Text>
        {days > 0 ? <Text style={styles.upNextUnit}>วัน</Text> : null}
      </View>
      <Text style={styles.upNextName} numberOfLines={1}>
        {item.productName}
      </Text>
      <Text style={styles.upNextMeta} numberOfLines={1}>
        {item.shopName} · {cycleLabel(item.cycle)} · ฿
        {(item.pricePerCycle * item.quantity).toLocaleString('th-TH')}/รอบ
      </Text>
    </View>
  );
}

/* ---------------- categories ---------------- */

/**
 * แถวไอคอนหมวดแบบวงกลม — ยังเป็น "เช็คบ็อกซ์" เหมือนเดิม (ติ๊กได้หลายหมวด
 * แล้วกรองในหน้านี้เลย) จึงคง `accessibilityRole="checkbox"` และเครื่องหมายถูก
 * บนวงกลม ให้คนตาบอดสีแยกได้โดยไม่พึ่งสีอย่างเดียว
 */
export function CategoryStrip({
  categories,
  picked,
  onToggle,
  onClear,
  width,
}: {
  categories: Category[];
  picked: number[];
  onToggle: (id: number) => void;
  onClear: () => void;
  /** ความกว้างของคอลัมน์เนื้อหา — ใช้แบ่งช่องให้แถวเต็มพอดี ไม่เหลือหางแถวละ 1 หมวด */
  width: number;
}) {
  const fit = Math.max(4, Math.floor((width - space.lg * 2) / 58));
  const rows = Math.ceil(categories.length / fit);
  const perRow = Math.max(1, Math.ceil(categories.length / Math.max(1, rows)));
  const cell = `${100 / perRow}%` as const;
  return (
    <View style={styles.panel}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>หมวดสินค้า</Text>
        {picked.length > 0 ? (
          <Pressable
            id="home-category-clear"
            accessibilityRole="button"
            onPress={onClear}
            style={styles.clear}
          >
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            <Text style={styles.clearText}>ล้างตัวกรอง ({picked.length})</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.cats}>
        {categories.map((c) => {
          const tone = categoryTone(c.icon);
          const on = picked.includes(c.id);
          return (
            <Pressable
              key={c.id}
              id={`home-category-${c.id}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={c.name}
              onPress={() => onToggle(c.id)}
              style={[styles.cat, { width: cell }]}
            >
              {({ pressed }) => (
                <>
                  <View
                    style={[
                      styles.catIcon,
                      { backgroundColor: tone.tint },
                      (on || pressed) && { borderColor: tone.solid },
                      on && styles.catIconOn,
                    ]}
                  >
                    <Ionicons name={iconName(c.icon)} size={22} color={tone.solid} />
                    {on ? (
                      <View style={[styles.catCheck, { backgroundColor: tone.solid }]}>
                        <Ionicons name="checkmark" size={11} color={colors.surface} />
                      </View>
                    ) : null}
                  </View>
                  <Text
                    style={[styles.catName, on && { color: tone.solid, fontFamily: type.bodyStrong.fontFamily }]}
                    numberOfLines={2}
                  >
                    {c.name}
                  </Text>
                </>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ---------------- promo tiles ---------------- */

type Tile = {
  id: string;
  title: string;
  body: string;
  cta: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: Href;
  bg: string;
  fg: string;
};

/**
 * ทุกช่องเป็นความสามารถที่มีอยู่จริงในระบบ — ไม่ใส่โปร "ส่งฟรี" หรือ flash sale
 * ที่ระบบไม่ได้ทำ (ป้ายที่ไม่จริงบนหน้าแรกของ thesis คือจุดที่กรรมการถามก่อน)
 */
const TILES: Tile[] = [
  {
    id: 'home-tile-manage',
    title: 'ข้าม หยุด เลื่อนได้เอง',
    body: 'คุมทุกรอบจากหน้าเดียว ไม่มีสัญญาผูกมัด',
    cta: 'ดูของที่สมัครไว้',
    icon: 'pause-circle-outline',
    href: '/(buyer)/subscriptions',
    bg: palette.pineSoft,
    fg: palette.pineDeep,
  },
  {
    id: 'home-tile-compare',
    title: 'เทียบก่อนสมัคร',
    body: 'ราคาต่อหน่วย ต่อรอบ ข้ามร้านในตารางเดียว',
    cta: 'เปิดหน้าเปรียบเทียบ',
    icon: 'git-compare-outline',
    href: '/compare',
    bg: palette.shelf,
    fg: palette.ink,
  },
  {
    id: 'home-tile-shops',
    title: 'หลายร้านในที่เดียว',
    body: 'กาแฟ สมุนไพร อาหารสัตว์ ส่งตามรอบของใครของมัน',
    cta: 'ค้นหาร้านค้า',
    icon: 'storefront-outline',
    href: '/search',
    bg: '#FBEED4',
    fg: palette.amberInk,
  },
];

export function PromoTiles({ columns }: { columns: number }) {
  const router = useRouter();
  const shown = columns >= 3 ? TILES : TILES.slice(0, columns);

  return (
    <View style={styles.tiles}>
      {shown.map((t) => (
        <Pressable
          key={t.id}
          id={t.id}
          accessibilityRole="link"
          onPress={() => router.push(t.href)}
          style={({ pressed }) => [
            styles.tile,
            { backgroundColor: t.bg },
            pressed && { opacity: 0.85 },
          ]}
        >
          <View style={styles.tileCopy}>
            <Text style={styles.tileTitle}>{t.title}</Text>
            <Text style={styles.tileBody}>{t.body}</Text>
            <View style={styles.tileCta}>
              <Text style={[styles.tileCtaText, { color: t.fg }]}>{t.cta}</Text>
              <Ionicons name="arrow-forward" size={14} color={t.fg} />
            </View>
          </View>
          <View style={styles.tileIcon}>
            <Ionicons name={t.icon} size={30} color={t.fg} />
          </View>
        </Pressable>
      ))}
    </View>
  );
}

/* ---------------- section header ---------------- */

export function HomeSectionHead({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {sub != null ? <Text style={styles.sectionSub}>{sub}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function SeeAll({ id, href }: { id: string; href: Href }) {
  const router = useRouter();
  return (
    <Pressable id={id} accessibilityRole="link" onPress={() => router.push(href)} style={styles.seeAll}>
      <Text style={styles.seeAllText}>ดูทั้งหมด</Text>
    </Pressable>
  );
}

/* ---------------- trust bar ---------------- */

const TRUST: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  { icon: 'shield-checkmark-outline', title: 'บัตรเก็บแค่ 4 ตัวท้าย', body: 'DEMO — ไม่มีการตัดเงินจริง' },
  { icon: 'pause-outline', title: 'ข้าม / หยุดได้ทุกเมื่อ', body: 'ไม่มีสัญญาผูกมัด' },
  { icon: 'notifications-outline', title: 'แจ้งเตือนทุกรอบ', body: 'รู้ก่อนของออกจากร้าน' },
  { icon: 'repeat-outline', title: 'รอบตรงทุกครั้ง', body: 'ระบบสร้างออเดอร์ให้เองตามรอบ' },
];

export function TrustBar({ columns }: { columns: number }) {
  return (
    <View style={[styles.panel, styles.trust]}>
      {TRUST.map((t) => (
        <View key={t.title} style={[styles.trustItem, { flexBasis: `${100 / columns - 4}%` }]}>
          <View style={styles.trustIcon}>
            <Ionicons name={t.icon} size={18} color={colors.primaryStrong} />
          </View>
          <View style={styles.trustCopy}>
            <Text style={styles.trustTitle}>{t.title}</Text>
            <Text style={styles.trustBody}>{t.body}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  /* hero */
  hero: {
    backgroundColor: palette.pineDeep,
    borderRadius: radius.xxl,
    padding: space.xxl,
    gap: space.xl,
    overflow: 'hidden',
  },
  heroWide: { flexDirection: 'row', alignItems: 'center', padding: space.xxxl, minHeight: 260 },
  blob: { position: 'absolute', borderRadius: 999 },
  blobA: { width: 260, height: 260, right: -70, top: -90, backgroundColor: palette.pine },
  blobB: { width: 120, height: 120, right: 140, bottom: -60, backgroundColor: palette.marigold, opacity: 0.9 },
  heroCopy: { flex: 1, gap: space.sm, minWidth: 0 },
  heroChip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 3,
  },
  heroChipText: { ...type.label, color: colors.onPrimary },
  greeting: { ...type.small, color: colors.onPrimaryMuted, marginTop: space.xs },
  heroTitle: { ...type.h1, fontSize: 32, lineHeight: 44, color: colors.onPrimary },
  heroBody: { ...type.small, color: colors.onPrimaryMuted, maxWidth: 420 },
  heroCta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
    minHeight: 44,
    marginTop: space.sm,
  },
  heroCtaText: { ...type.bodyStrong, color: colors.primaryStrong },

  nextCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.lg,
    gap: space.md,
  },
  nextCardWide: { width: 300 },
  upNext: { gap: 2 },
  upNextLabel: { ...type.label, color: colors.textMuted },
  upNextCount: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  upNextNumber: { ...type.display },
  upNextUnit: { ...type.small, color: colors.textMuted },
  upNextName: { ...type.h4, color: colors.text },
  upNextMeta: { ...type.caption, color: colors.textMuted },
  spendRow: {
    gap: space.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.md,
    alignItems: 'flex-start',
  },
  spend: { ...type.caption, color: colors.textMuted },

  /* generic panel + section head */
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.lg,
    gap: space.md,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap', flexShrink: 1 },
  sectionTitle: { ...type.h3, color: colors.text },
  sectionSub: { ...type.caption, color: colors.textFaint },
  seeAll: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    minHeight: 32,
    justifyContent: 'center',
  },
  seeAllText: { ...type.caption, color: colors.textMuted },

  /* categories */
  cats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md },
  cat: { alignItems: 'center', gap: 6, paddingVertical: 2 },
  catIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  catIconOn: { borderWidth: 2 },
  catCheck: {
    position: 'absolute',
    right: -2,
    top: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  catName: { ...type.caption, color: colors.textMuted, textAlign: 'center' },
  clear: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  clearText: { ...type.caption, color: colors.textMuted },

  /* tiles */
  tiles: { flexDirection: 'row', gap: space.md },
  tile: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    gap: space.sm,
    borderRadius: radius.xl,
    padding: space.lg,
    minHeight: 132,
  },
  tileCopy: { flex: 1, gap: 4, minWidth: 0 },
  tileTitle: { ...type.h4, color: colors.text },
  tileBody: { ...type.caption, color: colors.textMuted },
  tileCta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 'auto', paddingTop: space.sm },
  tileCtaText: { ...type.label, fontSize: 13 },
  tileIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },

  /* trust */
  trust: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.md },
  trustItem: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexGrow: 1 },
  trustIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustCopy: { flexShrink: 1 },
  trustTitle: { ...type.label, fontSize: 13, color: colors.text },
  trustBody: { ...type.caption, fontSize: 12, color: colors.textFaint },
});
