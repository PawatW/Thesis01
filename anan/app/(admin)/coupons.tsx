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
  SectionHeader,
  Splash,
} from '@/components/ui';
import {
  createCoupon,
  deactivateCoupon,
  listAdminCoupons,
  TIER_LABEL,
  updateCoupon,
  type AdminCoupon,
  type CouponDiscountType,
  type CouponState,
  type CouponTier,
} from '@/features/coupons/api';
import { formatThaiDay, todayISO } from '@/lib/date';
import { colors, radius, space, statusTones, type } from '@/lib/theme';

type Tab = 'active' | 'inactive' | 'all';
type TierFilter = 'all' | CouponTier;

const TABS: { key: Tab; label: string }[] = [
  { key: 'active', label: 'กำลังใช้' },
  { key: 'inactive', label: 'ปิด/หมดอายุ' },
  { key: 'all', label: 'ทั้งหมด' },
];

const TIER_TABS: { key: TierFilter; label: string }[] = [
  { key: 'all', label: 'ทุกระดับ' },
  { key: 'platform', label: 'ของแพลตฟอร์ม' },
  { key: 'shop', label: 'ของร้านค้า' },
];

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
 * คูปองส่วนลดรายรอบ — ฝั่งผู้ดูแลแพลตฟอร์ม (feature 18 · W13 Flow A)
 *
 * ★ ไม่มีปุ่มลบโดยตั้งใจ ★ คูปองที่ถูกใช้ไปแล้วมีออเดอร์ชี้กลับมาหาเสมอ
 * การลบทำให้ยอดเงินในอดีตอธิบายไม่ได้ — ใช้ "ปิดคูปอง" แทน ซึ่งห้ามจองใหม่
 * แต่ไม่แตะใบที่ผู้ซื้อจองไว้แล้ว
 *
 * ตัวเลข "จองอยู่ / ใช้แล้ว / คืนแล้ว" โชว์ทุกใบ เพราะโควตาถูกกินตั้งแต่ตอนจอง
 * ผู้ดูแลต้องเห็นก่อนกดลดโควตาหรือปิดคูปอง ไม่ใช่รู้ตอนโดนปฏิเสธ
 */
export default function AdminCouponsScreen() {
  const [tab, setTab] = useState<Tab>('active');
  const [tierTab, setTierTab] = useState<TierFilter>('all');
  const [items, setItems] = useState<AdminCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  // ฟอร์มออกคูปองใหม่
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [discountType, setDiscountType] = useState<CouponDiscountType>('percent');
  const [value, setValue] = useState('');
  const [cap, setCap] = useState('');
  const [minOrder, setMinOrder] = useState('');
  const [startsAt, setStartsAt] = useState(todayISO());
  const [endsAt, setEndsAt] = useState('');
  const [quota, setQuota] = useState('');

  const [editing, setEditing] = useState<string | null>(null);
  const [editQuota, setEditQuota] = useState('');

  const reload = useCallback(async () => {
    const { data, error: err } = await listAdminCoupons(
      tab,
      tierTab === 'all' ? undefined : tierTab,
    );
    setItems(data ?? []);
    setError(err);
    setLoading(false);
  }, [tab, tierTab]);

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
    endsAt > startsAt;

  if (loading) return <Splash />;

  return (
    <>
      <SectionHeader title="คูปองส่วนลด" action={<DemoBadge compact />} />
      <Text style={styles.lead}>
        ผู้ดูแลเป็นคนออกคูปอง · ร้านค้าเลือกเองว่าสินค้าไหนเข้าร่วม ·
        ผู้ซื้อเลือกใช้กับ&quot;รอบใดรอบหนึ่ง&quot;ก่อนวันตัดเงิน
      </Text>

      {error != null ? <ErrorNote id="admin-coupons-error" message={error} /> : null}
      {toast != null ? (
        <Pressable id="admin-coupons-toast" onPress={() => setToast(null)}>
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </Pressable>
      ) : null}

      {/* ---------------- ออกคูปองใหม่ ---------------- */}
      <Card>
        <SectionHeader title="ออกคูปองใหม่" />
        <TextField
          id="admin-coupon-code"
          label="โค้ด (A-Z 0-9 และ - · 4-24 ตัว)"
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase())}
          autoCapitalize="characters"
          maxLength={24}
        />
        <TextField
          id="admin-coupon-title"
          label="ชื่อแคมเปญ (ผู้ซื้อเห็นข้อความนี้)"
          value={title}
          onChangeText={setTitle}
          maxLength={120}
        />

        <View style={styles.typeRow}>
          {(['percent', 'fixed'] as const).map((t) => (
            <Pressable
              key={t}
              id={`admin-coupon-type-${t}`}
              onPress={() => {
                setDiscountType(t);
                if (t === 'fixed') setCap('');
              }}
              accessibilityRole="button"
              style={[styles.typeChip, discountType === t && styles.typeChipOn]}
            >
              <Text
                style={[
                  styles.typeText,
                  discountType === t && styles.typeTextOn,
                ]}
              >
                {t === 'percent' ? 'ลดเป็นเปอร์เซ็นต์' : 'ลดเป็นจำนวนเงิน'}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextField
          id="admin-coupon-value"
          label={discountType === 'percent' ? 'ลดกี่ % (1-100)' : 'ลดกี่บาท'}
          value={value}
          onChangeText={setValue}
          keyboardType="numeric"
        />
        {discountType === 'percent' ? (
          <TextField
            id="admin-coupon-cap"
            label="เพดานส่วนลดต่อรอบ (บาท · เว้นว่างได้)"
            value={cap}
            onChangeText={setCap}
            keyboardType="numeric"
          />
        ) : null}
        <TextField
          id="admin-coupon-min"
          label="ยอดขั้นต่ำต่อรอบ (บาท · เว้นว่างได้)"
          value={minOrder}
          onChangeText={setMinOrder}
          keyboardType="numeric"
        />
        <TextField
          id="admin-coupon-starts"
          label="เริ่มใช้ได้ (YYYY-MM-DD)"
          value={startsAt}
          onChangeText={setStartsAt}
          maxLength={10}
        />
        <TextField
          id="admin-coupon-ends"
          label="ใช้ได้ถึง (YYYY-MM-DD)"
          value={endsAt}
          onChangeText={setEndsAt}
          maxLength={10}
        />
        <TextField
          id="admin-coupon-quota"
          label="จำกัดจำนวนคนทั้งแคมเปญ (เว้นว่าง = ไม่จำกัด)"
          value={quota}
          onChangeText={setQuota}
          keyboardType="numeric"
        />
        <Text style={styles.hint}>
          1 คนใช้คูปองใบหนึ่งได้ครั้งเดียว และ 1 รอบใช้ได้ 1 ใบ — บังคับที่ฐานข้อมูล
        </Text>

        <Button
          id="admin-coupon-create"
          label="ออกคูปอง"
          loading={busy}
          disabled={!canSubmit}
          onPress={() => {
            void run(
              () =>
                createCoupon({
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
                }),
              'ออกคูปองแล้ว — บอกร้านให้เข้าร่วมได้เลย',
            ).then((ok) => {
              if (!ok) return;
              setCode('');
              setTitle('');
              setValue('');
              setCap('');
              setMinOrder('');
              setEndsAt('');
              setQuota('');
            });
          }}
        />
      </Card>

      {/* ---------------- รายการ ---------------- */}
      <View style={styles.tabs}>
        {TIER_TABS.map((t) => (
          <Pressable
            key={t.key}
            id={`admin-coupons-tier-${t.key}`}
            onPress={() => {
              setTierTab(t.key);
              setLoading(true);
            }}
            accessibilityRole="button"
            style={[styles.tab, tierTab === t.key && styles.tabOn]}
          >
            <Text style={[styles.tabText, tierTab === t.key && styles.tabTextOn]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            id={`admin-coupons-tab-${t.key}`}
            onPress={() => {
              setTab(t.key);
              setLoading(true);
            }}
            accessibilityRole="button"
            style={[styles.tab, tab === t.key && styles.tabOn]}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            id="admin-coupons-empty"
            title="ยังไม่มีคูปองในกลุ่มนี้"
            body="ออกคูปองจากฟอร์มด้านบน แล้วให้ร้านค้าเลือกสินค้าที่เข้าร่วม"
          />
        </Card>
      ) : null}

      {items.map((c) => (
        <Card key={c.id} id={`admin-coupon-${c.id}`}>
          <View style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={type.bodyStrong}>
                {c.code} <Text style={styles.muted}>· {c.title}</Text>
              </Text>
              <Text id={`admin-coupon-tier-${c.id}`} style={styles.muted}>
                {TIER_LABEL[c.tier]}
                {c.shopName == null ? '' : ` · ร้าน ${c.shopName}`}
                {c.appliesToAllProducts ? ' · ใช้ได้ทั้งร้าน' : ''}
              </Text>
              <Text id={`admin-coupon-label-${c.id}`} style={styles.muted}>
                {c.label}
                {c.minOrderAmount != null
                  ? ` · ยอดขั้นต่ำ ฿${c.minOrderAmount.toFixed(2)}`
                  : ''}
              </Text>
              <Text style={styles.muted}>
                {formatThaiDay(c.startsAt)} – {formatThaiDay(c.endsAt)} ·
                สินค้าที่เข้าร่วม {c.productCount} ชิ้น
              </Text>
              <Text id={`admin-coupon-usage-${c.id}`} style={styles.usage}>
                จองอยู่ {c.reservedCount} · ใช้แล้ว {c.consumedCount} · คืนแล้ว{' '}
                {c.releasedCount}
                {c.maxRedemptions != null
                  ? ` · กินโควตา ${c.inUseCount}/${c.maxRedemptions}`
                  : ' · ไม่จำกัดจำนวน'}
              </Text>
            </View>
            <View style={styles.rowActions}>
              <Pill
                id={`admin-coupon-state-${c.id}`}
                label={STATE_LABEL[c.state]}
                tone={STATE_TONE[c.state]}
                dot
              />
              {c.isActive && c.tier === 'platform' ? (
                <>
                  <Action
                    id={`admin-coupon-edit-${c.id}`}
                    label="แก้โควตา"
                    disabled={busy}
                    onPress={() => {
                      setEditing(c.id);
                      setEditQuota(
                        c.maxRedemptions == null ? '' : String(c.maxRedemptions),
                      );
                    }}
                  />
                  <Action
                    id={`admin-coupon-deactivate-${c.id}`}
                    label="ปิดคูปอง"
                    danger
                    disabled={busy}
                    onPress={() =>
                      void run(
                        () => deactivateCoupon(c.id),
                        'ปิดคูปองแล้ว — ใบที่จองไว้ยังใช้ได้ตามเดิม',
                      )
                    }
                  />
                </>
              ) : null}
            </View>
          </View>

          {editing === c.id ? (
            <View style={styles.editRow}>
              <TextField
                id="admin-coupon-edit-quota"
                label={`โควตาใหม่ (ต้องไม่ต่ำกว่า ${c.inUseCount} ที่ใช้ไปแล้ว · เว้นว่าง = ไม่จำกัด)`}
                value={editQuota}
                onChangeText={setEditQuota}
                keyboardType="numeric"
              />
              <View style={styles.rowActions}>
                <Button
                  id="admin-coupon-edit-save"
                  label="บันทึก"
                  loading={busy}
                  onPress={() => {
                    void run(
                      () =>
                        updateCoupon(c.id, {
                          maxRedemptions: num(editQuota) ?? null,
                        }),
                      'แก้โควตาแล้ว',
                    ).then((ok) => {
                      if (ok) setEditing(null);
                    });
                  }}
                />
                <Button
                  id="admin-coupon-edit-cancel"
                  label="ยกเลิก"
                  variant="ghost"
                  onPress={() => setEditing(null)}
                />
              </View>
            </View>
          ) : null}
        </Card>
      ))}
    </>
  );
}

function Action({
  label,
  onPress,
  disabled,
  danger,
  id,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  danger?: boolean;
  id: string;
}) {
  return (
    <Pressable
      id={id}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.action,
        danger === true && styles.actionDanger,
        pressed && styles.actionPressed,
        disabled && styles.actionDisabled,
      ]}
    >
      <Text style={[styles.actionText, danger === true && styles.actionTextDanger]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lead: { ...type.small, color: colors.textMuted },
  muted: { ...type.caption, color: colors.textMuted },
  usage: { ...type.caption, color: colors.text },
  hint: { ...type.caption, color: colors.textMuted },
  toast: {
    backgroundColor: statusTones.active.bg,
    borderRadius: radius.md,
    padding: space.md,
  },
  toastText: { ...type.small, color: statusTones.active.fg },
  typeRow: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  typeChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  typeChipOn: { borderColor: colors.primary, backgroundColor: statusTones.active.bg },
  typeText: { ...type.caption, color: colors.text },
  typeTextOn: { color: statusTones.active.fg },
  tabs: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  tab: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  tabOn: { borderColor: colors.primary, backgroundColor: statusTones.active.bg },
  tabText: { ...type.caption, color: colors.text },
  tabTextOn: { color: statusTones.active.fg },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
    flexWrap: 'wrap',
  },
  rowMain: { gap: 2, flexShrink: 1 },
  rowActions: {
    flexDirection: 'row',
    gap: space.sm,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  editRow: {
    gap: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.md,
  },
  action: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  actionPressed: { borderColor: colors.primary },
  actionDisabled: { opacity: 0.5 },
  actionDanger: {
    borderColor: colors.dangerSoftBorder,
    backgroundColor: colors.dangerSoft,
  },
  actionText: { ...type.caption, color: colors.text },
  actionTextDanger: { color: colors.danger },
});
