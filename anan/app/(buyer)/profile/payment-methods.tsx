import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, EmptyState, ErrorNote, Screen, SectionHeader, Splash } from '@/components/ui';
import {
  createPaymentMethod,
  deletePaymentMethod,
  listPaymentMethods,
  type PaymentMethod,
} from '@/features/auth/api';
import { CardFace } from '@/features/payment/CardFace';
import { CardForm, type CardPayload } from '@/features/payment/CardForm';
import type { CardBrand } from '@/features/payment/card';
import { colors, radius, space, statusTones, type } from '@/lib/theme';

/**
 * บัตรของฉัน (feature 09)
 *
 * ★ เลขบัตรเต็มกับ CVV ไม่เคยออกจากฟอร์ม ★ `CardForm` แปลงเป็นเครือข่าย +
 * 4 ตัวท้าย + วันหมดอายุ ก่อนยิง API เสมอ แล้วล้าง state ทิ้งทุกเส้นทาง
 * (กฎเหล็กข้อ 1 + security-rules C-2 · DB มี CHECK `last4 ~ '^[0-9]{4}$'` อีกชั้น)
 */
export default function PaymentMethodsScreen() {
  const [cards, setCards] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error: err } = await listPaymentMethods();
    setCards(data);
    setError(err);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function add(payload: CardPayload): Promise<string | null> {
    const { error: err } = await createPaymentMethod(payload);
    if (err != null) return err;
    setToast(`ผูกบัตรลงท้าย ${payload.last4} เรียบร้อย`);
    await reload();
    return null;
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    const { error: err } = await deletePaymentMethod(id);
    setBusy(false);
    if (err != null) {
      await reload();
      setError(err);
      return;
    }
    setToast('ลบบัตรแล้ว');
    await reload();
  }

  if (loading) return <Splash />;

  return (
    <Screen>
      <Card>
        <SectionHeader title="บัตรของฉัน" />
        <Text style={styles.muted}>
          บัตรที่ผูกไว้จะใช้ตัดยอดอัตโนมัติทุกรอบส่งของ · เปลี่ยนบัตรของรายการไหน
          ทำได้ที่หน้ารายการนั้น
        </Text>
      </Card>

      {error != null ? <ErrorNote id="cards-error" message={error} /> : null}
      {toast != null ? (
        <Pressable id="cards-toast" onPress={() => setToast(null)}>
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </Pressable>
      ) : null}

      {cards.length === 0 ? (
        <Card>
          <EmptyState
            id="cards-empty"
            title="ยังไม่มีบัตรที่ผูกไว้"
            body="ผูกบัตรไว้ก่อน แล้วตอนสมัครรับสินค้าจะเลือกได้เลย"
          />
        </Card>
      ) : null}

      {cards.map((card) => (
        <Card key={card.id} id={`card-${card.id}`}>
          <View style={styles.row}>
            <View style={styles.faceCol}>
              <CardFace
                brand={card.brand as CardBrand}
                last4={card.last4}
                expMonth={card.expMonth}
                expYear={card.expYear}
                holderName={card.holderName}
                compact
              />
            </View>
            <Pressable
              id={`card-delete-${card.id}`}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void remove(card.id)}
              style={styles.delete}
            >
              <Text style={styles.deleteText}>ลบ</Text>
            </Pressable>
          </View>
        </Card>
      ))}

      <Card>
        <SectionHeader title="ผูกบัตรใหม่" />
        <CardForm idPrefix="card" errorId="card-form-error" onSubmit={add} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { ...type.caption, color: colors.textMuted },
  toast: { backgroundColor: statusTones.active.bg, borderRadius: radius.md, padding: space.md },
  toastText: { ...type.small, color: statusTones.active.fg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  faceCol: { flex: 1 },
  delete: {
    borderWidth: 1,
    borderColor: colors.dangerSoftBorder,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  deleteText: { ...type.caption, color: colors.danger },
});
