/**
 * Phase 8.3 — retention (feature 06 R1–R3)
 *
 * กล่อง 3 ใบของหน้า "ของฉัน": ยกเลิกแบบบอกเหตุผล · หยุดพัก N รอบ · เปลี่ยนจำนวน
 *
 * ★ ที่นี่ไม่มีกฎ ★ ทุกการตัดสินใจ (สถานะไหนทำได้ · วันกลับมาคือวันไหน · ยอดเท่าไหร่)
 * อยู่ที่ API · ฝั่งนี้คำนวณแค่ preview ด้วยสูตรเดียวกับ API เพื่อบอกผู้ใช้ก่อนกด
 */

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { DemoBadge } from '@/components/ui';
import { getProduct, type Plan } from '@/features/catalog/api';
import {
  cancel,
  changePlan,
  changeQuantity,
  cycleLabel,
  formatThaiDate,
  pause,
  resumeDateAfter,
  skipCycle,
  skipTargetDate,
  type CancelReason,
  type SubscriptionCard,
} from '@/features/subscriptions/api';
import { colors, radius, space, type } from '@/lib/theme';

type RunAction = (id: string, action: () => Promise<{ error: string | null }>, ok: string) => Promise<void>;

/* ====================================================================== */
/* R1 — ยกเลิกแบบบอกเหตุผล                                                */
/* ====================================================================== */

/** ลำดับเดียวกับที่แสดง — เหตุผลที่มีข้อเสนอขึ้นก่อน */
const REASONS: { value: CancelReason; label: string }[] = [
  { value: 'taking_break', label: 'ขอพักก่อน / ไม่อยู่บ้านช่วงนี้' },
  { value: 'too_much_stock', label: 'ของเหลือ ใช้ไม่ทัน' },
  { value: 'too_expensive', label: 'ราคาสูงไป' },
  { value: 'quality', label: 'ไม่พอใจสินค้า' },
  { value: 'switching', label: 'เปลี่ยนไปใช้ที่อื่น' },
  { value: 'other', label: 'อื่น ๆ' },
];

/** รอบที่ห่างกว่า — ใช้หาข้อเสนอให้คนที่ "ของเหลือ" */
const CYCLE_ORDER: Record<string, number> = { '2w': 0, '1m': 1, '2m': 2 };

type Offer = {
  text: string;
  label: string;
  /** ข้อความมียอดเงิน → ต้องมีป้าย DEMO (กฎข้อ 1) */
  showsPrice?: boolean;
  /** ข้อเสนอที่เป็น action ของ API ส่ง `source: 'cancel_flow'` ไปด้วยเสมอ */
  run: () => void;
};

/**
 * ★ ปุ่มยืนยันยกเลิกอยู่ในกล่องเดียวกับข้อเสนอเสมอ ★
 *
 * ข้อเสนอเป็นทางเลือก ไม่ใช่ด่าน — การซ่อนปุ่มยกเลิกหรือบังคับให้ผ่านหลายหน้า
 * เป็น dark pattern ที่ทำลายความเชื่อใจ (ซึ่งคือสิ่งที่ subscription ขายจริง ๆ)
 * ข้อเสนอขึ้นเฉพาะรายการที่ยัง active เพราะทุกตัวเป็น action ของรายการ active
 */
type SheetProps = {
  item: SubscriptionCard | null;
  busy: boolean;
  onClose: () => void;
  onRun: RunAction;
};

/**
 * เนื้อในของกล่องถูก mount ใหม่ต่อรายการด้วย `key` — state (เหตุผลที่เลือก ·
 * จำนวน) จึงเริ่มใหม่ทุกครั้งที่เปิดกับรายการอื่น โดยไม่ต้อง reset ใน effect
 */
export function CancelFlowSheet(props: SheetProps & { onOpenCoupons: (item: SubscriptionCard) => void }) {
  return (
    <Modal visible={props.item != null} transparent animationType="fade" onRequestClose={props.onClose}>
      {props.item != null ? <CancelFlowBody key={props.item.id} {...props} item={props.item} /> : null}
    </Modal>
  );
}

function CancelFlowBody({
  item,
  busy,
  onClose,
  onRun,
  onOpenCoupons,
}: SheetProps & {
  item: SubscriptionCard;
  onOpenCoupons: (item: SubscriptionCard) => void;
}) {
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [note, setNote] = useState('');
  /** แผนอื่นของสินค้าชิ้นเดิม — ใช้หาข้อเสนอ "ส่งห่างขึ้น" */
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    if (item.status !== 'active') return;
    let live = true;
    void getProduct(item.productId).then((p) => {
      if (live) setPlans(p?.plans ?? []);
    });
    return () => {
      live = false;
    };
  }, [item.productId, item.status]);

  const offer = reason != null ? offerFor(item, reason, plans, onRun, onOpenCoupons) : null;

  return (
    <>
      <KeyboardAvoidingView
        id="subs-cancel-modal"
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <Text style={type.h3}>ทำไมถึงอยากยกเลิก?</Text>
          <Text style={styles.muted}>คำตอบช่วยให้ร้านปรับปรุง — ร้านเห็นแค่หมวดเหตุผล ไม่เห็นข้อความที่คุณพิมพ์</Text>

          <View style={styles.options}>
            {REASONS.map((r) => {
              const selected = reason === r.value;
              return (
                <Pressable
                  key={r.value}
                  id={`subs-cancel-reason-${r.value}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setReason(r.value)}
                  style={[styles.option, selected && styles.optionSelected]}
                >
                  <View style={[styles.radio, selected && styles.radioOn]} />
                  <Text style={[type.small, styles.optionText]}>{r.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {offer != null ? (
            <View id="subs-cancel-offer" style={styles.offer}>
              <Text id="subs-cancel-offer-text" style={styles.offerText}>
                {offer.text}
              </Text>
              {offer.showsPrice === true ? <DemoBadge /> : null}
              <Button
                id="subs-cancel-offer-accept"
                label={offer.label}
                variant="secondary"
                disabled={busy}
                onPress={offer.run}
              />
            </View>
          ) : null}

          {reason != null ? (
            <TextField
              id="subs-cancel-note"
              label="เล่าเพิ่มเติม (ไม่บังคับ)"
              value={note}
              onChangeText={setNote}
              maxLength={200}
              multiline
            />
          ) : null}

          <Text style={styles.muted}>ยกเลิกถาวร — สมัครใหม่ได้ภายหลัง ออเดอร์ที่ค้างส่งอยู่จะส่งจนจบ</Text>
          <View style={styles.actions}>
            <Button
              id="subs-cancel-confirm"
              label="ยืนยันยกเลิก"
              variant="danger"
              disabled={reason == null}
              loading={busy}
              onPress={() => {
                if (reason == null) return;
                void onRun(item.id, () => cancel(item.id, reason, note), 'ยกเลิกการสมัครแล้ว');
              }}
            />
            <Button id="subs-cancel-close" label="ไม่ยกเลิกแล้ว" variant="ghost" onPress={onClose} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

/**
 * จับคู่เหตุผล → ทางเลือก (แนวปฏิบัติที่ระบบ subscription ใช้กัน: ข้อเสนอที่ตรง
 * กับเหตุผลได้ผลกว่าข้อเสนอเดียวกันทุกคน) · เหตุผลที่ไม่มีทางเลือกจริง เช่น
 * "ไม่พอใจสินค้า" ไม่ต้องเสนออะไร — ยื้อคนที่ไม่ชอบของไว้มีแต่จะได้รีวิวแย่
 */
function offerFor(
  item: SubscriptionCard,
  reason: CancelReason,
  plans: Plan[],
  onRun: RunAction,
  onOpenCoupons: (item: SubscriptionCard) => void,
): Offer | null {
  if (item.status !== 'active') return null;

  if (reason === 'taking_break') {
    const back = resumeDateAfter(item, 1);
    if (back == null) return null;
    return {
      text: `หยุดพัก 1 รอบแทนไหม? ไม่มีการตัดเงินระหว่างนี้ และกลับมาส่งเองวันที่ ${formatThaiDate(back)}`,
      label: 'หยุดพัก 1 รอบ',
      run: () =>
        void onRun(item.id, () => pause(item.id, { cycles: 1, source: 'cancel_flow' }), 'หยุดพัก 1 รอบแล้ว'),
    };
  }

  if (reason === 'too_much_stock') {
    const current = CYCLE_ORDER[item.cycle] ?? 1;
    const longer = plans
      .filter((p) => (CYCLE_ORDER[p.cycle] ?? -1) > current)
      .sort((a, b) => (CYCLE_ORDER[a.cycle] ?? 0) - (CYCLE_ORDER[b.cycle] ?? 0))[0];
    if (longer != null) {
      return {
        text: `เปลี่ยนเป็นส่ง${cycleLabel(longer.cycle)}แทนไหม? ฿${longer.pricePerCycle.toLocaleString('th-TH')} / รอบ`,
        label: `ส่ง${cycleLabel(longer.cycle)}`,
        showsPrice: true,
        run: () => void onRun(item.id, () => changePlan(item.id, longer.id, 'cancel_flow'), 'เปลี่ยนรอบส่งแล้ว'),
      };
    }
    const to = skipTargetDate(item);
    if (to == null) return null;
    return {
      text: `ข้ามรอบถัดไปแทนไหม? รอบถัดไปจะเป็น ${formatThaiDate(to)}`,
      label: 'ข้ามรอบถัดไป',
      run: () => void onRun(item.id, () => skipCycle(item.id, 'cancel_flow'), 'ข้ามรอบแล้ว'),
    };
  }

  if (reason === 'too_expensive') {
    return {
      text: 'ลองดูคูปองที่ใช้กับรอบถัดไปได้ก่อนไหม?',
      label: 'ดูคูปอง',
      run: () => onOpenCoupons(item),
    };
  }

  return null;
}

/* ====================================================================== */
/* R2 — หยุดพัก N รอบ                                                    */
/* ====================================================================== */

type PauseChoice = 1 | 2 | 3 | 'open';

export function PauseSheet(props: SheetProps) {
  return (
    <Modal visible={props.item != null} transparent animationType="fade" onRequestClose={props.onClose}>
      {props.item != null ? <PauseBody key={props.item.id} {...props} item={props.item} /> : null}
    </Modal>
  );
}

function PauseBody({ item, busy, onClose, onRun }: SheetProps & { item: SubscriptionCard }) {
  const [choice, setChoice] = useState<PauseChoice>(1);

  const options: { value: PauseChoice; label: string; hint: string }[] = [
    ...([1, 2, 3] as const).map((n) => {
      const back = resumeDateAfter(item, n);
      return {
        value: n,
        label: `หยุด ${n} รอบ`,
        hint: back == null ? '' : `กลับมาส่งเองวันที่ ${formatThaiDate(back)}`,
      };
    }),
    { value: 'open', label: 'ไม่กำหนด', hint: 'หยุดจนกว่าคุณจะกดกลับมาใช้งานเอง' },
  ];

  return (
    <>
      <View id="subs-pause-modal" style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={type.h3}>หยุดชั่วคราว</Text>
          <Text style={styles.muted}>
            ระหว่างหยุดไม่มีการสร้างออเดอร์และไม่ตัดเงิน · ระบบจะเปิดรายการให้ล่วงหน้า 3 วัน เพื่อแจ้งเตือนก่อนตัดเงินและยังข้ามรอบได้
          </Text>
          <View style={styles.options}>
            {options.map((o) => {
              const selected = choice === o.value;
              return (
                <Pressable
                  key={String(o.value)}
                  id={`subs-pause-option-${o.value}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setChoice(o.value)}
                  style={[styles.option, selected && styles.optionSelected]}
                >
                  <View style={[styles.radio, selected && styles.radioOn]} />
                  <View style={styles.optionBody}>
                    <Text style={type.bodyStrong}>{o.label}</Text>
                    <Text style={styles.muted}>{o.hint}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.actions}>
            <Button
              id="subs-pause-confirm"
              label="ยืนยันหยุด"
              loading={busy}
              onPress={() => {
                const cycles = choice === 'open' ? undefined : choice;
                void onRun(
                  item.id,
                  () => pause(item.id, { cycles }),
                  cycles == null ? 'หยุดชั่วคราวแล้ว' : `หยุดพัก ${cycles} รอบแล้ว`,
                );
              }}
            />
            <Button id="subs-pause-close" label="ปิด" variant="ghost" onPress={onClose} />
          </View>
        </View>
      </View>
    </>
  );
}

/* ====================================================================== */
/* R3 — เปลี่ยนจำนวนต่อรอบ                                               */
/* ====================================================================== */

/** เพดานเดียวกับตอนสมัคร (DTO + CHECK `subs_quantity_range`) */
const MAX_QTY = 10;

export function QuantitySheet(props: SheetProps) {
  return (
    <Modal visible={props.item != null} transparent animationType="fade" onRequestClose={props.onClose}>
      {props.item != null ? <QuantityBody key={props.item.id} {...props} item={props.item} /> : null}
    </Modal>
  );
}

function QuantityBody({ item, busy, onClose, onRun }: SheetProps & { item: SubscriptionCard }) {
  const [qty, setQty] = useState(item.quantity);
  const total = item.pricePerCycle * qty;

  return (
    <>
      <View id="subs-qty-modal" style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={type.h3}>จำนวนต่อรอบ</Text>
          <Text style={styles.muted}>มีผลกับออเดอร์ถัดไป — รอบที่สร้างไปแล้วไม่เปลี่ยนตาม</Text>
          <View style={styles.stepper}>
            <Pressable
              id="subs-qty-minus"
              accessibilityRole="button"
              accessibilityLabel="ลดจำนวน"
              disabled={qty <= 1}
              onPress={() => setQty((q) => Math.max(1, q - 1))}
              style={[styles.stepBtn, qty <= 1 && styles.stepBtnOff]}
            >
              <Text style={type.h3}>−</Text>
            </Pressable>
            <Text id="subs-qty-value" style={[type.h2, styles.stepValue]}>
              {qty}
            </Text>
            <Pressable
              id="subs-qty-plus"
              accessibilityRole="button"
              accessibilityLabel="เพิ่มจำนวน"
              disabled={qty >= MAX_QTY}
              onPress={() => setQty((q) => Math.min(MAX_QTY, q + 1))}
              style={[styles.stepBtn, qty >= MAX_QTY && styles.stepBtnOff]}
            >
              <Text style={type.h3}>+</Text>
            </Pressable>
          </View>
          <Text id="subs-qty-total" style={type.bodyStrong}>
            ฿{total.toLocaleString('th-TH')} / รอบ
          </Text>
          <DemoBadge />
          <View style={styles.actions}>
            <Button
              id="subs-qty-save"
              label="บันทึก"
              disabled={qty === item.quantity}
              loading={busy}
              onPress={() => {
                void onRun(item.id, () => changeQuantity(item.id, qty), `เปลี่ยนเป็น ${qty} ชิ้นต่อรอบแล้ว`);
              }}
            />
            <Button id="subs-qty-close" label="ปิด" variant="ghost" onPress={onClose} />
          </View>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
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
    maxWidth: 440,
  },
  muted: { ...type.caption, color: colors.textMuted },
  options: { gap: space.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    minHeight: 48,
    paddingVertical: space.sm,
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  optionText: { color: colors.text, flexShrink: 1 },
  optionBody: { flex: 1, gap: 2 },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  radioOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  offer: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  offerText: { ...type.small, color: colors.text },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.xs,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    alignSelf: 'center',
  },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOff: { opacity: 0.4 },
  stepValue: { minWidth: 40, textAlign: 'center' },
});
