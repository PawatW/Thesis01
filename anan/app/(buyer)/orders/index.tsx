import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
import {
  listOrders,
  orderStatusLabel,
  orderStatusTone,
  type BuyerOrder,
} from '@/features/orders/api';
import { cycleLabel } from '@/features/subscriptions/api';
import { formatThaiDate } from '@/lib/date';
import { colors, radius, space, type } from '@/lib/theme';

type Tab = 'open' | 'done';

const TABS: { key: Tab; label: string }[] = [
  { key: 'open', label: 'กำลังดำเนินการ' },
  { key: 'done', label: 'สำเร็จ/ยกเลิก' },
];

/**
 * Feature 07 — ประวัติออเดอร์ของผู้ซื้อ
 *
 * รายการนี้ข้ามทุก subscription และทุกร้าน (API กรองด้วย buyerId จาก token)
 * ทั้งออเดอร์รอบแรกจาก checkout และรอบถัดไปจาก engine หน้าตาเหมือนกันหมด —
 * ผู้ซื้อไม่ควรต้องรู้ว่าใบไหนเกิดจากอะไร
 */
export default function OrdersScreen() {
  const [tab, setTab] = useState<Tab>('open');
  const [orders, setOrders] = useState<BuyerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error: err } = await listOrders(tab);
    setOrders(data ?? []);
    setError(err);
    setLoading(false);
  }, [tab]);

  /**
   * โหลดใหม่ทุกครั้งที่กลับมาที่หน้านี้ ไม่ใช่แค่ตอน mount
   *
   * expo-router คาหน้ารายการไว้ตอน push หน้ารายละเอียด — ผู้ซื้อกด "ได้รับแล้ว"
   * ในหน้ารายละเอียดแล้วกดย้อนกลับ จะเห็นสถานะเก่าค้างอยู่ถ้าใช้ `useEffect` เปล่า ๆ
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
        <SectionHeader title="ออเดอร์ของฉัน" />
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              id={`orders-tab-${t.key}`}
              accessibilityRole="button"
              onPress={() => setTab(t.key)}
              style={[styles.tab, tab === t.key && styles.tabOn]}
            >
              <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
        {/* ทุกยอดในหน้านี้เป็นเงินจำลอง — กฎเหล็กข้อ 1 ของโปรเจกต์ */}
        <DemoBadge />
      </Card>

      {error != null ? <ErrorNote id="orders-error" message={error} /> : null}

      {orders.length === 0 ? (
        <Card>
          <EmptyState
            id="orders-empty"
            title={tab === 'open' ? 'ยังไม่มีออเดอร์ที่กำลังส่ง' : 'ยังไม่มีออเดอร์ที่จบรอบ'}
            body="ระบบจะสร้างออเดอร์ให้อัตโนมัติทุกครั้งที่ถึงรอบส่งของรายการที่คุณสมัครไว้"
          />
        </Card>
      ) : null}

      {orders.map((order) => (
        <OrderRow key={order.id} order={order} />
      ))}
    </Screen>
  );
}

/**
 * การ์ด 1 ใบ = 1 ออเดอร์ · ทั้งใบเป็นลิงก์ไปหน้ารายละเอียด
 *
 * ป้ายที่ต้องเห็นตั้งแต่หน้ารายการโดยไม่ต้องกดเข้าไป: "ยืนยันรับแล้ว" (กดไปแล้ว
 * จะได้ไม่ต้องกดซ้ำ), "มีเคสปัญหา" และ "คืนเงินแล้ว" — สามอย่างนี้คือสิ่งที่ผู้ใช้
 * เปิดหน้านี้มาหา
 */
function OrderRow({ order }: { order: BuyerOrder }) {
  const refunded = order.paymentStatus === 'refunded';
  const unpaid = order.paymentStatus === 'failed';

  return (
    <Link href={`/(buyer)/orders/${order.id}`} asChild>
      <Pressable id={`order-card-${order.id}`} accessibilityRole="link">
        <Card>
          <SectionHeader
            title={order.productName}
            action={
              <Pill
                id={`order-status-${order.id}`}
                label={orderStatusLabel(order.status)}
                tone={orderStatusTone(order.status)}
              />
            }
          />
          <Text style={styles.muted}>
            {order.shopName} · รอบวันที่ {formatThaiDate(order.cycleDate)} · {cycleLabel(order.cycle)}
          </Text>
          <View style={styles.foot}>
            <Text style={styles.price}>
              ฿{order.amount.toLocaleString('th-TH')}
              <Text style={styles.muted}> · {order.quantity} ชิ้น</Text>
            </Text>
            <View style={styles.badges}>
              {unpaid ? (
                <Pill id={`order-unpaid-${order.id}`} label="ยังไม่ได้ชำระเงิน" tone="sale" />
              ) : null}
              {order.confirmedAt != null ? (
                <Pill id={`order-confirmed-${order.id}`} label="ยืนยันรับแล้ว" tone="active" />
              ) : null}
              {order.issue != null && order.issue.status === 'open' ? (
                <Pill id={`order-issue-${order.id}`} label="แจ้งปัญหาแล้ว" tone="frozen" />
              ) : null}
              {refunded ? (
                <Pill id={`order-refunded-${order.id}`} label="คืนเงินแล้ว (DEMO)" tone="sale" />
              ) : null}
            </View>
          </View>
        </Card>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  muted: { ...type.caption, color: colors.textMuted },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tab: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  tabOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  tabText: { ...type.caption, color: colors.text },
  tabTextOn: { color: colors.primaryStrong },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  price: { ...type.price, color: colors.text },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
