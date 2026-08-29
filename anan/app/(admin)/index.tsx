import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Card, DemoBadge, ErrorNote, SectionHeader, Splash } from '@/components/ui';
import {
  getStats,
  listEngineRuns,
  type AdminStats,
  type EngineRun,
} from '@/features/admin/api';
import { formatThaiDate } from '@/lib/date';
import { colors, space, type } from '@/lib/theme';

/**
 * ภาพรวมแพลตฟอร์ม (feature 14 · W10 Flow A)
 *
 * ทุกตัวเลขเป็น aggregate ที่ API รวมมาให้ — หน้าจอไม่เคยดึงแถวของผู้ใช้คนไหน
 * มานับเอง (ถ้าทำแบบนั้น หน้า admin จะกลายเป็นช่องทางดูดข้อมูลทั้งระบบ)
 */
export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [runs, setRuns] = useState<EngineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [s, r] = await Promise.all([getStats(), listEngineRuns()]);
    setStats(s.data);
    setRuns((r.data ?? []).slice(0, 5));
    setError(s.error ?? r.error);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (loading) return <Splash />;

  return (
    <>
      <SectionHeader title="ภาพรวมแพลตฟอร์ม" />
      {error != null ? <ErrorNote id="admin-error" message={error} /> : null}

      <View style={styles.grid}>
        <Stat id="admin-stat-users" label="ผู้ใช้ทั้งหมด" value={stats?.users ?? 0} />
        <Stat id="admin-stat-shops" label="ร้านค้า" value={stats?.shops ?? 0} note={`ถูกระงับ ${stats?.suspendedShops ?? 0}`} />
        <Stat id="admin-stat-products" label="สินค้า" value={stats?.products ?? 0} />
        <Stat
          id="admin-stat-subscriptions"
          label="รายการที่ใช้งานอยู่"
          value={stats?.activeSubscriptions ?? 0}
        />
        <Stat id="admin-stat-orders-today" label="ออเดอร์วันนี้" value={stats?.ordersToday ?? 0} />
        <Stat
          id="admin-stat-mrr"
          label="รายได้ต่อเดือน (จำลอง)"
          value={`฿${(stats?.mrr ?? 0).toLocaleString('th-TH')}`}
          money
        />
        <Stat
          id="admin-stat-cancelled"
          label="ยกเลิกเดือนนี้"
          value={stats?.cancelledThisMonth ?? 0}
        />
        <Stat
          id="admin-stat-issues"
          label="เคสปัญหาที่ยังไม่ตอบ"
          value={stats?.openIssues ?? 0}
          alert={(stats?.openIssues ?? 0) > 0}
        />
      </View>

      <Card id="admin-recent-runs">
        <SectionHeader title="Engine 5 รอบล่าสุด" />
        {runs.length === 0 ? (
          <Text id="admin-runs-empty" style={styles.muted}>
            ยังไม่เคยรัน engine บนเครื่องนี้
          </Text>
        ) : (
          runs.map((run) => (
            <View key={run.id} style={styles.runRow}>
              <Text style={type.bodyStrong}>{formatThaiDate(run.runDate)}</Text>
              <Text style={styles.muted}>
                ออเดอร์ {run.ordersCreated} · แจ้งเตือน {run.notificationsCreated} · ข้าม{' '}
                {run.detail.skipped}
                {run.detail.paymentsFailed > 0
                  ? ` · จ่ายไม่ผ่าน ${run.detail.paymentsFailed}`
                  : ''}
              </Text>
            </View>
          ))
        )}
      </Card>
    </>
  );
}

function Stat({
  label,
  value,
  note,
  money,
  alert,
  id,
}: {
  label: string;
  value: number | string;
  note?: string;
  money?: boolean;
  alert?: boolean;
  id: string;
}) {
  return (
    <Card style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text id={id} style={[styles.statValue, alert === true && styles.statAlert]}>
        {typeof value === 'number' ? value.toLocaleString('th-TH') : value}
      </Text>
      {note != null ? <Text style={styles.muted}>{note}</Text> : null}
      {money === true ? <DemoBadge compact /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  muted: { ...type.caption, color: colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  stat: { minWidth: 180, flexGrow: 1, flexBasis: 180, gap: space.xs },
  statLabel: { ...type.caption, color: colors.textMuted },
  statValue: { ...type.h2, color: colors.text },
  statAlert: { color: colors.danger },
  runRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.sm,
    gap: 2,
  },
});
