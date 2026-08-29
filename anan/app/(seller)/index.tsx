import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  Card,
  DemoBadge,
  EmptyState,
  ErrorNote,
  Pill,
  Screen,
  SectionHeader,
  Splash,
} from '@/components/ui';
import { eventLabel, getDashboard, type Dashboard } from '@/features/seller/api';
import { formatThaiDate } from '@/lib/date';
import { colors, radius, space, type } from '@/lib/theme';

/**
 * Dashboard ของร้าน (feature 10) — จุดขายฝั่งร้าน: รายได้คาดการณ์ได้
 *
 * ทุกตัวเลขมาจาก `GET /seller/dashboard` ซึ่งเป็น aggregate ที่คำนวณฝั่ง API
 * หน้าจอนี้จึงไม่มีทางเห็นว่าใครเป็นคนสมัครหรือยกเลิก แม้จะเปิด devtools ดู response
 */
export default function SellerDashboardScreen() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data: next, error: err } = await getDashboard();
    setData(next);
    setError(err);
    setLoading(false);
  }, []);

  /**
   * โหลดใหม่ทุกครั้งที่กลับมาที่แท็บนี้ — ไม่ใช่แค่ตอน mount
   *
   * expo-router ไม่ unmount แท็บที่ถูกสลับออก ถ้าใช้ `useEffect` เปล่า ๆ ตัวเลข
   * จะค้างค่าที่โหลดครั้งแรก ทั้งที่อีก 3 แท็บของร้านแก้ข้อมูลชุดเดียวกันอยู่
   */
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (loading) return <Splash />;

  return (
    <Screen>
      <Card>
        <SectionHeader
          title={data?.shop.name ?? 'ร้านของฉัน'}
          action={
            data?.shop.isSuspended === true ? (
              <Pill id="seller-suspended-pill" label="ถูกระงับ" tone="frozen" />
            ) : data?.shop.isActive === false ? (
              <Pill id="seller-closed-pill" label="ปิดร้านชั่วคราว" tone="paused" />
            ) : (
              <Pill label="เปิดอยู่" tone="active" />
            )
          }
        />
        <Text style={styles.muted}>ภาพรวมของร้านวันนี้</Text>
      </Card>

      {error != null ? <ErrorNote id="seller-dashboard-error" message={error} /> : null}

      {data != null ? (
        <>
          <View style={styles.stats}>
            <Stat
              id="seller-stat-subscribers"
              label="สมาชิกที่ใช้งานอยู่"
              value={data.activeSubscribers.toLocaleString('th-TH')}
              hint="นับจาก subscription ที่ยัง active"
            />
            <Stat
              id="seller-stat-mrr"
              label="รายได้ต่อเดือน (ประมาณ)"
              value={`฿${data.monthlyRevenue.toLocaleString('th-TH')}`}
              hint="2 สัปดาห์ ×2 · เดือน ×1 · 2 เดือน ×0.5"
              demo
            />
            <Stat
              id="seller-stat-churn"
              label="ยกเลิกเดือนนี้"
              value={data.cancelledThisMonth.toLocaleString('th-TH')}
              hint="ตัวตั้งของอัตรา churn"
            />
          </View>

          <Card>
            <SectionHeader title="งานที่ต้องทำ" />
            <Text id="seller-pending-orders" style={type.body}>
              ออเดอร์ค้างส่ง {data.pendingOrders.toLocaleString('th-TH')} รายการ
            </Text>
            <Text id="seller-active-products" style={styles.muted}>
              สินค้าที่เปิดขาย {data.activeProducts.toLocaleString('th-TH')} ชิ้น
            </Text>
          </Card>

          <Card id="seller-recent-events">
            <SectionHeader title="เหตุการณ์ล่าสุด" />
            {data.recentEvents.length === 0 ? (
              <EmptyState
                id="seller-events-empty"
                title="ยังไม่มีความเคลื่อนไหว"
                body="พอมีคนสมัครรับสินค้าของร้าน เหตุการณ์จะขึ้นที่นี่"
              />
            ) : (
              data.recentEvents.map((e, i) => (
                <View key={`${e.at}-${i}`} style={styles.eventRow}>
                  <Text style={type.body}>{eventLabel(e.event)}</Text>
                  <Text style={styles.muted}>
                    {e.productName} · {formatThaiDate(e.at.slice(0, 10))}
                  </Text>
                </View>
              ))
            )}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function Stat({
  label,
  value,
  hint,
  demo,
  id,
}: {
  label: string;
  value: string;
  hint: string;
  demo?: boolean;
  id: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text id={id} style={styles.statValue}>
        {value}
      </Text>
      <Text style={styles.statHint}>{hint}</Text>
      {demo === true ? <DemoBadge compact /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { ...type.caption, color: colors.textMuted },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  stat: {
    flexGrow: 1,
    flexBasis: 160,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.lg,
    gap: 4,
  },
  statLabel: { ...type.label, color: colors.textMuted },
  statValue: { ...type.h2, color: colors.text },
  statHint: { ...type.caption, color: colors.textFaint },
  eventRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.sm,
    gap: 2,
  },
});
