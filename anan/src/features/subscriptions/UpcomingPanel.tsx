import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ProductImage } from '@/components/Media';
import { DemoBadge, EmptyState, ErrorNote, Pill } from '@/components/ui';
import { CycleRail } from '@/features/subscriptions/CycleRail';
import {
  cycleLabel,
  daysUntil,
  type MonthCharge,
  type SubscriptionCard,
} from '@/features/subscriptions/api';
import { colors, radius, space, type } from '@/lib/theme';

/**
 * แผงขวาของหน้าแรก — ช่องเดียวกับ "My Cart" ใน mockup อ้างอิง
 *
 * ANAN ไม่มีตะกร้า (สมัครทีละสินค้า) ช่องนี้จึงเป็น "รอบส่งถัดไป" + ยอดของเดือนนี้
 * ไม่มีปุ่มแก้จำนวน/ข้ามรอบตรงนี้ — ทุก action ของ W05 มีกล่องยืนยันอยู่ที่หน้า
 * "ของฉัน" แล้ว ทำซ้ำตรงนี้ก็มีสองที่ที่ต้องดูแลกฎเดียวกัน
 */
export function UpcomingPanel({
  subs,
  loading,
  error,
  charges,
}: {
  subs: SubscriptionCard[];
  loading: boolean;
  error: string | null;
  charges: MonthCharge[];
}) {
  const router = useRouter();

  // รายการที่ใกล้ถึงรอบที่สุดขึ้นก่อน · หยุด/ยกเลิกไปไว้ท้าย
  const ordered = [...subs].sort((a, b) => {
    const rank = (s: SubscriptionCard) => (s.status === 'active' ? 0 : s.status === 'paused' ? 1 : 2);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return (a.nextOrderDate ?? '9999').localeCompare(b.nextOrderDate ?? '9999');
  });

  const gross = charges.reduce((sum, c) => sum + c.grossAmount, 0);
  const net = charges.reduce((sum, c) => sum + c.amount, 0);
  const discount = gross - net;

  return (
    <View id="home-next-panel" style={styles.panel}>
      <View style={styles.head}>
        <Text style={styles.title}>
          รอบส่งถัดไป{subs.length > 0 ? ` (${subs.length})` : ''}
        </Text>
        {subs.length > 0 ? (
          <Pressable
            id="home-next-manage"
            accessibilityRole="link"
            onPress={() => router.push('/(buyer)/subscriptions')}
            style={styles.manage}
          >
            <Text style={styles.manageText}>จัดการ</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <Text style={styles.muted}>กำลังโหลด…</Text>
      ) : error != null ? (
        <ErrorNote id="home-subs-error" message={error} />
      ) : subs.length === 0 ? (
        <EmptyState
          id="home-subs-empty"
          title="ยังไม่มีรายการที่สมัครไว้"
          body="เมื่อสมัครรับสินค้าแล้ว รอบส่งถัดไปจะแสดงที่นี่ พร้อมปุ่มข้ามรอบและหยุดชั่วคราว"
        />
      ) : (
        <>
          <View>
            {ordered.map((s, i) => (
              <SubscriptionRow key={s.id} item={s} last={i === ordered.length - 1} />
            ))}
          </View>

          {charges.length > 0 ? (
            <View id="home-month-summary" style={styles.summary}>
              <Line label={`ยอดเดือนนี้ (${charges.length} รอบ)`} value={gross} />
              {discount > 0 ? <Line label="คูปองที่จองไว้" value={-discount} tone="sale" /> : null}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>รวมเดือนนี้</Text>
                <Text style={styles.totalValue}>฿{net.toLocaleString('th-TH')}</Text>
              </View>
              <DemoBadge />
            </View>
          ) : (
            <Text style={styles.muted}>เดือนนี้ไม่มีรอบที่ต้องจ่าย</Text>
          )}

          <Pressable
            id="home-next-all"
            accessibilityRole="button"
            onPress={() => router.push('/(buyer)/subscriptions')}
            style={({ pressed }) => [styles.cta, pressed && { backgroundColor: colors.primaryStrong }]}
          >
            <Text style={styles.ctaText}>ดูปฏิทินรอบส่งทั้งหมด</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function Line({ label, value, tone }: { label: string; value: number; tone?: 'sale' }) {
  const color = tone === 'sale' ? colors.sale : colors.textMuted;
  return (
    <View style={styles.line}>
      <Text style={[styles.lineText, { color }]}>{label}</Text>
      <Text style={[styles.lineText, styles.num, { color }]}>
        {value < 0 ? '-' : ''}฿{Math.abs(value).toLocaleString('th-TH')}
      </Text>
    </View>
  );
}

function SubscriptionRow({ item, last }: { item: SubscriptionCard; last: boolean }) {
  const days = daysUntil(item.nextOrderDate);
  const frozen = item.pausedReason === 'shop_suspended';

  const when =
    item.status === 'active' && days != null ? (
      <Text
        style={[
          styles.when,
          days <= 3 ? { color: colors.timeUrgent } : days <= 7 ? { color: colors.timeSoon } : null,
        ]}
      >
        {days <= 0 ? 'ส่งรอบนี้วันนี้' : `อีก ${days} วัน`}
      </Text>
    ) : item.status === 'paused' ? (
      <Pill label={frozen ? 'ร้านถูกระงับ' : 'หยุดชั่วคราว'} tone={frozen ? 'frozen' : 'paused'} dot />
    ) : item.status === 'cancelled' ? (
      <Pill label="ยกเลิกแล้ว" tone="cancelled" dot />
    ) : null;

  return (
    <View id={`home-sub-${item.id}`} style={[styles.row, !last && styles.rowDivider]}>
      <ProductImage images={item.images} categoryIcon={null} height={64} iconSize={24} style={styles.thumb} />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.productName}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {cycleLabel(item.cycle)} · {item.shopName}
          {item.quantity > 1 ? ` · ${item.quantity} ชิ้น` : ''}
        </Text>
        <View style={styles.rowFoot}>
          {when}
          <Text style={styles.price}>
            ฿{(item.pricePerCycle * item.quantity).toLocaleString('th-TH')}
            <Text style={styles.per}> /รอบ</Text>
          </Text>
        </View>
        <CycleRail
          cycle={item.cycle}
          nextOrderDate={item.nextOrderDate}
          status={item.status}
          categoryIcon={null}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.lg,
    gap: space.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...type.h4, color: colors.text },
  manage: { minHeight: 32, justifyContent: 'center', paddingHorizontal: space.xs },
  manageText: { ...type.label, fontSize: 13, color: colors.primaryStrong },
  muted: { ...type.caption, color: colors.textMuted },

  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.md },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  thumb: { width: 56, borderRadius: radius.md },
  rowBody: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { ...type.small, fontFamily: type.bodyStrong.fontFamily, color: colors.text },
  rowMeta: { ...type.caption, fontSize: 12, color: colors.textFaint },
  rowFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  when: { ...type.label, fontSize: 13, color: colors.timeCalm },
  price: { ...type.small, fontFamily: type.bodyStrong.fontFamily, color: colors.text },
  per: { ...type.caption, fontSize: 12, color: colors.textFaint },

  summary: {
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: space.md,
  },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  lineText: { ...type.caption },
  num: { fontVariant: ['tabular-nums'] },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderStyle: 'dashed',
    paddingTop: space.sm,
    marginTop: 2,
  },
  totalLabel: { ...type.bodyStrong, color: colors.text },
  totalValue: { ...type.price, color: colors.text },

  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { ...type.bodyStrong, color: colors.onPrimary },
});
