import { useLocalSearchParams } from 'expo-router';
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
  ISSUE_TYPES,
  ORDER_STEPS,
  confirmReceipt,
  getOrder,
  issueStatusLabel,
  issueTypeLabel,
  orderStatusLabel,
  orderStatusTone,
  reportIssue,
  retryPayment,
  stepIndex,
  type BuyerOrder,
} from '@/features/orders/api';
import { cycleLabel } from '@/features/subscriptions/api';
import { formatThaiDate } from '@/lib/date';
import { colors, radius, space, statusTones, type } from '@/lib/theme';

/** ยืนยันได้เมื่อของออกจากร้านแล้วเท่านั้น — API บังคับกฎเดียวกันอีกชั้น */
const CONFIRMABLE = ['shipped', 'delivered'];
/** แจ้งปัญหาได้ตั้งแต่ร้านเริ่มจัดของ — ก่อนหน้านั้นยังไม่มีอะไรให้ผิดพลาด */
const REPORTABLE = ['preparing', 'shipped', 'delivered'];

const thaiDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Feature 07 + 15 + 16 — รายละเอียดออเดอร์ 1 ใบ
 *
 * ปุ่ม "ได้รับแล้ว" ที่นี่คือจุดเดียวในทั้งระบบที่เขียน `confirmed_at` ได้ —
 * ร้านไม่มี endpoint ไหนแตะฟิลด์นี้เลย (feature 16) ป้าย "ยืนยันรับแล้ว" จึงเป็น
 * คำพูดของผู้ซื้อจริง ๆ ไม่ใช่ของร้าน
 */
export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<BuyerOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  /**
   * กันกดปุ่มรัวในเฟรมเดียวกัน — `busy` เป็น state ที่มีผลหลัง re-render จึงกันไม่ทัน
   * (security-rules C-9) · DB มี `UNIQUE(order_id)` กันเคสซ้ำอยู่แล้ว แต่คำขอที่สอง
   * จะเด้ง 409 ให้ผู้ใช้เห็นทั้งที่ทำสำเร็จ ซึ่งอ่านแล้วสับสนกว่าไม่มีอะไรเกิด
   */
  const sending = useRef(false);
  const [issueType, setIssueType] = useState(ISSUE_TYPES[0].value);
  const [issueDetail, setIssueDetail] = useState('');

  const reload = useCallback(async () => {
    if (id == null) return;
    const { data, error: err } = await getOrder(id);
    if (data != null) setOrder(data);
    setError(err);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function confirm() {
    if (order == null || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const { data, error: err } = await confirmReceipt(order.id);
    sending.current = false;
    setBusy(false);
    if (err != null) {
      await reload();
      setError(err);
      return;
    }
    if (data != null) setOrder(data);
    setToast('ขอบคุณที่ยืนยัน — บันทึกว่าได้รับของแล้ว');
  }

  /** จ่ายซ้ำหลังบัตรถูกปฏิเสธ — ผลลัพธ์ที่ผู้ใช้ต้องเห็นคือ "ร้านเริ่มจัดของได้แล้ว" */
  async function payAgain() {
    if (order == null || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const { data, error: err } = await retryPayment(order.id);
    sending.current = false;
    setBusy(false);
    if (err != null) {
      await reload();
      setError(err);
      return;
    }
    if (data != null) setOrder(data);
    setToast('ชำระเงินสำเร็จ (จำลอง) — ร้านเริ่มจัดของให้แล้ว');
  }

  async function submitIssue() {
    if (order == null || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const { data, error: err } = await reportIssue(order.id, {
      type: issueType,
      detail: issueDetail.trim(),
    });
    sending.current = false;
    setBusy(false);
    if (err != null) {
      // API เป็นเจ้าของความจริง: ถ้ามีเคสอยู่แล้ว (แจ้งจากอีกเครื่อง) ต้องดึงมาโชว์
      // ไม่ใช่ค้างฟอร์มไว้เฉย ๆ · ตั้งข้อความหลัง reload เพราะ reload เคลียร์ error
      await reload();
      setError(err);
      return;
    }
    setIssueOpen(false);
    setIssueDetail('');
    if (data != null) setOrder(data);
    setToast('ส่งเรื่องให้ร้านแล้ว — ร้านจะได้รับแจ้งเตือนทันที');
  }

  if (loading) return <Splash />;

  if (order == null) {
    return (
      <Screen>
        <Card>
          <EmptyState
            id="order-not-found"
            title="ไม่พบออเดอร์นี้"
            body={error ?? 'ออเดอร์อาจถูกลบไปแล้ว หรือไม่ใช่ออเดอร์ของบัญชีนี้'}
          />
        </Card>
      </Screen>
    );
  }

  const cancelled = order.status === 'cancelled';
  const refunded = order.paymentStatus === 'refunded';
  const unpaid = order.paymentStatus === 'failed';
  const canConfirm = CONFIRMABLE.includes(order.status) && order.confirmedAt == null;
  const canReport = REPORTABLE.includes(order.status) && order.issue == null;

  return (
    <Screen>
      <Card id="order-detail">
        <SectionHeader
          title={order.productName}
          action={
            <Pill
              id="order-detail-status"
              label={orderStatusLabel(order.status)}
              tone={orderStatusTone(order.status)}
            />
          }
        />
        <Text style={styles.muted}>
          {order.shopName} · รอบวันที่ {formatThaiDate(order.cycleDate)} · {cycleLabel(order.cycle)}
        </Text>
        <Text style={styles.price}>
          ฿{order.amount.toLocaleString('th-TH')}
          <Text style={styles.muted}> · {order.quantity} ชิ้น</Text>
        </Text>
        {/* ส่วนลดคูปองของรอบนี้ (feature 18) — ยอดด้านบนคือยอดที่ตัดจริงแล้ว */}
        {order.discountAmount > 0 ? (
          <Text id="order-discount" style={styles.discount}>
            {`ใช้คูปอง ${order.coupons.map((c) => `${c.code} (−฿${c.discountAmount.toLocaleString('th-TH')})`).join(' + ')} · ลดรวม ฿${order.discountAmount.toLocaleString('th-TH')} จากยอด ฿${(order.amount + order.discountAmount).toLocaleString('th-TH')}`}
          </Text>
        ) : null}
        <DemoBadge />
        {order.receiptNo != null ? (
          <Button
            id="order-receipt-open"
            label="ดูใบเสร็จ (จำลอง)"
            variant="secondary"
            onPress={() => setReceiptOpen(true)}
          />
        ) : null}
        {order.subscriptionStatus === 'cancelled' ? (
          <Text id="order-sub-cancelled" style={styles.muted}>
            คุณยกเลิกการสมัครรายการนี้แล้ว — ออเดอร์ใบนี้เป็นประวัติที่ยังเก็บไว้
          </Text>
        ) : null}
      </Card>

      {error != null ? <ErrorNote id="order-error" message={error} /> : null}
      {toast != null ? (
        <Pressable id="order-toast" onPress={() => setToast(null)}>
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </Pressable>
      ) : null}

      {/* จ่ายไม่ผ่าน (feature 09 เฟส 5) — ต้องอยู่เหนือ stepper เพราะร้านยังไม่เริ่มทำอะไรจนกว่าจะจ่าย */}
      {unpaid && !cancelled ? (
        <Card id="order-unpaid" style={styles.cancelCard}>
          <Text style={type.h4}>ยังชำระเงินรอบนี้ไม่สำเร็จ</Text>
          <Text style={type.body}>
            บัตรถูกปฏิเสธ — ร้านจะยังไม่เห็นออเดอร์นี้จนกว่าการชำระเงินจะสำเร็จ
          </Text>
          <DemoBadge />
          <Button
            id="order-retry-payment"
            label={`จ่ายอีกครั้ง ฿${order.amount.toLocaleString('th-TH')}`}
            loading={busy}
            onPress={() => void payAgain()}
          />
          <Text style={styles.muted}>
            ถ้ายังไม่ผ่าน ให้เปลี่ยนบัตรของรายการนี้ที่หน้า &quot;ของฉัน&quot; แล้วกดจ่ายใหม่
          </Text>
        </Card>
      ) : null}

      {/* ร้านยกเลิก (feature 15) — เหตุผลต้องอยู่บนสุดของหน้า ไม่ใช่ซ่อนท้ายการ์ด */}
      {cancelled ? (
        <Card id="order-cancel-banner" style={styles.cancelCard}>
          <Text style={type.h4}>ร้านยกเลิกออเดอร์รอบนี้</Text>
          <Text id="order-cancel-reason" style={type.body}>
            เหตุผลจากร้าน: {order.cancelReason ?? '—'}
          </Text>
          {order.cancelledAt != null ? (
            <Text style={styles.muted}>ยกเลิกเมื่อ {thaiDateTime(order.cancelledAt)}</Text>
          ) : null}
          {refunded ? (
            <View id="order-refund-badge" style={styles.refund}>
              <Text style={styles.refundText}>
                คืนเงินจำลองแล้ว ฿{order.amount.toLocaleString('th-TH')}
                {order.refundedAt != null ? ` · ${thaiDateTime(order.refundedAt)}` : ''}
              </Text>
            </View>
          ) : null}
          <DemoBadge />
          <Text style={styles.muted}>
            รอบถัดไปของรายการนี้ยังเดินตามปกติ — ถ้าไม่ต้องการรอบหน้าให้กดหยุดชั่วคราวที่หน้า
            &quot;ของฉัน&quot;
          </Text>
        </Card>
      ) : (
        <Card id="order-stepper">
          <SectionHeader title="สถานะการส่ง" />
          <Stepper status={order.status} />
          {order.trackingNote != null ? (
            <Text id="order-tracking" style={styles.muted}>
              เลขพัสดุ {order.trackingNote}
            </Text>
          ) : null}
          {order.confirmedAt != null ? (
            <Text id="order-confirmed-at" style={styles.confirmed}>
              ยืนยันรับของแล้วเมื่อ {thaiDateTime(order.confirmedAt)}
            </Text>
          ) : order.status === 'delivered' ? (
            <Text id="order-auto-closed" style={styles.muted}>
              ปิดรอบนี้โดยร้านหรือระบบ (ส่งครบ 7 วัน) — ยังไม่มีการยืนยันจากคุณ
              ถ้ายังไม่ได้รับของจริง กดแจ้งปัญหาได้
            </Text>
          ) : null}
        </Card>
      )}

      {/* ปุ่มสองใบนี้คือของผู้ซื้อเท่านั้น — ซ่อนเมื่อออเดอร์ถูกยกเลิก (ไม่มีของให้ยืนยัน) */}
      {!cancelled && (canConfirm || canReport) ? (
        <Card>
          <SectionHeader title="ของถึงมือคุณหรือยัง" />
          <Text style={styles.muted}>
            การยืนยันนับเป็นหลักฐานเดียวที่ระบบใช้ว่าของถึงจริง — ร้านตั้งแทนคุณไม่ได้
          </Text>
          <View style={styles.actions}>
            {canConfirm ? (
              <Button
                id="order-confirm"
                label="ได้รับแล้ว"
                loading={busy}
                onPress={() => void confirm()}
              />
            ) : null}
            {canReport ? (
              <Button
                id="order-report"
                label="แจ้งปัญหา"
                variant="secondary"
                disabled={busy}
                onPress={() => {
                  setIssueOpen(true);
                  setIssueType(ISSUE_TYPES[0].value);
                  setIssueDetail('');
                }}
              />
            ) : null}
          </View>
        </Card>
      ) : null}

      {order.issue != null ? (
        <Card id="order-issue-card">
          <SectionHeader
            title="เคสที่แจ้งไว้"
            action={
              <Pill
                id="order-issue-status"
                label={issueStatusLabel(order.issue.status)}
                tone={order.issue.status === 'open' ? 'frozen' : 'active'}
              />
            }
          />
          <Text style={type.bodyStrong}>{issueTypeLabel(order.issue.type)}</Text>
          <Text style={type.body}>{order.issue.detail}</Text>
          <Text style={styles.muted}>แจ้งเมื่อ {thaiDateTime(order.issue.createdAt)}</Text>
          {order.issue.resolutionNote != null ? (
            <View id="order-issue-note" style={styles.note}>
              <Text style={type.bodyStrong}>ร้านตอบกลับ</Text>
              <Text style={type.body}>{order.issue.resolutionNote}</Text>
            </View>
          ) : (
            <Text style={styles.muted}>
              เคสนี้แจ้งได้ครั้งเดียวต่อออเดอร์ — ถ้ามีข้อมูลเพิ่มให้ติดต่อร้านโดยตรง
            </Text>
          )}
        </Card>
      ) : null}

      {/* ที่อยู่มาจาก snapshot ตอนออเดอร์เกิด — เปลี่ยนที่อยู่ทีหลังไม่ย้อนมาแก้ใบนี้ (feature 07) */}
      <Card id="order-address">
        <SectionHeader title="ส่งไปที่" />
        <Text style={type.bodyStrong}>{order.shipTo.name}</Text>
        <Text style={styles.muted}>{order.shipTo.phone}</Text>
        <Text style={styles.muted}>
          {order.shipTo.addressLine} {order.shipTo.province} {order.shipTo.postcode}
        </Text>
        <Text style={styles.muted}>
          บันทึกไว้ตอนออเดอร์เกิด — แก้ที่อยู่ทีหลังจะมีผลกับรอบถัดไปเท่านั้น
        </Text>
      </Card>

      {/* ใบเสร็จจำลอง (feature 09) — ข้อมูลทั้งใบมาจากออเดอร์ใบนี้ ไม่มีอะไรคำนวณใหม่ */}
      <Modal
        visible={receiptOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setReceiptOpen(false)}
      >
        <View id="order-receipt" style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={type.h3}>ใบเสร็จ (จำลอง)</Text>
            <Text id="order-receipt-no" style={type.bodyStrong}>
              เลขที่ {order.receiptNo ?? '—'}
            </Text>
            <Text style={styles.muted}>
              {order.paidAt != null ? thaiDateTime(order.paidAt) : '—'}
            </Text>

            <View style={styles.note}>
              <Text style={type.bodyStrong}>{order.productName}</Text>
              <Text style={styles.muted}>
                {order.shopName} · รอบวันที่ {formatThaiDate(order.cycleDate)} ·{' '}
                {order.quantity} ชิ้น
              </Text>
              {order.discountAmount > 0 ? (
                <Text id="order-receipt-discount" style={styles.muted}>
                  {`ยอดก่อนลด ฿${(order.amount + order.discountAmount).toLocaleString('th-TH')} · ${order.coupons.map((c) => `${c.code} −฿${c.discountAmount.toLocaleString('th-TH')}`).join(' · ')}`}
                </Text>
              ) : null}
              <Text id="order-receipt-amount" style={styles.price}>
                รวม ฿{order.amount.toLocaleString('th-TH')}
              </Text>
              {order.paymentStatus === 'refunded' ? (
                <Text id="order-receipt-refunded" style={styles.refundText}>
                  คืนเงินแล้ว
                  {order.refundedAt != null ? ` · ${thaiDateTime(order.refundedAt)}` : ''}
                </Text>
              ) : null}
            </View>

            <Text style={styles.muted}>ผู้รับ {order.shipTo.name}</Text>
            <DemoBadge />
            <Button
              id="order-receipt-close"
              label="ปิด"
              variant="ghost"
              onPress={() => setReceiptOpen(false)}
            />
          </View>
        </View>
      </Modal>

      <Modal
        visible={issueOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIssueOpen(false)}
      >
        {/* Modal อยู่คนละชั้นกับ `Screen` จึงต้องกันคีย์บอร์ดเอง (testing.md §5.0) */}
        <KeyboardAvoidingView
          id="order-issue-sheet"
          style={styles.backdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheet}>
            <Text style={type.h3}>แจ้งปัญหาออเดอร์นี้</Text>
            <Text style={styles.muted}>
              ร้านจะได้รับแจ้งเตือนทันทีและตอบกลับในเคสนี้ · 1 ออเดอร์แจ้งได้ 1 ครั้ง
            </Text>
            <View style={styles.chips}>
              {ISSUE_TYPES.map((t) => (
                <Pressable
                  key={t.value}
                  id={`order-issue-type-${t.value}`}
                  accessibilityRole="button"
                  onPress={() => setIssueType(t.value)}
                  style={[styles.chip, issueType === t.value && styles.chipOn]}
                >
                  <Text style={[styles.chipText, issueType === t.value && styles.chipTextOn]}>
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextField
              id="order-issue-detail"
              label="เล่าให้ร้านฟัง"
              value={issueDetail}
              onChangeText={setIssueDetail}
              placeholder="เช่น กล่องมาถึงแต่ข้างในว่างเปล่า"
              multiline
              maxLength={1000}
              hint="อย่างน้อย 5 ตัวอักษร"
            />
            <View style={styles.sheetActions}>
              <Button
                id="order-issue-submit"
                label="ส่งเรื่องให้ร้าน"
                loading={busy}
                disabled={issueDetail.trim().length < 5}
                onPress={() => void submitIssue()}
              />
              <Button
                id="order-issue-close"
                label="ปิด"
                variant="ghost"
                onPress={() => setIssueOpen(false)}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

/**
 * 4 ขั้นแนวนอน — ขั้นที่ผ่านแล้วทึบ ขั้นที่ยังไม่ถึงจาง
 * ออเดอร์ที่ถูกยกเลิกไม่แสดง stepper เลย (หน้าจอสลับไปเป็น banner แทน)
 */
function Stepper({ status }: { status: BuyerOrder['status'] }) {
  const current = stepIndex(status);

  return (
    <View id="order-steps" style={styles.steps}>
      {ORDER_STEPS.map((step, i) => {
        const done = i <= current;
        return (
          <View key={step.key} style={styles.step}>
            <View
              id={`order-step-${step.key}`}
              style={[styles.dot, done ? styles.dotOn : styles.dotOff]}
            />
            <Text style={[styles.stepText, done && styles.stepTextOn]}>{step.label}</Text>
            {i < ORDER_STEPS.length - 1 ? (
              <View style={[styles.bar, i < current ? styles.barOn : styles.barOff]} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { ...type.caption, color: colors.textMuted },
  price: { ...type.price, color: colors.text },
  discount: { ...type.caption, color: statusTones.active.fg },
  confirmed: { ...type.caption, color: colors.success },
  toast: { backgroundColor: statusTones.active.bg, borderRadius: radius.md, padding: space.md },
  toastText: { ...type.small, color: statusTones.active.fg },
  cancelCard: { borderWidth: 1, borderColor: colors.dangerSoftBorder },
  refund: {
    backgroundColor: statusTones.sale.bg,
    borderRadius: radius.md,
    padding: space.md,
  },
  refundText: { ...type.bodyStrong, color: statusTones.sale.fg },
  note: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: space.md,
    gap: 2,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  steps: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
  step: { flex: 1, alignItems: 'center', gap: space.xs },
  dot: { width: 14, height: 14, borderRadius: radius.pill },
  dotOn: { backgroundColor: colors.primary },
  dotOff: { backgroundColor: colors.border },
  bar: { position: 'absolute', top: 6, left: '55%', right: '-45%', height: 2 },
  barOn: { backgroundColor: colors.primary },
  barOff: { backgroundColor: colors.border },
  stepText: { ...type.caption, color: colors.textFaint, textAlign: 'center' },
  stepTextOn: { color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { ...type.caption, color: colors.text },
  chipTextOn: { color: colors.primaryStrong },
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
});
