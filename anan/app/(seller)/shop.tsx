import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { Card, ErrorNote, Pill, Screen, SectionHeader, Splash } from '@/components/ui';
import { getMyShop, updateShop, type Shop } from '@/features/seller/api';
import { useMyShop } from '@/features/seller/ShopProvider';
import { colors, type } from '@/lib/theme';

/**
 * ตั้งค่าร้าน (feature 10)
 *
 * ★ ร้านที่ถูกผู้ดูแลระงับ ★ ต้องเห็นชัดว่าทำไมของหายจาก catalog และต้องไม่มี
 * ปุ่มเปิดร้านให้กด — แต่ที่กันจริงคือ API (`SHOP_SUSPENDED`) ไม่ใช่การซ่อนปุ่ม
 */
export default function ShopSettingsScreen() {
  const router = useRouter();
  // หัวของคอนโซลแสดงชื่อร้าน — แก้ชื่อที่นี่แล้วต้องเปลี่ยนบนแถบนำทางด้วย
  const { refreshShop } = useMyShop();
  const [shop, setShop] = useState<Shop | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const reload = useCallback(async () => {
    const { data, error: err } = await getMyShop();
    setShop(data);
    setName(data?.name ?? '');
    setDescription(data?.description ?? '');
    setLogoUrl(data?.logoUrl ?? '');
    setError(err);
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

  async function save(patch: Parameters<typeof updateShop>[0], okMessage = true) {
    setBusy(true);
    setError(null);
    setSaved(false);
    const { error: err } = await updateShop(patch);
    setBusy(false);
    if (err != null) {
      await reload();
      setError(err);
      return;
    }
    if (okMessage) setSaved(true);
    await Promise.all([reload(), refreshShop()]);
  }

  if (loading) return <Splash />;

  return (
    <Screen>
      <Card>
        <SectionHeader
          title="ร้านของฉัน"
          action={
            shop?.isSuspended === true ? (
              <Pill id="shop-suspended" label="ถูกระงับโดยผู้ดูแล" tone="frozen" />
            ) : shop?.isActive === true ? (
              <Pill label="เปิดอยู่" tone="active" />
            ) : (
              <Pill id="shop-closed" label="ปิดชั่วคราว" tone="paused" />
            )
          }
        />
        {shop?.isSuspended === true ? (
          <Text id="shop-suspended-note" style={styles.warn}>
            ร้านถูกระงับโดยผู้ดูแลระบบ — สินค้าถูกซ่อนจากหน้าค้นหา และระบบหยุดเรียกเก็บเงิน
            จากสมาชิกไว้ทั้งหมด แก้ไขข้อมูลร้านไม่ได้จนกว่าจะได้รับการปลดระงับ
          </Text>
        ) : (
          <Text style={styles.muted}>
            ปิดร้านชั่วคราวได้ — สมาชิกเดิมยังได้รับของต่อ แต่จะไม่มีคนใหม่สมัครเข้ามา
          </Text>
        )}
      </Card>

      {error != null ? <ErrorNote id="shop-error" message={error} /> : null}

      <Card>
        <SectionHeader title="ข้อมูลร้าน" />
        <TextField
          id="shop-name"
          label="ชื่อร้าน"
          value={name}
          onChangeText={setName}
          maxLength={80}
          editable={shop?.isSuspended !== true}
        />
        <TextField
          id="shop-description"
          label="คำอธิบายร้าน"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={1000}
          editable={shop?.isSuspended !== true}
        />
        <TextField
          id="shop-logo"
          label="โลโก้ร้าน (ลิงก์รูป https)"
          value={logoUrl}
          onChangeText={setLogoUrl}
          maxLength={500}
          placeholder="https://…"
          editable={shop?.isSuspended !== true}
          hint="ต้องเป็น https เท่านั้น — DB มี CHECK บังคับไว้อีกชั้น · อัปโหลดจากเครื่องยังไม่เปิดใช้"
        />
        {saved ? (
          <Text id="shop-saved" style={styles.saved}>
            บันทึกแล้ว
          </Text>
        ) : null}
        {shop?.isSuspended !== true ? (
          <Button
            id="shop-save"
            label="บันทึก"
            loading={busy}
            onPress={() =>
              void save({
                name: name.trim(),
                description: description.trim(),
                // ช่องว่าง = ไม่มีโลโก้ · ส่ง undefined ไปเลยเพื่อไม่ให้ชน CHECK https
                logoUrl: logoUrl.trim() === '' ? undefined : logoUrl.trim(),
              })
            }
          />
        ) : null}
      </Card>

      {shop?.isSuspended !== true ? (
        <Card>
          <SectionHeader title="สถานะการขาย" />
          <Text style={styles.muted}>
            {shop?.isActive === true
              ? 'ร้านเปิดอยู่ — สินค้าปรากฏในหน้าค้นหาของผู้ซื้อ'
              : 'ร้านปิดอยู่ — สินค้าไม่ปรากฏในหน้าค้นหา แต่สมาชิกเดิมยังได้รับของ'}
          </Text>
          <Button
            id="shop-toggle-active"
            label={shop?.isActive === true ? 'ปิดร้านชั่วคราว' : 'เปิดร้านอีกครั้ง'}
            variant={shop?.isActive === true ? 'ghost' : 'primary'}
            loading={busy}
            onPress={() => void save({ isActive: shop?.isActive !== true }, false)}
          />
        </Card>
      ) : null}

      <Card>
        <SectionHeader title="สลับโหมด" />
        <Text style={styles.muted}>
          บัญชีเดียวใช้ได้ทั้งสองโหมด — ไม่ต้องออกจากระบบเพื่อสลับ
        </Text>
        <Button
          id="shop-switch-buyer"
          label="กลับไปโหมดผู้ซื้อ"
          variant="secondary"
          onPress={() => router.replace('/(buyer)')}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { ...type.caption, color: colors.textMuted },
  warn: { ...type.small, color: colors.statusFrozen },
  saved: { ...type.caption, color: colors.success },
});
