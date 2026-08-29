import { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';

import { colors, radius, space, type } from '@/lib/theme';

type Props = {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  maxLength?: number;
  multiline?: boolean;
  editable?: boolean;
  /** Lets the last field of a form submit with Enter / the keyboard's return key. */
  onSubmitEditing?: () => void;
  returnKeyType?: TextInputProps['returnKeyType'];
  /**
   * DOM id ของช่องกรอกบนเว็บ · ข้อความ error ของช่องนี้ได้ `${id}-error` อัตโนมัติ
   * เพื่อให้ e2e ยืนยันข้อความ validation ได้โดยไม่ต้องพึ่งข้อความไทย
   * (จุดเกาะของ Playwright — `e2e/helpers/selectors.ts`)
   */
  id?: string;
};

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  hint,
  secureTextEntry,
  keyboardType,
  autoCapitalize = 'none',
  autoComplete,
  maxLength,
  multiline,
  editable = true,
  onSubmitEditing,
  returnKeyType,
  id,
}: Props) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        id={id}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        maxLength={maxLength}
        multiline={multiline}
        editable={editable}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType ?? (onSubmitEditing != null ? 'go' : undefined)}
        // the visible <Text> label is not tied to the input, so name it explicitly —
        // on web this input would otherwise have no accessible name at all
        aria-label={label}
        aria-invalid={error != null}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          styles.input,
          multiline && styles.multiline,
          focused && styles.focused,
          error != null && styles.errored,
          !editable && styles.readonly,
        ]}
      />
      {error != null ? (
        <Text id={id != null ? `${id}-error` : undefined} style={styles.error}>
          {error}
        </Text>
      ) : hint != null ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { ...type.label, color: colors.textMuted },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 44, // touch target; padding alone left it at ~40 on some fields
    justifyContent: 'center',
  },
  // `verticalAlign` is the portable spelling; textAlignVertical is Android-only
  multiline: { minHeight: 96, paddingTop: space.md, verticalAlign: 'top' },
  focused: { borderColor: colors.primary, backgroundColor: colors.surface },
  errored: { borderColor: colors.danger },
  readonly: { opacity: 0.6 },
  error: { ...type.caption, color: colors.danger },
  hint: { ...type.caption, color: colors.textFaint },
});
