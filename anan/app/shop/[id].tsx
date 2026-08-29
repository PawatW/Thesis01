import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Media';
import { Card, EmptyState, Screen, SectionHeader, Splash } from '@/components/ui';
import { ProductCard } from '@/features/catalog/ProductCard';
import { useProductGrid } from '@/features/catalog/useProductGrid';
import { getShop, type ShopPage } from '@/features/catalog/api';
import { colors, space, type } from '@/lib/theme';

/**
 * หน้าร้านสาธารณะ (feature 10)
 *
 * เข้าจากชื่อร้านบนหน้าสินค้า — ผู้ซื้อที่ชอบของชิ้นหนึ่งมักอยากดูว่าร้านนี้มี
 * อะไรอีก ซึ่งเป็นพฤติกรรมที่ marketplace แบบ subscription ได้ประโยชน์เป็นพิเศษ
 * (สมัครหลายอย่างจากร้านเดียว = รอบส่งใกล้กัน)
 */
export default function ShopScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [shop, setShop] = useState<ShopPage | null>(null);
  const [loading, setLoading] = useState(true);
  const { cardWidth } = useProductGrid();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const data = await getShop(String(id));
      if (!cancelled) {
        setShop(data);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <Splash />;

  if (shop == null) {
    return (
      <Screen>
        <Card>
          <EmptyState
            id="shop-not-found"
            title="ไม่พบร้านนี้"
            body="ร้านอาจปิดชั่วคราวหรือถูกระงับ ลองดูสินค้าจากหน้าแรกแทน"
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card id="shop-page">
        <View style={styles.head}>
          <Avatar url={shop.logoUrl} name={shop.name} size={56} />
          <View style={styles.headText}>
            <SectionHeader title={shop.name} />
            <Text id="shop-product-count" style={styles.muted}>
              มีสินค้าให้สมัคร {shop.products.length} รายการ
            </Text>
          </View>
        </View>
        {shop.description != null ? (
          <Text style={styles.desc}>{shop.description}</Text>
        ) : null}
      </Card>

      {shop.products.length === 0 ? (
        <Card>
          <EmptyState id="shop-empty" title="ร้านนี้ยังไม่มีสินค้าที่เปิดขาย" />
        </Card>
      ) : (
        <View id="shop-grid" style={styles.grid}>
          {shop.products.map((p) => (
            <ProductCard key={p.id} id={`shop-product-${p.id}`} item={p} width={cardWidth} />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  desc: { ...type.body, color: colors.textMuted },
  muted: { ...type.caption, color: colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
});
