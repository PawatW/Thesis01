import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Media';
import type { ShopCardData } from '@/features/catalog/api';
import { formatThaiMonthYear } from '@/lib/date';
import { colors, radius, shadow, space, type } from '@/lib/theme';


/**
 * การ์ดร้านตามรูป Shopee — โลโก้ซ้าย / ชื่อ+คำอธิบาย / แถบสถิติ 4 ช่องด้านล่าง
 *
 * ตัว component ไม่รู้จัก router — รับ `onPress` มาจากข้างนอกเสมอ เพื่อให้ใช้ซ้ำได้
 * ทั้งหน้าแรก (hero) และหน้า `/search` โดยไม่ผูกกับ path ใดที่ตายตัว
 */
export function ShopCard({
  id,
  item,
  onPress,
}: {
  id: string;
  item: ShopCardData;
  onPress?: () => void;
}) {
  return (
    <Pressable
      id={id}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.name}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.header}>
        <Avatar url={item.logoUrl} name={item.name} size={48} />
        <View style={styles.headerText}>
          <Text style={type.bodyStrong} numberOfLines={1}>
            {item.name}
          </Text>
          {item.description != null ? (
            <Text style={styles.description} numberOfLines={1}>
              {item.description}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.stats}>
        <Text style={styles.stat}>
          <Text style={styles.statStrong}>{item.productCount}</Text> สินค้า
        </Text>
        <Text style={styles.stat}>
          <Text style={styles.statStrong}>{item.activeSubscribers}</Text> สมาชิก
        </Text>
        {item.rating != null ? (
          <View style={styles.ratingStat}>
            <Ionicons name="star" size={12} color={colors.rating} />
            <Text style={styles.stat}>
              <Text style={styles.statStrong}>{item.rating.toFixed(1)}</Text> ({item.reviewCount})
            </Text>
          </View>
        ) : (
          <Text style={styles.statMuted}>ยังไม่มีรีวิว</Text>
        )}
        <Text style={styles.statMuted}>{`เข้าร่วมเมื่อ ${formatThaiMonthYear(item.createdAt)}`}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: space.md,
    ...shadow('card'),
  },
  pressed: { borderColor: colors.borderStrong, backgroundColor: colors.surfaceAlt },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // minWidth: 0 กันข้อความยาวดันความกว้างของแถวเกิน แล้ว numberOfLines ไม่ตัดจริง
  headerText: { flex: 1, minWidth: 0, gap: 2 },
  description: { ...type.caption, color: colors.textMuted },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: space.xs,
    columnGap: space.md,
  },
  stat: { ...type.caption, color: colors.textMuted },
  statStrong: { ...type.caption, fontFamily: type.bodyStrong.fontFamily, color: colors.text },
  statMuted: { ...type.caption, color: colors.textFaint },
  ratingStat: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
