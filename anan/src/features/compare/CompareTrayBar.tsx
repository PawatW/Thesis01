import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MIN_COMPARE, useCompare } from './CompareProvider';
import { colors, radius, shadow, space, type } from '@/lib/theme';

/**
 * แถบลอยล่างหน้าหมวด — โผล่เมื่อมีของในถาดเท่านั้น
 *
 * ปุ่ม "ดูตาราง" ถูกปิดจนกว่าจะมี 2 ชิ้น เพราะเทียบชิ้นเดียวไม่มีความหมาย
 * (บอกเหตุผลไว้ข้าง ๆ ด้วย ไม่ใช่ปิดเฉย ๆ ให้ผู้ใช้เดา)
 */
export function CompareTrayBar() {
  const { items, clear } = useCompare();
  const router = useRouter();

  if (items.length === 0) return null;
  const ready = items.length >= MIN_COMPARE;

  return (
    <View id="compare-tray" style={styles.bar}>
      <View style={styles.info}>
        <Text style={styles.count}>เทียบ {items.length} ชิ้น</Text>
        <Text style={styles.hint} numberOfLines={1}>
          {ready ? items.map((i) => i.name).join(' · ') : 'เลือกอีกอย่างน้อย 1 ชิ้น'}
        </Text>
      </View>
      <Pressable
        id="compare-tray-open"
        accessibilityRole="button"
        disabled={!ready}
        onPress={() => router.push('/compare')}
        style={[styles.open, !ready && styles.disabled]}
      >
        <Text style={styles.openText}>ดูตาราง</Text>
      </Pressable>
      <Pressable
        id="compare-tray-clear"
        accessibilityRole="button"
        onPress={clear}
        style={styles.clear}
      >
        <Text style={styles.clearText}>ล้าง</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    ...shadow('floating'),
  },
  info: { flex: 1, gap: 2 },
  count: { ...type.bodyStrong },
  hint: { ...type.caption, color: colors.textMuted },
  open: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  disabled: { opacity: 0.45 },
  openText: { ...type.bodyStrong, color: colors.onPrimary },
  clear: { paddingHorizontal: space.sm, minHeight: 44, justifyContent: 'center' },
  clearText: { ...type.caption, color: colors.textMuted },
});
