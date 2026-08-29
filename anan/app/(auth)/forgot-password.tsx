import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { Card, ErrorNote, Screen } from '@/components/ui';
import { requestPasswordReset, validateEmail } from '@/features/auth/api';
import { colors, radius, space, type } from '@/lib/theme';

/**
 * ลืมรหัสผ่าน — ขั้นที่ 1: ขอลิงก์ (feature 01 · W01)
 *
 * ★ ข้อความหลังกดส่งต้องเหมือนกันทุกกรณี ★ API ตอบ 204 ทั้งเมื่ออีเมลมีในระบบ
 * และเมื่อไม่มี · ถ้าหน้านี้ขึ้น "ไม่พบอีเมลนี้" เมื่อไหร่ ด่านกัน user enumeration
 * ที่ทำไว้ทั้งหมดฝั่ง API ก็เสียไปกับข้อความบรรทัดเดียวบนหน้าจอ
 *
 * error ที่ยังแสดงได้คือของที่ไม่เกี่ยวกับว่าบัญชีมีจริงไหม: รูปแบบอีเมลผิด (400)
 * และขอถี่เกินไป (429)
 */
export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  /**
   * กันกดรัวในเฟรมเดียวกัน (security-rules C-9) — ต้องเป็น `ref` ไม่ใช่ `state`
   * เพราะ `busy` มีผลหลัง re-render ปุ่มจึงยังรับคลิกที่สองได้ก่อนหน้านั้น
   * ปุ่มนี้สั่งให้ระบบ **ส่งอีเมลออกไปข้างนอก** การกดรัวจึงเท่ากับสั่งส่งซ้ำ
   * (ฝั่ง API มีเพดาน 3 ครั้ง/5 นาทีรออยู่ แต่ไม่ควรปล่อยให้ไปถึงตรงนั้นเพราะแค่มือลั่น)
   */
  const submitting = useRef(false);

  async function handleSubmit() {
    if (submitting.current) return;
    setFormError(null);
    const problem = validateEmail(email);
    setEmailError(problem);
    if (problem != null) return;

    submitting.current = true;
    setBusy(true);
    const { error } = await requestPasswordReset(email);
    submitting.current = false;
    setBusy(false);
    if (error != null) {
      setFormError(error);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <Screen>
        <Card>
          <Text style={type.h2}>ตรวจกล่องอีเมลของคุณ</Text>
          {/* ไม่ยืนยันว่าอีเมลนี้มีบัญชีอยู่จริง — "ถ้ามี" คือคำสำคัญของประโยคนี้ */}
          <Text id="forgot-sent" style={styles.body}>
            ถ้ามีบัญชีที่ผูกกับ {email.trim()} อยู่ในระบบ เราส่งลิงก์ตั้งรหัสผ่านใหม่ไปให้แล้ว
          </Text>
          <View style={styles.note}>
            <Text style={styles.noteText}>ลิงก์ใช้ได้ 30 นาที และใช้ได้ครั้งเดียว</Text>
            <Text style={styles.noteText}>ถ้าไม่เจอในกล่องจดหมาย ลองดูในโฟลเดอร์สแปม</Text>
          </View>

          <Button
            id="forgot-resend"
            label="ส่งลิงก์อีกครั้ง"
            variant="secondary"
            onPress={() => setSent(false)}
            fullWidth
          />
          <View style={styles.footer}>
            <Link id="forgot-link-login" href="/(auth)/login" style={styles.link}>
              กลับไปหน้าเข้าสู่ระบบ
            </Link>
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <Text style={type.h2}>ลืมรหัสผ่าน</Text>
        <Text style={styles.sub}>
          กรอกอีเมลที่ใช้สมัคร แล้วเราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้
        </Text>

        <TextField
          id="forgot-email"
          label="อีเมล"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoComplete="email"
          error={emailError ?? undefined}
          maxLength={120}
          onSubmitEditing={() => void handleSubmit()}
        />
        {formError != null ? <ErrorNote id="forgot-error" message={formError} /> : null}
        <Button
          id="forgot-submit"
          label="ส่งลิงก์ตั้งรหัสผ่านใหม่"
          onPress={handleSubmit}
          loading={busy}
          fullWidth
        />

        <View style={styles.footer}>
          <Text style={styles.footerText}>นึกรหัสผ่านออกแล้ว?</Text>
          <Link id="forgot-link-login" href="/(auth)/login" style={styles.link}>
            เข้าสู่ระบบ
          </Link>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { ...type.small, color: colors.textMuted },
  body: { ...type.body, color: colors.text },
  note: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: 4,
  },
  noteText: { ...type.small, color: colors.textMuted },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: 'center' },
  footerText: { ...type.small, color: colors.textMuted },
  link: { ...type.bodyStrong, color: colors.primaryStrong },
});
