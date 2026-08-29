import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, radius, space, type } from '@/lib/theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: ReactNode;
  style?: ViewStyle;
  /**
   * DOM id บนเว็บ (react-native-web ส่ง `id` ลง element จริง) — จุดเกาะของ
   * Playwright e2e ที่ `e2e/helpers/selectors.ts` · บนมือถือเป็น nativeID เฉย ๆ
   * ไม่กระทบ layout หรือพฤติกรรมใด ๆ
   */
  id?: string;
};

/**
 * ปุ่มหลักเป็นเขียวสนทึบ ไม่ใช่ gradient อีกต่อไป
 *
 * ของเดิมใส่ gradient ม่วงทั้งที่ hero และปุ่มหลัก**ทุกปุ่ม** — เมื่อทุกอย่างเป็น
 * gradient มันก็เลิกแปลว่า "กดตรงนี้" · ตอนนี้เหลือสีทึบตัวเดียวที่ยืนอยู่บนพื้น
 * กระดาษได้ชัด และ radius เป็น `md` ไม่ใช่ pill เพราะ pill ถูกสงวนให้ status
 * กับชิปหมวด (ดูเหตุผลใน theme.ts)
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = false,
  icon,
  style,
  id,
}: Props) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      id={id}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        surfaceTone[variant],
        fullWidth && styles.fullWidth,
        pressed && !isDisabled && pressedTone[variant],
        isDisabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={variant === 'primary' ? colors.onPrimary : colors.primary} />
        ) : (
          <>
            {icon}
            <Text style={[styles.label, labelTone[variant]]}>{label}</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    overflow: 'hidden',
    alignSelf: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: space.xl,
    minHeight: 44,
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minHeight: 22 },
  label: { ...type.bodyStrong },
  disabled: { opacity: 0.45 },
});

const surfaceTone: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: colors.primary },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  ghost: { paddingHorizontal: space.md },
  danger: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.dangerSoftBorder,
  },
};

/** กดแล้วต้องเห็นว่ากดโดน — opacity อย่างเดียวอ่านยากบนพื้นกระดาษ */
const pressedTone: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: colors.primaryStrong },
  secondary: { backgroundColor: colors.surfaceAlt },
  ghost: { backgroundColor: colors.primarySoft },
  danger: { backgroundColor: colors.dangerSoft },
};

const labelTone: Record<Variant, { color: string }> = {
  primary: { color: colors.onPrimary },
  secondary: { color: colors.text },
  ghost: { color: colors.primaryStrong },
  danger: { color: colors.danger },
};
