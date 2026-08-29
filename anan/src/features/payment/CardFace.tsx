import { StyleSheet, Text, View } from 'react-native';

import { cardBrands, colors, radius, space, type } from '@/lib/theme';

import { expiryLabel, maskedNumber, type CardBrand } from './card';

/**
 * หน้าบัตรจริง ๆ ใบหนึ่ง — ใช้ทั้งในรายการบัตรที่ผูกไว้ และเป็นตัวอย่างสด
 * ระหว่างกรอกฟอร์ม (ตัวเลขกับเครือข่ายขยับตามที่พิมพ์)
 *
 * บนบัตรมีเฉพาะสิ่งที่ระบบเก็บไว้จริง: เครือข่าย · 4 ตัวท้าย · เดือน/ปีหมดอายุ ·
 * ชื่อบนบัตร — หลักที่เหลือเป็นจุดเสมอ เพราะไม่เคยมีอยู่ให้แสดง
 *
 * อัตราส่วน 1.586:1 คือสัดส่วนบัตร ISO/IEC 7810 ID-1 ของจริง
 */
export function CardFace({
  brand,
  last4,
  expMonth,
  expYear,
  holderName,
  compact = false,
  id,
}: {
  brand: CardBrand;
  last4: string;
  /** 0 = ยังกรอกไม่ครบ (ใช้ตอนเป็นตัวอย่างสดระหว่างพิมพ์) → แสดงเป็นจุด */
  expMonth: number;
  expYear: number;
  holderName?: string | null;
  /** ย่อลงสำหรับรายการที่มีหลายใบเรียงกัน */
  compact?: boolean;
  id?: string;
}) {
  const skin = cardBrands[brand];

  return (
    <View id={id} style={[styles.face, { backgroundColor: skin.face }, compact && styles.compact]}>
      <View style={styles.top}>
        <View style={styles.chip}>
          <View style={styles.chipLine} />
          <View style={styles.chipLine} />
        </View>
        <Text style={styles.brand}>{skin.label}</Text>
      </View>

      <Text style={[styles.number, compact && styles.numberCompact]}>
        {maskedNumber(last4, brand)}
      </Text>

      <View style={styles.bottom}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>ชื่อบนบัตร</Text>
          <Text numberOfLines={1} style={styles.fieldValue}>
            {holderName != null && holderName !== '' ? holderName.toUpperCase() : '—'}
          </Text>
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>หมดอายุ</Text>
          <Text style={styles.fieldValue}>
            {expMonth > 0 ? expiryLabel(expMonth, expYear) : '••/••'}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** ตัวอักษรบนบัตรเป็นละตินล้วนได้ จึงถ่างช่องไฟได้ (ดูกฎใน theme.ts) */
const onCard = { color: colors.onPrimary } as const;

const styles = StyleSheet.create({
  face: {
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.lg,
    maxWidth: 380,
    aspectRatio: 1.586,
    justifyContent: 'space-between',
  },
  compact: { aspectRatio: undefined, gap: space.md, paddingVertical: space.md },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: {
    width: 34,
    height: 26,
    borderRadius: radius.xs,
    backgroundColor: 'rgba(255,255,255,0.72)',
    padding: 5,
    justifyContent: 'space-between',
  },
  chipLine: { height: 2, borderRadius: 1, backgroundColor: 'rgba(28,25,23,0.35)' },
  brand: { ...type.h4, ...onCard, letterSpacing: 1 },
  number: { ...type.h3, ...onCard, fontVariant: ['tabular-nums'], letterSpacing: 1.5 },
  numberCompact: { ...type.bodyStrong, letterSpacing: 1 },
  bottom: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xl },
  field: { gap: 2, flexShrink: 1 },
  fieldLabel: { ...type.label, color: colors.onPrimaryMuted, letterSpacing: 0.5 },
  fieldValue: { ...type.small, ...onCard, fontVariant: ['tabular-nums'] },
});
