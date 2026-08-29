import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import {
  Card,
  EmptyState,
  ErrorNote,
  Pill,
  SectionHeader,
  Splash,
} from '@/components/ui';
import {
  listAuditLogs,
  listEmailLogs,
  type AuditAction,
  type AuditLogRow,
  type EmailLogRow,
  type EmailLogStatus,
} from '@/features/admin/api';
import { formatThaiDateTime } from '@/lib/date';
import { colors, radius, space, statusTones, type } from '@/lib/theme';

/**
 * log ระบบ (feature 14) — **อ่านอย่างเดียว ไม่มีปุ่มลบ**
 *
 * สองแท็บตอบคนละคำถาม:
 *   - "ใครทำอะไรกับระบบ"  → audit log (ปิดความเสี่ยง A-3)
 *   - "เมลไปถึงใครจริง ๆ" → email log · คู่กับหน้าตั้งค่าเมล เพราะพอเปิดโหมด DEV
 *     แล้วผู้รับบนจอกับผู้รับจริงจะไม่ใช่คนเดียวกัน และนั่นคือสิ่งที่ต้องตรวจได้
 */

type Tab = 'audit' | 'email';

const TABS: { key: Tab; label: string }[] = [
  { key: 'audit', label: 'การกระทำในระบบ' },
  { key: 'email', label: 'อีเมลที่ส่งออก' },
];

/** ป้ายไทยของ action — ตัวเดียวกับที่ enum ใน DB บังคับไว้ */
const ACTION_LABEL: Record<AuditAction, string> = {
  shop_suspended: 'ระงับร้าน',
  shop_unsuspended: 'คืนสถานะร้าน',
  product_suspended: 'ระงับสินค้า',
  product_unsuspended: 'คืนสถานะสินค้า',
  category_created: 'เพิ่มหมวด',
  category_updated: 'แก้หมวด',
  category_deleted: 'ลบหมวด',
  mail_settings_updated: 'แก้ตั้งค่าเมล',
  engine_run_manual: 'สั่งรัน engine',
  password_reset_completed: 'ตั้งรหัสผ่านใหม่',
};

const STATUS_LABEL: Record<EmailLogStatus, string> = {
  sent: 'ส่งแล้ว',
  failed: 'ส่งไม่สำเร็จ',
  skipped: 'ไม่ได้ส่ง (ยังไม่ตั้ง SMTP)',
};

const STATUS_TONE: Record<EmailLogStatus, 'active' | 'cancelled' | 'neutral'> = {
  sent: 'active',
  failed: 'cancelled',
  skipped: 'neutral',
};

export default function AdminLogsScreen() {
  const [tab, setTab] = useState<Tab>('audit');
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<AuditAction | ''>('');
  const [statusFilter, setStatusFilter] = useState<EmailLogStatus | ''>('');

  const [audit, setAudit] = useState<AuditLogRow[]>([]);
  const [email, setEmail] = useState<EmailLogRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (tab === 'audit') {
      const { data, error: err } = await listAuditLogs({ page, action: actionFilter });
      setAudit(data?.rows ?? []);
      setHasMore(data?.hasMore ?? false);
      setError(err);
    } else {
      const { data, error: err } = await listEmailLogs({ page, status: statusFilter });
      setEmail(data?.rows ?? []);
      setHasMore(data?.hasMore ?? false);
      setError(err);
    }
    setLoading(false);
  }, [tab, page, actionFilter, statusFilter]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  /** เปลี่ยนแท็บ/ตัวกรองแล้วต้องกลับหน้า 1 — ไม่งั้นค้างที่หน้า 5 ของชุดที่ไม่มีแถวนั้น */
  function switchTab(next: Tab) {
    setTab(next);
    setPage(1);
    setLoading(true);
  }

  if (loading) return <Splash />;

  return (
    <>
      <SectionHeader title="log ระบบ" />

      <Card>
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              id={`admin-logs-tab-${t.key}`}
              accessibilityRole="button"
              onPress={() => switchTab(t.key)}
              style={[styles.tab, tab === t.key && styles.tabOn]}
            >
              <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ตัวกรอง: ชิปแทน dropdown เพราะจำนวนตัวเลือกคงที่และเห็นทั้งหมดพร้อมกันดีกว่า */}
        <View style={styles.filters}>
          <FilterChip
            id="admin-logs-filter-all"
            label="ทั้งหมด"
            on={tab === 'audit' ? actionFilter === '' : statusFilter === ''}
            onPress={() => {
              if (tab === 'audit') setActionFilter('');
              else setStatusFilter('');
              setPage(1);
            }}
          />
          {tab === 'audit'
            ? (Object.keys(ACTION_LABEL) as AuditAction[]).map((a) => (
                <FilterChip
                  key={a}
                  id={`admin-logs-filter-${a}`}
                  label={ACTION_LABEL[a]}
                  on={actionFilter === a}
                  onPress={() => {
                    setActionFilter(a);
                    setPage(1);
                  }}
                />
              ))
            : (Object.keys(STATUS_LABEL) as EmailLogStatus[]).map((s) => (
                <FilterChip
                  key={s}
                  id={`admin-logs-filter-${s}`}
                  label={STATUS_LABEL[s]}
                  on={statusFilter === s}
                  onPress={() => {
                    setStatusFilter(s);
                    setPage(1);
                  }}
                />
              ))}
        </View>
      </Card>

      {error != null ? <ErrorNote id="admin-logs-error" message={error} /> : null}

      {tab === 'audit' ? (
        audit.length === 0 ? (
          <EmptyState
            id="admin-logs-audit-empty"
            title="ยังไม่มีเหตุการณ์"
            body="การกระทำของผู้ดูแลและเหตุการณ์สำคัญของระบบจะขึ้นที่นี่"
          />
        ) : (
          audit.map((row) => (
            <Card key={row.id} id={`admin-audit-${row.id}`}>
              <View style={styles.head}>
                <Pill label={ACTION_LABEL[row.action]} tone="neutral" />
                <Text style={styles.when}>{formatThaiDateTime(row.createdAt)}</Text>
              </View>
              <Text id={`admin-audit-summary-${row.id}`} style={type.body}>
                {row.summary}
              </Text>
              {/* null = ระบบทำเอง (engine) หรือบัญชีที่ทำถูกลบไปแล้ว */}
              <Text style={styles.muted}>
                โดย {row.actor ?? 'ระบบ'}
                {row.targetType == null ? '' : ` · ${row.targetType}`}
              </Text>
            </Card>
          ))
        )
      ) : email.length === 0 ? (
        <EmptyState
          id="admin-logs-email-empty"
          title="ยังไม่มีอีเมลที่ส่งออก"
          body="อีเมลทุกฉบับที่ระบบส่ง (หรือพยายามส่ง) จะถูกบันทึกที่นี่"
        />
      ) : (
        email.map((row) => (
          <Card key={row.id} id={`admin-email-${row.id}`}>
            <View style={styles.head}>
              <Pill
                id={`admin-email-status-${row.id}`}
                label={STATUS_LABEL[row.status]}
                tone={STATUS_TONE[row.status]}
              />
              {row.redirected ? (
                <Pill
                  id={`admin-email-redirected-${row.id}`}
                  label="เปลี่ยนเส้นทาง"
                  tone="frozen"
                />
              ) : null}
              <Text style={styles.when}>{formatThaiDateTime(row.createdAt)}</Text>
            </View>

            <Text style={type.body}>{row.kind}</Text>

            {/* ★ สองบรรทัดนี้คือหัวใจของหน้านี้ ★ ตอนเปิดโหมด DEV "ผู้รับตัวจริง"
                กับ "ที่ส่งไปจริง" ไม่ใช่คนเดียวกัน และนั่นคือสิ่งที่ต้องตรวจสอบได้ */}
            <Text id={`admin-email-intended-${row.id}`} style={styles.muted}>
              ผู้รับตัวจริง: {row.toIntended}
            </Text>
            <Text id={`admin-email-actual-${row.id}`} style={styles.muted}>
              ส่งไปที่: {row.toActual}
              {row.ccActual == null ? '' : ` · สำเนา ${row.ccActual}`}
            </Text>

            {row.error == null ? null : (
              <Text style={styles.failure}>{row.error}</Text>
            )}
          </Card>
        ))
      )}

      <View style={styles.pager}>
        <Button
          id="admin-logs-prev"
          label="ก่อนหน้า"
          variant="secondary"
          disabled={page <= 1}
          onPress={() => {
            setPage((p) => Math.max(1, p - 1));
            setLoading(true);
          }}
        />
        <Text id="admin-logs-page" style={styles.muted}>
          หน้า {page}
        </Text>
        <Button
          id="admin-logs-next"
          label="ถัดไป"
          variant="secondary"
          disabled={!hasMore}
          onPress={() => {
            setPage((p) => p + 1);
            setLoading(true);
          }}
        />
      </View>
    </>
  );
}

function FilterChip({
  id,
  label,
  on,
  onPress,
}: {
  id: string;
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      id={id}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.chip, on && styles.chipOn]}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tab: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  tabOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  tabText: { ...type.caption, color: colors.text },
  tabTextOn: { color: colors.primaryStrong },

  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { ...type.caption, color: colors.textMuted },
  chipTextOn: { color: colors.primaryStrong },

  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  when: { ...type.caption, color: colors.textFaint },
  muted: { ...type.small, color: colors.textMuted },
  failure: { ...type.caption, color: statusTones.cancelled.fg },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
  },
});
