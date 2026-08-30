import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { parseISODate, todayISO, toISODate } from '@/lib/date';
import { colors, radius, shadow, space, type } from '@/lib/theme';

/**
 * ช่องกรอกวันที่ + ปฏิทินให้เลือก (feature 18 · หน้าออกคูปองของแอดมินและของร้าน)
 *
 * ★ ทำไมยังมีช่องพิมพ์อยู่ ★ — ปฏิทินเป็นทางหลัก แต่ input ตัวเดิมถูกเก็บไว้เพราะ
 *   1. บนเว็บ Playwright กรอกค่าลง `#...-starts / #...-ends` ตรง ๆ (TC-116) และ
 *      ช่อง readonly จะ `fill()` ไม่ได้
 *   2. แอดมินที่รู้วันอยู่แล้วพิมพ์เร็วกว่าเลื่อนปฏิทินหลายเดือน
 *
 * ★ ทำไมเขียนปฏิทินเอง ไม่ลง react-native-community/datetimepicker ★ — ตัวนั้นเป็น
 * native module ที่ไม่มีบนเว็บ (ต้องแตกเป็น 2 ทาง) ส่วน `<input type="date">` ของเบราว์เซอร์
 * ก็ใช้บนมือถือไม่ได้ · CLAUDE.md ข้อ 3 บังคับว่าทุกหน้าต้องได้ทั้ง mobile และ web
 * ปฏิทินนี้ประกอบจาก View/Pressable ล้วน จึงหน้าตาเดียวกันทุกแพลตฟอร์ม
 *
 * ทุกค่าเข้า-ออกเป็น `YYYY-MM-DD` ตามปฏิทินท้องถิ่น (ไม่แตะ UTC — ดูหัวไฟล์ lib/date.ts)
 * ส่วนที่แสดงเป็น พ.ศ. เพราะกลุ่มเป้าหมายเป็นคนไทย
 */

const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const;

const MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `true` เฉพาะสตริงที่เป็นวันจริง — '2026-02-31' ต้องไม่ผ่าน */
function isValidISODate(iso: string): boolean {
  if (!ISO_DATE.test(iso)) return false;
  const d = parseISODate(iso);
  return !Number.isNaN(d.getTime()) && toISODate(d) === iso;
}

function monthLabel(year: number, month: number): string {
  return `${MONTHS[month]} ${year + 543}`;
}

/** ทุกช่องของตาราง 7 คอลัมน์ — `null` คือช่องว่างก่อนวันที่ 1 / หลังวันสุดท้าย */
function buildMonthGrid(year: number, month: number): (string | null)[] {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (string | null)[] = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(toISODate(new Date(year, month, day)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

type Props = {
  label: string;
  /** `YYYY-MM-DD` หรือ '' เมื่อยังไม่เลือก */
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  /** เลือกวันก่อนหน้านี้ไม่ได้ (inclusive) — ใช้กับ "ใช้ได้ถึง" ที่ต้องไม่มาก่อนวันเริ่ม */
  minDate?: string;
  /** เลือกวันหลังจากนี้ไม่ได้ (inclusive) */
  maxDate?: string;
  /** ให้ล้างค่าเป็นค่าว่างได้ — ช่องที่ "เว้นว่างได้" เท่านั้น */
  clearable?: boolean;
  editable?: boolean;
  /**
   * DOM id ของช่องพิมพ์บนเว็บ · ปุ่มและวันในปฏิทินได้ id ที่แตกจากตัวนี้อัตโนมัติ
   * (`${id}-open`, `${id}-day-YYYY-MM-DD`, …) — ลงทะเบียนไว้ที่ `e2e/helpers/selectors.ts`
   */
  id?: string;
};

export function DateField({
  label,
  value,
  onChange,
  placeholder = 'ปปปป-ดด-วว',
  hint,
  error,
  minDate,
  maxDate,
  clearable = false,
  editable = true,
  id,
}: Props) {
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);

  // เดือนที่ปฏิทินกำลังเปิดอยู่ — แยกจาก `value` เพราะผู้ใช้เลื่อนดูเดือนอื่นได้โดยยังไม่เลือก
  const anchor = isValidISODate(value) ? value : (minDate ?? todayISO());
  const [cursor, setCursor] = useState(() => parseISODate(anchor));

  /** เปิดปฏิทินครั้งใหม่ต้องเริ่มที่เดือนของค่าปัจจุบันเสมอ ไม่ใช่เดือนที่ค้างไว้รอบก่อน */
  const openCalendar = () => {
    setCursor(parseISODate(anchor));
    setOpen(true);
  };

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const cells = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const today = todayISO();

  const shiftMonth = (delta: number) => setCursor(new Date(year, month + delta, 1));

  const outOfRange = (iso: string) =>
    (minDate != null && minDate !== '' && iso < minDate) ||
    (maxDate != null && maxDate !== '' && iso > maxDate);

  const invalid = error != null || (value !== '' && !isValidISODate(value));
  const helper =
    error ??
    (value !== '' && !isValidISODate(value) ? 'รูปแบบวันที่ไม่ถูกต้อง' : undefined);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>

      <View style={styles.row}>
        <TextInput
          id={id}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          maxLength={10}
          editable={editable}
          inputMode="numeric"
          aria-label={label}
          aria-invalid={invalid}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[
            styles.input,
            focused && styles.focused,
            invalid && styles.errored,
            !editable && styles.readonly,
          ]}
        />
        <Pressable
          id={id != null ? `${id}-open` : undefined}
          accessibilityRole="button"
          accessibilityLabel={`เลือกวันที่: ${label}`}
          disabled={!editable}
          onPress={openCalendar}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && styles.iconButtonPressed,
            !editable && styles.readonly,
          ]}
        >
          <Ionicons name="calendar-outline" size={20} color={colors.primary} />
        </Pressable>
      </View>

      {helper != null ? (
        <Text id={id != null ? `${id}-error` : undefined} style={styles.error}>
          {helper}
        </Text>
      ) : hint != null ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* กดพื้นหลังเพื่อปิด — พฤติกรรมเดียวกับ CouponSheet */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* ครอบเนื้อในด้วย Pressable เปล่าเพื่อกันการกดทะลุไปโดนพื้นหลัง */}
          <Pressable
            id={id != null ? `${id}-calendar` : undefined}
            style={[styles.sheet, shadow('floating')]}
            onPress={() => {}}
          >
            <View style={styles.head}>
              <Pressable
                id={id != null ? `${id}-prev` : undefined}
                accessibilityRole="button"
                accessibilityLabel="เดือนก่อนหน้า"
                onPress={() => shiftMonth(-1)}
                style={styles.navButton}
              >
                <Ionicons name="chevron-back" size={20} color={colors.text} />
              </Pressable>
              <Text id={id != null ? `${id}-month` : undefined} style={type.h4}>
                {monthLabel(year, month)}
              </Text>
              <Pressable
                id={id != null ? `${id}-next` : undefined}
                accessibilityRole="button"
                accessibilityLabel="เดือนถัดไป"
                onPress={() => shiftMonth(1)}
                style={styles.navButton}
              >
                <Ionicons name="chevron-forward" size={20} color={colors.text} />
              </Pressable>
            </View>

            <View style={styles.grid}>
              {WEEKDAYS.map((w) => (
                <View key={w} style={styles.cell}>
                  <Text style={styles.weekday}>{w}</Text>
                </View>
              ))}

              {cells.map((iso, index) => {
                if (iso == null) return <View key={`blank-${index}`} style={styles.cell} />;
                const disabled = outOfRange(iso);
                const selected = iso === value;
                return (
                  <View key={iso} style={styles.cell}>
                    <Pressable
                      id={id != null ? `${id}-day-${iso}` : undefined}
                      accessibilityRole="button"
                      accessibilityState={{ disabled, selected }}
                      disabled={disabled}
                      onPress={() => {
                        onChange(iso);
                        setOpen(false);
                      }}
                      style={({ pressed }) => [
                        styles.day,
                        iso === today && styles.dayToday,
                        selected && styles.daySelected,
                        pressed && !disabled && !selected && styles.dayPressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.dayText,
                          selected && styles.dayTextSelected,
                          disabled && styles.dayTextDisabled,
                        ]}
                      >
                        {parseISODate(iso).getDate()}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>

            <View style={styles.foot}>
              {clearable ? (
                <Pressable
                  id={id != null ? `${id}-clear` : undefined}
                  accessibilityRole="button"
                  onPress={() => {
                    onChange('');
                    setOpen(false);
                  }}
                  style={styles.footButton}
                >
                  <Text style={styles.footText}>ล้างวันที่</Text>
                </Pressable>
              ) : (
                <View />
              )}
              <Pressable
                id={id != null ? `${id}-today` : undefined}
                accessibilityRole="button"
                disabled={outOfRange(today)}
                onPress={() => {
                  onChange(today);
                  setOpen(false);
                }}
                style={styles.footButton}
              >
                <Text style={[styles.footText, outOfRange(today) && styles.footTextDisabled]}>
                  วันนี้
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { ...type.label, color: colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: space.sm },
  input: {
    ...type.body,
    flex: 1,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 44,
    justifyContent: 'center',
  },
  focused: { borderColor: colors.primary, backgroundColor: colors.surface },
  errored: { borderColor: colors.danger },
  readonly: { opacity: 0.6 },
  iconButton: {
    width: 48,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  iconButtonPressed: { backgroundColor: colors.primarySoft },
  error: { ...type.caption, color: colors.danger },
  hint: { ...type.caption, color: colors.textFaint },

  backdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  navButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  // ตาราง 7 คอลัมน์แบบ wrap — ทำงานเหมือนกันทั้ง native และ web (ไม่พึ่ง CSS grid)
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 2 },
  weekday: { ...type.label, color: colors.textFaint },
  day: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  dayToday: { borderWidth: 1, borderColor: colors.primary },
  daySelected: { backgroundColor: colors.primary },
  dayPressed: { backgroundColor: colors.primarySoft },
  dayText: { ...type.small, color: colors.text },
  dayTextSelected: { color: colors.onPrimary },
  dayTextDisabled: { color: colors.textFaint, opacity: 0.5 },

  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.sm,
  },
  footButton: { paddingVertical: space.sm, paddingHorizontal: space.md },
  footText: { ...type.bodyStrong, color: colors.primary },
  footTextDisabled: { color: colors.textFaint },
});
