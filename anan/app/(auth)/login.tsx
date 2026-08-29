import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { Card, ErrorNote, Screen } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { signInWithEmail, validateEmail } from '@/features/auth/api';
import { colors, radius, space, type } from '@/lib/theme';

export default function LoginScreen() {
  const { setProfile } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setFormError(null);
    const emailProblem = validateEmail(email);
    setEmailError(emailProblem);
    if (emailProblem != null) return;
    if (password.length === 0) {
      setFormError('กรุณากรอกรหัสผ่าน');
      return;
    }

    setBusy(true);
    const { data, error } = await signInWithEmail({ email, password });
    setBusy(false);
    // deliberately generic: never reveal whether the email exists
    if (error != null) {
      setFormError(error);
      return;
    }
    // setting the profile flips the auth gate; (auth)/_layout redirects to (buyer)
    setProfile(data);
  }

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.brand}>ANAN</Text>
        <Text style={styles.tagline}>ของใช้ประจำ มาเองตามรอบ</Text>
      </View>

      <Card>
        <Text style={type.h2}>เข้าสู่ระบบ</Text>
        <TextField
          id="login-email"
          label="อีเมล"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoComplete="email"
          error={emailError ?? undefined}
          maxLength={120}
        />
        <TextField
          id="login-password"
          label="รหัสผ่าน"
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••••"
          secureTextEntry
          autoComplete="current-password"
          maxLength={72}
          onSubmitEditing={() => void handleSubmit()}
        />
        {formError != null ? <ErrorNote id="login-error" message={formError} /> : null}
        <Button id="login-submit" label="เข้าสู่ระบบ" onPress={handleSubmit} loading={busy} fullWidth />

        {/* อยู่ติดใต้ปุ่มเข้าสู่ระบบ ไม่ใช่ท้ายการ์ด — คนที่กดตรงนี้คือคนที่เพิ่ง
            ล็อกอินไม่ผ่าน สายตาอยู่แถวปุ่มพอดี ไม่ใช่ล่างสุดของหน้า */}
        <View style={styles.footer}>
          <Link id="login-link-forgot" href="/(auth)/forgot-password" style={styles.link}>
            ลืมรหัสผ่าน?
          </Link>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>ยังไม่มีบัญชี?</Text>
          <Link id="login-link-register" href="/(auth)/register" style={styles.link}>
            สมัครสมาชิก
          </Link>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // แบรนด์ยืนบนพื้นเขียวสนทึบ ไม่ใช่ gradient — สีเดียวกับปุ่มหลักทั้งแอป
  hero: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: space.xxl, gap: 4 },
  // letterSpacing ใส่ได้เพราะเป็นละตินล้วน (ดูกฎในหัว theme.ts)
  brand: { ...type.h1, color: colors.onPrimary, letterSpacing: 1 },
  tagline: { ...type.body, color: colors.onPrimaryMuted },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: 'center' },
  footerText: { ...type.small, color: colors.textMuted },
  link: { ...type.bodyStrong, color: colors.primaryStrong },
});
