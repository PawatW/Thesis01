import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Card, DemoBadge, EmptyState, ErrorNote, Pill, Screen, SectionHeader, Splash } from '@/components/ui';
import {
  listPlanCoupons,
  TIER_LABEL,
  type AvailableCoupon,
  type CouponTier,
} from '@/features/coupons/api';
import {
  createPaymentMethod,
  listAddresses,
  listPaymentMethods,
  type Address,
  type PaymentMethod,
} from '@/features/auth/api';
import { baht, cycleLabel, cycleShort, discountPercent, getPlan } from '@/features/catalog/api';
import { CardFace } from '@/features/payment/CardFace';
import { CardForm, type CardPayload } from '@/features/payment/CardForm';
import type { CardBrand } from '@/features/payment/card';
import { subscribeToPlan } from '@/features/subscriptions/api';
import { addDays, todayISO } from '@/lib/date';
import { colors, radius, space, statusTones, type } from '@/lib/theme';

import type { PlanLookup } from '@/features/catalog/api';

type Card4 = PaymentMethod;

export default function CheckoutScreen() {
  const { planId, qty } = useLocalSearchParams<{ planId: string; qty?: string }>();
  const router = useRouter();

  const [info, setInfo] = useState<PlanLookup | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [cards, setCards] = useState<Card4[]>([]);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [startOffset, setStartOffset] = useState(1); // days from today
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** คูปองของรอบแรก (feature 18) — ยอดส่วนลดมาจาก API ทั้งหมด */
  const [coupons, setCoupons] = useState<AvailableCoupon[]>([]);
  /** เลือกได้ระดับละ 1 ใบ — key คือระดับ ไม่ใช่ index (feature 18) */
  const [picked, setPicked] = useState<Partial<Record<CouponTier, string>>>({});


  /**
   * A second confirm creates a second subscription with its own id, so the
   * UNIQUE constraints on orders/payments cannot catch it — the client is the
   * only guard against a duplicate charge. A ref, not state: it must block the
   * next tap in the same frame, before React re-renders.
   */
  const submitting = useRef(false);

  // must be a whole number: `?qty=1.5` would clamp fine and then fail in Postgres
  const quantity = Math.min(10, Math.max(1, Math.round(Number(qty ?? '1') || 1)));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [p, addr, pm, cpn] = await Promise.all([
        getPlan(String(planId)),
        listAddresses(),
        listPaymentMethods(),
        // คูปองขึ้นกับทั้งแผนและจำนวนชิ้น — ยอดจึงคำนวณที่ API ตามจำนวนจริง
        listPlanCoupons(String(planId), quantity),
      ]);
      if (cancelled) return;
      // distinguish "plan is gone" from "request failed" (catalog/api.ts)
      if (p != null && 'error' in p) {
        setError(p.error);
        setInfo(null);
      } else {
        setInfo(p);
      }
      setAddresses(addr.data);
      setAddressId(addr.data.find((a) => a.isDefault)?.id ?? addr.data[0]?.id ?? null);
      setCards(pm.data);
      setCardId(pm.data[0]?.id ?? null);
      setCoupons(cpn.data ?? []);
      // a failed load must not read as "you have no address / no card"
      if (addr.error != null) setError(addr.error);
      else if (pm.error != null) setError(pm.error);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [planId]);

  /**
   * ผูกบัตรใหม่โดยไม่ต้องออกจากหน้าจ่ายเงิน แล้วเลือกใบนั้นให้เลย
   *
   * `CardForm` เป็นที่เดียวที่เห็นเลขบัตรเต็ม — ที่นี่ได้แค่ payload ที่มี
   * เครือข่าย + 4 ตัวท้าย + วันหมดอายุ (กฎเหล็กข้อ 1)
   */
  async function handleAddCard(payload: CardPayload): Promise<string | null> {
    const { data, error: err } = await createPaymentMethod(payload);
    if (err != null) return err;

    setCards((prev) => [...prev, data]);
    setCardId(data.id);
    return null;
  }

  async function handleConfirm() {
    if (submitting.current) return;
    if (info == null || addressId == null || cardId == null) return;
    submitting.current = true;
    setError(null);
    setBusy(true);

    // วันที่ตามปฏิทินไทย ไม่ใช่ UTC — toISOString() จะส่งวันของเมื่อวานในช่วง
    // 00:00-07:00 แล้ว API จะปฏิเสธว่า "ต้องเริ่มตั้งแต่พรุ่งนี้"
    const iso = addDays(todayISO(), startOffset);

    // ★ ไม่ส่งยอดเงินขึ้นไป ★ API อ่านราคาจากฐานข้อมูลเอง
    const { error: err } = await subscribeToPlan({
      planId: info.plan.id,
      addressId,
      paymentMethodId: cardId,
      quantity,
      startDate: iso,
      // ★ ส่งแค่ id ของคูปอง ★ ส่วนลดคำนวณที่ API จากราคาในฐานข้อมูล
      // ซ้อนได้ระดับละ 1 ใบ — API ปฏิเสธเองถ้าระดับซ้ำ
      ...(pickedIds.length === 0 ? {} : { couponIds: pickedIds }),
    });

    if (err != null) {
      submitting.current = false;
      setBusy(false);
      setError(err);
      return;
    }
    // stay busy through the navigation: this screen is about to unmount and the
    // button must not become tappable again in the meantime
    router.replace('/(buyer)/subscriptions');
  }

  if (loading) return <Splash />;
  if (info == null) {
    return (
      <Screen>
        <Card>
          <EmptyState id="checkout-plan-not-found" title="ไม่พบแผนรอบส่งนี้" body="แผนอาจถูกปิดรับสมาชิกใหม่ไปแล้ว" />
        </Card>
      </Screen>
    );
  }

  const off = discountPercent(info.plan, info.product.oneTimePrice);
  const total = info.plan.pricePerCycle * quantity;
  const ready = addressId != null && cardId != null;
  const pickedIds = Object.values(picked).filter((v) => v !== undefined);
  const pickedCoupons = coupons.filter((c) => pickedIds.includes(c.id));
  /** ยอดรวมของรอบแรก — บวกได้ตรง ๆ เพราะ API หนีบมาให้แล้วตอนสร้างจริง
   *  (ตัวเลขนี้เป็น "ประมาณการก่อนกดยืนยัน" ยอดจริงมาจาก response ของ API) */
  const pickedDiscount = pickedCoupons.reduce(
    (sum, c) => sum + (c.discountAmount ?? 0),
    0,
  );

  return (
    <Screen>
      <Card>
        <SectionHeader title="ยืนยันการสมัคร" />
        <Text id="checkout-product-name" style={type.h4}>
          {info.product.name}
        </Text>
        <Text id="checkout-meta" style={styles.muted}>
          {info.product.shopName} · {cycleLabel(info.plan.cycle)} · {quantity} ชิ้น/รอบ
        </Text>
        <View style={styles.priceRow}>
          <Text id="checkout-total" style={styles.total}>
            {baht(total)}
            <Text style={styles.per}> {cycleShort(info.plan.cycle)}</Text>
          </Text>
          {off > 0 ? <Pill label={`ถูกกว่าซื้อครั้งเดียว ${off}%`} tone="sale" /> : null}
        </View>
        <DemoBadge />
      </Card>

      <Card>
        <SectionHeader title="ที่อยู่จัดส่ง" />
        {addresses.length === 0 ? (
          <EmptyState
            id="checkout-address-empty"
            title="ยังไม่มีที่อยู่"
            body="เพิ่มที่อยู่ในหน้าโปรไฟล์ก่อน แล้วกลับมาสมัครต่อได้เลย"
            action={
              <Button
                id="checkout-address-add"
                label="ไปเพิ่มที่อยู่"
                onPress={() => router.push('/(buyer)/profile/addresses')}
              />
            }
          />
        ) : (
          addresses.map((a) => (
            <Selectable
              key={a.id}
              id={`checkout-address-${a.id}`}
              selected={a.id === addressId}
              onPress={() => setAddressId(a.id)}
            >
              <Text style={type.bodyStrong}>
                {a.label != null && a.label !== '' ? a.label : 'ที่อยู่'} · {a.recipientName}
              </Text>
              <Text style={styles.muted}>
                {a.addressLine} {a.province} {a.postcode}
              </Text>
            </Selectable>
          ))
        )}
      </Card>

      <Card>
        <SectionHeader title="ชำระด้วยบัตร" />
        {cards.map((c) => (
          <Selectable
            key={c.id}
            id={`checkout-card-${c.id}`}
            selected={c.id === cardId}
            onPress={() => setCardId(c.id)}
          >
            <CardFace
              brand={c.brand as CardBrand}
              last4={c.last4}
              expMonth={c.expMonth}
              expYear={c.expYear}
              holderName={c.holderName}
              compact
            />
          </Selectable>
        ))}
        <View style={styles.addCard}>
          <SectionHeader title="ผูกบัตรใหม่" />
          <CardForm
            idPrefix="checkout-card"
            errorId="checkout-card-error"
            submitLabel="ผูกบัตรนี้"
            variant="secondary"
            onSubmit={handleAddCard}
          />
        </View>
      </Card>

      {coupons.length > 0 ? (
        <Card id="checkout-coupons">
          <SectionHeader title="คูปองสำหรับรอบแรก" />
          <Text style={styles.muted}>
            เลือกได้ระดับละ 1 ใบ (คูปองแพลตฟอร์ม + คูปองร้าน ใช้ซ้อนกันได้) ·
            รอบถัด ๆ ไปเลือกคูปองเองได้จากหน้า &quot;ของฉัน&quot; ก่อนถึงวันตัดรอบ
          </Text>
          {(['platform', 'shop'] as const).map((tier) => {
            const rows = coupons.filter((c) => c.tier === tier);
            if (rows.length === 0) return null;
            return (
              <View key={tier} id={`checkout-coupon-tier-${tier}`} style={styles.couponGroup}>
                <Text style={styles.couponGroupTitle}>{TIER_LABEL[tier]}</Text>
                {rows.map((c) => (
                  <Selectable
                    key={c.id}
                    id={`checkout-coupon-${c.id}`}
                    selected={picked[tier] === c.id}
                    onPress={() => {
                      if (!c.usable) return;
                      setPicked((prev) => ({
                        ...prev,
                        // กดใบเดิมซ้ำ = ยกเลิกการใช้ระดับนั้น
                        [tier]: prev[tier] === c.id ? undefined : c.id,
                      }));
                    }}
                  >
                    <View style={styles.couponRow}>
                      <View style={styles.couponMain}>
                        <Text style={type.bodyStrong}>{c.code}</Text>
                        <Text style={styles.muted}>
                          {c.title} · {c.label}
                        </Text>
                        {!c.usable ? (
                          <Text style={styles.couponBlocked}>{c.blockedReason}</Text>
                        ) : null}
                      </View>
                      {c.usable && c.discountAmount != null ? (
                        <Text id={`checkout-coupon-save-${c.id}`} style={styles.couponSave}>
                          −{baht(c.discountAmount)}
                        </Text>
                      ) : null}
                    </View>
                  </Selectable>
                ))}
              </View>
            );
          })}
          {pickedIds.length > 0 ? (
            <Text id="checkout-coupon-clear-hint" style={styles.muted}>
              กดใบเดิมซ้ำเพื่อยกเลิกการใช้คูปองระดับนั้น
            </Text>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <SectionHeader title="เริ่มรอบแรก" />
        <View style={styles.dayRow} accessibilityRole="radiogroup">
          {[1, 3, 7, 14].map((d) => (
            <Pressable
              key={d}
              id={`checkout-start-${d}`}
              onPress={() => setStartOffset(d)}
              accessibilityRole="radio"
              accessibilityState={{ selected: startOffset === d }}
              style={[styles.day, startOffset === d && styles.daySelected]}
            >
              <Text style={[type.caption, startOffset === d && styles.daySelectedText]}>
                {d === 1 ? 'พรุ่งนี้' : `อีก ${d} วัน`}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card>
        <Text style={type.small}>
          ระบบจะสร้างออเดอร์ {cycleLabel(info.plan.cycle)} และตัดเงินจำลอง {baht(total)} ต่อรอบ — ยกเลิกได้ทุกเมื่อ
        </Text>
        {/* คูปองลดเฉพาะรอบแรก — ต้องเขียนให้ชัดว่ารอบถัดไปกลับไปเป็นราคาเต็ม */}
        {pickedCoupons.length > 0 ? (
          <Text id="checkout-coupon-summary" style={styles.couponSummary}>
            {`รอบแรกใช้คูปอง ${pickedCoupons.map((c) => c.code).join(' + ')} ลดรวม ${baht(pickedDiscount)} → ตัดเงินจำลอง ${baht(Math.max(0, total - pickedDiscount))} · รอบถัดไปเป็น ${baht(total)} ตามปกติ (เลือกคูปองใหม่ได้ทุกรอบ)`}
          </Text>
        ) : null}
        {error != null ? <ErrorNote id="checkout-error" message={error} /> : null}
        <Button
          id="checkout-confirm"
          label="ยืนยันสมัครรับสินค้า"
          onPress={handleConfirm}
          loading={busy}
          disabled={!ready}
          fullWidth
        />
        {!ready ? (
          <Text id="checkout-not-ready" style={styles.muted}>
            ต้องเลือกที่อยู่และบัตรก่อนจึงจะยืนยันได้
          </Text>
        ) : null}
      </Card>
    </Screen>
  );
}

function Selectable({
  selected,
  onPress,
  children,
  id,
}: {
  selected: boolean;
  onPress: () => void;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <Pressable
      id={id}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.selectable, selected && styles.selectableOn]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  muted: { ...type.caption, color: colors.textMuted },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  total: { ...type.h2, color: colors.text },
  couponGroup: { gap: space.sm },
  couponGroupTitle: { ...type.label, color: colors.textMuted },
  couponRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  couponMain: { flex: 1, gap: 2 },
  couponSave: { ...type.bodyStrong, color: statusTones.active.fg },
  couponBlocked: { ...type.caption, color: colors.statusFrozen },
  couponSummary: { ...type.caption, color: statusTones.active.fg },
  per: { ...type.caption, color: colors.textMuted },
  selectable: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.md,
    gap: 2,
    backgroundColor: colors.surface,
  },
  selectableOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  addCard: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md, gap: space.md },
  dayRow: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  day: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  daySelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  daySelectedText: { color: colors.primaryStrong },
});
