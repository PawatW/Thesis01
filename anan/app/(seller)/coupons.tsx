import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
  createShopCoupon,
  deactivateShopCoupon,
  listShopCoupons,
  type CouponDiscountType,
  type CouponState,
  type ShopCoupon,
} from '@/features/coupons/api';
import { listMyProducts, type SellerProduct } from '@/features/seller/api';
import { formatThaiDay, todayISO } from '@/lib/date';
import { colors, radius, space, statusTones, type } from '@/lib/theme';

const STATE_TONE: Record<CouponState, 'active' | 'paused' | 'cancelled'> = {
  running: 'active',
  scheduled: 'paused',
  expired: 'cancelled',
  disabled: 'cancelled',
};

const STATE_LABEL: Record<CouponState, string> = {
  running: 'กำลังใช้',
  scheduled: 'ยังไม่เริ่ม',
  expired: 'หมดอายุ',
  disabled: 'ปิดแล้ว',
};

/** 'YYYY-MM-DD' → ISO datetime ที่ต้นวัน/สิ้นวันตามเวลาไทย */
const startOfThaiDay = (iso: string) => `${iso}T00:00:00+07:00`;
const endOfThaiDay = (iso: string) => `${iso}T23:59:59+07:00`;

/**
 * คูปองของร้าน (feature 18 ชั้นที่ 2 · W13 Flow B)
 *
 * ★ คูปองของร้านซ้อนกับคูปองของแพลตฟอร์มได้ ★ ผู้ซื้อใช้ได้ระดับละ 1 ใบต่อรอบ
 * ร้านจึงต้องเห็นตั้งแต่ตอนออกคูปองว่า "ลูกค้าอาจได้ส่วนลดสองชั้น" —
 * ถ้าไม่อยากให้ซ้อนกับสินค้าชิ้นไหน ไปปิดที่นโยบายในหน้าแก้สินค้าชิ้นนั้น
 *
 * ★ ไม่มีปุ่มลบ ★ ใบที่ถูกใช้ไปแล้วมีออเดอร์ชี้กลับมาหาเสมอ — ปิดได้อย่างเดียว
 */
export default function SellerCouponsScreen() {
  const [items, setItems] = useState<ShopCoupon[]>([]);
  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [discountType, setDiscountType] = useState<CouponDiscountType>('percent');
  const [value, setValue] = useState('');
  const [cap, setCap] = useState('');
  const [minOrder, setMinOrder] = useState('');
  const [startsAt, setStartsAt] = useState(todayISO());
  const [endsAt, setEndsAt] = useState('');
  const [quota, setQuota] = useState('');
  const [allProducts, setAllProducts] = useState(true);
  const [scope, setScope] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    const [mine, prods] = await Promise.all([
      listShopCoupons(),
      listMyProducts(),
    ]);
    setItems(mine.data ?? []);
    setProducts(prods.data ?? []);
    setError(mine.error);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  /** กันกดรัวด้วย ref เพราะ `busy` เป็น state ที่มีผลหลัง re-render (C-9) */
  async function run(
    action: () => Promise<{ error: string | null }>,
    okMessage: string,
  ): Promise<boolean> {
    if (submitting.current) return false;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const { error: err } = await action();
    submitting.current = false;
    setBusy(false);
    if (err != null) {
      await reload();
      setError(err);
      return false;
    }
    setToast(okMessage);
    await reload();
    return true;
  }

  const num = (s: string): number | undefined => {
    const n = Number(s.trim());
    return s.trim() === '' || Number.isNaN(n) ? undefined : n;
  };

  const valueNum = num(value);
  const canSubmit =
    code.trim().length >= 4 &&
    title.trim() !== '' &&
    valueNum !== undefined &&
    valueNum > 0 &&
    (discountType !== 'percent' || valueNum <= 100) &&
    endsAt.trim() !== '' &&
    endsAt > startsAt &&
    (allProducts || scope.size > 0);

  if (loading) return <Splash />;

  return (
    <Screen>
      <SectionHeader title="คูปองของร้าน" action={<DemoBadge compact />} />
      <Text style={styles.lead}>
        คูปองของร้านใช้ร่วมกับคูปองของแพลตฟอร์มได้ — ผู้ซื้อใช้ได้ระดับละ 1 ใบต่อรอบ
        และส่วนลดทั้งสองใบเป็นภาระของร้าน · ปิดการซ้อนรายสินค้าได้ที่หน้าแก้สินค้า
      </Text>

      {error != null ? <ErrorNote id="seller-coupons-page-error" message={error} /> : null}
      {toast != null ? (
        <Pressable id="seller-coupons-toast" onPress={() => setToast(null)}>
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </Pressable>
      ) : null}

      <Card>
        <SectionHeader title="ออกคูปองใหม่ของร้าน" />
        <TextField
          id="seller-coupon-code"
          label="โค้ด (A-Z 0-9 และ - · 4-24 ตัว · ห้ามซ้ำกับร้านอื่น)"
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase())}
          autoCapitalize="characters"
          maxLength={24}
        />
        <TextField
          id="seller-coupon-title"
          label="ชื่อแคมเปญ (ผู้ซื้อเห็นข้อความนี้)"
          value={title}
          onChangeText={setTitle}
          maxLength={120}
        />

        <View style={styles.chips}>
          {(['percent', 'fixed'] as const).map((t) => (
            <Pressable
              key={t}
              id={`seller-coupon-type-${t}`}
              accessibilityRole="button"
              onPress={() => {
                setDiscountType(t);
                if (t === 'fixed') setCap('');
              }}
              style={[styles.chip, discountType === t && styles.chipOn]}
            >
              <Text
                style={[styles.chipText, discountType === t && styles.chipTextOn]}
              >
                {t === 'percent' ? 'ลดเป็นเปอร์เซ็นต์' : 'ลดเป็นจำนวนเงิน'}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextField
          id="seller-coupon-value"
          label={discountType === 'percent' ? 'ลดกี่ % (1-100)' : 'ลดกี่บาท'}
          value={value}
          onChangeText={setValue}
          keyboardType="numeric"
        />
        {discountType === 'percent' ? (
          <TextField
            id="seller-coupon-cap"
            label="เพดานส่วนลดต่อรอบ (บาท · เว้นว่างได้)"
            value={cap}
            onChangeText={setCap}
            keyboardType="numeric"
          />
        ) : null}
        <TextField
          id="seller-coupon-min"
          label="ยอดขั้นต่ำต่อรอบ (บาท · เว้นว่างได้)"
          value={minOrder}
          onChangeText={setMinOrder}
          keyboardType="numeric"
        />
        <TextField
          id="seller-coupon-starts"
          label="เริ่มใช้ได้ (YYYY-MM-DD)"
          value={startsAt}
          onChangeText={setStartsAt}
          maxLength={10}
        />
        <TextField
          id="seller-coupon-ends"
          label="ใช้ได้ถึง (YYYY-MM-DD)"
          value={endsAt}
          onChangeText={setEndsAt}
          maxLength={10}
        />
        <TextField
          id="seller-coupon-quota"
          label="จำกัดจำนวนคน (เว้นว่าง = ไม่จำกัด)"
          value={quota}
          onChangeText={setQuota}
          keyboardType="numeric"
        />

        {/* ---------- ขอบเขต ---------- */}
        <Text style={styles.label}>ใช้ได้กับสินค้าไหน</Text>
        <View style={styles.chips}>
          {[
            { on: true, label: 'ทั้งร้าน (รวมสินค้าที่เพิ่มทีหลัง)' },
            { on: false, label: 'เลือกเฉพาะบางสินค้า' },
          ].map((opt) => (
            <Pressable
              key={String(opt.on)}
              id={`seller-coupon-scope-${opt.on ? 'all' : 'some'}`}
              accessibilityRole="button"
              onPress={() => setAllProducts(opt.on)}
              style={[styles.chip, allProducts === opt.on && styles.chipOn]}
            >
              <Text
                style={[
                  styles.chipText,
                  allProducts === opt.on && styles.chipTextOn,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {!allProducts ? (
          <View style={styles.scopeList}>
            {products.length === 0 ? (
              <Text style={styles.muted}>ร้านนี้ยังไม่มีสินค้า</Text>
            ) : null}
            {products.map((p) => {
              const on = scope.has(p.id);
              return (
                <Pressable
                  key={p.id}
                  id={`seller-coupon-product-${p.id}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => {
                    const next = new Set(scope);
                    if (on) next.delete(p.id);
                    else next.add(p.id);
                    setScope(next);
                  }}
                  style={[styles.row, on && styles.rowOn]}
                >
                  <View style={[styles.box, on && styles.boxOn]}>
                    {on ? <Text style={styles.tick}>✓</Text> : null}
                  </View>
                  <Text style={type.body}>{p.name}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <Button
          id="seller-coupon-create"
          label="ออกคูปอง"
          loading={busy}
          disabled={!canSubmit}
          onPress={() => {
            void run(
              () =>
                createShopCoupon({
                  code: code.trim(),
                  title: title.trim(),
                  discountType,
                  discountValue: valueNum as number,
                  ...(discountType === 'percent' && num(cap) !== undefined
                    ? { maxDiscountAmount: num(cap) as number }
                    : {}),
                  ...(num(minOrder) === undefined
                    ? {}
                    : { minOrderAmount: num(minOrder) as number }),
                  startsAt: startOfThaiDay(startsAt.trim()),
                  endsAt: endOfThaiDay(endsAt.trim()),
                  ...(num(quota) === undefined
                    ? {}
                    : { maxRedemptions: num(quota) as number }),
                  appliesToAllProducts: allProducts,
                  ...(allProducts ? {} : { productIds: [...scope] }),
                }),
              'ออกคูปองของร้านแล้ว',
            ).then((ok) => {
              if (!ok) return;
              setCode('');
              setTitle('');
              setValue('');
              setCap('');
              setMinOrder('');
              setEndsAt('');
              setQuota('');
              setScope(new Set());
            });
          }}
        />
      </Card>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            id="seller-coupons-page-empty"
            title="ร้านยังไม่มีคูปองของตัวเอง"
            body="ออกคูปองจากฟอร์มด้านบน แล้วผู้ซื้อจะเห็นในช่อง 'คูปองร้านค้า'"
          />
        </Card>
      ) : null}

      {items.map((c) => (
        <Card key={c.id} id={`seller-coupon-item-${c.id}`}>
          <View style={styles.itemRow}>
            <View style={styles.itemMain}>
              <Text style={type.bodyStrong}>
                {c.code} <Text style={styles.muted}>· {c.title}</Text>
              </Text>
              <Text id={`seller-coupon-label-${c.id}`} style={styles.muted}>
                {c.label}
                {c.minOrderAmount != null
                  ? ` · ยอดขั้นต่ำ ฿${c.minOrderAmount.toFixed(2)}`
                  : ''}
              </Text>
              <Text style={styles.muted}>
                {formatThaiDay(c.startsAt)} – {formatThaiDay(c.endsAt)} ·{' '}
                {c.appliesToAllProducts
                  ? 'ใช้ได้ทั้งร้าน'
                  : `เฉพาะ ${c.productCount} สินค้า`}
              </Text>
              <Text id={`seller-coupon-usage-${c.id}`} style={styles.usage}>
                จองอยู่ {c.reservedCount} · ใช้แล้ว {c.consumedCount} · คืนแล้ว{' '}
                {c.releasedCount}
                {c.maxRedemptions != null
                  ? ` · กินโควตา ${c.inUseCount}/${c.maxRedemptions}`
                  : ' · ไม่จำกัดจำนวน'}
              </Text>
            </View>
            <View style={styles.itemActions}>
              <Pill
                id={`seller-coupon-state-${c.id}`}
                label={STATE_LABEL[c.state]}
                tone={STATE_TONE[c.state]}
                dot
              />
              {c.isActive ? (
                <Pressable
                  id={`seller-coupon-deactivate-${c.id}`}
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() =>
                    void run(
                      () => deactivateShopCoupon(c.id),
                      'ปิดคูปองแล้ว — ใบที่จองไว้ยังใช้ได้ตามเดิม',
                    )
                  }
                  style={({ pressed }) => [
                    styles.action,
                    pressed && styles.actionPressed,
                    busy && styles.actionDisabled,
                  ]}
                >
                  <Text style={styles.actionText}>ปิดคูปอง</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { ...type.small, color: colors.textMuted },
  muted: { ...type.caption, color: colors.textMuted },
  label: { ...type.label, color: colors.textMuted },
  usage: { ...type.caption, color: colors.text },
  toast: {
    backgroundColor: statusTones.active.bg,
    borderRadius: radius.md,
    padding: space.md,
  },
  toastText: { ...type.small, color: statusTones.active.fg },
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
  scopeList: { gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
  },
  rowOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  box: {
    width: 22,
    height: 22,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  tick: { ...type.caption, color: colors.surface },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
    flexWrap: 'wrap',
  },
  itemMain: { gap: 2, flexShrink: 1 },
  itemActions: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  action: {
    borderWidth: 1,
    borderColor: colors.dangerSoftBorder,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  actionPressed: { borderColor: colors.danger },
  actionDisabled: { opacity: 0.5 },
  actionText: { ...type.caption, color: colors.danger },
});
