import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ProductImage } from '@/components/Media';
import { Pill } from '@/components/ui';
import {
  baht,
  cheapestPlan,
  cycleShort,
  discountPercent,
  type ProductCardData,
} from '@/features/catalog/api';
import { colors, radius, space, type } from '@/lib/theme';

/**
 * The reference mockup's product card, with the one change that matters here:
 * the two prices mean "per cycle" vs "buy once", not "sale" vs "was".
 */
/**
 * ปุ่มเทียบเป็น **พี่น้อง** ของการ์ด ไม่ใช่ลูก — บนเว็บ Pressable ที่มี
 * `accessibilityRole="button"` render เป็น `<button>` จริง ซ้อนกันสองชั้นเป็น
 * HTML ที่ไม่ถูกต้อง (React แจ้ง hydration error) เลยวางทับด้วย absolute
 * จากกรอบนอกแทน โดยชดเชยระยะ padding ของการ์ดในสไตล์ `compare`
 *
 * `id` ต้องถูกส่งมาจากหน้าจอที่ใช้ ไม่ใช่ตั้งจากรหัสสินค้าในนี้ — expo-router
 * ยังคาหน้าเดิมไว้ในต้นไม้ตอน push หน้าใหม่ สินค้าชิ้นเดียวกันจึงโผล่พร้อมกัน
 * ได้ทั้งในหน้าแรกและหน้าหมวด ถ้าตั้ง id เองจะกลายเป็น id ซ้ำใน DOM
 */
export function ProductCard({
  item,
  width,
  id,
  compare,
}: {
  item: ProductCardData;
  width: number;
  id?: string;
  /**
   * ปุ่มเทียบ (feature 04) — ส่งมาเฉพาะหน้าที่มีถาดเปรียบเทียบ (หน้าหมวด)
   * หน้าแรกไม่ส่ง เพราะเทียบข้ามหมวดไม่ได้อยู่แล้ว
   */
  compare?: { active: boolean; onToggle: () => void; id: string };
}) {
  const router = useRouter();
  const plan = cheapestPlan(item.plans);
  const off = plan == null ? 0 : discountPercent(plan, item.oneTimePrice);

  const card = (
    <Pressable
      id={id}
      onPress={() => router.push({ pathname: '/product/[id]', params: { id: item.id } })}
      accessibilityRole="button"
      accessibilityLabel={item.name}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <ProductImage images={item.images} categoryIcon={item.categoryIcon} height={120}>
        {off > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>ประหยัด {off}%</Text>
          </View>
        ) : null}
      </ProductImage>

      <Text style={styles.name} numberOfLines={2}>
        {item.name}
      </Text>
      <Text style={styles.shop} numberOfLines={1}>
        {item.shopName}
      </Text>

      {plan == null ? (
        <Pill label="ปิดรับชั่วคราว" tone="cancelled" />
      ) : (
        <>
          <View style={styles.priceLine}>
            <Text style={styles.price}>{baht(plan.pricePerCycle)}</Text>
            <Text style={styles.per}>{cycleShort(plan.cycle)}</Text>
          </View>
          <View style={styles.priceLine}>
            <Text style={styles.was}>{baht(item.oneTimePrice)}</Text>
            <Text style={styles.wasLabel}>ซื้อครั้งเดียว</Text>
          </View>
        </>
      )}

      <View style={styles.meta}>
        {item.rating != null ? (
          <View style={styles.rating}>
            <Ionicons name="star" size={12} color={colors.rating} />
            <Text style={styles.ratingText}>
              {item.rating.toFixed(1)}
              <Text style={styles.metaMuted}> ({item.reviewCount})</Text>
            </Text>
          </View>
        ) : (
          <Text style={styles.metaMuted}>ยังไม่มีรีวิว</Text>
        )}
        {item.activeSubscribers > 0 ? (
          <Text style={styles.metaMuted}>{item.activeSubscribers} คนสมัคร</Text>
        ) : null}
      </View>
    </Pressable>
  );

  return (
    <View style={{ width }}>
      {card}
      {compare != null ? (
        <Pressable
          id={compare.id}
          accessibilityRole="button"
          accessibilityState={{ selected: compare.active }}
          onPress={compare.onToggle}
          style={[styles.compare, compare.active && styles.compareOn]}
        >
          <Text style={[styles.compareText, compare.active && styles.compareTextOn]}>
            {compare.active ? '✓ เทียบอยู่' : '+ เทียบ'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: 6,
  },
  pressed: { borderColor: colors.borderStrong, backgroundColor: colors.surfaceAlt },
  badge: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    // ประหยัดเงินไม่ใช่เรื่องน่าตกใจ — ปล่อยให้แดงแปลว่า "ระวัง" อย่างเดียวทั้งระบบ
    backgroundColor: colors.sale,
    borderRadius: radius.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    zIndex: 1,
  },
  badgeText: { ...type.label, color: colors.onPrimary },
  compare: {
    position: 'absolute',
    // กรอบนอกไม่มี padding แล้ว จึงต้องบวก padding ของการ์ดเองเข้าไป
    top: space.md + space.sm,
    right: space.md + space.sm,
    zIndex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    minHeight: 32,
    justifyContent: 'center',
  },
  compareOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  compareText: { ...type.label, color: colors.textMuted },
  compareTextOn: { color: colors.primaryStrong },
  name: { ...type.bodyStrong, minHeight: 44 },
  shop: { ...type.caption, color: colors.textMuted },
  priceLine: { flexDirection: 'row', alignItems: 'baseline', gap: 4, flexWrap: 'wrap' },
  price: { ...type.price, color: colors.text },
  per: { ...type.caption, color: colors.textMuted },
  was: { ...type.caption, color: colors.textFaint, textDecorationLine: 'line-through' },
  wasLabel: { ...type.caption, color: colors.textFaint },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm, marginTop: 2 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingText: { ...type.caption, color: colors.textMuted },
  metaMuted: { ...type.caption, color: colors.textFaint },
});
