import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Card, EmptyState, ErrorNote, SectionHeader } from '@/components/ui';
import { formatThaiDay } from '@/lib/date';
import { colors, radius, space, statusTones, type } from '@/lib/theme';

import {
  listProductCoupons,
  POLICY_LABEL,
  setProductCoupons,
  TIER_LABEL,
  type CouponPolicy,
  type CouponTier,
  type ProductCoupons,
  type SellerCoupon,
} from './api';

const POLICIES: CouponPolicy[] = ['both', 'platform_only', 'shop_only', 'none'];

/** ระดับนี้ถูกเปิดโดยนโยบายที่เลือกอยู่ไหม — ตรรกะเดียวกับ `policyAllows()` ฝั่ง API */
function policyAllows(policy: CouponPolicy, tier: CouponTier): boolean {
  if (policy === 'none') return false;
  if (policy === 'both') return true;
  return policy === (tier === 'platform' ? 'platform_only' : 'shop_only');
}

/**
 * "คูปองที่ร่วมรายการ" ในหน้าแก้สินค้าของร้าน (feature 18 · W13 Flow B)
 *
 * การ์ดนี้คุม 2 เรื่องที่อยู่ในคำสั่งบันทึกเดียวกัน:
 *   1. **นโยบายรายสินค้า** — ชิ้นนี้รับคูปองระดับไหนบ้าง (ปิดการซ้อนได้ที่นี่)
 *   2. **คูปองที่ครอบชิ้นนี้** — ทั้งของแพลตฟอร์มที่ร้านกดเข้าร่วม และของร้านเอง
 *
 * ★ การเข้าร่วมคือความสมัครใจของร้าน = ร้านรับภาระส่วนลดเอง ★ นั่นคือเหตุผลที่
 * ระบบไม่ต้องมีโมเดลส่วนแบ่งรายได้ · ตัวเลข "เสียส่วนลดสูงสุด" จึงต้องอยู่ตรงหน้า
 * ปุ่มตั้งแต่ก่อนกด ไม่ใช่ให้ร้านมารู้ตอนเงินหายไปแล้ว
 *
 * ★ ติ๊กออกทีหลังไม่กระทบใบที่ผู้ซื้อจองไว้แล้ว ★ (ใบจองถือ snapshot ของเงื่อนไข)
 */
export function ProductCouponPicker({
  productId,
  disabled = false,
}: {
  productId: string;
  disabled?: boolean;
}) {
  const [data, setData] = useState<ProductCoupons | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [policy, setPolicy] = useState<CouponPolicy>('both');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);

  const reload = useCallback(async () => {
    const { data: res, error: err } = await listProductCoupons(productId);
    setData(res);
    if (res != null) {
      setPolicy(res.couponPolicy);
      setPicked(
        new Set(
          [...res.platform, ...res.shop]
            // ใบที่ครอบอยู่แล้วเพราะตั้งเป็น "ทั้งร้าน" ไม่ได้อยู่ใน coupon_products
            .filter((c) => c.enabled && !c.coveredByAllProducts)
            .map((c) => c.id),
        ),
      );
    }
    setError(err);
    setLoading(false);
  }, [productId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const all = data === null ? [] : [...data.platform, ...data.shop];
  const dirty =
    data !== null &&
    (policy !== data.couponPolicy ||
      all.some(
        (c) => !c.coveredByAllProducts && c.enabled !== picked.has(c.id),
      ));

  async function save() {
    // กันกดรัวด้วย ref เพราะ state มีผลหลัง re-render เท่านั้น (C-9)
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    setSaved(false);
    const { error: err } = await setProductCoupons(productId, {
      couponIds: [...picked],
      couponPolicy: policy,
    });
    submitting.current = false;
    setBusy(false);
    if (err != null) {
      setError(err);
      await reload();
      return;
    }
    setSaved(true);
    await reload();
  }

  if (loading || data === null) return null;

  return (
    <Card id="seller-coupons-card">
      <SectionHeader title="คูปองที่ร่วมรายการ" />
      <Text style={styles.lead}>
        ผู้ดูแลแพลตฟอร์มออกคูปองกลาง ร้านออกคูปองของตัวเองได้ด้วย —
        ผู้ซื้อใช้ได้ระดับละ 1 ใบต่อรอบ ส่วนลดที่เกิดขึ้นเป็นภาระของร้านทั้งคู่
      </Text>

      {error != null ? <ErrorNote id="seller-coupons-error" message={error} /> : null}
      {saved ? (
        <View style={styles.toast}>
          <Text id="seller-coupons-saved" style={styles.toastText}>
            บันทึกแล้ว
          </Text>
        </View>
      ) : null}

      {/* ---------- นโยบายรายสินค้า ---------- */}
      <Text style={styles.label}>สินค้าชิ้นนี้รับคูปองระดับไหน</Text>
      <View style={styles.chips}>
        {POLICIES.map((p) => (
          <Pressable
            key={p}
            id={`seller-coupon-policy-${p}`}
            accessibilityRole="button"
            disabled={disabled || busy}
            onPress={() => {
              setPolicy(p);
              setSaved(false);
            }}
            style={[styles.chip, policy === p && styles.chipOn]}
          >
            <Text style={[styles.chipText, policy === p && styles.chipTextOn]}>
              {POLICY_LABEL[p]}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.muted}>
        เลือก &quot;เฉพาะ…&quot; เพื่อกันไม่ให้สินค้ากำไรบางถูกลดซ้อนสองชั้น
        โดยไม่ต้องถอนออกจากแคมเปญทั้งใบ
      </Text>

      {/* ---------- คูปองแต่ละระดับ ---------- */}
      {(['platform', 'shop'] as const).map((tier) => {
        const rows = data[tier];
        const allowed = policyAllows(policy, tier);
        return (
          <View key={tier} id={`seller-coupon-group-${tier}`} style={styles.group}>
            <Text style={styles.label}>
              {TIER_LABEL[tier]}
              {allowed ? '' : ' — ปิดไว้ด้วยนโยบายด้านบน'}
            </Text>
            {rows.length === 0 ? (
              <EmptyState
                id={`seller-coupons-empty-${tier}`}
                title={
                  tier === 'platform'
                    ? 'ยังไม่มีแคมเปญของแพลตฟอร์มให้เข้าร่วม'
                    : 'ร้านยังไม่มีคูปองของตัวเอง'
                }
                body={
                  tier === 'shop'
                    ? 'ออกคูปองของร้านได้ที่เมนู "คูปองของร้าน"'
                    : undefined
                }
              />
            ) : null}
            {rows.map((c) => (
              <CouponRow
                key={c.id}
                coupon={c}
                on={c.coveredByAllProducts || picked.has(c.id)}
                dim={!allowed}
                disabled={disabled || busy || c.coveredByAllProducts}
                onToggle={() => {
                  const next = new Set(picked);
                  if (next.has(c.id)) next.delete(c.id);
                  else next.add(c.id);
                  setPicked(next);
                  setSaved(false);
                }}
              />
            ))}
          </View>
        );
      })}

      {!disabled ? (
        <>
          <Button
            id="seller-coupons-save"
            label="บันทึกคูปองที่ร่วมรายการ"
            loading={busy}
            disabled={!dirty}
            onPress={() => void save()}
          />
          <Text style={styles.muted}>
            ถอนคูปองออกได้ตลอด — แต่ไม่กระทบรอบที่ผู้ซื้อจองคูปองไว้แล้ว
            (ใบที่จองแล้วยึดเงื่อนไข ณ วันที่จอง)
          </Text>
        </>
      ) : null}
    </Card>
  );
}

function CouponRow({
  coupon,
  on,
  dim,
  disabled,
  onToggle,
}: {
  coupon: SellerCoupon;
  on: boolean;
  dim: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      id={`seller-coupon-${coupon.id}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={[styles.row, on && styles.rowOn, (dim || disabled) && styles.rowOff]}
    >
      <View style={[styles.box, on && styles.boxOn]}>
        {on ? <Text style={styles.tick}>✓</Text> : null}
      </View>
      <View style={styles.rowMain}>
        <Text style={type.bodyStrong}>
          {coupon.code} <Text style={styles.muted}>· {coupon.title}</Text>
        </Text>
        <Text style={styles.muted}>
          {coupon.label}
          {coupon.minOrderAmount != null
            ? ` · ยอดขั้นต่ำ ฿${coupon.minOrderAmount.toFixed(2)}`
            : ''}{' '}
          · ถึง {formatThaiDay(coupon.endsAt)}
        </Text>
        {coupon.coveredByAllProducts ? (
          <Text id={`seller-coupon-all-${coupon.id}`} style={styles.muted}>
            คูปองนี้ตั้งเป็น &quot;ใช้ได้ทั้งร้าน&quot; — ครอบสินค้าชิ้นนี้อยู่แล้ว
          </Text>
        ) : null}
        {coupon.maxDiscountPerCycle != null ? (
          <Text id={`seller-coupon-cost-${coupon.id}`} style={styles.cost}>
            {`เข้าร่วมแล้วสินค้าชิ้นนี้เสียส่วนลดสูงสุด ฿${coupon.maxDiscountPerCycle.toFixed(2)} ต่อรอบ (ต่อ 1 ชิ้น)`}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lead: { ...type.small, color: colors.textMuted },
  muted: { ...type.caption, color: colors.textMuted },
  label: { ...type.label, color: colors.textMuted },
  cost: { ...type.caption, color: colors.statusFrozen },
  group: {
    gap: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.md,
  },
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
  toast: {
    backgroundColor: statusTones.active.bg,
    borderRadius: radius.md,
    padding: space.md,
  },
  toastText: { ...type.small, color: statusTones.active.fg },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
  },
  rowOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  rowOff: { opacity: 0.5 },
  rowMain: { flex: 1, gap: 2 },
  box: {
    width: 22,
    height: 22,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  boxOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  tick: { ...type.caption, color: colors.surface },
});
