import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Avatar } from '@/components/Media';
import { TextField } from '@/components/TextField';
import { Card, ErrorNote, Pill, Screen, SectionHeader } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { updateProfile, validateDisplayName } from '@/features/auth/api';
import { colors, radius, space, type } from '@/lib/theme';

export default function ProfileScreen() {
  const { profile, refreshProfile, signOut } = useAuth();
  const router = useRouter();

  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.displayName ?? '');
    setPhone(profile?.phone ?? '');
  }, [profile?.displayName, profile?.phone]);

  async function handleSave() {
    if (profile == null) return;
    setFormError(null);
    setSaved(false);

    const problem = validateDisplayName(displayName);
    setNameError(problem);
    if (problem != null) return;
    if (phone.trim().length > 0 && !/^[0-9+\-() ]{6,20}$/.test(phone.trim())) {
      setFormError('เบอร์โทรไม่ถูกต้อง (6-20 หลัก)');
      return;
    }

    setBusy(true);
    // ไม่ต้องส่ง id — API อ่านตัวตนจาก token เท่านั้น
    const { error } = await updateProfile({
      displayName: displayName.trim(),
      phone: phone.trim().length > 0 ? phone.trim() : null,
    });
    setBusy(false);

    if (error != null) {
      setFormError(error);
      return;
    }
    await refreshProfile();
    setSaved(true);
  }

  async function handleSignOut() {
    await signOut();
    router.replace('/(auth)/login');
  }

  return (
    <Screen>
      <Card>
        <View style={styles.header}>
          <Avatar url={profile?.avatarUrl} name={profile?.displayName ?? '?'} size={56} />
          <View style={styles.headerBody}>
            <Text id="profile-display-name" style={type.h3}>
              {profile?.displayName ?? '—'}
            </Text>
            <Text id="profile-email" style={styles.muted}>
              {profile?.email ?? ''}
            </Text>
            <View style={styles.roles}>
              <Pill label="ผู้ซื้อ" tone="neutral" />
              {profile?.isSeller === true ? <Pill label="ร้านค้า" tone="active" /> : null}
              {profile?.isAdmin === true ? <Pill label="ผู้ดูแลระบบ" tone="frozen" /> : null}
            </View>
          </View>
        </View>
      </Card>

      <Card>
        <SectionHeader title="ข้อมูลส่วนตัว" />
        <TextField
          id="profile-name"
          label="ชื่อที่แสดง"
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize="words"
          error={nameError ?? undefined}
          maxLength={60}
        />
        <TextField
          id="profile-phone"
          label="เบอร์โทร"
          value={phone}
          onChangeText={setPhone}
          placeholder="0812345678"
          keyboardType="phone-pad"
          maxLength={20}
        />
        {formError != null ? <ErrorNote id="profile-error" message={formError} /> : null}
        {saved ? (
          <Text id="profile-saved" style={styles.saved}>
            บันทึกแล้ว
          </Text>
        ) : null}
        <Button id="profile-save" label="บันทึก" onPress={handleSave} loading={busy} />
      </Card>

      <Card>
        <SectionHeader title="การจัดการ" />
        {/* asChild: without it expo-router renders the Link as a <Text>, and a row
            View nested in Text lays out unreliably on native */}
        <Link href="/(buyer)/profile/addresses" asChild>
          <Pressable id="profile-link-addresses" accessibilityRole="link" style={styles.row}>
            <Ionicons name="location-outline" size={18} color={colors.textMuted} />
            <Text style={type.body}>ที่อยู่จัดส่ง</Text>
          </Pressable>
        </Link>
        {/* ModeSwitcher (W02) — ปุ่มเปลี่ยนความหมายตามว่ามีร้านแล้วหรือยัง
            การซ่อน/แสดงตรงนี้เป็น UX เท่านั้น: endpoint ฝั่งร้านตรวจ role เองทุกครั้ง */}
        <Link href="/(buyer)/profile/payment-methods" asChild>
          <Pressable id="profile-link-cards" accessibilityRole="link" style={styles.row}>
            <Ionicons name="card-outline" size={18} color={colors.textMuted} />
            <Text style={type.body}>บัตรของฉัน</Text>
          </Pressable>
        </Link>
        {profile?.isAdmin === true ? (
          <Link href="/(admin)" asChild>
            <Pressable id="profile-link-admin" accessibilityRole="link" style={styles.row}>
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.textMuted} />
              <Text style={type.body}>โหมดผู้ดูแลระบบ</Text>
            </Pressable>
          </Link>
        ) : null}
        {profile?.isSeller === true ? (
          <Link href="/(seller)" asChild>
            <Pressable id="profile-link-seller" accessibilityRole="link" style={styles.row}>
              <Ionicons name="storefront-outline" size={18} color={colors.textMuted} />
              <Text style={type.body}>ไปที่ร้านของฉัน</Text>
            </Pressable>
          </Link>
        ) : (
          <Link href="/(buyer)/profile/open-shop" asChild>
            <Pressable id="profile-link-open-shop" accessibilityRole="link" style={styles.row}>
              <Ionicons name="storefront-outline" size={18} color={colors.textMuted} />
              <Text style={type.body}>เปิดร้านค้า</Text>
            </Pressable>
          </Link>
        )}
      </Card>

      <Button id="profile-signout" label="ออกจากระบบ" onPress={handleSignOut} variant="danger" fullWidth />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  headerBody: { flex: 1, gap: 4 },
  muted: { ...type.caption, color: colors.textMuted },
  roles: { flexDirection: 'row', gap: space.sm, marginTop: 2 },
  saved: { ...type.caption, color: colors.success },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  rowDisabled: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44, opacity: 0.6 },
  disabledText: { ...type.body, color: colors.textFaint },
});
