import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { DemoBadge, ErrorNote } from '@/components/ui';
import { formatThaiDate, formatThaiDay } from '@/lib/date';
import { colors, radius, space, statusTones, type } from '@/lib/theme';

import {
  applyCoupon,
  getSubscriptionCoupons,
  removeCoupon,
  TIER_LABEL,
  type CouponTier,
  type CouponTierView,
  type SubscriptionCoupons,
} from './api';

const TIERS: CouponTier[] = ['platform', 'shop'];

/**
 * เลือกคูปองให้ "รอบใดรอบหนึ่ง" ของ subscription (feature 18 · W13 Flow C)
 *
 * ★ สองอย่างที่ต่างจากคูปองของ e-commerce ★
 *   1. ผู้ซื้อไม่ได้ใช้คูปองตอนนี้ — กำลัง **จอง** ไว้กับรอบที่จะถูกตัดเงินอัตโนมัติ
 *      หัวกล่องจึงบอกวันรอบเสมอ
 *   2. **ซ้อนได้ 2 ระดับ** (แพลตฟอร์ม + ร้าน) กล่องจึงแบ่งเป็น 2 ช่องชัดเจน
 *      ช่องละ 1 ใบ — ไม่ใช่รายการเดียวยาว ๆ ที่ผู้ซื้อต้องเดาเองว่าเลือกซ้อนได้ไหม
 *
 * ทุกยอดบนกล่องนี้มาจาก API — ฝั่งนี้ไม่คำนวณหรือบวกส่วนลดเองแม้แต่ตัวเดียว
 * (กฎการหนีบเมื่อรวมเกินยอดอยู่ฝั่ง server ที่เดียว)
 */
export function CouponSheet({
  subscriptionId,
  visible,
  onClose,
  onChanged,
}: {
  subscriptionId: string | null;
  visible: boolean;
  onClose: () => void;
  /** ให้หน้าที่เรียกโหลดการ์ดใหม่ — ยอดบนการ์ดเปลี่ยนทันทีที่จอง/ถอน */
  onChanged: () => void;
}) {
  const [view, setView] = useState<SubscriptionCoupons | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  const load = useCallback(async () => {
    if (subscriptionId == null) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await getSubscriptionCoupons(subscriptionId);
    setView(data);
    setError(err);
    setLoading(false);
  }, [subscriptionId]);

  useEffect(() => {
    if (visible) void load();
    else setView(null);
  }, [visible, load]);

  /** กันกดรัวด้วย ref — state มีผลหลัง re-render เท่านั้น (C-9) */
  async function run(
    action: () => Promise<{
      data: SubscriptionCoupons | null;
      error: string | null;
    }>,
  ) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const { data, error: err } = await action();
    submitting.current = false;
    setBusy(false);
    if (err != null) {
      setError(err);
      await load();
      return;
    }
    setView(data);
    onChanged();
  }

  const cycleText = view?.cycleDate == null ? '' : formatThaiDate(view.cycleDate);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View id="subs-coupon-modal" style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={type.h3}>ใช้คูปองกับรอบถัดไป</Text>
            <DemoBadge compact />
          </View>

          {view != null && view.cycleDate != null ? (
            <Text id="subs-coupon-cycle" style={styles.muted}>
              {`รอบวันที่ ${cycleText} · ยอดก่อนลด ฿${view.grossAmount.toLocaleString('th-TH')}`}
            </Text>
          ) : null}

          {/* ยอดรวมหลังลด — มาจาก API ทั้งก้อน ฝั่งนี้ไม่บวกเอง */}
          {view != null && view.discountAmount > 0 ? (
            <View id="subs-coupon-total" style={styles.total}>
              <Text style={styles.totalText}>
                {`รวมลด ฿${view.discountAmount.toLocaleString('th-TH')} → ตัดเงินจำลอง ฿${view.netAmount.toLocaleString('th-TH')}`}
              </Text>
            </View>
          ) : null}

          {error != null ? <ErrorNote id="subs-coupon-error" message={error} /> : null}

          {loading ? (
            <Text style={styles.muted}>กำลังโหลด…</Text>
          ) : view == null ? null : !view.canApply && view.discountAmount === 0 ? (
            <Text id="subs-coupon-blocked" style={styles.blocked}>
              {view.blockedReason ?? 'รอบนี้ใช้คูปองไม่ได้'}
            </Text>
          ) : (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
              {TIERS.map((tier) => (
                <TierSection
                  key={tier}
                  tier={tier}
                  data={view[tier]}
                  busy={busy}
                  cycleText={cycleText}
                  onApply={(couponId) =>
                    void run(() => applyCoupon(subscriptionId!, couponId))
                  }
                  onRemove={() =>
                    void run(() => removeCoupon(subscriptionId!, tier))
                  }
                />
              ))}
              <Text style={styles.muted}>
                {`เลือกได้ระดับละ 1 ใบ — ส่วนลดจะถูกหักตอนระบบตัดเงินวันที่ ${cycleText}`}
              </Text>
            </ScrollView>
          )}

          <Button id="subs-coupon-close" label="ปิด" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

/** หนึ่งช่องของหนึ่งระดับ — จองแล้ว / เลือกได้ / ถูกร้านปิดไว้ */
function TierSection({
  tier,
  data,
  busy,
  cycleText,
  onApply,
  onRemove,
}: {
  tier: CouponTier;
  data: CouponTierView;
  busy: boolean;
  cycleText: string;
  onApply: (couponId: string) => void;
  onRemove: () => void;
}) {
  void cycleText;

  return (
    <View id={`subs-coupon-tier-${tier}`} style={styles.tier}>
      <Text style={styles.tierTitle}>{TIER_LABEL[tier]}</Text>

      {data.applied != null ? (
        <>
          <View id={`subs-coupon-applied-${tier}`} style={styles.applied}>
            <Text style={styles.appliedTitle}>{data.applied.code}</Text>
            <Text style={styles.appliedBody}>
              {`${data.applied.title} · ลด ฿${data.applied.discountAmount.toLocaleString('th-TH')}`}
            </Text>
          </View>
          <Button
            id={`subs-coupon-remove-${tier}`}
            label="ถอนใบนี้ออก"
            variant="ghost"
            loading={busy}
            onPress={onRemove}
          />
        </>
      ) : !data.allowed ? (
        <Text id={`subs-coupon-blocked-${tier}`} style={styles.blocked}>
          {data.blockedReason ?? 'ระดับนี้ใช้กับสินค้าชิ้นนี้ไม่ได้'}
        </Text>
      ) : data.available.length === 0 ? (
        <Text id={`subs-coupon-empty-${tier}`} style={styles.muted}>
          {tier === 'platform'
            ? 'ยังไม่มีคูปองของแพลตฟอร์มสำหรับสินค้านี้'
            : 'ร้านนี้ยังไม่มีคูปองของตัวเอง'}
        </Text>
      ) : (
        data.available.map((c) => (
          <Pressable
            key={c.id}
            id={`subs-coupon-option-${c.id}`}
            accessibilityRole="button"
            disabled={!c.usable || busy}
            onPress={() => onApply(c.id)}
            style={[styles.option, !c.usable && styles.optionOff]}
          >
            <View style={styles.optionHead}>
              <Text style={type.bodyStrong}>{c.code}</Text>
              {c.usable && c.discountAmount != null ? (
                <Text id={`subs-coupon-save-${c.id}`} style={styles.save}>
                  −฿{c.discountAmount.toLocaleString('th-TH')}
                </Text>
              ) : null}
            </View>
            <Text style={styles.muted}>
              {c.title} · {c.label}
            </Text>
            {!c.usable ? (
              <Text style={styles.blocked}>{c.blockedReason}</Text>
            ) : null}
            <Text style={styles.fine}>
              ใช้ได้ถึง {formatThaiDay(c.endsAt)} · 1 คนใช้ได้ครั้งเดียว
            </Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'center',
    padding: space.lg,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    maxHeight: '88%',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  scroll: { flexShrink: 1 },
  scrollBody: { gap: space.md },
  tier: {
    gap: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.md,
  },
  tierTitle: { ...type.label, color: colors.textMuted },
  muted: { ...type.caption, color: colors.textMuted },
  fine: { ...type.caption, color: colors.textFaint },
  blocked: { ...type.caption, color: colors.statusFrozen },
  save: { ...type.bodyStrong, color: statusTones.active.fg },
  total: {
    backgroundColor: statusTones.active.bg,
    borderRadius: radius.md,
    padding: space.md,
  },
  totalText: { ...type.bodyStrong, color: statusTones.active.fg },
  applied: {
    backgroundColor: statusTones.active.bg,
    borderRadius: radius.md,
    padding: space.md,
    gap: 2,
  },
  appliedTitle: { ...type.bodyStrong, color: statusTones.active.fg },
  appliedBody: { ...type.caption, color: statusTones.active.fg },
  option: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: 2,
  },
  optionOff: { opacity: 0.55 },
  optionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
});
