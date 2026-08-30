import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SearchBar } from '@/components/SearchBar';
import { Card, EmptyState, Screen, SectionHeader, Splash } from '@/components/ui';
import { ProductCard } from '@/features/catalog/ProductCard';
import { ShopCard } from '@/features/catalog/ShopCard';
import { useProductGrid } from '@/features/catalog/useProductGrid';
import {
  listProducts,
  listShops,
  type ProductCardData,
  type ProductSort,
  type ShopCardData,
} from '@/features/catalog/api';
import { colors, radius, space, type } from '@/lib/theme';

const SORTS: { key: ProductSort; label: string }[] = [
  { key: 'popular', label: 'ยอดนิยม' },
  { key: 'newest', label: 'ล่าสุด' },
  { key: 'price_asc', label: 'ราคาต่ำ-สูง' },
  { key: 'price_desc', label: 'ราคาสูง-ต่ำ' },
];

/**
 * หน้าค้นหารวม (feature 02) — ช่องเดียวค้นได้ทั้งชื่อร้านและชื่อสินค้า
 *
 * route ระดับบนสุด push ทับแบบเดียวกับ `compare.tsx` เข้าได้จากช่องค้นหาบนหน้าแรก
 * (hero) หรือพิมพ์ตรงในหน้านี้เอง — sort ส่งไป API เสมอ ไม่ sort ในเครื่องแบบหน้าหมวด
 * เพราะ `ProductSort` มีตัวเลือกที่ local sort ทำไม่ได้ (เช่น `newest` ต้องอิงเวลา
 * สร้างที่มีแต่ API เห็น)
 */
export default function SearchScreen() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  const router = useRouter();

  const [search, setSearch] = useState(q ?? '');
  const [sort, setSort] = useState<ProductSort>('popular');
  const [shops, setShops] = useState<ShopCardData[]>([]);
  const [products, setProducts] = useState<ProductCardData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const trimmed = search.trim();
    // ไม่มีคำค้นเลย — ไม่ยิง request ไปขอ "ทุกร้าน/ทุกสินค้า" มาโชว์ แค่ชวนพิมพ์
    if (trimmed.length === 0) {
      setShops([]);
      setProducts([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // debounce 300ms กันยิง query ทุกตัวอักษรที่พิมพ์ (เหมือนหน้าหมวด)
    const timer = setTimeout(() => {
      void (async () => {
        const [shopRows, productRows] = await Promise.all([
          listShops({ search: trimmed, limit: 3 }),
          listProducts({ search: trimmed, sort }),
        ]);
        if (!cancelled) {
          setShops(shopRows);
          setProducts(productRows);
          setLoading(false);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, sort]);

  const { cardWidth } = useProductGrid();

  // Splash is flex:1 — inside a ScrollView's auto-height content it collapses to
  // zero. Return it before <Screen>, the way category/[id].tsx does.
  if (loading && shops.length === 0 && products.length === 0) return <Splash />;

  const trimmed = search.trim();
  const nothingFound = shops.length === 0 && products.length === 0;

  return (
    <Screen>
      <SectionHeader title="ค้นหา" />
      <SearchBar
        id="search-input"
        submitId="search-submit"
        value={search}
        onChangeText={setSearch}
        placeholder="ค้นหาสินค้าหรือร้านค้า"
      />

      {shops.length > 0 ? (
        <View id="search-shops" style={styles.shopsSection}>
          <SectionHeader title={`ร้านค้าที่เกี่ยวข้องกับ "${trimmed}"`} />
          <View style={styles.shopsList}>
            {shops.map((shop) => (
              <ShopCard
                key={shop.id}
                id={`search-shop-${shop.id}`}
                item={shop}
                onPress={() => router.push({ pathname: '/shop/[id]', params: { id: shop.id } })}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.sortRow}>
        {SORTS.map((s) => (
          <SortChip
            key={s.key}
            id={`search-sort-${s.key.replace('_', '-')}`}
            label={s.label}
            active={sort === s.key}
            onPress={() => setSort(s.key)}
          />
        ))}
      </View>

      {loading ? (
        <Text style={styles.searching}>กำลังค้นหา…</Text>
      ) : nothingFound ? (
        <Card>
          <EmptyState
            id="search-empty"
            title={trimmed.length > 0 ? `ไม่พบ "${trimmed}"` : 'ค้นหาสินค้าหรือร้านค้าที่ชอบ'}
            body={
              trimmed.length > 0
                ? 'ลองค้นด้วยคำอื่น หรือตรวจตัวสะกดอีกครั้ง'
                : 'พิมพ์ชื่อสินค้าหรือชื่อร้านในช่องด้านบนเพื่อเริ่มค้นหา'
            }
          />
        </Card>
      ) : (
        <View id="search-grid" style={styles.grid}>
          {products.map((p) => (
            <ProductCard key={p.id} id={`search-product-${p.id}`} item={p} width={cardWidth} />
          ))}
        </View>
      )}
    </Screen>
  );
}

function SortChip({
  id,
  label,
  active,
  onPress,
}: {
  id: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      id={id}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[type.caption, { color: active ? colors.primaryStrong : colors.textMuted }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shopsSection: { gap: space.md },
  shopsList: { gap: space.md },
  sortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.primarySoft },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  searching: { ...type.caption, color: colors.textMuted },
});
