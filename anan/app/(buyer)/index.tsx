import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SearchBar } from '@/components/SearchBar';
import { Card, DemoBadge, EmptyState, ErrorNote, Pill, Screen, SectionHeader } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { ProductCard } from '@/features/catalog/ProductCard';
import { iconName } from '@/features/catalog/categoryIcon';
import { useProductGrid } from '@/features/catalog/useProductGrid';
import {
  listCategories,
  listProducts,
  type Category,
  type ProductCardData,
} from '@/features/catalog/api';
import { CycleRail } from '@/features/subscriptions/CycleRail';
import {
  cycleLabel,
  daysUntil,
  listMySubscriptions,
  monthCharges,
  type SubscriptionCard,
} from '@/features/subscriptions/api';
import { breakpoints, categoryTone, colors, layout, radius, space, type } from '@/lib/theme';
import { useWindowWidth } from '@/lib/useWindowWidth';

export default function BuyerHome() {
  const { profile } = useAuth();
  const router = useRouter();
  const width = useWindowWidth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [subs, setSubs] = useState<SubscriptionCard[]>([]);
  const [featured, setFeatured] = useState<ProductCardData[]>([]);
  const [subsError, setSubsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [homeSearch, setHomeSearch] = useState('');
  /** หมวดที่ติ๊กไว้ — ว่าง = ไม่กรอง (โชว์ "คนสมัครเยอะที่สุด" ตามเดิม) */
  const [picked, setPicked] = useState<number[]>([]);
  /** ผลกรองพร้อมชุดหมวดที่ขอไป — เก็บคู่กันเพื่อทิ้งผลของชุดเก่าที่มาช้าได้ */
  const [result, setResult] = useState<{ key: string; rows: ProductCardData[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [cats, mine, products] = await Promise.all([
        listCategories(),
        listMySubscriptions(),
        listProducts({ limit: 8 }),
      ]);
      if (cancelled) return;
      setCategories(cats);
      setSubs(mine.data);
      // never let a failed query read as "you have nothing subscribed" — in a
      // subscription app that is the most misleading thing the screen can say
      setSubsError(mine.error);
      // "แนะนำ" = most subscribers, per feature 02
      // เก็บไว้ทั้ง 8 ชิ้น แล้วค่อยตัดตามจำนวนคอลัมน์ตอน render ให้แถวเต็มพอดี
      setFeatured([...products].sort((a, b) => b.activeSubscribers - a.activeSubscribers));
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
   * ยิง API ใหม่ทุกครั้งแทนที่จะกรอง `featured` ในเครื่อง เพราะ `featured`
   * มีแค่ 8 ชิ้นแรก — กรองในเครื่องจะได้ผลลัพธ์ที่ "หายไป" โดยไม่มีใครรู้
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

  const { cardWidth, columns } = useProductGrid({ rail: true, inCard: true });
  const hasRail = width >= breakpoints.desktop;

  /**
   * แถวสุดท้ายต้องเต็ม — 6 ชิ้นตายตัวบนกริด 4 คอลัมน์เหลือช่องว่าง 2 ช่อง
   * จำนวนที่น้อยที่สุดที่ ≥ 6 และหารด้วยจำนวนคอลัมน์ลงตัว: 2 คอล.→6 · 3→6 · 4→8
   */
  const shown = featured.slice(0, Math.ceil(6 / columns) * columns);

  /** ตอนกรองอยู่ให้เห็นทุกชิ้นที่ตรง ไม่ตัดให้แถวสวย — คนกำลังหาของอยู่ */
  const gridItems = filtered ?? shown;

  const active = subs.filter((s) => s.status === 'active');
  const charges = monthCharges(subs);
  const spend = charges.reduce((sum, c) => sum + c.amount, 0);

  /** รายการที่ใกล้ถึงรอบที่สุด — พระเอกของหน้านี้ */
  const upNext = [...active]
    .filter((s) => s.nextOrderDate != null)
    .sort((a, b) => (a.nextOrderDate ?? '').localeCompare(b.nextOrderDate ?? ''))[0];

  const nextPanel = (
    <Card id="home-next-panel">
      <SectionHeader title="รอบถัดไปของฉัน" />
      {loading ? (
        <Text style={styles.muted}>กำลังโหลด…</Text>
      ) : subsError != null ? (
        <ErrorNote id="home-subs-error" message={subsError} />
      ) : subs.length === 0 ? (
        <EmptyState
          id="home-subs-empty"
          title="ยังไม่มีรายการที่สมัครไว้"
          body="เมื่อสมัครรับสินค้าแล้ว รอบส่งถัดไปจะแสดงที่นี่ พร้อมปุ่มข้ามรอบและหยุดชั่วคราว"
        />
      ) : (
        subs.map((s) => <SubscriptionRow key={s.id} item={s} />)
      )}
    </Card>
  );

  return (
    <Screen wide={hasRail}>
      <View style={[styles.shell, hasRail && styles.shellWide]}>
        <View style={styles.main}>
          {/*
            เดิมเป็นแถบ gradient ม่วง→ชมพูเต็มความกว้าง ซึ่งกินจอแรกทั้งหมดโดยไม่
            สื่อกลไกของสินค้าเลย · ตอนนี้จอแรกตอบคำถามเดียวที่ผู้ใช้เปิดแอปมาถาม:
            "อะไรจะมาถึงเมื่อไหร่"
          */}
          <View id="home-hero" style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={styles.heroIntro}>
                <Text id="home-greeting" style={styles.greeting}>
                  สวัสดี {profile?.displayName ?? ''}
                </Text>
                <Text style={styles.heroTitle}>ของใช้ประจำ ให้มาเองตามรอบ</Text>
              </View>
              <DemoBadge />
            </View>

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

            {upNext != null ? <UpNext item={upNext} /> : null}

            {active.length > 0 ? (
              <Text style={styles.heroSpend}>
                {charges.length > 0
                  ? `เดือนนี้จ่ายรวม ฿${spend.toLocaleString('th-TH')} จาก ${charges.length} รอบ`
                  : 'เดือนนี้ไม่มีรอบที่ต้องจ่าย'}
              </Text>
            ) : null}
          </View>

          <Card>
            <SectionHeader
              title="หมวดสินค้า"
              action={
                picked.length > 0 ? (
                  <Pressable
                    id="home-category-clear"
                    accessibilityRole="button"
                    onPress={() => setPicked([])}
                    style={styles.clear}
                  >
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                    <Text style={styles.clearText}>ล้างตัวกรอง ({picked.length})</Text>
                  </Pressable>
                ) : undefined
              }
            />
            <View style={styles.chips}>
              {categories.map((c) => {
                const tone = categoryTone(c.icon);
                const on = picked.includes(c.id);
                return (
                  <Pressable
                    key={c.id}
                    id={`home-category-${c.id}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={c.name}
                    onPress={() =>
                      setPicked((prev) =>
                        prev.includes(c.id) ? prev.filter((id) => id !== c.id) : [...prev, c.id],
                      )
                    }
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        backgroundColor: tone.tint,
                        // ติ๊กแล้วต้องอ่านออกโดยไม่พึ่งสีอย่างเดียว — มีทั้งกรอบเข้ม
                        // และกล่องเช็คนำหน้า (ผู้ใช้ตาบอดสีเห็นเครื่องหมายถูก)
                        borderColor: on || pressed ? tone.solid : 'transparent',
                        borderWidth: on ? 2 : 1,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.box,
                        { borderColor: tone.solid },
                        on && { backgroundColor: tone.solid },
                      ]}
                    >
                      {on ? <Ionicons name="checkmark" size={12} color={colors.surface} /> : null}
                    </View>
                    <Ionicons name={iconName(c.icon)} size={16} color={tone.solid} />
                    <Text style={[styles.chipText, { color: tone.solid }]}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>

          <Card>
            <SectionHeader
              title={picked.length > 0 ? 'สินค้าในหมวดที่เลือก' : 'คนสมัครเยอะที่สุด'}
              action={
                filtered != null ? (
                  <Text id="home-featured-count" style={styles.muted}>
                    {filtered.length} รายการ
                  </Text>
                ) : undefined
              }
            />
            {filtering ? (
              <Text style={styles.muted}>กำลังโหลด…</Text>
            ) : filtered != null && filtered.length === 0 ? (
              <EmptyState
                id="home-featured-empty"
                title="ยังไม่มีสินค้าในหมวดที่เลือก"
                body="ลองเลือกหมวดอื่นเพิ่ม หรือล้างตัวกรองเพื่อดูสินค้าทั้งหมด"
              />
            ) : (
              <View id="home-featured" style={styles.grid}>
                {gridItems.map((p) => (
                  <ProductCard key={p.id} id={`home-product-${p.id}`} item={p} width={cardWidth} />
                ))}
              </View>
            )}
          </Card>

          {!hasRail ? nextPanel : null}
        </View>

        {hasRail ? <View style={styles.rail}>{nextPanel}</View> : null}
      </View>
    </Screen>
  );
}

/**
 * การ์ด "ถัดไป" — ตัวเลขที่ใหญ่ที่สุดในแอปคือจำนวนวันที่เหลือ
 *
 * ANAN ขายเวลา ไม่ใช่ราคา · ของเดิมแสดง "อีก N วัน" เป็น caption 12px สีเทาที่
 * มุมขวาล่างของแถว ซึ่งกลับหัวกับคุณค่าของโปรเจกต์
 */
function UpNext({ item }: { item: SubscriptionCard }) {
  const days = daysUntil(item.nextOrderDate);
  if (days == null) return null;

  const toneColor =
    days <= 3 ? colors.timeUrgent : days <= 7 ? colors.timeSoon : colors.timeCalm;

  return (
    <View id="home-upnext" style={styles.upNext}>
      <View style={styles.upNextCount}>
        <Text style={[styles.upNextNumber, { color: toneColor }]}>
          {days <= 0 ? 'วันนี้' : days}
        </Text>
        {days > 0 ? <Text style={styles.upNextUnit}>วัน</Text> : null}
      </View>
      <View style={styles.upNextBody}>
        <Text style={styles.upNextName} numberOfLines={1}>
          {item.productName}
        </Text>
        <Text style={styles.upNextMeta} numberOfLines={1}>
          {item.shopName} · {cycleLabel(item.cycle)} · ฿
          {(item.pricePerCycle * item.quantity).toLocaleString('th-TH')}/รอบ
        </Text>
      </View>
    </View>
  );
}

function SubscriptionRow({ item }: { item: SubscriptionCard }) {
  const days = daysUntil(item.nextOrderDate);
  const frozen = item.pausedReason === 'shop_suspended';

  const statusPill =
    item.status === 'active' ? (
      <Pill label="กำลังใช้งาน" tone="active" dot />
    ) : item.status === 'paused' ? (
      <Pill label={frozen ? 'ร้านถูกระงับ' : 'หยุดชั่วคราว'} tone={frozen ? 'frozen' : 'paused'} dot />
    ) : (
      <Pill label="ยกเลิกแล้ว" tone="cancelled" dot />
    );

  return (
    <View id={`home-sub-${item.id}`} style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.productName}
        </Text>
        {statusPill}
      </View>
      <Text style={styles.rowMeta}>
        {item.shopName} · {cycleLabel(item.cycle)}
        {item.quantity > 1 ? ` · ${item.quantity} ชิ้น/รอบ` : ''}
      </Text>
      <View style={styles.rowFoot}>
        <Text style={styles.price}>
          ฿{(item.pricePerCycle * item.quantity).toLocaleString('th-TH')}
          <Text style={styles.per}> / รอบ</Text>
        </Text>
        {/* วันที่อยู่บน CycleRail ข้างล่างแล้ว ตรงนี้เหลือแค่ความเร่งด่วน */}
        {item.status === 'active' && days != null ? (
          <Text
            style={[
              styles.next,
              days <= 3 && { color: colors.timeUrgent },
              days > 3 && days <= 7 && { color: colors.timeSoon },
            ]}
          >
            {days <= 0 ? 'ส่งรอบนี้วันนี้' : `อีก ${days} วัน`}
          </Text>
        ) : item.status === 'paused' ? (
          <Text style={styles.next}>{frozen ? 'ไม่มีการตัดเงิน' : 'หยุดไว้ชั่วคราว'}</Text>
        ) : null}
      </View>
      <CycleRail
        cycle={item.cycle}
        nextOrderDate={item.nextOrderDate}
        status={item.status}
        categoryIcon={null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { gap: space.lg },
  shellWide: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xxl },
  main: { flex: 1, gap: space.lg, minWidth: 0 },
  rail: { width: layout.railWidth, gap: space.lg },

  hero: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xl,
    gap: space.lg,
  },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.md },
  heroIntro: { flexShrink: 1, gap: 2 },
  greeting: { ...type.small, color: colors.textMuted },
  heroTitle: { ...type.h2, color: colors.text },
  heroSpend: { ...type.small, color: colors.textMuted },

  upNext: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  upNextCount: { flexDirection: 'row', alignItems: 'baseline', gap: 4, minWidth: 92 },
  upNextNumber: { ...type.display },
  upNextUnit: { ...type.small, color: colors.textMuted },
  upNextBody: { flex: 1, minWidth: 0, gap: 2 },
  upNextName: { ...type.h4, color: colors.text },
  upNextMeta: { ...type.caption, color: colors.textMuted },

  muted: { ...type.caption, color: colors.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    minHeight: 44,
  },
  chipText: { ...type.caption },
  box: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clear: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clearText: { ...type.caption, color: colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  row: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: space.md,
    gap: 6,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  rowTitle: { ...type.bodyStrong, flexShrink: 1 },
  rowMeta: { ...type.caption, color: colors.textMuted },
  rowFoot: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  price: { ...type.price, color: colors.text },
  per: { ...type.caption, color: colors.textMuted },
  next: { ...type.caption, color: colors.textMuted },
});
