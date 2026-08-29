import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { Card, ErrorNote, SectionHeader, Splash } from '@/components/ui';
import { listEngineRuns, runEngine, type EngineRun } from '@/features/admin/api';
import { formatThaiDate, todayISO } from '@/lib/date';
import { colors, radius, space, statusTones, type } from '@/lib/theme';

/**
 * หน้าควบคุม engine (feature 14 · W10 Flow D)
 *
 * มีไว้เพื่อการนำเสนอ: กรรมการเห็นรอบเกิดสด ๆ แทนที่จะต้องเชื่อว่า cron ตี 1
 * ทำงานจริง — และเห็นว่ากดซ้ำวันเดิมแล้วออเดอร์ไม่งอกเพิ่ม (idempotent)
 *
 * ★ ช่อง "วันที่จำลอง" ไม่ใช่ของที่หน้าจอเป็นคนอนุญาต ★ API เปิดให้เฉพาะเมื่อ
 * เป็น admin **และ** เครื่องเปิด `DEMO_MODE` **และ** NODE_ENV อยู่ใน allowlist
 */
export default function AdminEngineScreen() {
  const [runs, setRuns] = useState<EngineRun[]>([]);
  const [runDate, setRunDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const running = useRef(false);

  const reload = useCallback(async () => {
    const { data, error: err } = await listEngineRuns();
    setRuns(data ?? []);
    setError(err);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function run() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    const { data, error: err } = await runEngine(runDate.trim());
    running.current = false;
    setBusy(false);
    if (err != null) {
      await reload();
      setError(err);
      return;
    }
    setToast(
      `รันเสร็จ — ออเดอร์ใหม่ ${data?.ordersCreated ?? 0} ใบ · ข้ามที่สร้างไปแล้ว ${data?.detail.skipped ?? 0} · แจ้งเตือน ${data?.notificationsCreated ?? 0}`,
    );
    await reload();
  }

  if (loading) return <Splash />;

  return (
    <>
      <SectionHeader title="ควบคุม Engine" />
      {error != null ? <ErrorNote id="admin-engine-error" message={error} /> : null}
      {toast != null ? (
        <Pressable id="admin-engine-toast" onPress={() => setToast(null)}>
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </Pressable>
      ) : null}

      <Card>
        <Text style={styles.muted}>
          ปกติ engine ทำงานเองทุกวันตี 1 (เวลาไทย) · กดปุ่มนี้เพื่อรันเดี๋ยวนี้
          กดซ้ำวันเดิมออเดอร์จะไม่ซ้ำ เพราะ idempotency มาจาก UNIQUE ที่ฐานข้อมูล
        </Text>
        <TextField
          id="admin-engine-date"
          label="วันที่จำลอง (เว้นว่าง = วันนี้)"
          value={runDate}
          onChangeText={setRunDate}
          placeholder={todayISO()}
          maxLength={10}
          hint="รูปแบบ YYYY-MM-DD — ใช้ได้เฉพาะเครื่องเดโม่ที่เปิด DEMO_MODE"
        />
        <Button id="admin-engine-run" label="รัน engine เดี๋ยวนี้" loading={busy} onPress={() => void run()} />
      </Card>

      <Card id="admin-engine-runs">
        <SectionHeader title={`ประวัติการรัน (${runs.length})`} />
        {runs.length === 0 ? (
          <Text id="admin-engine-empty" style={styles.muted}>
            ยังไม่เคยรัน engine บนเครื่องนี้
          </Text>
        ) : (
          runs.map((item) => (
            <View key={item.id} id={`admin-engine-run-${item.id}`} style={styles.runRow}>
              <Text style={type.bodyStrong}>
                {formatThaiDate(item.runDate)} · ออเดอร์ {item.ordersCreated} ใบ
              </Text>
              <Text style={styles.muted}>
                ถึงรอบ {item.detail.due} · ข้าม {item.detail.skipped} · แจ้งล่วงหน้า{' '}
                {item.detail.upcoming} · ปิดอัตโนมัติ {item.detail.autoConfirmed} · จ่ายไม่ผ่าน{' '}
                {item.detail.paymentsFailed} · ผิดพลาด {item.detail.failed}
              </Text>
            </View>
          ))
        )}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  muted: { ...type.caption, color: colors.textMuted },
  toast: { backgroundColor: statusTones.active.bg, borderRadius: radius.md, padding: space.md },
  toastText: { ...type.small, color: statusTones.active.fg },
  runRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.sm,
    gap: 2,
  },
});
