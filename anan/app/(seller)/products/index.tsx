import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
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
  EmptyState,
  ErrorNote,
  Pill,
  Screen,
  SectionHeader,
  Splash,
} from '@/components/ui';
import { listCategories, type Category } from '@/features/catalog/api';
import {
  addPlan,
  createProduct,
  discountPercent,
  listMyProducts,
  updatePlan,
  updateProduct,
  type SellerPlan,
  type SellerProduct,
} from '@/features/seller/api';
import { colors, radius, space, type } from '@/lib/theme';

const CYCLES = [
  { value: '2w', label: 'ทุก 2 สัปดาห์' },
  { value: '1m', label: 'ทุกเดือน' },
  { value: '2m', label: 'ทุก 2 เดือน' },
] as const;

type NewPlanDraft = { enabled: boolean; price: string; qty: string };

/**
 * สินค้าของร้าน (feature 11 · W07)
 *
 * รวมทั้งรายการ ฟอร์มลงขาย และการแก้แผนไว้หน้าเดียวโดยตั้งใจ: ทุก action ของร้าน
 * จบใน ≤2 คลิกเหมือนฝั่งผู้ซื้อ และการแก้ราคาต้องเห็นจำนวนสมาชิกที่กระทบ
 * อยู่ข้าง ๆ ช่องราคาตอนกด ไม่ใช่ต้องข้ามหน้าไปดู
 */
export default function SellerProductsScreen() {
  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [oneTimePrice, setOneTimePrice] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [netAmount, setNetAmount] = useState('');
  const [unit, setUnit] = useState('');
  const [drafts, setDrafts] = useState<Record<string, NewPlanDraft>>({
    '2w': { enabled: false, price: '', qty: '1' },
    '1m': { enabled: true, price: '', qty: '1' },
    '2m': { enabled: false, price: '', qty: '1' },
  });
  const [formError, setFormError] = useState<string | null>(null);

  /**
   * ★ กันกดปุ่ม "ลงขาย" รัวในเฟรมเดียวกัน ★ `busy` เป็น state ที่อัปเดตหลัง
   * re-render จึงกันไม่ทัน — และ endpoint นี้ไม่มี unique constraint ไหนรองรับ
   * (สินค้าใหม่ id ใหม่ทุกครั้ง) ต่างจากปุ่มอื่นที่ DB ช่วยกันให้อยู่แล้ว
   * (security-rules C-9 · แพตเทิร์นเดียวกับ `checkout/[planId].tsx`)
   */
  const submitting = useRef(false);

  /** ยืนยันการขึ้น/ลดราคา — ต้องบอกจำนวนคนที่กระทบก่อนกด (feature 11) */
  const [priceConfirm, setPriceConfirm] = useState<{
    plan: SellerPlan;
    product: SellerProduct;
    price: number;
  } | null>(null);

  /** เปิดรอบส่งเพิ่มให้สินค้าที่มีอยู่ — ร้านเป็นคนกรอกราคาเอง */
  const [newPlanFor, setNewPlanFor] = useState<{
    product: SellerProduct;
    cycle: string;
    label: string;
  } | null>(null);
  const [newPlanPrice, setNewPlanPrice] = useState('');
  const [newPlanQty, setNewPlanQty] = useState('1');

  const reload = useCallback(async () => {
    const [mine, cats] = await Promise.all([listMyProducts(), listCategories()]);
    setProducts(mine.data ?? []);
    setCategories(cats);
    setError(mine.error);
    setLoading(false);
  }, []);

  /**
   * โหลดใหม่ทุกครั้งที่กลับมาที่แท็บนี้ — ไม่ใช่แค่ตอน mount
   *
   * expo-router ไม่ unmount แท็บที่ถูกสลับออก ถ้าใช้ `useEffect` เปล่า ๆ ตัวเลข
   * จะค้างค่าที่โหลดครั้งแรก ทั้งที่อีก 3 แท็บของร้านแก้ข้อมูลชุดเดียวกันอยู่
   */
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function run(
    action: () => Promise<{ error: string | null }>,
    okMessage: string,
  ) {
    setBusy(true);
    setError(null);
    const { error: err } = await action();
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

  async function handleCreate() {
    if (submitting.current) return;
    setFormError(null);

    const price = Number(oneTimePrice);
    const plans = CYCLES.filter((c) => drafts[c.value]?.enabled === true).map((c) => ({
      cycle: c.value,
      pricePerCycle: Number(drafts[c.value]?.price ?? '0'),
      qtyPerCycle: Number(drafts[c.value]?.qty ?? '1'),
    }));

    // ตรวจฝั่งนี้เพื่อให้ error อ่านง่ายเป็นภาษาไทย — API ตรวจซ้ำทุกข้ออยู่แล้ว
    if (name.trim().length < 2) return setFormError('ชื่อสินค้าต้องยาวอย่างน้อย 2 ตัวอักษร');
    if (categoryId == null) return setFormError('เลือกหมวดสินค้า');
    if (!Number.isFinite(price) || price <= 0) return setFormError('ราคาซื้อครั้งเดียวต้องมากกว่า 0');
    if (!/^https:\/\//.test(imageUrl.trim())) return setFormError('ใส่ลิงก์รูป https อย่างน้อย 1 รูป');
    if (plans.length === 0) return setFormError('เปิดรอบส่งอย่างน้อย 1 รอบ');
    if (plans.some((p) => !Number.isFinite(p.pricePerCycle) || p.pricePerCycle <= 0)) {
      return setFormError('ราคาต่อรอบของรอบที่เปิดต้องมากกว่า 0');
    }

    submitting.current = true;
    const ok = await run(
      () =>
        createProduct({
          name: name.trim(),
          categoryId,
          images: [imageUrl.trim()],
          oneTimePrice: price,
          ...(netAmount.trim() === '' ? {} : { netAmount: Number(netAmount) }),
          ...(unit.trim() === '' ? {} : { unit: unit.trim() }),
          plans,
        }),
      'ลงขายสินค้าแล้ว',
    );
    submitting.current = false;
    if (ok) {
      setFormOpen(false);
      setName('');
      setOneTimePrice('');
      setImageUrl('');
      setNetAmount('');
      setUnit('');
    }
  }

  if (loading) return <Splash />;

  return (
    <Screen>
      <Card>
        <SectionHeader
          title={`สินค้าของฉัน (${products.length})`}
          action={
            <Button
              id="seller-new-open"
              label={formOpen ? 'ปิดฟอร์ม' : 'เพิ่มสินค้า'}
              variant={formOpen ? 'ghost' : 'primary'}
              onPress={() => setFormOpen((v) => !v)}
            />
          }
        />
        <Text style={styles.muted}>
          ปิดการขายได้ทุกเมื่อ — สมาชิกเดิมยังได้รับของต่อจนกว่าจะยกเลิกเอง
        </Text>
      </Card>

      {error != null ? <ErrorNote id="seller-products-error" message={error} /> : null}
      {toast != null ? (
        <Pressable id="seller-toast" onPress={() => setToast(null)}>
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </Pressable>
      ) : null}

      {formOpen ? (
        <Card id="seller-new-form">
          <SectionHeader title="ขั้น 1 — ข้อมูลสินค้า" />
          <TextField id="seller-new-name" label="ชื่อสินค้า" value={name} onChangeText={setName} maxLength={120} />
          <Text style={styles.label}>หมวดสินค้า</Text>
          <View style={styles.chips}>
            {categories.map((c) => (
              <Pressable
                key={c.id}
                id={`seller-new-category-${c.id}`}
                accessibilityRole="button"
                onPress={() => setCategoryId(c.id)}
                style={[styles.chip, categoryId === c.id && styles.chipOn]}
              >
                <Text style={[styles.chipText, categoryId === c.id && styles.chipTextOn]}>{c.name}</Text>
              </Pressable>
            ))}
          </View>
          <TextField
            id="seller-new-price"
            label="ราคาซื้อครั้งเดียว (บาท)"
            value={oneTimePrice}
            onChangeText={setOneTimePrice}
            keyboardType="decimal-pad"
          />
          <TextField
            id="seller-new-image"
            label="ลิงก์รูปสินค้า (https)"
            value={imageUrl}
            onChangeText={setImageUrl}
            placeholder="https://..."
            hint="ยังไม่ได้ตั้งค่าที่เก็บรูปบนเครื่องนี้ — ใส่ลิงก์รูปได้เลย"
          />
          <View style={styles.pair}>
            <View style={styles.pairItem}>
              <TextField
                id="seller-new-net"
                label="ปริมาณสุทธิ"
                value={netAmount}
                onChangeText={setNetAmount}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.pairItem}>
              <TextField id="seller-new-unit" label="หน่วย" value={unit} onChangeText={setUnit} placeholder="g" />
            </View>
          </View>

          <SectionHeader title="ขั้น 2 — รอบส่ง" />
          {CYCLES.map((c) => {
            const draft = drafts[c.value] ?? { enabled: false, price: '', qty: '1' };
            const percent = discountPercent(Number(draft.price), Number(draft.qty), Number(oneTimePrice));
            return (
              <View key={c.value} style={styles.planRow}>
                <Pressable
                  id={`seller-new-plan-${c.value}`}
                  accessibilityRole="button"
                  onPress={() =>
                    setDrafts((prev) => ({
                      ...prev,
                      [c.value]: { ...draft, enabled: !draft.enabled },
                    }))
                  }
                  style={[styles.chip, draft.enabled && styles.chipOn]}
                >
                  <Text style={[styles.chipText, draft.enabled && styles.chipTextOn]}>{c.label}</Text>
                </Pressable>
                {draft.enabled ? (
                  <>
                    <View style={styles.pairItem}>
                      <TextField
                        id={`seller-new-plan-price-${c.value}`}
                        label="ราคาต่อรอบ"
                        value={draft.price}
                        onChangeText={(v) =>
                          setDrafts((prev) => ({ ...prev, [c.value]: { ...draft, price: v } }))
                        }
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={styles.pairItem}>
                      <TextField
                        id={`seller-new-plan-qty-${c.value}`}
                        label="ชิ้นต่อรอบ"
                        value={draft.qty}
                        onChangeText={(v) =>
                          setDrafts((prev) => ({ ...prev, [c.value]: { ...draft, qty: v } }))
                        }
                        keyboardType="number-pad"
                      />
                    </View>
                    {/* ส่วนลดติดลบ = เตือน ไม่บล็อก (W07 E2) */}
                    <Text
                      id={`seller-new-plan-discount-${c.value}`}
                      style={percent > 0 ? styles.discount : styles.warn}
                    >
                      {percent > 0 ? `ถูกกว่า ${percent}%` : 'แพงกว่าซื้อปกติ'}
                    </Text>
                  </>
                ) : null}
              </View>
            );
          })}

          {formError != null ? <ErrorNote id="seller-new-error" message={formError} /> : null}
          <Button id="seller-new-submit" label="ลงขาย" onPress={handleCreate} loading={busy} fullWidth />
        </Card>
      ) : null}

      {products.length === 0 ? (
        <Card>
          <EmptyState
            id="seller-products-empty"
            title="ยังไม่มีสินค้า"
            body="ลงสินค้าชิ้นแรกเพื่อเริ่มรับสมาชิก"
          />
        </Card>
      ) : null}

      {products.map((p) => (
        <Card key={p.id} id={`seller-product-${p.id}`}>
          <SectionHeader
            title={p.name}
            action={
              <Pill
                id={`seller-product-status-${p.id}`}
                label={p.isSuspended ? 'ถูกระงับ' : p.isActive ? 'เปิดขาย' : 'ปิดขาย'}
                tone={p.isSuspended ? 'frozen' : p.isActive ? 'active' : 'paused'}
              />
            }
          />
          <Text id={`seller-product-subs-${p.id}`} style={styles.muted}>
            สมาชิกที่ใช้งานอยู่ {p.activeSubscribers} คน · ราคาซื้อครั้งเดียว ฿
            {p.oneTimePrice.toLocaleString('th-TH')}
          </Text>
          {/* ชื่อ/คำอธิบาย/รูป/หมวด/ขนาดบรรจุ อยู่หน้าแก้ไขแยก — หน้านี้เก็บไว้เฉพาะ
              ของที่ร้านแตะบ่อย (ราคา + เปิด/ปิดขาย) */}
          <Link href={{ pathname: '/(seller)/products/[id]', params: { id: p.id } }} asChild>
            <Pressable
              id={`seller-product-edit-${p.id}`}
              accessibilityRole="link"
              style={styles.editLink}
            >
              <Text style={styles.editLinkText}>แก้ไขรายละเอียดสินค้า →</Text>
            </Pressable>
          </Link>

          {p.plans.map((plan) => (
            <View key={plan.id} id={`seller-plan-${plan.id}`} style={styles.plan}>
              <View style={styles.planHead}>
                <Text style={type.bodyStrong}>{cycleLabel(plan.cycle)}</Text>
                <Pill
                  id={`seller-plan-status-${plan.id}`}
                  label={plan.isActive ? 'เปิดรับ' : 'ปิดรับสมาชิกใหม่'}
                  tone={plan.isActive ? 'active' : 'paused'}
                />
              </View>
              <Text style={styles.muted}>
                ฿{plan.pricePerCycle.toLocaleString('th-TH')} / รอบ · {plan.qtyPerCycle} ชิ้น ·
                สมาชิก {plan.activeSubscribers} คน
              </Text>
              <PlanPriceEditor
                // key ผูกกับราคาจริง — โดน 409 แล้ว reload ค่าใหม่ ช่องกรอกต้อง
                // ไม่ค้างเลขที่ไม่มีอยู่ใน DB ให้ร้านเข้าใจผิด
                key={`${plan.id}-${plan.pricePerCycle}`}
                plan={plan}
                busy={busy}
                onSubmit={(price) => setPriceConfirm({ plan, product: p, price })}
              />
              <Button
                id={`seller-plan-toggle-${plan.id}`}
                label={plan.isActive ? 'ปิดรับสมาชิกใหม่' : 'เปิดรับสมาชิกใหม่'}
                variant="ghost"
                onPress={() =>
                  void run(
                    () => updatePlan(plan.id, { isActive: !plan.isActive }),
                    plan.isActive ? 'ปิดรับสมาชิกใหม่แล้ว' : 'เปิดรับสมาชิกใหม่แล้ว',
                  )
                }
              />
            </View>
          ))}

          <View style={styles.actions}>
            {/* ราคาต้องมาจากร้านเสมอ — ระบบเดาให้ไม่ได้ เพราะแผนขึ้น catalog
                ให้คนสมัครได้ทันทีที่ราคานั้น (W07 ขั้น 2) */}
            {CYCLES.filter((c) => !p.plans.some((plan) => plan.cycle === c.value)).map((c) => (
              <Button
                key={c.value}
                id={`seller-product-add-plan-${p.id}-${c.value}`}
                label={`เปิด ${c.label}`}
                variant="ghost"
                onPress={() => {
                  setNewPlanFor({ product: p, cycle: c.value, label: c.label });
                  setNewPlanPrice('');
                  setNewPlanQty('1');
                }}
              />
            ))}
            <Button
              id={`seller-product-toggle-${p.id}`}
              label={p.isActive ? 'ปิดการขาย' : 'เปิดการขาย'}
              variant="ghost"
              onPress={() =>
                void run(
                  () => updateProduct(p.id, { isActive: !p.isActive }),
                  p.isActive ? 'ปิดการขายแล้ว' : 'เปิดการขายแล้ว',
                )
              }
            />
          </View>
        </Card>
      ))}

      <Modal
        visible={newPlanFor != null}
        transparent
        animationType="fade"
        onRequestClose={() => setNewPlanFor(null)}
      >
        <KeyboardAvoidingView
          id="seller-add-plan-modal"
          style={styles.backdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheet}>
            <Text style={type.h3}>เปิด{newPlanFor?.label ?? ''}</Text>
            <Text style={styles.muted}>
              {newPlanFor == null
                ? ''
                : `${newPlanFor.product.name} · ราคาซื้อครั้งเดียว ฿${newPlanFor.product.oneTimePrice.toLocaleString('th-TH')}`}
            </Text>
            <TextField
              id="seller-add-plan-price"
              label="ราคาต่อรอบ (บาท)"
              value={newPlanPrice}
              onChangeText={setNewPlanPrice}
              keyboardType="decimal-pad"
            />
            <TextField
              id="seller-add-plan-qty"
              label="ชิ้นต่อรอบ"
              value={newPlanQty}
              onChangeText={setNewPlanQty}
              keyboardType="number-pad"
            />
            {newPlanFor != null && Number(newPlanPrice) > 0 ? (
              <Text
                id="seller-add-plan-discount"
                style={
                  discountPercent(
                    Number(newPlanPrice),
                    Number(newPlanQty),
                    newPlanFor.product.oneTimePrice,
                  ) > 0
                    ? styles.discount
                    : styles.warn
                }
              >
                {discountPercent(
                  Number(newPlanPrice),
                  Number(newPlanQty),
                  newPlanFor.product.oneTimePrice,
                ) > 0
                  ? `ถูกกว่าซื้อปกติ ${discountPercent(Number(newPlanPrice), Number(newPlanQty), newPlanFor.product.oneTimePrice)}%`
                  : 'แพงกว่าซื้อปกติ — ผู้ซื้อจะไม่เห็นส่วนลด'}
              </Text>
            ) : null}
            <View style={styles.sheetActions}>
              <Button
                id="seller-add-plan-submit"
                label="เปิดรอบส่ง"
                loading={busy}
                onPress={() => {
                  const target = newPlanFor;
                  const price = Number(newPlanPrice);
                  const qty = Number(newPlanQty);
                  if (target == null || !(price > 0) || !(qty > 0)) return;
                  setNewPlanFor(null);
                  void run(
                    () =>
                      addPlan(target.product.id, {
                        cycle: target.cycle,
                        pricePerCycle: price,
                        qtyPerCycle: qty,
                      }),
                    'เปิดรอบส่งใหม่แล้ว',
                  );
                }}
              />
              <Button
                id="seller-add-plan-close"
                label="ยกเลิก"
                variant="ghost"
                onPress={() => setNewPlanFor(null)}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={priceConfirm != null}
        transparent
        animationType="fade"
        onRequestClose={() => setPriceConfirm(null)}
      >
        <View id="seller-price-confirm" style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={type.h3}>ยืนยันราคาใหม่</Text>
            <Text id="seller-price-confirm-body" style={type.body}>
              {priceConfirm == null
                ? ''
                : `สมาชิกปัจจุบัน ${priceConfirm.plan.affectedSubscribers} คนจะจ่ายราคาใหม่ (฿${priceConfirm.price.toLocaleString('th-TH')}) ตั้งแต่รอบหน้า และระบบจะแจ้งเตือนทุกคนทันที`}
            </Text>
            <View style={styles.sheetActions}>
              <Button
                id="seller-price-confirm-ok"
                label="ยืนยัน"
                loading={busy}
                onPress={() => {
                  const target = priceConfirm;
                  setPriceConfirm(null);
                  if (target != null) {
                    void run(
                      () => updatePlan(target.plan.id, { pricePerCycle: target.price }),
                      'เปลี่ยนราคาแล้ว — แจ้งสมาชิกทุกคนเรียบร้อย',
                    );
                  }
                }}
              />
              <Button
                id="seller-price-confirm-close"
                label="ยกเลิก"
                variant="ghost"
                onPress={() => setPriceConfirm(null)}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

/** ช่องแก้ราคาต่อแผน — แยกเป็น component เพราะแต่ละแถวถือ state ของตัวเอง */
function PlanPriceEditor({
  plan,
  busy,
  onSubmit,
}: {
  plan: SellerPlan;
  busy: boolean;
  onSubmit: (price: number) => void;
}) {
  const [value, setValue] = useState(String(plan.pricePerCycle));
  const price = Number(value);
  const changed = Number.isFinite(price) && price > 0 && price !== plan.pricePerCycle;

  return (
    <View style={styles.priceRow}>
      <View style={styles.pairItem}>
        <TextField
          id={`seller-plan-price-${plan.id}`}
          label="ราคาต่อรอบ (บาท)"
          value={value}
          onChangeText={setValue}
          keyboardType="decimal-pad"
        />
      </View>
      <Button
        id={`seller-plan-save-${plan.id}`}
        label="บันทึกราคา"
        disabled={!changed || busy}
        onPress={() => onSubmit(price)}
      />
    </View>
  );
}

function cycleLabel(cycle: string): string {
  if (cycle === '2w') return 'ทุก 2 สัปดาห์';
  if (cycle === '2m') return 'ทุก 2 เดือน';
  return 'ทุกเดือน';
}

const styles = StyleSheet.create({
  editLink: { minHeight: 44, justifyContent: 'center' },
  editLinkText: { ...type.caption, color: colors.primaryStrong },
  muted: { ...type.caption, color: colors.textMuted },
  label: { ...type.label, color: colors.textMuted },
  toast: { backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: space.md },
  toastText: { ...type.small, color: colors.primaryStrong },
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
  pair: { flexDirection: 'row', gap: space.md },
  pairItem: { flex: 1, minWidth: 120 },
  planRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.md,
  },
  discount: { ...type.caption, color: colors.success },
  warn: { ...type.caption, color: colors.danger },
  plan: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
  planHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
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
