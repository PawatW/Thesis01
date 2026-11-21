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
      <ProductImage
        images={item.images}
        categoryIcon={item.categoryIcon}
        // รูปสูงตามความกว้างการ์ด (ราว 4:3) แทนความสูงตายตัว — การ์ดกว้างบนเว็บ
        // จะไม่ได้รูปแบนยาว · หนีบไว้ไม่ให้สูงเกินจอมือถือ
        height={Math.min(180, Math.max(110, Math.round(width * 0.72)))}
        iconSize={48}
        style={styles.image}
      >
        {off > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>ประหยัด {off}%</Text>
          </View>
        ) : null}
      </ProductImage>

      <View style={styles.shopRow}>
        <Ionicons name="storefront-outline" size={12} color={colors.textFaint} />
        <Text style={styles.shop} numberOfLines={1}>
          {item.shopName}
        </Text>
      </View>
      <Text style={styles.name} numberOfLines={2}>
        {item.name}
      </Text>

      {plan == null ? (
        <View style={styles.closed}>
          <Pill label="ปิดรับชั่วคราว" tone="cancelled" />
        </View>
      ) : (
        <View style={styles.priceRow}>
          <View style={styles.priceCol}>
            <View style={styles.priceLine}>
              <Text style={styles.price}>{baht(plan.pricePerCycle)}</Text>
              <Text style={styles.per}>{cycleShort(plan.cycle)}</Text>
            </View>
            <View style={styles.priceLine}>
              <Text style={styles.was}>{baht(item.oneTimePrice)}</Text>
              <Text style={styles.wasLabel}>ซื้อครั้งเดียว</Text>
            </View>
          </View>
          {/* ตัวบอกว่า "กดเพื่อสมัคร" เป็นแค่ภาพ — ทั้งการ์ดคือปุ่มอยู่แล้ว
              ถ้าเป็น Pressable ซ้อนจะกลายเป็น <button> ใน<button> บนเว็บ */}
          {/* การ์ดแคบบนมือถือ (2 คอลัมน์) ไม่มีที่ให้ปุ่ม — ราคาสำคัญกว่า */}
          {width >= 180 ? (
            <View style={styles.go} importantForAccessibility="no" accessibilityElementsHidden>
              <Ionicons name="add" size={20} color={colors.onPrimary} />
            </View>
          ) : null}
        </View>
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
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.sm + 2,
    gap: 6,
  },
  image: { borderRadius: radius.md, marginBottom: 4 },
  closed: { alignSelf: 'flex-start' },
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
    top: space.sm + 2 + space.sm,
    right: space.sm + 2 + space.sm,
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
  name: { ...type.bodyStrong, minHeight: 52 },
  shopRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  shop: { ...type.caption, color: colors.textFaint, flexShrink: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.sm },
  priceCol: { flexShrink: 1, minWidth: 0 },
  go: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
