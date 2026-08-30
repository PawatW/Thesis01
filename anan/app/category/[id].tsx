import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SearchBar } from '@/components/SearchBar';
import { Card, EmptyState, Screen, SectionHeader, Splash } from '@/components/ui';
import { ProductCard } from '@/features/catalog/ProductCard';
import { useProductGrid } from '@/features/catalog/useProductGrid';
import { cheapestPlan, listProducts, type ProductCardData } from '@/features/catalog/api';
import { CompareTrayBar } from '@/features/compare/CompareTrayBar';
import { MAX_COMPARE, useCompare } from '@/features/compare/CompareProvider';
import { colors, radius, space, statusTones, type } from '@/lib/theme';

type Sort = 'popular' | 'price';

export default function CategoryScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();

  const [items, setItems] = useState<ProductCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('popular');
  const [toast, setToast] = useState<string | null>(null);
  /** ชิ้นที่กดเทียบตอนถาดเป็นของหมวดอื่น — เก็บไว้ให้ปุ่ม "ล้างแล้วเริ่มใหม่" ใช้ */
  const [pending, setPending] = useState<ProductCardData | null>(null);
  const compare = useCompare();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // debounce so typing does not fire a query per keystroke (feature 02)
    const timer = setTimeout(() => {
      void (async () => {
        const rows = await listProducts({ categoryId: Number(id), search });
        if (!cancelled) {
          setItems(rows);
          setLoading(false);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, search]);

  const sorted = useMemo(() => {
    const copy = [...items];
    if (sort === 'price') {
      copy.sort(
        (a, b) =>
          (cheapestPlan(a.plans)?.pricePerCycle ?? Number.MAX_SAFE_INTEGER) -
          (cheapestPlan(b.plans)?.pricePerCycle ?? Number.MAX_SAFE_INTEGER),
      );
    } else {
      copy.sort((a, b) => b.activeSubscribers - a.activeSubscribers);
    }
    return copy;
  }, [items, sort]);

  const { cardWidth } = useProductGrid();

  /**
   * กติกาของถาด (feature 04) — ทุกทางที่กดไม่ได้ต้องบอกเหตุผล ไม่ใช่เงียบ
   */
  function onCompare(item: ProductCardData) {
    const result = compare.toggle(item, Number(id));
    if (result === 'full') {
      setToast(`เทียบได้สูงสุด ${MAX_COMPARE} ชิ้น — เอาชิ้นเดิมออกก่อน`);
      return;
    }
    if (result === 'other-category') {
      setPending(item);
      setToast('เทียบได้เฉพาะสินค้าหมวดเดียวกัน');
      return;
    }
    setToast(null);
    setPending(null);
  }

  // Splash is flex:1 — inside a ScrollView's auto-height content it collapses to
  // zero. Return it before <Screen>, the way every other screen does.
  if (loading && items.length === 0) return <Splash />;

  return (
    <Screen>
      <SectionHeader title={name ?? 'สินค้าในหมวด'} />
      <SearchBar
        id="category-search"
        value={search}
        onChangeText={setSearch}
        placeholder="พิมพ์ชื่อสินค้า"
      />

      <View style={styles.sortRow}>
        <SortChip id="category-sort-popular" label="ยอดนิยม" active={sort === 'popular'} onPress={() => setSort('popular')} />
        <SortChip id="category-sort-price" label="ราคาต่ำ-สูง" active={sort === 'price'} onPress={() => setSort('price')} />
      </View>

      {loading ? (
        <Text style={styles.searching}>กำลังค้นหา…</Text>
      ) : sorted.length === 0 ? (
        <Card>
          <EmptyState
            id="category-empty"
            title={search.length > 0 ? `ไม่พบ "${search}"` : 'ยังไม่มีสินค้าในหมวดนี้'}
            body="ลองค้นด้วยคำอื่น หรือกลับไปเลือกหมวดอื่น"
          />
        </Card>
      ) : (
        <View id="category-grid" style={styles.grid}>
          {sorted.map((p) => (
            <ProductCard
              key={p.id}
              id={`category-product-${p.id}`}
              item={p}
              width={cardWidth}
              compare={{
                active: compare.has(p.id),
                onToggle: () => onCompare(p),
                id: `category-compare-${p.id}`,
              }}
            />
          ))}
        </View>
      )}

      {toast != null ? (
        <View id="category-compare-toast" style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
          {pending != null ? (
            <Pressable
              id="category-compare-restart"
              accessibilityRole="button"
              onPress={() => {
                compare.restartWith(pending, Number(id));
                setPending(null);
                setToast(null);
              }}
            >
              <Text style={styles.toastAction}>ล้างถาดแล้วเริ่มใหม่ด้วยชิ้นนี้</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* ★ เว้นที่ให้แถบลอย ★ ไม่มีอันนี้ แถบเทียบจะทับปุ่มสุดท้ายของหน้า
          (Playwright จับได้ตอน TC-081: กดปุ่ม "ล้างถาดแล้วเริ่มใหม่" ไม่โดน
          เพราะแถบลอยกินคลิกไปหมด) */}
      {compare.items.length > 0 ? <View style={styles.traySpacer} /> : null}

      <CompareTrayBar />
    </Screen>
  );
}

function SortChip({
  label,
  active,
  onPress,
  id,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  id?: string;
}) {
  // chrome lives on the Pressable (a View), not the Text: rounded backgrounds on
  // Text are unreliable across platforms, and this gets a real 44px touch target
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
  sortRow: { flexDirection: 'row', gap: space.sm },
  toast: {
    backgroundColor: statusTones.paused.bg,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  toastText: { ...type.small, color: statusTones.paused.fg },
  toastAction: { ...type.bodyStrong, color: colors.primaryStrong, minHeight: 44, paddingTop: space.sm },
  /** สูงเท่าแถบลอย + ระยะขอบล่าง */
  traySpacer: { height: 96 },
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
