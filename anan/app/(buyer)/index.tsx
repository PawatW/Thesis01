import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SearchBar } from '@/components/SearchBar';
import { EmptyState, Screen } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  CategoryStrip,
  HomeHero,
  HomeSectionHead,
  PromoTiles,
  SeeAll,
  TrustBar,
} from '@/features/catalog/HomeSections';
import { ProductCard } from '@/features/catalog/ProductCard';
import { useProductGrid } from '@/features/catalog/useProductGrid';
import {
  bestDiscountPlan,
  discountPercent,
  listCategories,
  listProducts,
  type Category,
  type ProductCardData,
} from '@/features/catalog/api';
import { UpcomingPanel } from '@/features/subscriptions/UpcomingPanel';
import { listMySubscriptions, monthCharges, type SubscriptionCard } from '@/features/subscriptions/api';
import { breakpoints, colors, layout, space, type } from '@/lib/theme';
import { useWindowWidth } from '@/lib/useWindowWidth';

/**
 * หน้าแรกผู้ซื้อ (feature 02) — layout ตาม mockup 2026-11 (docs/mockups/home-redesign.html)
 *
 *   ≥1200px : sidebar (ConsoleShell) | เนื้อหา | แผง "รอบส่งถัดไป" ขวามือ
 *   <1200px : เนื้อหาคอลัมน์เดียว แล้วแผงรอบส่งต่อท้าย + bottom tabs
 *
 * ลำดับบนจอ: ค้นหา → hero + รอบถัดไป → หมวด → 3 ช่องทางลัด → ดีลคุ้ม → คนสมัครเยอะ → แถบความเชื่อมั่น
 */
export default function BuyerHome() {
  const { profile } = useAuth();
  const router = useRouter();
  const width = useWindowWidth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [subs, setSubs] = useState<SubscriptionCard[]>([]);
  const [products, setProducts] = useState<ProductCardData[]>([]);
  const [subsError, setSubsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [homeSearch, setHomeSearch] = useState('');
  /** หมวดที่ติ๊กไว้ — ว่าง = ไม่กรอง (โชว์ "ดีลคุ้ม" + "คนสมัครเยอะที่สุด" ตามเดิม) */
  const [picked, setPicked] = useState<number[]>([]);
  /** ผลกรองพร้อมชุดหมวดที่ขอไป — เก็บคู่กันเพื่อทิ้งผลของชุดเก่าที่มาช้าได้ */
  const [result, setResult] = useState<{ key: string; rows: ProductCardData[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [cats, mine, rows] = await Promise.all([
        listCategories(),
        listMySubscriptions(),
        listProducts({ limit: 16 }),
      ]);
      if (cancelled) return;
      setCategories(cats);
      setSubs(mine.data);
      // never let a failed query read as "you have nothing subscribed" — in a
      // subscription app that is the most misleading thing the screen can say
      setSubsError(mine.error);
      setProducts(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * กรองในหน้านี้เลย ไม่เด้งไปหน้าหมวด — ผู้ซื้อของใช้ประจำมักคิดเป็นชุด
   * ("ยาสีฟัน + แชมพู") การบังคับให้เข้าทีละหมวดทำให้เทียบข้ามหมวดไม่ได้
   *
   * ยิง API ใหม่ทุกครั้งแทนที่จะกรองในเครื่อง เพราะที่โหลดไว้มีแค่ชุดแรก —
   * กรองในเครื่องจะได้ผลลัพธ์ที่ "หายไป" โดยไม่มีใครรู้
   */
  const pickedKey = picked.join(',');

  useEffect(() => {
    if (pickedKey === '') return;
    let cancelled = false;
    void (async () => {
      const rows = await listProducts({
        categoryIds: pickedKey.split(',').map(Number),
        limit: 60,
        sort: 'popular',
      });
      if (!cancelled) setResult({ key: pickedKey, rows });
    })();
    return () => {
      cancelled = true;
    };
  }, [pickedKey]);

  /**
   * ผลของชุดหมวดอื่นถือว่ายังไม่มีผล — ติ๊กหมวดที่สามระหว่างที่คำขอเก่ายังไม่กลับ
   * ต้องเห็น "กำลังโหลด…" ไม่ใช่ผลของสองหมวดแรกที่ตอนนี้ผิดไปแล้ว
   */
  const filtered = pickedKey !== '' && result?.key === pickedKey ? result.rows : null;
  const filtering = pickedKey !== '' && filtered === null;

  // กริดไม่ได้อยู่ใน <Card> แล้ว (section ลอยบนพื้นกระดาษตาม mockup)
  const { cardWidth, columns } = useProductGrid({ rail: true });
  const hasRail = width >= breakpoints.desktop;
  /** ความกว้างของคอลัมน์เนื้อหาโดยประมาณ — ใช้ตัดสินว่า hero วางสองฝั่งได้ไหม */
  const mainWidth = hasRail ? width - layout.sidebarWidth - layout.railWidth - 96 : width - 48;

  /** แถวเต็มพอดีจำนวนคอลัมน์ — ไม่เหลือช่องว่างท้ายแถว */
  const rowOf = (n: number) => Math.max(1, Math.floor(n / columns)) * columns;

  // "ดีลคุ้ม" = ส่วนลดเทียบซื้อครั้งเดียวสูงสุด · "คนสมัครเยอะ" = activeSubscribers (feature 02)
  const bestOff = (p: ProductCardData) => {
    const plan = bestDiscountPlan(p.plans, p.oneTimePrice);
    return plan == null ? 0 : discountPercent(plan, p.oneTimePrice);
  };
  const deals = [...products]
    .filter((p) => bestOff(p) > 0)
    .sort((a, b) => bestOff(b) - bestOff(a))
    .slice(0, columns);
  const popular = [...products]
    .sort((a, b) => b.activeSubscribers - a.activeSubscribers)
    .slice(0, rowOf(Math.max(6, columns * 2)));

  const charges = monthCharges(subs);
  const active = subs.filter((s) => s.status === 'active');
  const spend = charges.reduce((sum, c) => sum + c.amount, 0);

  /** รายการที่ใกล้ถึงรอบที่สุด — พระเอกของ hero */
  const upNext = [...active]
    .filter((s) => s.nextOrderDate != null)
    .sort((a, b) => (a.nextOrderDate ?? '').localeCompare(b.nextOrderDate ?? ''))[0];

  const spendLine =
    active.length === 0
      ? null
      : charges.length > 0
        ? `เดือนนี้จ่ายรวม ฿${spend.toLocaleString('th-TH')} จาก ${charges.length} รอบ`
        : 'เดือนนี้ไม่มีรอบที่ต้องจ่าย';

  const panel = (
    <UpcomingPanel subs={subs} loading={loading} error={subsError} charges={charges} />
  );

  return (
    <Screen wide={hasRail}>
      <View style={[styles.shell, hasRail && styles.shellWide]}>
        <View style={styles.main}>
          <SearchBar
            id="home-search"
            submitId="home-search-submit"
            value={homeSearch}
            onChangeText={setHomeSearch}
            onSubmit={() => {
              const q = homeSearch.trim();
              router.push(q.length > 0 ? { pathname: '/search', params: { q } } : { pathname: '/search' });
            }}
          />

          <HomeHero
            displayName={profile?.displayName ?? ''}
            upNext={upNext}
            spendLine={spendLine}
            wide={mainWidth >= 720}
          />

          <CategoryStrip
            categories={categories}
            picked={picked}
            onToggle={(id) =>
              setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
            }
            onClear={() => setPicked([])}
            width={mainWidth}
          />

          {picked.length === 0 ? (
            <>
              <PromoTiles columns={mainWidth >= 720 ? 3 : mainWidth >= 480 ? 2 : 1} />

              {deals.length > 0 ? (
                <View style={styles.section}>
                  <HomeSectionHead
                    title="ดีลคุ้มเมื่อสมัครรับ"
                    sub="เทียบกับราคาซื้อครั้งเดียว"
                    action={<SeeAll id="home-deals-all" href="/search" />}
                  />
                  <View id="home-deals" style={styles.grid}>
                    {deals.map((p) => (
                      <ProductCard key={p.id} id={`home-deal-${p.id}`} item={p} width={cardWidth} />
                    ))}
                  </View>
                </View>
              ) : null}
            </>
          ) : null}

          <View style={styles.section}>
            <HomeSectionHead
              title={picked.length > 0 ? 'สินค้าในหมวดที่เลือก' : 'คนสมัครเยอะที่สุด'}
              sub={picked.length > 0 ? undefined : 'แนะนำสำหรับคุณ'}
              action={
                filtered != null ? (
                  <Text id="home-featured-count" style={styles.muted}>
                    {filtered.length} รายการ
                  </Text>
                ) : picked.length === 0 ? (
                  <SeeAll id="home-popular-all" href="/search" />
                ) : undefined
              }
            />
            {filtering || (loading && picked.length === 0) ? (
              <Text style={styles.muted}>กำลังโหลด…</Text>
            ) : filtered != null && filtered.length === 0 ? (
              <EmptyState
                id="home-featured-empty"
                title="ยังไม่มีสินค้าในหมวดที่เลือก"
                body="ลองเลือกหมวดอื่นเพิ่ม หรือล้างตัวกรองเพื่อดูสินค้าทั้งหมด"
              />
            ) : (
              <View id="home-featured" style={styles.grid}>
                {(filtered ?? popular).map((p) => (
                  <ProductCard key={p.id} id={`home-product-${p.id}`} item={p} width={cardWidth} />
                ))}
              </View>
            )}
          </View>

          <TrustBar columns={mainWidth >= 720 ? 4 : mainWidth >= 480 ? 2 : 1} />

          {!hasRail ? panel : null}
        </View>

        {hasRail ? <View style={styles.rail}>{panel}</View> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  shell: { gap: space.lg },
  shellWide: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xxl },
  main: { flex: 1, gap: space.xl, minWidth: 0 },
  rail: { width: layout.railWidth, gap: space.lg },
  section: { gap: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  muted: { ...type.caption, color: colors.textMuted },
});
