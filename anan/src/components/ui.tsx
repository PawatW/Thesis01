/**
 * Small shared primitives. Anything that grows past ~40 lines moves to its own file.
 *
 * `id` บน Pill / EmptyState / ErrorNote คือ DOM id บนเว็บ (react-native-web ส่ง
 * `id` ลง element จริง) — เป็นจุดเกาะของ Playwright e2e ที่ประกาศชื่อไว้ที่
 * `e2e/helpers/selectors.ts` · ไม่กระทบ layout หรือพฤติกรรม
 *
 * ⚠️ `Pill` ถูก assert ด้วย `toHaveText()` แบบตรงตัว (subscriptions.spec.ts:86,190,
 * 221,269,360,511) — ห้ามเพิ่ม **ข้อความ** ใด ๆ เข้าไปในกล่องที่ถือ `id`
 * จุดสีจึงต้องเป็น `<View>` ไม่ใช่ `<Text>` ที่มีอักขระอยู่ข้างใน
 */

import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { breakpoints, colors, layout, radius, shadow, space, statusTones, type } from '@/lib/theme';
import { useWindowWidth } from '@/lib/useWindowWidth';

/** Full-screen loader used while fonts or the session are still resolving. */
export function Splash() {
  // e2e รอให้ #splash หายไปก่อนค่อย assert เนื้อหา — ไม่ต้องใช้ sleep คงที่
  return (
    <View id="splash" style={styles.splash}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

/**
 * `raised` — พื้นผิวขาวมีขอบ hairline (ค่าเริ่มต้น)
 * `plain`  — โปร่งใส ไม่มีขอบ ไม่มีพื้น ใช้กับ "กลุ่ม" ที่ต้องการแค่หัวข้อกับรายการ
 *
 * ของเดิมทุก Card เป็นกล่องขาวลอยเหมือนกันหมด ทำให้หน้าแรกเกิดการ์ดลอยซ้อน
 * การ์ดลอย (Card ห่อ ProductCard) และกินที่บนมือถือ 32px ต่อด้าน
 * `plain` มีไว้ให้ย้ายลุคออกได้โดย **ไม่ต้องขยับ `id`** — `#subs-group-*` ยังอยู่
 * บน element เดิมและยังเป็นพ่อของ `#subs-item-*` ตาม descendant selector ของ e2e
 */
export function Card({
  children,
  style,
  id,
  variant = 'raised',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  id?: string;
  variant?: 'raised' | 'plain';
}) {
  return (
    <View id={id} style={[variant === 'plain' ? styles.cardPlain : styles.card, style]}>
      {children}
    </View>
  );
}

/**
 * Page wrapper. Three things every screen needs and none should re-solve:
 *  - safe area at the top (headers are hidden, so content would sit under the notch)
 *  - the keyboard must not cover the field being typed into, on iOS
 *  - a tap on a button while the keyboard is open must press the button, not just
 *    dismiss the keyboard (RN's default would make every form submit take two taps)
 *
 * `wide` ปิด maxWidth ของคอลัมน์เนื้อหา ใช้กับหน้าที่คุมความกว้างเองแล้ว
 * (เช่น หน้าแรกบนเดสก์ท็อปที่มี rail อยู่ข้าง ๆ)
 */
export function Screen({
  children,
  scroll = true,
  wide = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  wide?: boolean;
}) {
  const width = useWindowWidth();
  const insets = useSafeAreaInsets();
  const pad = width >= breakpoints.tablet ? space.xxl : space.lg;
  const content: ViewStyle = { padding: pad, paddingTop: pad + insets.top };
  const inner: ViewStyle = {
    width: '100%',
    maxWidth: wide ? undefined : layout.contentMaxWidth,
    alignSelf: 'center',
    gap: space.lg,
  };

  if (!scroll) {
    return (
      <View style={[styles.screen, content]}>
        <View style={inner}>{children}</View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={styles.screen} contentContainerStyle={content} keyboardShouldPersistTaps="handled">
        <View style={inner}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={type.h3}>{title}</Text>
      {action}
    </View>
  );
}

type PillTone = keyof typeof statusTones;

/**
 * `dot` เติมจุดสีนำหน้าเพื่อให้แยกสถานะได้โดยไม่พึ่ง hue อย่างเดียว (คนตาบอดสี)
 * เป็น `<View>` ล้วน ไม่มีข้อความ — `toHaveText()` ของ e2e จึงยังได้ค่าเดิมเป๊ะ
 */
export function Pill({
  label,
  tone = 'neutral',
  id,
  dot = false,
}: {
  label: string;
  tone?: PillTone;
  id?: string;
  dot?: boolean;
}) {
  return (
    <View id={id} style={[styles.pill, { backgroundColor: statusTones[tone].bg }]}>
      {dot ? <View style={[styles.pillDot, { backgroundColor: statusTones[tone].fg }]} /> : null}
      <Text style={[type.label, { color: statusTones[tone].fg }]}>{label}</Text>
    </View>
  );
}

/**
 * Required next to every money figure (CLAUDE.md rule 1).
 *
 * เป็น "ตราประทับ" ขอบประ ไม่ใช่ป้ายสีทึบ — ยืมภาษาของตรา "ตัวอย่าง / ไม่ใช่
 * เอกสารจริง" บนแบบฟอร์มไทย และไม่ไปกินช่องสีที่ระบบสงวนไว้ให้สถานะกับเวลา
 * ข้อความคงเดิมทุกตัวอักษรตามกฎเหล็ก
 */
export function DemoBadge({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.demo}>
      <Text style={styles.demoText}>{compact ? 'DEMO' : 'DEMO — ไม่มีการตัดเงินจริง'}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  body,
  action,
  id,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <View id={id} style={styles.empty}>
      <Text style={[type.h4, { textAlign: 'center' }]}>{title}</Text>
      {body != null ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {action}
    </View>
  );
}

export function ErrorNote({ message, id }: { message: string; id?: string }) {
  return (
    <View id={id} style={styles.errorNote}>
      <Text style={[type.small, { color: colors.danger }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  screen: { flex: 1, backgroundColor: colors.background },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
    ...shadow('card'),
  },
  cardPlain: { gap: space.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 3,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  demo: {
    alignSelf: 'flex-start',
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.xs,
    paddingHorizontal: space.md,
    paddingVertical: 3,
  },
  demoText: { ...type.label, color: colors.textMuted },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.xxxl },
  emptyBody: { ...type.small, color: colors.textMuted, textAlign: 'center', maxWidth: 320 },
  errorNote: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.dangerSoftBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
  },
});
