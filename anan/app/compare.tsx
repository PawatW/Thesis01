import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Card, EmptyState, Screen, SectionHeader } from '@/components/ui';
import {
  baht,
  bestDiscountPlan,
  cycleLabel,
  discountPercent,
  pricePerUnit,
  type Cycle,
  type ProductCardData,
} from '@/features/catalog/api';
import { MIN_COMPARE, useCompare } from '@/features/compare/CompareProvider';
import { colors, radius, space, type } from '@/lib/theme';

const CYCLES: Cycle[] = ['2w', '1m', '2m'];

/** คอลัมน์แรก (ชื่อแถว) กว้างคงที่และตรึงไว้ — คอลัมน์สินค้าเลื่อนแนวนอน */
const LABEL_WIDTH = 132;
const COLUMN_WIDTH = 168;

type Row = {
  key: string;
  label: string;
  /** ค่าที่เอาไปเทียบเพื่อไฮไลต์ — null = ไม่ร่วมไฮไลต์ */
  value: (item: ProductCardData) => number | null;
  /** ยิ่งน้อยยิ่งดี (ราคา) หรือยิ่งมากยิ่งดี (ส่วนลด/คะแนน) */
  better: 'lower' | 'higher';
  text: (item: ProductCardData) => string;
};

const planOf = (item: ProductCardData, cycle: Cycle) =>
  item.plans.find((p) => p.cycle === cycle) ?? null;

/**
 * Feature 04 — ตารางเทียบสินค้าข้ามร้าน
 *
 * ★ นี่คือ objective ของ proposal ที่จับต้องได้ ★ "เทียบข้ามแบรนด์" จะมีความหมาย
 * ก็ต่อเมื่อเทียบ **ราคาต่อหน่วย** ได้ ไม่ใช่แค่ราคาต่อรอบ — ขนาดบรรจุกับจำนวน
 * ชิ้นต่อรอบต่างกัน ราคาต่อรอบจึงเทียบกันตรง ๆ ไม่ได้เลย
 *
 * ทั้งหน้าไม่ยิง request เลยสักครั้ง: ใช้ข้อมูลที่หน้าหมวดโหลดไว้แล้ว
 */
export default function CompareScreen() {
  const { items, remove, clear } = useCompare();
  const router = useRouter();

  if (items.length < MIN_COMPARE) {
    return (
      <Screen>
        <Card>
          <EmptyState
            id="compare-empty"
            title="ยังไม่มีอะไรให้เทียบ"
            body="เลือกสินค้าในหมวดเดียวกันอย่างน้อย 2 ชิ้นจากหน้าหมวด แล้วกด “ดูตาราง”"
            action={<Button label="กลับไปเลือกสินค้า" onPress={() => router.back()} />}
          />
        </Card>
      </Screen>
    );
  }

  /**
   * หน่วยที่เทียบกันได้ต้องเป็นหน่วยเดียวกัน — g กับ ml เทียบต่อหน่วยไม่ได้
   * ใช้หน่วยของชิ้นแรกที่มีเป็นเกณฑ์ แล้วชิ้นที่หน่วยไม่ตรงจะขึ้น "—"
   */
  const baseUnit = items.find((i) => i.unit != null)?.unit ?? null;
  const comparableUnit = (item: ProductCardData): boolean =>
    baseUnit != null && item.unit === baseUnit && item.netAmount != null;

  const rows: Row[] = [
    ...CYCLES.map<Row>((cycle) => ({
      key: `price-${cycle}`,
      label: cycleLabel(cycle),
      better: 'lower',
      value: (item) => planOf(item, cycle)?.pricePerCycle ?? null,
      text: (item) => {
        const plan = planOf(item, cycle);
        return plan == null ? '—' : `${baht(plan.pricePerCycle)} · ${plan.qtyPerCycle} ชิ้น`;
      },
    })),
    {
      key: 'per-unit',
      label: baseUnit == null ? 'ราคาต่อหน่วย' : `ราคาต่อ 1 ${baseUnit}`,
      better: 'lower',
      value: (item) => {
        if (!comparableUnit(item)) return null;
        const plan = bestDiscountPlan(item.plans, item.oneTimePrice);
        return plan == null ? null : pricePerUnit(plan, item.netAmount);
      },
      text: (item) => {
        if (!comparableUnit(item)) return '—';
        const plan = bestDiscountPlan(item.plans, item.oneTimePrice);
        const per = plan == null ? null : pricePerUnit(plan, item.netAmount);
        return per == null ? '—' : `${baht(per)} / ${item.unit ?? ''}`;
      },
    },
    {
      key: 'discount',
      label: 'ถูกกว่าซื้อครั้งเดียว',
      better: 'higher',
      value: (item) => {
        const plan = bestDiscountPlan(item.plans, item.oneTimePrice);
        return plan == null ? null : discountPercent(plan, item.oneTimePrice);
      },
      text: (item) => {
        const plan = bestDiscountPlan(item.plans, item.oneTimePrice);
        const off = plan == null ? 0 : discountPercent(plan, item.oneTimePrice);
        return off > 0 ? `${off}%` : '—';
      },
    },
    {
      key: 'rating',
      label: 'คะแนนรีวิว',
      better: 'higher',
      // สินค้าที่ยังไม่มีรีวิวต้องไม่ร่วมไฮไลต์ และต้องไม่ถูกอ่านว่า 0 ดาว
      value: (item) => item.rating,
      text: (item) =>
        item.rating == null ? 'ยังไม่มีรีวิว' : `★ ${item.rating.toFixed(1)} (${item.reviewCount})`,
    },
    {
      key: 'subscribers',
      label: 'คนที่สมัครอยู่',
      better: 'higher',
      value: (item) => item.activeSubscribers,
      text: (item) => `${item.activeSubscribers} คน`,
    },
  ];

  return (
    <Screen>
      <SectionHeader
        title={`เทียบ ${items.length} ชิ้น`}
        action={
          <Pressable id="compare-clear" accessibilityRole="button" onPress={clear}>
            <Text style={styles.clear}>ล้างถาด</Text>
          </Pressable>
        }
      />
      <Text style={styles.note}>
        ราคาต่อหน่วยคำนวณจากแผนที่คุ้มที่สุดของแต่ละชิ้น — ช่องที่ขึ้น “—” คือไม่มีข้อมูล
        ขนาดบรรจุ หรือหน่วยไม่ตรงกันจนเทียบไม่ได้
      </Text>

      <Card>
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.table}>
          <View>
            {/* หัวตาราง: ชื่อสินค้า + ปุ่มถอดออกจากถาด */}
            <View style={styles.row}>
              <View style={[styles.labelCell, styles.headCell]} />
              {items.map((item) => (
                <View key={item.id} id={`compare-col-${item.id}`} style={[styles.cell, styles.headCell]}>
                  <Text style={styles.name} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={styles.shop} numberOfLines={1}>
                    {item.shopName}
                  </Text>
                  <Pressable
                    id={`compare-remove-${item.id}`}
                    accessibilityRole="button"
                    onPress={() => remove(item.id)}
                  >
                    <Text style={styles.remove}>เอาออก</Text>
                  </Pressable>
                </View>
              ))}
            </View>

            {rows.map((row) => {
              const values = items.map(row.value);
              const numbers = values.filter((v): v is number => v != null);
              const best =
                numbers.length < 2
                  ? null
                  : row.better === 'lower'
                    ? Math.min(...numbers)
                    : Math.max(...numbers);

              return (
                <View key={row.key} id={`compare-row-${row.key}`} style={styles.row}>
                  <View style={styles.labelCell}>
                    <Text style={styles.label}>{row.label}</Text>
                  </View>
                  {items.map((item, i) => {
                    const value = values[i];
                    const isBest = best != null && value != null && value === best;
                    return (
                      <View
                        key={item.id}
                        id={`compare-${row.key}-${item.id}`}
                        style={[styles.cell, isBest && styles.bestCell]}
                      >
                        <Text style={[styles.value, isBest && styles.bestValue]}>
                          {row.text(item)}
                        </Text>
                        {isBest ? <Text style={styles.bestTag}>ดีที่สุด</Text> : null}
                      </View>
                    );
                  })}
                </View>
              );
            })}

            {/* สมัครตรงจากคอลัมน์ — แผนที่คุ้มที่สุดของสินค้าชิ้นนั้น */}
            <View style={styles.row}>
              <View style={styles.labelCell}>
                <Text style={styles.label}>สมัครเลย</Text>
              </View>
              {items.map((item) => {
                const plan = bestDiscountPlan(item.plans, item.oneTimePrice);
                return (
                  <View key={item.id} style={styles.cell}>
                    {plan == null ? (
                      <Text style={styles.value}>ปิดรับชั่วคราว</Text>
                    ) : (
                      <Button
                        id={`compare-subscribe-${item.id}`}
                        label="สมัคร"
                        onPress={() =>
                          router.push({
                            pathname: '/checkout/[planId]',
                            params: { planId: plan.id },
                          })
                        }
                      />
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        </ScrollView>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { ...type.caption, color: colors.textMuted },
  clear: { ...type.caption, color: colors.primaryStrong },
  table: { paddingRight: space.md },
  row: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border },
  labelCell: {
    width: LABEL_WIDTH,
    paddingVertical: space.md,
    paddingRight: space.sm,
    justifyContent: 'center',
  },
  cell: {
    width: COLUMN_WIDTH,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    gap: 2,
    justifyContent: 'center',
  },
  headCell: { borderTopWidth: 0, paddingBottom: space.sm },
  bestCell: { backgroundColor: colors.primarySoft, borderRadius: radius.md },
  label: { ...type.caption, color: colors.textMuted },
  value: { ...type.bodyStrong },
  bestValue: { color: colors.primaryStrong },
  bestTag: { ...type.label, color: colors.primaryStrong },
  name: { ...type.bodyStrong },
  shop: { ...type.caption, color: colors.textMuted },
  remove: { ...type.caption, color: colors.danger, minHeight: 44, paddingTop: space.sm },
});
