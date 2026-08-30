import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { colors, radius, space, type } from '@/lib/theme';

type Props = {
  /** DOM id ของ `<TextInput>` จริง — จุดเกาะของ Playwright (`e2e/helpers/selectors.ts`) */
  id: string;
  value: string;
  onChangeText: (next: string) => void;
  /** เรียกทั้งตอนกด Enter/"ค้นหา" บนคีย์บอร์ด และตอนกดปุ่มไอคอนแว่นขยาย */
  onSubmit?: () => void;
  placeholder?: string;
  /** DOM id ของปุ่มไอคอนแว่นขยาย */
  submitId?: string;
  autoFocus?: boolean;
};

/**
 * ช่องค้นหาสินค้า/ร้านค้า — ใช้ซ้ำได้ทั้งหน้าแรก (hero) และหน้า `/search`
 *
 * ต้องกด Enter บนเว็บและปุ่ม "ค้นหา" บนคีย์บอร์ดมือถือได้เหมือนกัน (`onSubmitEditing`
 * + `returnKeyType="search"`) และมีปุ่มไอคอนแว่นขยายให้กดแทนได้ด้วย — ผู้ใช้มือถือ
 * บางคนไม่รู้ว่าปุ่ม "ค้นหา" บนคีย์บอร์ดคือปุ่มเดียวกับการกดแว่นขยาย
 *
 * radius ของทั้งช่องกรอกและปุ่มเป็น `md` ไม่ใช่ `pill` — pill สงวนไว้ให้ status
 * badge/ชิปหมวดเท่านั้น (ดูเหตุผลใน `theme.ts`)
 */
export function SearchBar({
  id,
  value,
  onChangeText,
  onSubmit,
  placeholder = 'ค้นหาสินค้าหรือร้านค้า',
  submitId,
  autoFocus,
}: Props) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrap}>
      <TextInput
        id={id}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        returnKeyType="search"
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        // ไม่มี <Text> label ที่ผูกไว้ให้ — ตั้งชื่อ accessible เองตรง ๆ เหมือน TextField
        aria-label={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.input, focused && styles.inputFocused]}
      />
      <Pressable
        id={submitId}
        onPress={onSubmit}
        accessibilityRole="button"
        accessibilityLabel="ค้นหา"
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <Ionicons name="search" size={20} color={colors.onPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: {
    ...type.body,
    flex: 1,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 44,
  },
  inputFocused: { borderColor: colors.primary },
  button: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  buttonPressed: { backgroundColor: colors.primaryStrong },
});
