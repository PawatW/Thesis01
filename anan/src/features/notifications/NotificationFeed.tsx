import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, EmptyState, ErrorNote, Screen, SectionHeader, Splash } from '@/components/ui';
import {
  listNotifications,
  markAllRead,
  markRead,
  notificationIcon,
  type Notification,
  type NotificationScope,
} from '@/features/notifications/api';
import { colors, radius, space, type } from '@/lib/theme';

type Tab = 'all' | 'unread';

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'unread', label: 'ยังไม่อ่าน' },
];

/** เวลาแบบ "เมื่อ 2 ชม.ที่แล้ว" — อ่านง่ายกว่าวันที่เต็มสำหรับของที่เพิ่งเกิด */
function ago(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'เมื่อสักครู่';
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชม.ที่แล้ว`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} วันที่แล้ว`;
  return new Date(iso).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  });
}

/**
 * กล่องแจ้งเตือนหนึ่งกล่อง (feature 08)
 *
 * ใช้ร่วมกันระหว่างคอนโซลผู้ซื้อกับคอนโซลร้าน ต่างกันแค่ `scope` ที่ส่งขึ้น API
 * และคำอธิบายตอนกล่องว่าง — การกรองว่าใบไหนเป็นของใครอยู่ฝั่ง API ทั้งหมด
 *
 * `idPrefix` ต้องต่างกันต่อกล่อง เพราะสองคอนโซลใช้ id ชุดเดียวกันไม่ได้
 * (Playwright จับด้วย `#id` และ strict mode จะแดงทันทีถ้าเจอสองตัว)
 */
export function NotificationFeed({
  scope,
  title,
  emptyBody,
  idPrefix,
}: {
  scope: NotificationScope;
  title: string;
  emptyBody: string;
  idPrefix: string;
}) {
  const [tab, setTab] = useState<Tab>('all');
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const reload = useCallback(async () => {
    const { data, error: err } = await listNotifications(tab, scope);
    setItems(data?.items ?? []);
    setUnread(data?.unreadCount ?? 0);
    setError(err);
    setLoading(false);
  }, [tab, scope]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  /**
   * กดแล้วทำ 2 อย่าง: ทำเครื่องหมายว่าอ่าน แล้วพาไปหน้าที่เกี่ยวข้อง
   * `linkPath` มาจาก DB ที่มี CHECK บังคับว่าต้องเป็น path ในแอปเท่านั้น
   */
  async function open(item: Notification) {
    if (item.readAt === null) {
      await markRead(item.id);
      await reload();
    }
    /**
     * `linkPath` เป็นข้อความจาก DB จึงพิมพ์เป็น route type ไม่ได้ — cast จำเป็น
     * แต่ต้องตรวจรูปแบบก่อนเสมอ: DB มี CHECK บังคับให้ขึ้นต้นด้วย `/` อยู่แล้ว
     * และตรงนี้เป็นด่านที่สอง (ถ้าวันหนึ่ง CHECK หลุด แอปต้องไม่พาไปเว็บนอก)
     */
    if (item.linkPath != null && item.linkPath.startsWith('/')) {
      router.push(item.linkPath as Parameters<typeof router.push>[0]);
    }
  }

  if (loading) return <Splash />;

  return (
    <Screen>
      <Card>
        <SectionHeader
          title={title}
          action={
            unread > 0 ? (
              <Pressable
                id={`${idPrefix}-mark-all`}
                accessibilityRole="button"
                onPress={() => {
                  void markAllRead(scope).then(() => reload());
                }}
              >
                <Text style={styles.markAll}>อ่านทั้งหมด ({unread})</Text>
              </Pressable>
            ) : undefined
          }
        />
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              id={`${idPrefix}-tab-${t.key}`}
              accessibilityRole="button"
              onPress={() => setTab(t.key)}
              style={[styles.tab, tab === t.key && styles.tabOn]}
            >
              <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>
                {t.label}
                {t.key === 'unread' && unread > 0 ? ` (${unread})` : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      {error != null ? <ErrorNote id={`${idPrefix}-error`} message={error} /> : null}

      {items.length === 0 ? (
        <Card>
          <EmptyState
            id={`${idPrefix}-empty`}
            title={tab === 'unread' ? 'อ่านครบแล้ว' : 'ยังไม่มีการแจ้งเตือน'}
            body={emptyBody}
          />
        </Card>
      ) : null}

      {items.map((item) => (
        <Pressable
          key={item.id}
          id={`${idPrefix}-item-${item.id}`}
          accessibilityRole="button"
          onPress={() => void open(item)}
        >
          <Card style={item.readAt === null ? styles.unreadCard : undefined}>
            <View style={styles.row}>
              <Ionicons
                name={notificationIcon(item.type)}
                size={20}
                color={item.readAt === null ? colors.primaryStrong : colors.textFaint}
              />
              <View style={styles.body}>
                <Text style={type.bodyStrong}>{item.title}</Text>
                {item.body != null ? <Text style={styles.text}>{item.body}</Text> : null}
                <Text style={styles.time}>{ago(item.createdAt)}</Text>
              </View>
              {item.readAt === null ? (
                <View id={`${idPrefix}-dot-${item.id}`} style={styles.dot} />
              ) : null}
            </View>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  markAll: { ...type.caption, color: colors.primaryStrong },
  tabs: { flexDirection: 'row', gap: space.sm },
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
  unreadCard: { borderWidth: 1, borderColor: colors.primarySoft },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  body: { flex: 1, gap: 2 },
  text: { ...type.small, color: colors.textMuted },
  time: { ...type.caption, color: colors.textFaint },
  dot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.primary, marginTop: 4 },
});
