import { useFocusEffect } from 'expo-router';
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
  SectionHeader,
  Splash,
} from '@/components/ui';
import {
  listIssues,
  listProducts,
  listShops,
  setProductSuspension,
  setShopSuspension,
  type AdminIssue,
  type AdminProduct,
  type AdminShop,
} from '@/features/admin/api';
import { formatThaiDate } from '@/lib/date';
import { colors, radius, space, statusTones, type } from '@/lib/theme';

type Tab = 'shops' | 'products' | 'issues';

const TABS: { key: Tab; label: string }[] = [
  { key: 'shops', label: 'ร้านค้า' },
  { key: 'products', label: 'สินค้า' },
  { key: 'issues', label: 'เคสปัญหา' },
];

/** เคสที่ค้างเกินนี้ต้องเด่น — ตัวชี้วัดคุณภาพร้าน (feature 16) */
const STALE_ISSUE_DAYS = 7;

type SuspendTarget =
  | { kind: 'shop'; id: string; name: string; subscribers: number }
  | { kind: 'product'; id: string; name: string; subscribers: number };

/**
 * Moderation (feature 14 · W10 Flow C)
 *
 * ★ กล่องยืนยันต้องบอกผลที่จะเกิดกับ "คนอื่น" ก่อนกด ★ การระงับร้านไม่ได้แค่ซ่อน
 * สินค้า แต่หยุด subscription ของผู้ซื้อทุกคนของร้านนั้นด้วย — ตัวเลขที่โชว์
 * ในกล่องคือจำนวนคนที่จะถูกกระทบจริง
 */
export default function AdminModerationScreen() {
  const [tab, setTab] = useState<Tab>('shops');
  const [q, setQ] = useState('');
  const [shops, setShops] = useState<AdminShop[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [issues, setIssues] = useState<AdminIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [target, setTarget] = useState<SuspendTarget | null>(null);
  const [reason, setReason] = useState('');
  const submitting = useRef(false);

  const reload = useCallback(async () => {
    if (tab === 'shops') {
      const { data, error: err } = await listShops(q.trim());
      setShops(data ?? []);
      setError(err);
    } else if (tab === 'products') {
      const { data, error: err } = await listProducts(q.trim());
      setProducts(data ?? []);
      setError(err);
    } else {
      const { data, error: err } = await listIssues('open');
      setIssues(data ?? []);
      setError(err);
    }
    setLoading(false);
  }, [tab, q]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function suspend(t: SuspendTarget, on: boolean, why?: string) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const { data, error: err } =
      t.kind === 'shop'
        ? await setShopSuspension(t.id, on, why)
        : await setProductSuspension(t.id, on, why);
    submitting.current = false;
    setBusy(false);
    if (err != null) {
      await reload();
      setError(err);
      return;
    }
    setTarget(null);
    setReason('');
    setToast(
      on
        ? `ระงับแล้ว — หยุดรายการของผู้ซื้อ ${data?.affectedSubscriptions ?? 0} รายการ (ไม่มีการตัดเงิน)`
        : `คืนสถานะแล้ว — ปลุกรายการกลับมา ${data?.affectedSubscriptions ?? 0} รายการ`,
    );
    await reload();
  }

  if (loading) return <Splash />;

  return (
    <>
      <SectionHeader title="ดูแลร้านและสินค้า" />
      <Card>
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              id={`admin-mod-tab-${t.key}`}
              accessibilityRole="button"
              onPress={() => {
                setTab(t.key);
                setToast(null);
              }}
              style={[styles.tab, tab === t.key && styles.tabOn]}
            >
              <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {tab === 'issues' ? null : (
          <TextField
            id="admin-mod-search"
            label="ค้นหาจากชื่อ"
            value={q}
            onChangeText={setQ}
            maxLength={60}
          />
        )}
      </Card>

      {error != null ? <ErrorNote id="admin-mod-error" message={error} /> : null}
      {toast != null ? (
        <Pressable id="admin-mod-toast" onPress={() => setToast(null)}>
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </Pressable>
      ) : null}

      {tab === 'shops'
        ? shops.map((shop) => {
            const suspended = shop.suspendedAt != null;
            return (
              <Card key={shop.id} id={`admin-shop-${shop.id}`}>
                <SectionHeader
                  title={shop.name}
                  action={
                    <Pill
                      id={`admin-shop-status-${shop.id}`}
                      label={suspended ? 'ถูกระงับ' : shop.isActive ? 'เปิดอยู่' : 'ร้านปิดเอง'}
                      tone={suspended ? 'sale' : shop.isActive ? 'active' : 'cancelled'}
                    />
                  }
                />
                <Text style={styles.muted}>
                  {shop.ownerName} · {shop.ownerEmail} · สินค้า {shop.productCount} ชิ้น
                </Text>
                <View style={styles.signals}>
                  <Text id={`admin-shop-subs-${shop.id}`} style={styles.signal}>
                    สมาชิก {shop.activeSubscribers}
                  </Text>
                  <Text
                    id={`admin-shop-issues-${shop.id}`}
                    style={[styles.signal, shop.openIssues > 0 && styles.signalAlert]}
                  >
                    เคสค้าง {shop.openIssues}
                  </Text>
                  <Text
                    id={`admin-shop-cancels-${shop.id}`}
                    style={[styles.signal, shop.cancelledOrders30d > 0 && styles.signalAlert]}
                  >
                    ยกเลิก 30 วัน {shop.cancelledOrders30d}
                  </Text>
                </View>
                {suspended ? (
                  <Text id={`admin-shop-reason-${shop.id}`} style={styles.muted}>
                    เหตุผล: {shop.suspendedReason ?? '—'}
                  </Text>
                ) : null}
                <Button
                  id={`admin-shop-suspend-${shop.id}`}
                  label={suspended ? 'คืนสถานะร้าน' : 'ระงับร้าน'}
                  variant={suspended ? 'secondary' : 'danger'}
                  loading={busy}
                  onPress={() => {
                    const t: SuspendTarget = {
                      kind: 'shop',
                      id: shop.id,
                      name: shop.name,
                      subscribers: shop.activeSubscribers,
                    };
                    if (suspended) {
                      void suspend(t, false);
                      return;
                    }
                    setTarget(t);
                    setReason('');
                  }}
                />
              </Card>
            );
          })
        : null}

      {tab === 'products'
        ? products.map((product) => {
            const suspended = product.suspendedAt != null;
            return (
              <Card key={product.id} id={`admin-product-${product.id}`}>
                <SectionHeader
                  title={product.name}
                  action={
                    <Pill
                      id={`admin-product-status-${product.id}`}
                      label={suspended ? 'ถูกระงับ' : product.isActive ? 'ขายอยู่' : 'ปิดการขาย'}
                      tone={suspended ? 'sale' : product.isActive ? 'active' : 'cancelled'}
                    />
                  }
                />
                <Text style={styles.muted}>
                  {product.shopName} · สมาชิก {product.activeSubscribers} ราย
                </Text>
                {suspended ? (
                  <Text style={styles.muted}>เหตุผล: {product.suspendedReason ?? '—'}</Text>
                ) : null}
                <Button
                  id={`admin-product-suspend-${product.id}`}
                  label={suspended ? 'คืนสถานะสินค้า' : 'ระงับสินค้า'}
                  variant={suspended ? 'secondary' : 'danger'}
                  loading={busy}
                  onPress={() => {
                    const t: SuspendTarget = {
                      kind: 'product',
                      id: product.id,
                      name: product.name,
                      subscribers: product.activeSubscribers,
                    };
                    if (suspended) {
                      void suspend(t, false);
                      return;
                    }
                    setTarget(t);
                    setReason('');
                  }}
                />
              </Card>
            );
          })
        : null}

      {tab === 'issues' ? (
        issues.length === 0 ? (
          <Card>
            <EmptyState
              id="admin-issues-empty"
              title="ไม่มีเคสค้างในระบบ"
              body="เคสที่ผู้ซื้อแจ้งและร้านยังไม่ตอบจะขึ้นที่นี่ เรียงจากเคสที่ค้างนานที่สุด"
            />
          </Card>
        ) : (
          issues.map((issue) => (
            <Card
              key={issue.id}
              id={`admin-issue-${issue.id}`}
              style={issue.ageDays > STALE_ISSUE_DAYS ? styles.staleCard : undefined}
            >
              <SectionHeader
                title={issue.productName}
                action={
                  <Pill
                    id={`admin-issue-age-${issue.id}`}
                    label={`ค้าง ${issue.ageDays} วัน`}
                    tone={issue.ageDays > STALE_ISSUE_DAYS ? 'sale' : 'paused'}
                  />
                }
              />
              <Text style={styles.muted}>
                {issue.shopName} · แจ้งเมื่อ {formatThaiDate(issue.createdAt.slice(0, 10))}
              </Text>
              <Text style={type.body}>{issue.detail}</Text>
            </Card>
          ))
        )
      ) : null}

      {tab === 'shops' && shops.length === 0 ? (
        <Card>
          <EmptyState id="admin-shops-empty" title="ไม่พบร้านที่ตรงกับคำค้น" />
        </Card>
      ) : null}
      {tab === 'products' && products.length === 0 ? (
        <Card>
          <EmptyState id="admin-products-empty" title="ไม่พบสินค้าที่ตรงกับคำค้น" />
        </Card>
      ) : null}

      <Modal
        visible={target != null}
        transparent
        animationType="fade"
        onRequestClose={() => setTarget(null)}
      >
        <KeyboardAvoidingView
          id="admin-suspend-modal"
          style={styles.backdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheet}>
            <Text style={type.h3}>
              {target?.kind === 'shop' ? 'ระงับร้านนี้' : 'ระงับสินค้าชิ้นนี้'}
            </Text>
            {/* ★ บอกผลที่จะเกิดกับผู้ซื้อก่อนกด ★ ไม่ใช่แค่ "ยืนยันไหม" */}
            <Text id="admin-suspend-warning" style={type.body}>
              {target?.kind === 'shop'
                ? 'สินค้าทั้งร้านจะหายจากหน้าค้นหาทันที'
                : 'สินค้าชิ้นนี้จะหายจากหน้าค้นหาทันที'}{' '}
              และรายการของผู้ซื้อ {target?.subscribers ?? 0} รายการจะถูกหยุดชั่วคราว —{' '}
              <Text style={type.bodyStrong}>ไม่มีการตัดเงินระหว่างที่ถูกระงับ</Text>{' '}
              ผู้ซื้อจะได้รับแจ้งเตือน และปลดเองไม่ได้จนกว่าคุณจะคืนสถานะ
            </Text>
            <TextField
              id="admin-suspend-reason"
              label="เหตุผล (บันทึกไว้ในระบบ)"
              value={reason}
              onChangeText={setReason}
              multiline
              maxLength={200}
              hint="อย่างน้อย 5 ตัวอักษร"
            />
            <View style={styles.sheetActions}>
              <Button
                id="admin-suspend-confirm"
                label="ยืนยันการระงับ"
                variant="danger"
                loading={busy}
                disabled={reason.trim().length < 5}
                onPress={() => {
                  if (target != null) void suspend(target, true, reason.trim());
                }}
              />
              <Button
                id="admin-suspend-close"
                label="ปิด"
                variant="ghost"
                onPress={() => setTarget(null)}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  muted: { ...type.caption, color: colors.textMuted },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tab: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  tabOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  tabText: { ...type.caption, color: colors.text },
  tabTextOn: { color: colors.primaryStrong },
  toast: { backgroundColor: statusTones.active.bg, borderRadius: radius.md, padding: space.md },
  toastText: { ...type.small, color: statusTones.active.fg },
  signals: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  signal: { ...type.caption, color: colors.textMuted },
  signalAlert: { color: colors.danger },
  staleCard: { borderWidth: 1, borderColor: colors.dangerSoftBorder },
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
    maxWidth: 480,
  },
  sheetActions: { flexDirection: 'row', gap: space.sm },
});
