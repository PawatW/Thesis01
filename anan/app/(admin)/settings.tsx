import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { Card, ErrorNote, Pill, SectionHeader, Splash } from '@/components/ui';
import {
  getMailSettings,
  saveMailSettings,
  type MailSettings,
} from '@/features/admin/api';
import { colors, radius, space, type } from '@/lib/theme';

/**
 * ตั้งค่าเมลของระบบ (feature 14)
 *
 * ★ สวิตช์บนหน้านี้ไม่ใช่ด่าน ★ ปุ่มจะถูกปิดเมื่อ `uatModeAvailable = false` เพื่อ
 * อธิบายให้ผู้ดูแลรู้ว่าทำไมกดไม่ได้ — แต่คนที่แก้โค้ดหน้าเว็บให้เปิดสวิตช์แล้วยิง
 * `PUT /admin/mail-settings` เองก็ยังได้ 403 เพราะ `SettingsService` ตรวจ env ซ้ำ
 *
 * ช่อง `SMTP_USER` / `SMTP_PASS` **ไม่มีในหน้านี้โดยตั้งใจ** — เป็น credential จริง
 * ที่อยู่ใน `.env` ของ API เท่านั้น (กฎข้อ 7)
 */
export default function AdminMailSettingsScreen() {
  const [loaded, setLoaded] = useState<MailSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  // ฟอร์มถือค่าเป็นสตริงทั้งหมด แล้วแปลงตอนส่ง — ช่องว่าง = "ใช้ค่าจาก .env"
  const [redirectEnabled, setRedirectEnabled] = useState(false);
  const [redirectTo, setRedirectTo] = useState('');
  const [redirectCc, setRedirectCc] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [mailFrom, setMailFrom] = useState('');

  const fill = useCallback((s: MailSettings) => {
    setLoaded(s);
    setRedirectEnabled(s.redirectEnabled);
    setRedirectTo(s.redirectTo ?? '');
    setRedirectCc(s.redirectCc ?? '');
    setSmtpHost(s.smtpHost ?? '');
    setSmtpPort(s.smtpPort === null ? '' : String(s.smtpPort));
    setSmtpSecure(s.smtpSecure);
    setMailFrom(s.mailFrom ?? '');
  }, []);

  const reload = useCallback(async () => {
    const { data, error: err } = await getMailSettings();
    if (data != null) fill(data);
    setError(err);
    setLoading(false);
  }, [fill]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function save() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    setToast(null);

    const port = smtpPort.trim();
    const { data, error: err } = await saveMailSettings({
      redirectEnabled,
      redirectTo: redirectTo.trim(),
      redirectCc: blankToNull(redirectCc),
      smtpHost: blankToNull(smtpHost),
      smtpPort: port === '' ? null : Number(port),
      smtpSecure,
      mailFrom: blankToNull(mailFrom),
    });

    saving.current = false;
    setBusy(false);
    if (err != null) {
      setError(err);
      return;
    }
    if (data != null) fill(data);
    setToast('บันทึกแล้ว — มีผลกับอีเมลฉบับถัดไปทันที');
  }

  if (loading) return <Splash />;

  const locked = loaded?.uatModeAvailable === false;

  return (
    <View style={styles.wrap}>
      <SectionHeader title="ตั้งค่าเมล" />

      {/* สถานะปัจจุบันต้องอ่านได้ในสายตาเดียว — คนเปิดหน้านี้มักมาถามว่า
          "ตอนนี้เมลออกจริงไหม" ไม่ได้มาแก้ค่า */}
      <View style={styles.badges}>
        <Pill
          id="mail-status-mode"
          label={
            loaded?.redirectEnabled === true
              ? `โหมด DEV เปิดอยู่ → ${loaded.redirectTo ?? '-'}`
              : 'โหมดปกติ — ส่งถึงผู้รับจริง'
          }
          tone={loaded?.redirectEnabled === true ? 'frozen' : 'active'}
        />
        <Pill
          id="mail-status-smtp"
          label={
            loaded?.smtpConfigured === true
              ? 'SMTP พร้อมส่ง'
              : 'ยังไม่ได้ตั้ง SMTP — บันทึกลง log แทน'
          }
          tone={loaded?.smtpConfigured === true ? 'active' : 'neutral'}
        />
      </View>

      {loaded?.redirectEnabled === true ? (
        <View id="mail-active-warning" style={styles.warning}>
          <Text style={styles.warningTitle}>โหมดเปลี่ยนเส้นทางอีเมลกำลังทำงาน</Text>
          <Text style={styles.warningBody}>
            อีเมลทุกฉบับของระบบถูกส่งไปที่ {loaded.redirectTo} แทนผู้รับจริง —
            ใช้กับเครื่องทดสอบเท่านั้น
          </Text>
        </View>
      ) : null}

      {locked ? (
        <View id="mail-locked-note" style={styles.locked}>
          <Text style={styles.lockedText}>
            เครื่องนี้เปิดโหมดเปลี่ยนเส้นทางไม่ได้ — ต้องตั้ง{' '}
            <Text style={styles.code}>MAIL_UAT_MODE_AVAILABLE=true</Text> ใน .env ของ API
            และต้องไม่ใช่เครื่อง production
          </Text>
        </View>
      ) : null}

      <Card>
        <Pressable
          id="mail-redirect-toggle"
          accessibilityRole="switch"
          accessibilityState={{ checked: redirectEnabled, disabled: locked }}
          disabled={locked}
          onPress={() => setRedirectEnabled((v) => !v)}
          style={styles.toggleRow}
        >
          {/* ★ สวิตช์ไม่รับคลิกเอง ★ ถ้ามันมี `onValueChange` ของตัวเองด้วย การคลิก
              ตรงตัวสวิตช์จะยิงทั้งของมันและของ `Pressable` ที่ครอบอยู่ → สลับสองครั้ง
              = ไม่มีอะไรเปลี่ยน · ให้แถวทั้งแถวเป็นคนตัดสินใจคนเดียว */}
          <Switch
            value={redirectEnabled}
            disabled={locked}
            pointerEvents="none"
            trackColor={{ true: colors.primary, false: colors.border }}
          />
          <View style={styles.toggleText}>
            <Text style={type.bodyStrong}>เปิดใช้งานโหมดเปลี่ยนเส้นทางอีเมล</Text>
            <Text style={styles.hint}>
              เปิดแล้ว: อีเมลทุกฉบับที่ระบบส่ง จะถูกเปลี่ยนผู้รับเป็นที่อยู่ด้านล่าง
              พร้อมแถบบอกผู้รับตัวจริงในเนื้อเมล
            </Text>
          </View>
        </Pressable>

        <TextField
          id="mail-redirect-to"
          label="ส่งทั้งหมดไปที่ *"
          value={redirectTo}
          onChangeText={setRedirectTo}
          placeholder="qa-team@example.com"
          keyboardType="email-address"
          editable={!locked && redirectEnabled}
          hint="ที่อยู่เดียวที่จะได้รับอีเมลทุกฉบับแทนผู้รับจริง"
          maxLength={254}
        />
        <TextField
          id="mail-redirect-cc"
          label="สำเนาถึง (ไม่บังคับ)"
          value={redirectCc}
          onChangeText={setRedirectCc}
          placeholder="dev@example.com, qa2@example.com"
          editable={!locked && redirectEnabled}
          hint="คั่นด้วยเครื่องหมายจุลภาค — แนบไปกับทุกฉบับระหว่างเปิดโหมด"
          maxLength={500}
        />
      </Card>

      <Card>
        <Text style={type.h3}>เซิร์ฟเวอร์ SMTP</Text>
        <Text style={styles.hint}>
          เว้นว่างไว้ = ใช้ค่าจาก .env ของ API ตามเดิม · ชื่อผู้ใช้กับรหัสผ่านของ SMTP
          ตั้งได้ที่ .env เท่านั้น ไม่มีให้กรอกที่นี่โดยตั้งใจ
        </Text>

        <TextField
          id="mail-smtp-host"
          label="โฮสต์"
          value={smtpHost}
          onChangeText={setSmtpHost}
          placeholder="smtp.mailtrap.io"
          maxLength={255}
        />
        <TextField
          id="mail-smtp-port"
          label="พอร์ต"
          value={smtpPort}
          onChangeText={setSmtpPort}
          placeholder="587"
          keyboardType="number-pad"
          hint="587 = STARTTLS · 465 = TLS ตั้งแต่เชื่อมต่อ"
          maxLength={5}
        />
        <Pressable
          id="mail-smtp-secure"
          accessibilityRole="switch"
          accessibilityState={{ checked: smtpSecure }}
          onPress={() => setSmtpSecure((v) => !v)}
          style={styles.toggleRow}
        >
          <Switch
            value={smtpSecure}
            pointerEvents="none"
            trackColor={{ true: colors.primary, false: colors.border }}
          />
          <View style={styles.toggleText}>
            <Text style={type.bodyStrong}>เข้ารหัสตั้งแต่เชื่อมต่อ (พอร์ต 465)</Text>
            <Text style={styles.hint}>
              ปิดไว้ = ใช้ STARTTLS · ระบบบังคับเข้ารหัสเสมอไม่ว่าเลือกแบบไหน
            </Text>
          </View>
        </Pressable>
        <TextField
          id="mail-from"
          label="ผู้ส่งที่ผู้รับเห็น"
          value={mailFrom}
          onChangeText={setMailFrom}
          placeholder="ANAN <no-reply@anan.local>"
          maxLength={200}
        />
      </Card>

      {error != null ? <ErrorNote id="mail-settings-error" message={error} /> : null}
      {toast != null ? (
        <View id="mail-settings-toast" style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      <Button
        id="mail-settings-save"
        label="บันทึก"
        onPress={save}
        loading={busy}
        fullWidth
      />
    </View>
  );
}

/** ช่องว่าง = "ใช้ค่าจาก .env" ไม่ใช่ "ตั้งเป็นสตริงว่าง" */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  warning: {
    backgroundColor: colors.surface,
    borderLeftWidth: 4,
    borderLeftColor: colors.statusFrozen,
    borderRadius: radius.md,
    padding: space.md,
    gap: 4,
  },
  warningTitle: { ...type.bodyStrong, color: colors.text },
  warningBody: { ...type.small, color: colors.textMuted },
  locked: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
  },
  lockedText: { ...type.small, color: colors.textMuted },
  code: { ...type.small, color: colors.text },
  toggleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  toggleText: { flex: 1, gap: 2 },
  hint: { ...type.small, color: colors.textMuted },
  toast: {
    backgroundColor: colors.surface,
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
    borderRadius: radius.md,
    padding: space.md,
  },
  toastText: { ...type.small, color: colors.text },
});
