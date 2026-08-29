import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { Card, ErrorNote, Screen, SectionHeader } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { openShop } from '@/features/seller/api';
import { colors, space, type } from '@/lib/theme';

/**
 * เปิดร้านค้า (W02) — ครั้งเดียวต่อบัญชี
 *
 * ไม่มีขั้นอนุมัติในเดโม่ · `is_seller` ถูกตั้งโดย API ในทรานแซกชันเดียวกับการสร้างร้าน
 * หน้านี้จึงแค่ `refreshProfile()` แล้วเข้าโหมดร้านได้เลย ไม่ต้องล็อกอินใหม่
 */
export default function OpenShopScreen() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** กันกดเปิดร้านรัว — DB มี unique `owner_id` กันไว้อีกชั้น (C-9) */
  const submitting = useRef(false);

  // มีร้านแล้วไม่ต้องเห็นฟอร์มนี้อีก — พาเข้าโหมดร้านทันที (W02 E1)
  useEffect(() => {
    if (profile?.isSeller === true) router.replace('/(seller)');
  }, [profile?.isSeller, router]);

  async function handleOpen() {
    if (submitting.current) return;
    setError(null);
    if (name.trim().length < 2) {
      setError('ชื่อร้านต้องยาว 2-80 ตัวอักษร');
      return;
    }

    submitting.current = true;
    setBusy(true);
    const { error: err } = await openShop({
      name: name.trim(),
      ...(description.trim() === '' ? {} : { description: description.trim() }),
    });
    setBusy(false);
    submitting.current = false;

    if (err != null) {
      setError(err);
      return;
    }
    // ดึงโปรไฟล์ใหม่ก่อนเข้าโหมดร้าน ไม่งั้น layout ฝั่งร้านจะเห็น isSeller เป็น false
    // แล้วเด้งกลับมาหน้านี้ทันที (ค่าสิทธิ์อยู่ที่ profile ใน context)
    await refreshProfile();
    router.replace('/(seller)');
  }

  return (
    <Screen>
      <Card>
        <SectionHeader title="เปิดร้านค้า" />
        <Text style={styles.muted}>
          ใช้บัญชีเดิมขายได้เลย — สลับระหว่างโหมดผู้ซื้อกับโหมดร้านได้ทุกเมื่อ
          และเดโม่นี้ไม่มีขั้นอนุมัติร้าน
        </Text>
        <TextField
          id="open-shop-name"
          label="ชื่อร้าน"
          value={name}
          onChangeText={setName}
          maxLength={80}
          autoCapitalize="words"
        />
        <TextField
          id="open-shop-description"
          label="คำอธิบายร้าน (ไม่บังคับ)"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={1000}
        />
        {error != null ? <ErrorNote id="open-shop-error" message={error} /> : null}
        <Button id="open-shop-submit" label="เปิดร้าน" onPress={handleOpen} loading={busy} fullWidth />
      </Card>

      <Card>
        <SectionHeader title="เปิดร้านแล้วทำอะไรได้" />
        <Text style={styles.bullet}>· ลงสินค้าและกำหนดรอบส่ง (2 สัปดาห์ / เดือน / 2 เดือน)</Text>
        <Text style={styles.bullet}>· เห็นออเดอร์ล่วงหน้าเพื่อเตรียมของ</Text>
        <Text style={styles.bullet}>· ดูสมาชิก รายได้ต่อเดือนโดยประมาณ และอัตราการยกเลิก</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { ...type.caption, color: colors.textMuted },
  bullet: { ...type.body, color: colors.text, marginBottom: space.xs },
});
