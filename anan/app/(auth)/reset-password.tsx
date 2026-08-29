import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { Card, ErrorNote, Screen } from '@/components/ui';
import {
  MIN_PASSWORD_LENGTH,
  resetPassword,
  validatePassword,
} from '@/features/auth/api';
import { colors, radius, space, type } from '@/lib/theme';

/**
 * ลืมรหัสผ่าน — ขั้นที่ 2: ตั้งรหัสใหม่ (feature 01 · W01)
 *
 * ปลายทางของลิงก์ในอีเมล: `/reset-password?token=…` (กลุ่ม `(auth)` ไม่โผล่ใน URL)
 *
 * ★ ไม่ล็อกอินให้อัตโนมัติหลังตั้งรหัสเสร็จ ★ ตั้งใจให้กรอกรหัสใหม่อีกรอบที่หน้า
 * เข้าสู่ระบบ — API เพิ่งเพิกถอนทุก session ของบัญชีนี้ไป (นั่นคือจุดประสงค์ของ
 * การรีเซ็ต) การเด้งเข้าแอปทันทีจะกลบข้อเท็จจริงว่า "เครื่องอื่นหลุดหมดแล้ว"
 * ที่ผู้ใช้ควรรู้ และเป็นการยืนยันว่ารหัสใหม่ใช้ได้จริงไปในตัว
 */
export default function ResetPasswordScreen() {
  // ผู้ใช้ก๊อปลิงก์มาไม่ครบ / ลิงก์ถูกตัดท้าย เป็นเรื่องที่เกิดจริง — ต้องไม่จอขาว
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  /**
   * กันกดรัวในเฟรมเดียวกัน (security-rules C-9) — ตั๋วใช้ได้ครั้งเดียว การยิงสอง
   * ครั้งพร้อมกันจะได้ 204 หนึ่งใบกับ 400 อีกใบ แล้วหน้าจออาจขึ้น "ลิงก์ใช้ไม่ได้แล้ว"
   * ทั้งที่ตั้งรหัสสำเร็จไปแล้ว — ผู้ใช้จะไปขอลิงก์ใหม่ทั้งที่ไม่ต้องขอ
   */
  const submitting = useRef(false);

  async function handleSubmit() {
    if (submitting.current) return;
    if (typeof token !== 'string' || token.length === 0) return;
    setFormError(null);

    const problem = validatePassword(password);
    const mismatch = password !== confirm ? 'รหัสผ่านสองช่องไม่ตรงกัน' : null;
    setPasswordError(problem);
    setConfirmError(mismatch);
    if (problem != null || mismatch != null) return;

    submitting.current = true;
    setBusy(true);
    const { error } = await resetPassword({ token, password });
    submitting.current = false;
    setBusy(false);
    if (error != null) {
      // ครอบทั้งลิงก์หมดอายุ ใช้ไปแล้ว และลิงก์มั่ว — API ตอบข้อความเดียวกันหมด
      setFormError(error);
      return;
    }
    setDone(true);
  }

  if (typeof token !== 'string' || token.length === 0) {
    return (
      <Screen>
        <Card>
          <Text style={type.h2}>ลิงก์ไม่สมบูรณ์</Text>
          <Text id="reset-missing-token" style={styles.body}>
            ลิงก์ที่เปิดมาไม่มีรหัสสำหรับตั้งรหัสผ่านใหม่ — อาจถูกตัดตอนคัดลอกมา
          </Text>
          {/* ใช้ router ไม่ใช่ `<Link asChild>` — expo-router โยน error ทันทีเมื่อ
              ลูกของ Link มี style เป็น array ซึ่ง `Button` เป็นแบบนั้น (จอขาว) */}
          <Button
            id="reset-request-again"
            label="ขอลิงก์ใหม่"
            onPress={() => router.replace('/(auth)/forgot-password')}
            fullWidth
          />
        </Card>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen>
        <Card>
          <Text style={type.h2}>ตั้งรหัสผ่านใหม่เรียบร้อย</Text>
          <Text id="reset-done" style={styles.body}>
            ใช้รหัสผ่านใหม่เข้าสู่ระบบได้เลย
          </Text>
          <View style={styles.note}>
            <Text style={styles.noteText}>
              เพื่อความปลอดภัย เครื่องอื่นที่ยังค้างอยู่ในระบบถูกให้ออกจากระบบทั้งหมดแล้ว
            </Text>
          </View>
          <Button
            id="reset-goto-login"
            label="เข้าสู่ระบบ"
            onPress={() => router.replace('/(auth)/login')}
            fullWidth
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <Text style={type.h2}>ตั้งรหัสผ่านใหม่</Text>
        <Text style={styles.sub}>ตั้งรหัสผ่านใหม่สำหรับบัญชีของคุณ</Text>

        <TextField
          id="reset-password"
          label="รหัสผ่านใหม่"
          value={password}
          onChangeText={setPassword}
          placeholder="อย่างน้อย 10 ตัวอักษร"
          secureTextEntry
          autoComplete="new-password"
          error={passwordError ?? undefined}
          hint={`ใช้อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร และไม่ใช่รหัสที่เคยหลุดจากเว็บอื่น`}
          maxLength={72}
        />
        <TextField
          id="reset-confirm"
          label="ยืนยันรหัสผ่านใหม่"
          value={confirm}
          onChangeText={setConfirm}
          placeholder="พิมพ์รหัสผ่านเดิมอีกครั้ง"
          secureTextEntry
          autoComplete="new-password"
          error={confirmError ?? undefined}
          maxLength={72}
          onSubmitEditing={() => void handleSubmit()}
        />
        {formError != null ? <ErrorNote id="reset-error" message={formError} /> : null}
        <Button
          id="reset-submit"
          label="บันทึกรหัสผ่านใหม่"
          onPress={handleSubmit}
          loading={busy}
          fullWidth
        />

        <View style={styles.footer}>
          <Text style={styles.footerText}>ลิงก์หมดอายุแล้ว?</Text>
          <Link id="reset-link-forgot" href="/(auth)/forgot-password" style={styles.link}>
            ขอลิงก์ใหม่
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
  },
  noteText: { ...type.small, color: colors.textMuted },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: 'center' },
  footerText: { ...type.small, color: colors.textMuted },
  link: { ...type.bodyStrong, color: colors.primaryStrong },
});
