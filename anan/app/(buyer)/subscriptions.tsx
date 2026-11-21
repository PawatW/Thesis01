import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { Card, DemoBadge, EmptyState, ErrorNote, Pill, Screen, SectionHeader, Splash } from '@/components/ui';
import { listAddresses, type Address } from '@/features/auth/api';
import { getProduct, type Plan } from '@/features/catalog/api';
import { CouponSheet } from '@/features/coupons/CouponSheet';
import { getMyReview, upsertReview, type Review } from '@/features/orders/api';
import { CycleRail } from '@/features/subscriptions/CycleRail';
import { CancelFlowSheet, PauseSheet, QuantitySheet } from '@/features/subscriptions/RetentionSheets';
import {
  changeAddress,
  changePlan,
  cycleLabel,
  daysUntil,
  formatThaiDate,
  listMySubscriptions,
  monthCharges,
  type MonthCharge,
  previewSkip,
  reschedule,
  resume,
  shipNow,
  skipCycle,
  type SubscriptionCard,
} from '@/features/subscriptions/api';
import { addCycle, addDays, todayISO } from '@/lib/date';
import { colors, radius, space, statusTones, type } from '@/lib/theme';

type Confirm = {
  title: string;
  body: string;
  danger?: boolean;
  /** กล่องที่พูดถึงยอดเงิน — ต้องมีป้าย DEMO (กฎข้อ 1) */
  demo?: boolean;
  run: () => Promise<{ error: string | null }>;
};

/**
 * Feature 06 — the screen the whole product is judged on. Every action must be
 * reachable in two taps and must state its outcome before it happens (W05).
 */
export default function SubscriptionsScreen() {
  const [items, setItems] = useState<SubscriptionCard[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [addressFor, setAddressFor] = useState<SubscriptionCard | null>(null);
  const [planFor, setPlanFor] = useState<SubscriptionCard | null>(null);
  /** แผนอื่นของสินค้าชิ้นเดียวกัน — โหลดตอนเปิดกล่องเท่านั้น (W05 E1) */
  const [plans, setPlans] = useState<Plan[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  /** รีวิวของรายการที่กำลังเปิดกล่องอยู่ (feature 17) */
  const [reviewFor, setReviewFor] = useState<SubscriptionCard | null>(null);
  /** รายการที่กำลังเปิดกล่องเลือกคูปองอยู่ (feature 18) */
  const [couponFor, setCouponFor] = useState<SubscriptionCard | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [existingReview, setExistingReview] = useState<Review | null>(null);
  /** Phase 8.3 — กล่อง retention (feature 06 R1–R3) */
  const [cancelFor, setCancelFor] = useState<SubscriptionCard | null>(null);
  const [pauseFor, setPauseFor] = useState<SubscriptionCard | null>(null);
  const [qtyFor, setQtyFor] = useState<SubscriptionCard | null>(null);

  const reload = useCallback(async () => {
    const [mine, addr] = await Promise.all([listMySubscriptions(), listAddresses()]);
    setItems(mine.data);
    setAddresses(addr.data);
    setError(mine.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * เปิดกล่องเปลี่ยนรอบส่ง — ตัวเลือกต้องมีเฉพาะแผนที่ยังเปิดรับจริง
   * (W05 E1: "ไม่มีทางกดผิด") API ก็ปฏิเสธซ้ำอีกชั้นถ้าแผนเพิ่งถูกปิดไป
   */
  async function openPlanPicker(item: SubscriptionCard) {
    setPlanFor(item);
    setPlans([]);
    const product = await getProduct(item.productId);
    setPlans(product?.plans ?? []);
  }

  /**
   * เปิดกล่องรีวิว — โหลดรีวิวเดิมมาก่อนเสมอ
   *
   * รีวิวที่ 2 บนรายการเดิมคือ "การแก้ไข" ไม่ใช่รีวิวใหม่ (feature 17) กล่องจึงต้อง
   * ขึ้นค่าเดิมให้เห็น ไม่ใช่ฟอร์มว่างที่ทำให้ผู้ใช้นึกว่ากำลังเขียนรีวิวที่สอง
   */
  async function openReview(item: SubscriptionCard) {
    setReviewFor(item);
    setExistingReview(null);
    setRating(item.myRating ?? 5);
    setComment('');
    const { data } = await getMyReview(item.id);
    if (data != null) {
      setExistingReview(data);
      setRating(data.rating);
      setComment(data.comment ?? '');
    }
  }

  async function saveReview() {
    const target = reviewFor;
    if (target == null) return;
    setBusyId(target.id);
    setError(null);
    const { error: err } = await upsertReview(target.id, {
      rating,
      comment: comment.trim(),
    });
    setBusyId(null);
    if (err != null) {
      setError(err);
      return;
    }
    setReviewFor(null);
    setToast(existingReview != null ? 'แก้ไขรีวิวแล้ว' : 'ขอบคุณสำหรับรีวิว');
    await reload();
  }

  /**
   * กันกดซ้ำแบบ synchronous (security-rules C-9) — `busyId` เป็น state ซึ่งยังไม่
   * re-render ทันระหว่างคลิกรัวสองครั้ง · ปุ่มที่ตัดเงิน ("ส่งรอบนี้เลย") ผ่านตรงนี้
   * API กันซ้ำด้วย guard + UNIQUE อยู่แล้ว ตรงนี้แค่ไม่ให้ผู้ใช้เห็น 409 จากคลิกตัวเอง
   */
  const inFlight = useRef(false);

  async function run(id: string, action: () => Promise<{ error: string | null }>, okMessage: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyId(id);
    setError(null);
    const { error: err } = await action().finally(() => {
      inFlight.current = false;
    });
    setBusyId(null);
    setConfirm(null);
    setAddressFor(null);
    setPlanFor(null);
    setCancelFor(null);
    setPauseFor(null);
    setQtyFor(null);

    if (err != null) {
      // the DB is the authority: if it refuses, show why and re-sync.
      // set the message *after* reload — reload() ends with setError(mine.error),
      // so setting it first meant the reason flashed and vanished within a frame
      await reload();
      setError(err);
      return;
    }
    setToast(okMessage);
    await reload();
  }

  if (loading) return <Splash />;

  const active = items.filter((s) => s.status === 'active');
  const paused = items.filter((s) => s.status === 'paused');
  const cancelled = items.filter((s) => s.status === 'cancelled');
  const charges = monthCharges(items);
  const spend = charges.reduce((sum, c) => sum + c.amount, 0);

  return (
    <Screen>
      <Card>
        <SectionHeader title="รายการของฉัน" />
        <Text id="subs-spend" style={styles.spend}>
          เดือนนี้จ่ายรวม ฿{spend.toLocaleString('th-TH')}
          <Text style={styles.muted}>
            {charges.length > 0
              ? ` จาก ${charges.length} รอบ ใน ${new Set(charges.map((c) => c.subscriptionId)).size} รายการ`
              : ' — เดือนนี้ไม่มีรอบที่ต้องจ่าย'}
          </Text>
        </Text>
        <MonthSchedule charges={charges} />
        <DemoBadge />
      </Card>

      {error != null ? <ErrorNote id="subs-error" message={error} /> : null}
      {toast != null ? (
        <Pressable id="subs-toast" onPress={() => setToast(null)}>
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </Pressable>
      ) : null}

      {items.length === 0 ? (
        <Card>
          <EmptyState id="subs-empty" title="ยังไม่มีรายการ" body="เลือกสินค้าจากหน้าแรกแล้วสมัครรับตามรอบได้เลย" />
        </Card>
      ) : null}

      <Group
        id="subs-group-active"
        title={`กำลังใช้งาน (${active.length})`}
        items={active}
        busyId={busyId}
        addresses={addresses}
        onConfirm={setConfirm}
        onPickAddress={setAddressFor}
        onPickPlan={openPlanPicker}
        onReview={openReview}
        onPickCoupon={setCouponFor}
        onCancel={setCancelFor}
        onPause={setPauseFor}
        onQuantity={setQtyFor}
        onRun={run}
      />
      <Group
        id="subs-group-paused"
        title={`หยุดชั่วคราว (${paused.length})`}
        items={paused}
        busyId={busyId}
        addresses={addresses}
        onConfirm={setConfirm}
        onPickAddress={setAddressFor}
        onPickPlan={openPlanPicker}
        onReview={openReview}
        onPickCoupon={setCouponFor}
        onCancel={setCancelFor}
        onPause={setPauseFor}
        onQuantity={setQtyFor}
        onRun={run}
      />
      <Group
        id="subs-group-cancelled"
        title={`ยกเลิกแล้ว (${cancelled.length})`}
        items={cancelled}
        busyId={busyId}
        addresses={addresses}
        onConfirm={setConfirm}
        onPickAddress={setAddressFor}
        onPickPlan={openPlanPicker}
        onReview={openReview}
        onPickCoupon={setCouponFor}
        onCancel={setCancelFor}
        onPause={setPauseFor}
        onQuantity={setQtyFor}
        onRun={run}
      />

      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} busy={busyId != null} onRun={run} />

      <CancelFlowSheet
        item={cancelFor}
        busy={busyId != null}
        onClose={() => setCancelFor(null)}
        onRun={run}
        onOpenCoupons={(s) => {
          // ข้อเสนอ "ดูคูปอง" ปิดกล่องยกเลิกก่อน — สองกล่องซ้อนกันบนเว็บกดไม่ได้
          setCancelFor(null);
          setCouponFor(s);
        }}
      />
      <PauseSheet item={pauseFor} busy={busyId != null} onClose={() => setPauseFor(null)} onRun={run} />
      <QuantitySheet item={qtyFor} busy={busyId != null} onClose={() => setQtyFor(null)} onRun={run} />

      <Modal visible={addressFor != null} transparent animationType="fade" onRequestClose={() => setAddressFor(null)}>
        <View id="subs-address-modal" style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={type.h3}>เปลี่ยนที่อยู่จัดส่ง</Text>
            <Text style={styles.muted}>ออเดอร์ที่ส่งไปแล้วไม่เปลี่ยนตาม — ใช้ที่อยู่เดิมที่บันทึกไว้ในออเดอร์</Text>
            {addresses.map((a) => (
              <Pressable
                key={a.id}
                id={`subs-address-option-${a.id}`}
                accessibilityRole="button"
                // กดรัวสองครั้งต้องยิงคำสั่งเดียว — request ที่สองจะได้ 409 อยู่แล้ว
                // แต่ผู้ใช้จะเห็น error ทั้งที่ทำสำเร็จ ซึ่งอ่านแล้วสับสนกว่าไม่มีอะไรเกิด
                disabled={busyId != null}
                style={styles.addressRow}
                onPress={() => {
                  const target = addressFor;
                  if (target != null) {
                    void run(target.id, () => changeAddress(target.id, a.id), 'เปลี่ยนที่อยู่แล้ว');
                  }
                }}
              >
                <Text style={type.bodyStrong}>
                  {a.label != null && a.label !== '' ? a.label : 'ที่อยู่'} · {a.recipientName}
                </Text>
                <Text style={styles.muted}>
                  {a.addressLine} {a.province} {a.postcode}
                </Text>
              </Pressable>
            ))}
            <Button id="subs-address-close" label="ปิด" variant="ghost" onPress={() => setAddressFor(null)} />
          </View>
        </View>
      </Modal>

      <Modal visible={planFor != null} transparent animationType="fade" onRequestClose={() => setPlanFor(null)}>
        <View id="subs-plan-modal" style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={type.h3}>เปลี่ยนรอบส่ง</Text>
            <Text style={styles.muted}>
              รอบถัดไปยังเป็นวันเดิม — ความถี่และราคาใหม่จะเริ่มนับหลังจากรอบนั้น
            </Text>
            {plans.length === 0 ? (
              <Text id="subs-plan-empty" style={styles.muted}>
                ไม่มีรอบส่งอื่นให้เลือกสำหรับสินค้าชิ้นนี้
              </Text>
            ) : null}
            {plans.map((p) => {
              const current = planFor?.planId === p.id;
              return (
                <Pressable
                  key={p.id}
                  id={`subs-plan-option-${p.id}`}
                  accessibilityRole="button"
                  disabled={current || busyId != null}
                  style={[styles.addressRow, current && styles.planRowCurrent]}
                  onPress={() => {
                    const target = planFor;
                    if (target != null) {
                      void run(target.id, () => changePlan(target.id, p.id), 'เปลี่ยนรอบส่งแล้ว');
                    }
                  }}
                >
                  <Text style={type.bodyStrong}>
                    {cycleLabel(p.cycle)} · ฿{p.pricePerCycle.toLocaleString('th-TH')} / รอบ
                  </Text>
                  <Text style={styles.muted}>
                    {current ? 'รอบที่ใช้อยู่ตอนนี้' : `ครั้งละ ${p.qtyPerCycle} ชิ้น`}
                  </Text>
                </Pressable>
              );
            })}
            <Button id="subs-plan-close" label="ปิด" variant="ghost" onPress={() => setPlanFor(null)} />
          </View>
        </View>
      </Modal>

      {/* คูปองรายรอบ (feature 18 · W13) — กล่องดูแลสถานะของตัวเองทั้งหมด */}
      <CouponSheet
        subscriptionId={couponFor?.id ?? null}
        visible={couponFor != null}
        onClose={() => setCouponFor(null)}
        onChanged={() => void reload()}
      />

      <Modal visible={reviewFor != null} transparent animationType="fade" onRequestClose={() => setReviewFor(null)}>
        {/* กล่องนี้มีช่องพิมพ์ ต่างจากกล่องเลือกที่อยู่/แผน — บน iOS จอเล็กคีย์บอร์ด
            จะทับปุ่มบันทึกถ้าไม่ห่อ (บทเรียนเดียวกับกล่องเลขพัสดุใน testing.md §5.0) */}
        <KeyboardAvoidingView
          id="subs-review-modal"
          style={styles.backdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheet}>
            <Text style={type.h3}>{existingReview != null ? 'แก้ไขรีวิว' : 'ให้คะแนนสินค้านี้'}</Text>
            <Text style={styles.muted}>
              รีวิวจะแสดงคู่กับป้าย &quot;รับมาแล้ว {reviewFor?.cyclesReceived ?? 0} รอบ&quot; และชื่อของคุณจะถูกซ่อนบางส่วน
            </Text>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable
                  key={n}
                  id={`subs-review-star-${n}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${n} ดาว`}
                  onPress={() => setRating(n)}
                >
                  <Text style={[styles.star, n > rating && styles.starOff]}>★</Text>
                </Pressable>
              ))}
            </View>
            <TextField
              id="subs-review-comment"
              label="เล่าให้คนอื่นฟัง (ไม่บังคับ)"
              value={comment}
              onChangeText={setComment}
              placeholder="เช่น ใช้มา 4 รอบแล้ว คุณภาพคงที่ ส่งตรงเวลา"
              multiline
              maxLength={1000}
            />
            {existingReview != null ? (
              <Text id="subs-review-edited" style={styles.muted}>
                รีวิวเดิมของคุณ ★{existingReview.rating} · บันทึกตอน {formatThaiDate(existingReview.createdAt.slice(0, 10))}
              </Text>
            ) : null}
            <View style={styles.sheetActions}>
              <Button
                id="subs-review-submit"
                label="บันทึกรีวิว"
                loading={busyId != null}
                onPress={() => void saveReview()}
              />
              <Button id="subs-review-close" label="ปิด" variant="ghost" onPress={() => setReviewFor(null)} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

function Group({
  title,
  items,
  busyId,
  addresses,
  onConfirm,
  onPickAddress,
  onPickPlan,
  onReview,
  onPickCoupon,
  onCancel,
  onPause,
  onQuantity,
  onRun,
  id,
}: {
  title: string;
  items: SubscriptionCard[];
  busyId: string | null;
  addresses: Address[];
  onConfirm: (c: Confirm) => void;
  onPickAddress: (s: SubscriptionCard) => void;
  onPickPlan: (s: SubscriptionCard) => void;
  onReview: (s: SubscriptionCard) => void;
  onPickCoupon: (s: SubscriptionCard) => void;
  onCancel: (s: SubscriptionCard) => void;
  onPause: (s: SubscriptionCard) => void;
  onQuantity: (s: SubscriptionCard) => void;
  onRun: (id: string, action: () => Promise<{ error: string | null }>, ok: string) => Promise<void>;
  id?: string;
}) {
  if (items.length === 0) return null;

  return (
    // `plain` = กลุ่มเป็นแค่หัวข้อกับรายการ ไม่ใช่กล่องขาวอีกใบซ้อนบนการ์ดของแต่ละ
    // รายการ · `id` ยังอยู่บน element เดิมและยังเป็นพ่อของ `#subs-item-*`
    // ตาม descendant selector ที่ e2e ใช้ (subscriptions.spec.ts:81-82)
    <Card id={id} variant="plain">
      <SectionHeader title={title} />
      {items.map((item) => (
        <SubscriptionItem
          key={item.id}
          item={item}
          busy={busyId === item.id}
          hasAddresses={addresses.length > 0}
          onConfirm={onConfirm}
          onPickAddress={onPickAddress}
          onPickPlan={onPickPlan}
          onReview={onReview}
          onPickCoupon={onPickCoupon}
          onCancel={onCancel}
          onPause={onPause}
          onQuantity={onQuantity}
          onRun={onRun}
        />
      ))}
    </Card>
  );
}

function SubscriptionItem({
  item,
  busy,
  hasAddresses,
  onConfirm,
  onPickAddress,
  onPickPlan,
  onReview,
  onPickCoupon,
  onCancel,
  onPause,
  onQuantity,
  onRun,
}: {
  item: SubscriptionCard;
  busy: boolean;
  hasAddresses: boolean;
  onConfirm: (c: Confirm) => void;
  onPickAddress: (s: SubscriptionCard) => void;
  onPickPlan: (s: SubscriptionCard) => void;
  onReview: (s: SubscriptionCard) => void;
  onPickCoupon: (s: SubscriptionCard) => void;
  onCancel: (s: SubscriptionCard) => void;
  onPause: (s: SubscriptionCard) => void;
  onQuantity: (s: SubscriptionCard) => void;
  onRun: (id: string, action: () => Promise<{ error: string | null }>, ok: string) => Promise<void>;
}) {
  const days = daysUntil(item.nextOrderDate);
  const frozen = item.pausedReason === 'shop_suspended';
  const total = item.pricePerCycle * item.quantity;

  return (
    <View id={`subs-item-${item.id}`} style={styles.item}>
      <View style={styles.itemHead}>
        <Text style={styles.itemTitle} numberOfLines={1}>
          {item.productName}
        </Text>
        {item.status === 'active' ? (
          <Pill id={`subs-status-${item.id}`} label="กำลังใช้งาน" tone="active" />
        ) : item.status === 'paused' ? (
          <Pill
            id={`subs-status-${item.id}`}
            label={frozen ? 'ร้านถูกระงับ' : 'หยุดชั่วคราว'}
            tone={frozen ? 'frozen' : 'paused'}
          />
        ) : (
          <Pill id={`subs-status-${item.id}`} label="ยกเลิกแล้ว" tone="cancelled" />
        )}
      </View>

      <Text style={styles.muted}>
        {item.shopName} · {cycleLabel(item.cycle)}
        {item.quantity > 1 ? ` · ${item.quantity} ชิ้น/รอบ` : ''}
      </Text>

      <View style={styles.itemFoot}>
        <Text style={styles.price}>
          ฿{total.toLocaleString('th-TH')}
          <Text style={styles.muted}> / รอบ</Text>
        </Text>
        {/*
          "อีกกี่วันของจะมา" คือสิ่งเดียวที่ marketplace ซื้อครั้งเดียวให้ไม่ได้
          ของเดิมเป็น caption 12px สีเทา — เล็กกว่าราคาที่อยู่ข้าง ๆ ทั้งที่
          สำคัญกว่า · กฎ 3 วันมีอยู่ในโค้ดเดิมแล้ว (`days <= 3 && nextSoon`)
          ตรงนี้แค่ขยายกฎเดิมให้มองเห็น ไม่ใช่กฎใหม่
        */}
        {item.status === 'active' && days != null ? (
          <Text style={[styles.next, { color: timeColor(days) }]}>
            {days <= 0 ? 'ส่งรอบนี้วันนี้' : `อีก ${days} วัน`}
          </Text>
        ) : frozen ? (
          <Text style={styles.frozenNote}>ไม่มีการตัดเงินจนกว่าร้านจะกลับมา</Text>
        ) : item.status === 'paused' && item.resumeOn != null ? (
          <Text id={`subs-resume-on-${item.id}`} style={styles.muted}>
            กลับมาส่ง {formatThaiDate(item.resumeOn)}
          </Text>
        ) : null}
      </View>

      {/*
        คูปองที่จองไว้กับรอบถัดไป (feature 18) — ต้องอยู่ติดกับยอด เพราะเป็น
        ตัวเลขที่จะถูกตัดจริง ไม่ใช่ราคาป้ายด้านบน
      */}
      {item.status === 'active' && item.coupons.length > 0 ? (
        <View id={`subs-coupon-line-${item.id}`} style={styles.couponLine}>
          <Text style={styles.couponText}>
            {`คูปอง ${item.coupons.map((c) => c.code).join(' + ')} · รอบนี้ลด ฿${item.couponDiscount.toLocaleString('th-TH')} → ตัดเงินจำลอง ฿${item.couponNetAmount.toLocaleString('th-TH')}`}
          </Text>
        </View>
      ) : null}

      <CycleRail cycle={item.cycle} nextOrderDate={item.nextOrderDate} status={item.status} />

      {item.status === 'active' ? (
        <View style={styles.actions}>
          <Action
            id={`subs-action-skip-${item.id}`}
            label="ข้ามรอบ"
            tone="primary"
            disabled={busy}
            onPress={() =>
              onConfirm({
                title: 'ข้ามรอบถัดไป',
                body: previewSkip(item),
                run: () => skipCycle(item.id),
              })
            }
          />
          <Action
            id={`subs-action-coupon-${item.id}`}
            label={
              item.coupons.length > 0
                ? `คูปอง ${item.coupons.length} ใบ`
                : 'ใช้คูปอง'
            }
            disabled={busy}
            onPress={() => onPickCoupon(item)}
          />
          <Action
            id={`subs-action-reschedule-${item.id}`}
            label="เลื่อน 7 วัน"
            disabled={busy}
            onPress={() => {
              if (item.nextOrderDate == null) return;
              const iso = addDays(item.nextOrderDate, 7);
              onConfirm({
                title: 'เลื่อนวันส่ง',
                body: `เลื่อนจาก ${formatThaiDate(item.nextOrderDate)} เป็น ${formatThaiDate(iso)}`,
                run: () => reschedule(item.id, iso),
              });
            }}
          />
          <Action
            id={`subs-action-pause-${item.id}`}
            label="หยุดชั่วคราว"
            disabled={busy}
            onPress={() => onPause(item)}
          />
          <Action
            id={`subs-action-ship-now-${item.id}`}
            label="ส่งรอบนี้เลย"
            disabled={busy}
            onPress={() => {
              const total = item.pricePerCycle * item.quantity;
              const next = addCycle(todayISO(), item.cycle);
              onConfirm({
                title: 'ส่งรอบนี้เลย',
                body:
                  `สร้างออเดอร์และตัดเงินจำลอง ฿${total.toLocaleString('th-TH')} วันนี้ — รอบถัดไปจะเป็น ${formatThaiDate(next)}` +
                  (item.coupons.length > 0 ? ' · คูปองที่จองไว้กับรอบเดิมจะถูกคืน' : ''),
                demo: true,
                run: () => shipNow(item.id),
              });
            }}
          />
          <Action
            id={`subs-action-quantity-${item.id}`}
            label="เปลี่ยนจำนวน"
            tone="quiet"
            disabled={busy}
            onPress={() => onQuantity(item)}
          />
          <Action
            id={`subs-action-plan-${item.id}`}
            label="เปลี่ยนรอบส่ง"
            tone="quiet"
            disabled={busy}
            onPress={() => onPickPlan(item)}
          />
          {hasAddresses ? (
            <Action
              id={`subs-action-address-${item.id}`}
              label="เปลี่ยนที่อยู่"
              tone="quiet"
              disabled={busy}
              onPress={() => onPickAddress(item)}
            />
          ) : null}
          <Action
            id={`subs-action-cancel-${item.id}`}
            label="ยกเลิก"
            tone="danger"
            disabled={busy}
            onPress={() => onCancel(item)}
          />
        </View>
      ) : item.status === 'paused' ? (
        <View style={styles.actions}>
          {frozen ? (
            <Text id={`subs-frozen-note-${item.id}`} style={styles.muted}>
              ระบบจะกลับมาส่งให้อัตโนมัติเมื่อร้านเปิดอีกครั้ง
            </Text>
          ) : (
            <Action
              id={`subs-action-resume-${item.id}`}
              label="กลับมาใช้งาน"
              tone="primary"
              disabled={busy}
              onPress={() => void onRun(item.id, () => resume(item.id), 'กลับมาใช้งานแล้ว')}
            />
          )}
          {hasAddresses ? (
            <Action
              id={`subs-action-address-${item.id}`}
              label="เปลี่ยนที่อยู่"
              tone="quiet"
              disabled={busy}
              onPress={() => onPickAddress(item)}
            />
          ) : null}
          {frozen ? null : (
            <Action
              id={`subs-action-quantity-${item.id}`}
              label="เปลี่ยนจำนวน"
              tone="quiet"
              disabled={busy}
              onPress={() => onQuantity(item)}
            />
          )}
          <Action
            id={`subs-action-cancel-${item.id}`}
            label="ยกเลิก"
            tone="danger"
            disabled={busy}
            onPress={() => onCancel(item)}
          />
        </View>
      ) : null}

      {/* รีวิว (feature 17) — ยกเลิกไปแล้วก็ยังรีวิวได้ คนกลุ่มนี้มีข้อมูลจริงที่สุด */}
      <View style={styles.reviewRow}>
        {item.cyclesReceived === 0 ? (
          <Text id={`subs-review-locked-${item.id}`} style={styles.muted}>
            รีวิวได้หลังได้รับสินค้ารอบแรก
          </Text>
        ) : (
          <>
            <Action
              id={`subs-action-review-${item.id}`}
              label={item.myRating == null ? 'ให้คะแนนสินค้านี้' : `แก้รีวิว ★${item.myRating}`}
              tone="quiet"
              disabled={busy}
              onPress={() => onReview(item)}
            />
            <Text id={`subs-review-cycles-${item.id}`} style={styles.muted}>
              รับมาแล้ว {item.cyclesReceived} รอบ
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

/**
 * ปุ่มของรายการ — 4 ระดับน้ำหนัก แต่ **DOM เหมือนเดิมทุกประการ**
 *
 * ของเดิมทั้ง 6 ปุ่มใช้สไตล์เดียวกันหมด ต่างแค่ปุ่มยกเลิกที่มี tint ชมพูจาง ๆ
 * ผลคือไม่มีปุ่มไหนเป็นตัวเลือกหลัก ผู้ใช้ต้องอ่านครบทั้ง 6 ทุกครั้ง (เกินขีด
 * working memory ที่ ~4) และปุ่มทำลายอยู่แถวเดียวกับปุ่มที่ใช้บ่อยที่สุด
 *
 * ทางที่ไม่เลือก: ยุบปุ่มรองเข้าเมนู "⋯" — จะทำให้ `#subs-action-plan/address/cancel`
 * หายจาก DOM จนกว่าเมนูจะกาง ซึ่ง e2e เรียกตรงทั้ง 8 ตัว · การจัดน้ำหนักด้วย
 * style ล้วนได้ผลเกือบเท่ากันโดยไม่ต้องแตะ spec สักไฟล์
 */
type ActionTone = 'primary' | 'outline' | 'quiet' | 'danger';

function Action({
  label,
  onPress,
  disabled,
  tone = 'outline',
  id,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  tone?: ActionTone;
  id?: string;
}) {
  return (
    <Pressable
      id={id}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.action,
        actionSurface[tone],
        pressed && actionPressed[tone],
        disabled && styles.actionDisabled,
      ]}
    >
      <Text style={[styles.actionText, actionLabel[tone]]}>{label}</Text>
    </Pressable>
  );
}

function ConfirmDialog({
  confirm,
  onClose,
  busy,
  onRun,
}: {
  confirm: Confirm | null;
  onClose: () => void;
  busy: boolean;
  onRun: (id: string, action: () => Promise<{ error: string | null }>, ok: string) => Promise<void>;
}) {
  return (
    <Modal visible={confirm != null} transparent animationType="fade" onRequestClose={onClose}>
      <View id="subs-confirm" style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text id="subs-confirm-title" style={type.h3}>
            {confirm?.title ?? ''}
          </Text>
          <Text id="subs-confirm-body" style={type.body}>
            {confirm?.body ?? ''}
          </Text>
          {confirm?.demo === true ? <DemoBadge /> : null}
          <View style={styles.sheetActions}>
            <Button
              id="subs-confirm-ok"
              label="ยืนยัน"
              variant={confirm?.danger === true ? 'danger' : 'primary'}
              loading={busy}
              onPress={() => {
                if (confirm != null) void onRun('confirm', confirm.run, `${confirm.title}แล้ว`);
              }}
            />
            <Button id="subs-confirm-close" label="ปิด" variant="ghost" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * ปฏิทินการตัดเงินของเดือนนี้ — "จ่ายไรวันไหน"
 *
 * การ์ดสรุปบอกยอดรวมได้ก็จริง แต่ยอดรวมอย่างเดียวตอบไม่ได้ว่าเงินก้อนนี้จะออกวันไหน
 * ซึ่งเป็นสิ่งที่ต้องรู้เพื่อวางแผน · รายการนี้จึงเรียงตามวันจริงที่ engine จะสร้างออเดอร์
 * ไม่ใช่เรียงตามรายการ subscription
 */
function MonthSchedule({ charges }: { charges: MonthCharge[] }) {
  if (charges.length === 0) return null;

  return (
    <View id="subs-schedule" style={styles.schedule}>
      {charges.map((c, i) => (
        <View
          key={`${c.subscriptionId}-${c.date}`}
          id={`subs-schedule-row-${c.subscriptionId}-${c.date}`}
          style={[styles.scheduleRow, i > 0 && styles.scheduleRowDivided]}
        >
          <Text style={styles.scheduleDate}>{formatThaiDate(c.date)}</Text>
          <View style={styles.scheduleMain}>
            <Text style={styles.scheduleName} numberOfLines={1}>
              {c.productName}
            </Text>
            <Text style={styles.scheduleMeta} numberOfLines={1}>
              {c.shopName}
              {c.overdue ? ' · ค้างจากรอบก่อน จะตัดเมื่อระบบรันรอบถัดไป' : ''}
              {c.hasCoupon ? ` · คูปองลด ฿${(c.grossAmount - c.amount).toLocaleString('th-TH')}` : ''}
            </Text>
          </View>
          <Text style={styles.scheduleAmount}>฿{c.amount.toLocaleString('th-TH')}</Text>
        </View>
      ))}
    </View>
  );
}

/** สีของการนับถอยหลัง — สงวนไว้ให้เวลาเท่านั้น (ดู theme.ts) */
function timeColor(days: number): string {
  if (days <= 3) return colors.timeUrgent;
  if (days <= 7) return colors.timeSoon;
  return colors.timeCalm;
}

const styles = StyleSheet.create({
  spend: { ...type.h3, color: colors.text },
  schedule: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
  },
  scheduleRowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  // วันอยู่ซ้ายสุดและกว้างคงที่ เพื่อให้ทั้งคอลัมน์อ่านเป็น "ปฏิทิน" ได้ในสายตาเดียว
  scheduleDate: { ...type.caption, color: colors.textMuted, width: 88 },
  scheduleMain: { flex: 1, gap: 2 },
  scheduleName: { ...type.small, color: colors.text },
  scheduleMeta: { ...type.caption, color: colors.textMuted },
  scheduleAmount: { ...type.bodyStrong, color: colors.text },
  muted: { ...type.caption, color: colors.textMuted },
  toast: { backgroundColor: statusTones.active.bg, borderRadius: radius.md, padding: space.md },
  toastText: { ...type.small, color: statusTones.active.fg },
  // กลุ่มเป็น `plain` แล้ว รายการจึงต้องเป็นพื้นผิวขาวมีขอบเอง ไม่ใช่แถบเทา
  // บนกล่องขาว (ซึ่งเดิมทำให้เกิดสามชั้น: Card → item → action)
  item: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: 6,
  },
  itemHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  itemTitle: { ...type.bodyStrong, flexShrink: 1 },
  itemFoot: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  price: { ...type.price, color: colors.text },
  // ตัวเลขวันใหญ่กว่าราคาที่อยู่ข้าง ๆ — ANAN ขายเวลา ไม่ใช่ราคา
  next: { ...type.h4 },
  frozenNote: { ...type.caption, color: colors.statusFrozen },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  action: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  actionDisabled: { opacity: 0.5 },
  actionText: { ...type.caption },
  couponLine: {
    backgroundColor: statusTones.active.bg,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  couponText: { ...type.caption, color: statusTones.active.fg },
  backdrop: { flex: 1, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: space.xl,
    gap: space.md,
    width: '100%',
    maxWidth: 420,
  },
  sheetActions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  addressRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.md,
    gap: 2,
  },
  planRowCurrent: { backgroundColor: colors.surfaceAlt, opacity: 0.7 },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.sm,
  },
  // ตัวอักษรสูง 34 แต่พื้นที่แตะต้องไม่ต่ำกว่า 44 (เกณฑ์เดียวกับปุ่มอื่นทั้งแอป)
  star: { fontSize: 28, lineHeight: 34, color: colors.rating, paddingHorizontal: 6, paddingVertical: 5 },
  starOff: { color: colors.border },
  stars: { flexDirection: 'row', gap: space.xs },
});

/* ปุ่ม 4 ระดับ — เรียงจากหนักไปเบา ให้สายตาเจอ "ข้ามรอบ" ก่อนเสมอ
   และปุ่มยกเลิกไม่แข่งน้ำหนักกับปุ่มที่ใช้ทุกวัน */
const actionSurface: Record<ActionTone, ViewStyle> = {
  primary: { backgroundColor: colors.primary, borderColor: colors.primary },
  outline: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
  quiet: { paddingHorizontal: space.sm },
  danger: { paddingHorizontal: space.sm },
};

const actionPressed: Record<ActionTone, ViewStyle> = {
  primary: { backgroundColor: colors.primaryStrong },
  outline: { backgroundColor: colors.surfaceAlt },
  quiet: { backgroundColor: colors.primarySoft },
  danger: { backgroundColor: colors.dangerSoft },
};

const actionLabel: Record<ActionTone, TextStyle> = {
  primary: { color: colors.onPrimary, fontFamily: type.bodyStrong.fontFamily },
  outline: { color: colors.text },
  quiet: { color: colors.primaryStrong },
  danger: { color: colors.danger },
};
