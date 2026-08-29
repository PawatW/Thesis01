import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
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
  advanceOrder,
  cancelOrder,
  getForecast,
  issueTypeLabel,
  listIssues,
  listOrders,
  nextActionLabel,
  orderStatusLabel,
  resolveIssue,
  type Forecast,
  type OrderTab,
  type SellerIssue,
  type SellerOrder,
} from '@/features/seller/api';
import { daysUntil, formatThaiDate } from '@/lib/date';
import { colors, radius, space, statusTones, type } from '@/lib/theme';

type Tab = OrderTab | 'forecast' | 'issues';

const TABS: { key: Tab; label: string }[] = [
  { key: 'open', label: 'ค้างส่ง' },
  { key: 'shipped', label: 'กำลังส่ง' },
  { key: 'issues', label: 'ปัญหา' },
  { key: 'forecast', label: 'ล่วงหน้า' },
  { key: 'history', label: 'ประวัติ' },
];

const FORECAST_RANGES = [7, 14, 30];

/** ออเดอร์ค้างเกิน 2 วันต้องเด่น — visual เท่านั้น ไม่มี auto-action (W08 A1) */
const LATE_DAYS = -2;

/** เคสที่ยังไม่ตอบเกิน 3 วันขึ้นสีเตือน (feature 16) */
const STALE_ISSUE_DAYS = 3;

/** ยกเลิกได้เฉพาะก่อนของออกจากร้าน — ส่งแล้วต้องใช้ flow คืนของ (out of scope) */
const CANCELLABLE = ['pending', 'preparing'];

/** เหตุผลที่พบบ่อย — กดแล้วเติมลงช่องข้อความ ยังแก้ต่อได้ (ผู้ซื้ออ่านข้อความนี้) */
const CANCEL_PRESETS = [
  { key: 'out-of-stock', label: 'ของหมด' },
  { key: 'shop-closed', label: 'ปิดร้านชั่วคราว' },
  { key: 'no-delivery', label: 'ส่งพื้นที่นี้ไม่ได้' },
] as const;

/**
 * ออเดอร์ของร้าน (feature 12 · W08)
 *
 * ปุ่มเปลี่ยนสถานะมีปุ่มเดียวต่อออเดอร์ และไม่ได้ส่งสถานะเป้าหมายขึ้นไป —
 * API เป็นคนตัดสินว่าขั้นถัดไปคืออะไร ลำดับจึงข้ามไม่ได้แม้แก้โค้ดหน้านี้
 */
export default function SellerOrdersScreen() {
  const [tab, setTab] = useState<Tab>('open');
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [shipping, setShipping] = useState<SellerOrder | null>(null);
  const [tracking, setTracking] = useState('');
  const [cancelling, setCancelling] = useState<SellerOrder | null>(null);
  const [reason, setReason] = useState('');
  const [issues, setIssues] = useState<SellerIssue[]>([]);
  const [issueTab, setIssueTab] = useState<'open' | 'closed'>('open');
  const [answering, setAnswering] = useState<SellerIssue | null>(null);
  const [note, setNote] = useState('');
  /**
   * ★ ปุ่มยกเลิกออเดอร์แตะเงินของผู้ซื้อ ★ `busyId` เป็น state ที่มีผลหลัง re-render
   * จึงกันการกดรัวในเฟรมเดียวกันไม่ได้ (security-rules C-9) · ฝั่ง API มีเงื่อนไข
   * สถานะเดิมอยู่ใน `where` อยู่แล้ว คำขอที่สองจึงได้ 409 ไม่ได้คืนเงินซ้ำ
   * แต่ผู้ใช้ไม่ควรเห็น error จากการกดของตัวเอง
   */
  const submitting = useRef(false);

  const reload = useCallback(async () => {
    if (tab === 'forecast') {
      const { data, error: err } = await getForecast(days);
      setForecast(data);
      setError(err);
    } else if (tab === 'issues') {
      const { data, error: err } = await listIssues(issueTab);
      setIssues(data ?? []);
      setError(err);
    } else {
      const { data, error: err } = await listOrders(tab);
      setOrders(data ?? []);
      setError(err);
    }
    setLoading(false);
  }, [tab, days, issueTab]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  async function advance(order: SellerOrder, note?: string) {
    setBusyId(order.id);
    setError(null);
    const { error: err } = await advanceOrder(order.id, note);
    setBusyId(null);
    setShipping(null);
    setTracking('');

    if (err != null) {
      await reload();
      setError(err);
      return;
    }
    setToast('อัปเดตสถานะแล้ว — แจ้งผู้ซื้อเรียบร้อย');
    await reload();
  }

  /**
   * ยกเลิก + คืนเงินจำลอง อยู่ใน request เดียว (feature 15)
   * ฝั่งนี้ไม่ได้คำนวณยอดคืนเลย — API คืนตามยอดที่บันทึกไว้ในออเดอร์
   */
  async function cancel(order: SellerOrder) {
    if (submitting.current) return;
    submitting.current = true;
    setBusyId(order.id);
    setError(null);
    const { error: err } = await cancelOrder(order.id, reason.trim());
    submitting.current = false;
    setBusyId(null);
    if (err != null) {
      setError(err);
      return;
    }
    setCancelling(null);
    setReason('');
    setToast('ยกเลิกออเดอร์และคืนเงินจำลองให้ผู้ซื้อแล้ว — รอบถัดไปยังเดินตามปกติ');
    await reload();
  }

  async function answer(issue: SellerIssue, status: 'resolved' | 'rejected') {
    if (submitting.current) return;
    submitting.current = true;
    setBusyId(issue.id);
    setError(null);
    const { error: err } = await resolveIssue(issue.id, { status, note: note.trim() });
    submitting.current = false;
    setBusyId(null);
    if (err != null) {
      setError(err);
      return;
    }
    setAnswering(null);
    setNote('');
    setToast('ปิดเคสแล้ว — ผู้ซื้อได้รับแจ้งเตือน');
    await reload();
  }

  if (loading) return <Splash />;

  return (
    <Screen>
      <Card>
        <SectionHeader title="ออเดอร์ของร้าน" />
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              id={`seller-orders-tab-${t.key}`}
              accessibilityRole="button"
              onPress={() => {
                setTab(t.key);
                setToast(null);
                setError(null);
              }}
              style={[styles.tab, tab === t.key && styles.tabOn]}
            >
              <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
        {/* ยอดบนการ์ดออเดอร์ทุกใบเป็นเงินจำลอง (กฎเหล็กข้อ 1) */}
        <DemoBadge />
      </Card>

      {error != null ? <ErrorNote id="seller-orders-error" message={error} /> : null}
      {toast != null ? (
        <Pressable id="seller-orders-toast" onPress={() => setToast(null)}>
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </Pressable>
      ) : null}

      {tab === 'forecast' ? (
        <Card id="seller-forecast">
          <SectionHeader title="ออเดอร์ที่จะเกิด" />
          <View style={styles.tabs}>
            {FORECAST_RANGES.map((d) => (
              <Pressable
                key={d}
                id={`seller-forecast-range-${d}`}
                accessibilityRole="button"
                onPress={() => setDays(d)}
                style={[styles.tab, days === d && styles.tabOn]}
              >
                <Text style={[styles.tabText, days === d && styles.tabTextOn]}>{d} วัน</Text>
              </Pressable>
            ))}
          </View>
          <Text id="seller-forecast-note" style={styles.muted}>
            ตัวเลขโดยประมาณ — ผู้ซื้อ skip หรือหยุดชั่วคราวได้ถึงวันก่อนรอบ
          </Text>
          {forecast == null || forecast.items.length === 0 ? (
            <EmptyState
              id="seller-forecast-empty"
              title="ยังไม่มีรอบส่งในช่วงนี้"
              body="พอสมาชิกใกล้ถึงรอบ รายการจะขึ้นที่นี่ให้เตรียมของล่วงหน้า"
            />
          ) : (
            forecast.items.map((item) => (
              <View key={item.productId} id={`seller-forecast-${item.productId}`} style={styles.forecastRow}>
                <Text style={type.bodyStrong}>{item.productName}</Text>
                <Text style={styles.muted}>
                  {item.ordersCount} ออเดอร์ / {item.units} ชิ้น · ประมาณ ฿
                  {item.revenue.toLocaleString('th-TH')}
                </Text>
              </View>
            ))
          )}
          <DemoBadge />
        </Card>
      ) : tab === 'issues' ? (
        <>
          <Card>
            <SectionHeader title="เคสปัญหาจากผู้ซื้อ" />
            <View style={styles.tabs}>
              {(['open', 'closed'] as const).map((k) => (
                <Pressable
                  key={k}
                  id={`seller-issue-tab-${k}`}
                  accessibilityRole="button"
                  onPress={() => setIssueTab(k)}
                  style={[styles.tab, issueTab === k && styles.tabOn]}
                >
                  <Text style={[styles.tabText, issueTab === k && styles.tabTextOn]}>
                    {k === 'open' ? 'รอตอบ' : 'ปิดแล้ว'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.muted}>
              ตอบแล้วเคสจะปิดถาวร — ถ้าต้องคืนเงินให้ใช้ปุ่ม &quot;ยกเลิกออเดอร์&quot; ในแท็บค้างส่ง
            </Text>
          </Card>

          {issues.length === 0 ? (
            <Card>
              <EmptyState
                id="seller-issues-empty"
                title={issueTab === 'open' ? 'ไม่มีเคสค้างตอบ' : 'ยังไม่มีเคสที่ปิดไปแล้ว'}
                body="ผู้ซื้อแจ้งปัญหาได้จากหน้าออเดอร์ของตัวเอง แล้วเคสจะขึ้นที่นี่ทันที"
              />
            </Card>
          ) : null}

          {issues.map((issue) => {
            const stale = issue.status === 'open' && issue.ageDays > STALE_ISSUE_DAYS;
            return (
              <Card
                key={issue.id}
                id={`seller-issue-${issue.id}`}
                style={stale ? styles.lateCard : undefined}
              >
                <SectionHeader
                  title={issueTypeLabel(issue.type)}
                  action={
                    <Pill
                      id={`seller-issue-status-${issue.id}`}
                      label={
                        issue.status === 'open'
                          ? 'รอตอบ'
                          : issue.status === 'resolved'
                            ? 'แก้ไขให้แล้ว'
                            : 'ปฏิเสธ'
                      }
                      tone={issue.status === 'open' ? 'paused' : 'active'}
                    />
                  }
                />
                <Text style={styles.muted}>
                  {issue.productName} · รอบวันที่ {formatThaiDate(issue.cycleDate)} · ผู้รับ{' '}
                  {issue.recipientName}
                </Text>
                <Text style={type.body}>{issue.detail}</Text>
                {stale ? (
                  <Text id={`seller-issue-stale-${issue.id}`} style={styles.late}>
                    ค้างมา {issue.ageDays} วัน — ผู้ซื้อยังรอคำตอบอยู่
                  </Text>
                ) : null}
                {issue.resolutionNote != null ? (
                  <Text id={`seller-issue-note-${issue.id}`} style={styles.muted}>
                    คำตอบของร้าน: {issue.resolutionNote}
                  </Text>
                ) : null}
                {issue.status === 'open' ? (
                  <Button
                    id={`seller-issue-answer-${issue.id}`}
                    label="ตอบเคสนี้"
                    onPress={() => {
                      setAnswering(issue);
                      setNote('');
                    }}
                  />
                ) : null}
              </Card>
            );
          })}
        </>
      ) : orders.length === 0 ? (
        <Card>
          <EmptyState
            id="seller-orders-empty"
            title="ไม่มีออเดอร์ในแท็บนี้"
            body="ออเดอร์จะถูกสร้างอัตโนมัติเมื่อสมาชิกถึงรอบส่ง"
          />
        </Card>
      ) : (
        orders.map((order) => {
          const late = order.status === 'pending' && (daysUntil(order.cycleDate) ?? 0) <= LATE_DAYS;
          const action = nextActionLabel(order.status);
          return (
            <Card key={order.id} id={`seller-order-${order.id}`} style={late ? styles.lateCard : undefined}>
              <SectionHeader
                title={order.productName}
                action={
                  <Pill
                    id={`seller-order-status-${order.id}`}
                    label={orderStatusLabel(order.status)}
                    tone={
                      order.status === 'delivered'
                        ? 'active'
                        : order.status === 'cancelled'
                          ? 'cancelled'
                          : 'paused'
                    }
                  />
                }
              />
              <Text style={styles.muted}>
                รอบวันที่ {formatThaiDate(order.cycleDate)} · {order.quantity} ชิ้น · ฿
                {order.amount.toLocaleString('th-TH')}
              </Text>
              {late ? (
                <Text id={`seller-order-late-${order.id}`} style={styles.late}>
                  ค้างเกิน 2 วัน — ควรรีบจัดของ
                </Text>
              ) : null}
              {order.subscriptionCancelled ? (
                <Text id={`seller-order-cancelled-sub-${order.id}`} style={styles.muted}>
                  ผู้ซื้อยกเลิกการสมัครแล้ว — ออเดอร์ใบนี้ยังต้องส่งให้จบ
                </Text>
              ) : null}

              {/* ที่อยู่มาจาก snapshot ตอนออเดอร์เกิด — แก้ที่อยู่ทีหลังไม่ย้อนมาแก้ใบนี้ */}
              <View id={`seller-order-address-${order.id}`} style={styles.address}>
                <Text style={type.bodyStrong}>{order.recipient.name}</Text>
                <Text style={styles.muted}>{order.recipient.phone}</Text>
                <Text style={styles.muted}>
                  {order.recipient.addressLine} {order.recipient.province} {order.recipient.postcode}
                </Text>
              </View>

              {order.trackingNote != null ? (
                <Text id={`seller-order-tracking-${order.id}`} style={styles.muted}>
                  เลขพัสดุ {order.trackingNote}
                </Text>
              ) : null}

              <View style={styles.orderActions}>
                {action != null ? (
                  <Button
                    id={`seller-order-advance-${order.id}`}
                    label={action}
                    loading={busyId === order.id}
                    onPress={() => {
                      // ขั้น "ส่งแล้ว" เท่านั้นที่เปิดกล่องกรอกเลขพัสดุ (API ก็บังคับเหมือนกัน)
                      if (order.status === 'preparing') {
                        setShipping(order);
                        setTracking('');
                        return;
                      }
                      void advance(order);
                    }}
                  />
                ) : null}
                {/* ทางออกเมื่อส่งไม่ได้ (feature 15) — หายไปทันทีที่ของออกจากร้าน */}
                {CANCELLABLE.includes(order.status) ? (
                  <Button
                    id={`seller-order-cancel-${order.id}`}
                    label="ยกเลิกออเดอร์"
                    variant="danger"
                    disabled={busyId != null}
                    onPress={() => {
                      setCancelling(order);
                      setReason('');
                    }}
                  />
                ) : null}
              </View>
            </Card>
          );
        })
      )}

      <Modal
        visible={shipping != null}
        transparent
        animationType="fade"
        onRequestClose={() => setShipping(null)}
      >
        {/* คีย์บอร์ดบน iOS จอเล็กทับปุ่มยืนยันถ้าไม่ห่อ — `Screen` ห่อให้เฉพาะเนื้อหาหลัก
            ไม่ครอบ Modal ที่ render อยู่คนละชั้น (บทเรียนใน testing.md §5.0) */}
        <KeyboardAvoidingView
          id="seller-ship-modal"
          style={styles.backdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheet}>
            <Text style={type.h3}>ส่งของแล้ว</Text>
            <Text style={styles.muted}>
              ใส่เลขพัสดุเพื่อให้ผู้ซื้อตามของได้ (ไม่ใส่ก็ส่งได้ แต่ผู้ซื้อจะติดตามไม่ได้)
            </Text>
            <TextField
              id="seller-ship-tracking"
              label="เลขพัสดุ"
              value={tracking}
              onChangeText={setTracking}
              maxLength={200}
            />
            <View style={styles.sheetActions}>
              <Button
                id="seller-ship-confirm"
                label="ยืนยันการส่ง"
                loading={busyId != null}
                onPress={() => {
                  const target = shipping;
                  if (target != null) {
                    void advance(target, tracking.trim() === '' ? undefined : tracking.trim());
                  }
                }}
              />
              <Button
                id="seller-ship-close"
                label="ปิด"
                variant="ghost"
                onPress={() => setShipping(null)}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={cancelling != null}
        transparent
        animationType="fade"
        onRequestClose={() => setCancelling(null)}
      >
        <KeyboardAvoidingView
          id="seller-cancel-modal"
          style={styles.backdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheet}>
            <Text style={type.h3}>ยกเลิกออเดอร์รอบนี้</Text>
            <Text style={styles.muted}>
              ผู้ซื้อจะได้รับเงินคืน (จำลอง) ฿
              {(cancelling?.amount ?? 0).toLocaleString('th-TH')} ทันที และเห็นเหตุผลที่คุณกรอก ·
              รอบถัดไปของเขายังเดินตามปกติ
            </Text>
            <DemoBadge />
            <View style={styles.tabs}>
              {CANCEL_PRESETS.map((preset) => (
                <Pressable
                  key={preset.key}
                  id={`seller-cancel-preset-${preset.key}`}
                  accessibilityRole="button"
                  onPress={() => setReason(preset.label)}
                  style={[styles.tab, reason === preset.label && styles.tabOn]}
                >
                  <Text style={[styles.tabText, reason === preset.label && styles.tabTextOn]}>
                    {preset.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextField
              id="seller-cancel-reason"
              label="เหตุผล (ผู้ซื้อเห็นข้อความนี้)"
              value={reason}
              onChangeText={setReason}
              multiline
              maxLength={200}
              hint="อย่างน้อย 5 ตัวอักษร"
            />
            <View style={styles.sheetActions}>
              <Button
                id="seller-cancel-confirm"
                label="ยืนยันยกเลิก + คืนเงิน"
                variant="danger"
                loading={busyId != null}
                disabled={reason.trim().length < 5}
                onPress={() => {
                  const target = cancelling;
                  if (target != null) void cancel(target);
                }}
              />
              <Button
                id="seller-cancel-close"
                label="ปิด"
                variant="ghost"
                onPress={() => setCancelling(null)}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={answering != null}
        transparent
        animationType="fade"
        onRequestClose={() => setAnswering(null)}
      >
        <KeyboardAvoidingView
          id="seller-issue-modal"
          style={styles.backdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheet}>
            <Text style={type.h3}>ตอบเคสของผู้ซื้อ</Text>
            <Text style={styles.muted}>
              {answering != null ? issueTypeLabel(answering.type) : ''} · ปิดแล้วเปิดใหม่ไม่ได้
              ผู้ซื้อจะเห็นหมายเหตุนี้บนหน้าออเดอร์
            </Text>
            <TextField
              id="seller-issue-note"
              label="หมายเหตุถึงผู้ซื้อ"
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={1000}
              hint="อย่างน้อย 5 ตัวอักษร"
            />
            <View style={styles.sheetActions}>
              <Button
                id="seller-issue-resolve"
                label="แก้ไขให้แล้ว"
                loading={busyId != null}
                disabled={note.trim().length < 5}
                onPress={() => {
                  const target = answering;
                  if (target != null) void answer(target, 'resolved');
                }}
              />
              <Button
                id="seller-issue-reject"
                label="ปฏิเสธเคส"
                variant="danger"
                disabled={busyId != null || note.trim().length < 5}
                onPress={() => {
                  const target = answering;
                  if (target != null) void answer(target, 'rejected');
                }}
              />
              <Button
                id="seller-issue-close"
                label="ปิด"
                variant="ghost"
                onPress={() => setAnswering(null)}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
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
  toast: { backgroundColor: statusTones.active.bg, borderRadius: radius.md, padding: space.md },
  toastText: { ...type.small, color: statusTones.active.fg },
  lateCard: { borderWidth: 1, borderColor: colors.dangerSoftBorder },
  late: { ...type.caption, color: colors.danger },
  address: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: space.md,
    gap: 2,
  },
  forecastRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.sm,
    gap: 2,
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.xl,
    gap: space.md,
    width: '100%',
    maxWidth: 420,
  },
  sheetActions: { flexDirection: 'row', gap: space.sm },
  orderActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
