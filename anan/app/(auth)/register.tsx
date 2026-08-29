import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { Card, ErrorNote, Screen } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  MIN_PASSWORD_LENGTH,
  signUpWithEmail,
  validateDisplayName,
  validateEmail,
  validatePassword,
} from '@/features/auth/api';
import { colors, space, type } from '@/lib/theme';

type FieldErrors = { name?: string; email?: string; password?: string };

export default function RegisterScreen() {
  const { setProfile } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setFormError(null);
    const next: FieldErrors = {
      name: validateDisplayName(name) ?? undefined,
      email: validateEmail(email) ?? undefined,
      password: validatePassword(password) ?? undefined,
    };
    setErrors(next);
    if (next.name != null || next.email != null || next.password != null) return;

    setBusy(true);
    const { data, error } = await signUpWithEmail({ email, password, displayName: name });
    setBusy(false);
    if (error != null) {
      setFormError(error);
      return;
    }
    // setting the profile flips the auth gate; (auth)/_layout redirects to (buyer)
    setProfile(data);
  }

  return (
    <Screen>
      <Card>
        <Text style={type.h2}>สมัครสมาชิก</Text>
        <Text style={styles.sub}>บัญชีเดียวใช้ได้ทั้งซื้อและเปิดร้าน</Text>

        <TextField
          id="register-name"
          label="ชื่อที่แสดง"
          value={name}
          onChangeText={setName}
          placeholder="เช่น ปวัตน์"
          autoCapitalize="words"
          error={errors.name}
          maxLength={60}
        />
        <TextField
          id="register-email"
          label="อีเมล"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoComplete="email"
          error={errors.email}
          maxLength={120}
        />
        <TextField
          id="register-password"
          label="รหัสผ่าน"
          value={password}
          onChangeText={setPassword}
          placeholder="อย่างน้อย 10 ตัวอักษร"
          secureTextEntry
          autoComplete="new-password"
          error={errors.password}
          hint={`ใช้อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร และไม่ใช่รหัสที่เคยหลุดจากเว็บอื่น`}
          maxLength={72}
          onSubmitEditing={() => void handleSubmit()}
        />
        {formError != null ? <ErrorNote id="register-error" message={formError} /> : null}
        <Button id="register-submit" label="สมัครสมาชิก" onPress={handleSubmit} loading={busy} fullWidth />

        <View style={styles.footer}>
          <Text style={styles.footerText}>มีบัญชีแล้ว?</Text>
          <Link id="register-link-login" href="/(auth)/login" style={styles.link}>
            เข้าสู่ระบบ
          </Link>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { ...type.small, color: colors.textMuted },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: 'center' },
  footerText: { ...type.small, color: colors.textMuted },
  link: { ...type.bodyStrong, color: colors.primaryStrong },
});
