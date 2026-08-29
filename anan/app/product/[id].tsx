import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ProductImage } from '@/components/Media';
import { Card, DemoBadge, EmptyState, Pill, Screen, SectionHeader, Splash } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  baht,
  bestDiscountPlan,
  cycleLabel,
  cycleShort,
  discountPercent,
  getProduct,
  pricePerUnit,
  type Plan,
  type ProductDetail,
  type Review,
} from '@/features/catalog/api';
import { colors, radius, space, type } from '@/lib/theme';

// รีวิวมาพร้อมรายละเอียดสินค้าใน request เดียว — API mask ชื่อผู้รีวิวมาให้แล้ว

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { profile } = useAuth();

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const p = await getProduct(String(id));
      if (cancelled) return;
      setProduct(p);
      setReviews(p?.reviews ?? []);
      // default to the plan that saves the most, like the mockup's pre-selected card
      if (p != null) setPlanId(bestDiscountPlan(p.plans, p.oneTimePrice)?.id ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <Splash />;
  if (product == null) {
    return (
      <Screen>
        <Card>
          <EmptyState id="product-not-found" title="ไม่พบสินค้านี้" body="สินค้าอาจถูกปิดการขายหรือร้านถูกระงับ" />
        </Card>
      </Screen>
    );
  }

  const selected = product.plans.find((p) => p.id === planId) ?? null;
  const total = selected == null ? 0 : selected.pricePerCycle * qty;

  function handleSubscribe() {
    if (selected == null) return;
    // signed-out visitors can browse; they land back here after logging in
    if (profile == null) {
      router.push('/(auth)/login');
      return;
    }
    router.push({ pathname: '/checkout/[planId]', params: { planId: selected.id, qty: String(qty) } });
  }

  return (
    <Screen>
      <Card>
        <ProductImage
          images={product.images}
          categoryIcon={product.categoryIcon}
          height={220}
          iconSize={72}
        />
        <Text id="product-title" style={type.h2}>
          {product.name}
        </Text>
        <View style={styles.shopRow}>
          {/* กดชื่อร้านเพื่อดูของทั้งร้าน — สมัครหลายอย่างจากร้านเดียวได้รอบส่งใกล้กัน */}
          <Link href={{ pathname: '/shop/[id]', params: { id: product.shopId } }} asChild>
            <Pressable id="product-shop-link" accessibilityRole="link">
              <Text style={styles.shopLink}>{product.shopName} →</Text>
            </Pressable>
          </Link>
          {product.netAmount != null ? (
            <Text style={styles.shop}>
              · {product.netAmount} {product.unit ?? ''}
            </Text>
          ) : null}
        </View>
        {product.rating != null ? (
          <Text style={styles.rating}>
            ★ {product.rating.toFixed(1)} <Text style={styles.muted}>({product.reviewCount} รีวิว)</Text>
          </Text>
        ) : null}
        {product.description != null ? <Text style={type.body}>{product.description}</Text> : null}
      </Card>

      <Card>
        <SectionHeader title="เลือกรอบส่ง" />
        {product.plans.length === 0 ? (
          <EmptyState id="product-plans-empty" title="ปิดรับสมาชิกชั่วคราว" body="ร้านปิดรับสมาชิกใหม่สำหรับสินค้านี้อยู่" />
        ) : (
          <>
            {/* radio buttons must be owned by a radiogroup for screen readers */}
            <View accessibilityRole="radiogroup" style={styles.planList}>
            {product.plans.map((plan) => (
              <PlanRow
                key={plan.id}
                // รอบส่งของสินค้าหนึ่งตัวไม่ซ้ำกัน — id อ่านออกกว่า uuid ของแผน
                id={`product-plan-${plan.cycle}`}
                plan={plan}
                oneTimePrice={product.oneTimePrice}
                netAmount={product.netAmount}
                unit={product.unit}
                selected={plan.id === planId}
                onSelect={() => setPlanId(plan.id)}
              />
            ))}
            </View>

            <View style={styles.qtyRow}>
              <Text style={type.bodyStrong}>จำนวนต่อรอบ</Text>
              <View style={styles.stepper}>
                <Stepper
                  id="product-qty-dec"
                  direction="down"
                  onPress={() => setQty((q) => Math.max(1, q - 1))}
                  disabled={qty <= 1}
                />
                <Text id="product-qty-value" style={styles.qtyValue}>
                  {qty}
                </Text>
                <Stepper
                  id="product-qty-inc"
                  direction="up"
                  onPress={() => setQty((q) => Math.min(10, q + 1))}
                  disabled={qty >= 10}
                />
              </View>
            </View>

            <View style={styles.summary}>
              <View>
                <Text style={styles.summaryLabel}>รวมต่อรอบ</Text>
                <Text id="product-total" style={styles.summaryValue}>
                  {baht(total)}
                  <Text style={styles.per}> {selected == null ? '' : cycleShort(selected.cycle)}</Text>
                </Text>
              </View>
              <DemoBadge compact />
            </View>

            <Button
              id="product-subscribe"
              label="สมัครรับสินค้า"
              fullWidth
              disabled={selected == null}
              onPress={handleSubscribe}
            />
            <Text style={styles.note}>ยกเลิกได้ทุกเมื่อ · ข้ามรอบหรือหยุดชั่วคราวได้เอง</Text>
          </>
        )}
      </Card>

      <Card>
        <SectionHeader title={`รีวิวจากผู้ใช้จริง (${product.reviewCount})`} />
        {reviews.length === 0 ? (
          <Text style={styles.muted}>ยังไม่มีรีวิว — รีวิวได้หลังได้รับสินค้ารอบแรก</Text>
        ) : (
          reviews.map((r) => (
            <View key={r.id} style={styles.review}>
              <View style={styles.reviewHead}>
                <Text style={styles.rating}>{'★'.repeat(r.rating)}</Text>
                <Pill label={`รับมาแล้ว ${r.cyclesReceived} รอบ`} tone="neutral" />
              </View>
              {r.comment != null ? <Text style={type.small}>{r.comment}</Text> : null}
              <Text style={styles.muted}>{r.reviewerName}</Text>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

function PlanRow({
  plan,
  oneTimePrice,
  netAmount,
  unit,
  selected,
  onSelect,
  id,
}: {
  plan: Plan;
  oneTimePrice: number;
  netAmount: number | null;
  unit: string | null;
  selected: boolean;
  onSelect: () => void;
  id?: string;
}) {
  const off = discountPercent(plan, oneTimePrice);
  const perUnit = pricePerUnit(plan, netAmount);

  return (
    <Pressable
      id={id}
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.plan, selected && styles.planSelected]}
    >
      <View style={styles.planHead}>
        <Text style={type.bodyStrong}>{cycleLabel(plan.cycle)}</Text>
        {off > 0 ? <Pill label={`ถูกกว่า ${off}%`} tone="sale" /> : null}
      </View>
      <View style={styles.planFoot}>
        <Text style={styles.planPrice}>
          {baht(plan.pricePerCycle)}
          <Text style={styles.per}> {cycleShort(plan.cycle)}</Text>
        </Text>
        <Text style={styles.muted}>
          {plan.qtyPerCycle > 1 ? `${plan.qtyPerCycle} ชิ้น/รอบ · ` : ''}
          {perUnit != null ? `${baht(Number(perUnit.toFixed(2)))} / ${unit ?? 'หน่วย'}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

/** Literal union, so a wrong label cannot silently announce the wrong action. */
function Stepper({
  direction,
  onPress,
  disabled,
  id,
}: {
  direction: 'up' | 'down';
  onPress: () => void;
  disabled: boolean;
  id?: string;
}) {
  return (
    <Pressable
      id={id}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={direction === 'up' ? 'เพิ่มจำนวน' : 'ลดจำนวน'}
      style={[styles.stepperBtn, disabled && styles.stepperDisabled]}
    >
      <Text style={styles.stepperLabel}>{direction === 'up' ? '+' : '−'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shopRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  shopLink: { ...type.bodyStrong, color: colors.primaryStrong, minHeight: 44, paddingTop: space.sm },
  shop: { ...type.small, color: colors.textMuted },
  rating: { ...type.small, color: colors.rating },
  muted: { ...type.caption, color: colors.textMuted },
  plan: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.md,
    gap: 6,
    backgroundColor: colors.surface,
  },
  planSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  planHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  planFoot: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  planPrice: { ...type.price, color: colors.text },
  per: { ...type.caption, color: colors.textMuted },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planList: { gap: space.md },
  stepperDisabled: { opacity: 0.4 },
  stepperLabel: { ...type.h4, color: colors.text },
  qtyValue: { ...type.h4, minWidth: 24, textAlign: 'center' },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.md,
    gap: space.md,
  },
  summaryLabel: { ...type.caption, color: colors.textMuted },
  summaryValue: { ...type.h3, color: colors.text },
  note: { ...type.caption, color: colors.textFaint, textAlign: 'center' },
  review: { gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
});
