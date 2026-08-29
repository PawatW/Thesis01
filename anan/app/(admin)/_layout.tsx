import { Redirect, Slot } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { ConsoleShell, type NavItem } from '@/components/console/ConsoleShell';
import { Splash } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { breakpoints, space } from '@/lib/theme';
import { useWindowWidth } from '@/lib/useWindowWidth';

const NAV: NavItem[] = [
  { id: 'nav-admin-overview', href: '/(admin)', label: 'ภาพรวม', icon: 'stats-chart-outline', match: ['/'] },
  {
    id: 'nav-admin-categories',
    href: '/(admin)/categories',
    label: 'หมวดสินค้า',
    icon: 'pricetags-outline',
    match: ['/categories'],
  },
  {
    id: 'nav-admin-moderation',
    href: '/(admin)/moderation',
    label: 'ดูแลร้าน',
    icon: 'shield-checkmark-outline',
    match: ['/moderation'],
  },
  {
    id: 'nav-admin-coupons',
    href: '/(admin)/coupons',
    label: 'คูปอง',
    icon: 'ticket-outline',
    match: ['/coupons'],
  },
  {
    id: 'nav-admin-engine',
    href: '/(admin)/engine',
    label: 'Engine',
    icon: 'time-outline',
    match: ['/engine'],
  },
  {
    id: 'nav-admin-logs',
    href: '/(admin)/logs',
    label: 'log ระบบ',
    icon: 'list-outline',
    match: ['/logs'],
  },
  {
    id: 'nav-admin-settings',
    href: '/(admin)/settings',
    label: 'ตั้งค่าเมล',
    icon: 'mail-outline',
    match: ['/settings'],
  },
];

/**
 * คอนโซลผู้ดูแล (feature 14) — **web-first**: sidebar ตั้งแต่ 768px ขึ้นไป
 *
 * ใช้เปลือกเดียวกับอีกสองคอนโซล ต่างที่สีพื้น (ดำหมึก = ห้องเครื่องของระบบ)
 * และมีตัวสลับโหมด/ออกจากระบบติดอยู่ที่ท้ายแถบเหมือนกัน — ผู้ดูแลจึงกลับไป
 * โหมดผู้ซื้อหรือออกจากระบบได้โดยไม่ต้องเดินย้อนออกไปหน้าโปรไฟล์ก่อน
 *
 * ★ guard นี้เป็น UX ไม่ใช่ security ★ ทุก endpoint ของ admin ตรวจ role จาก token
 * เองอยู่แล้ว (403) — ที่ต้องมีตรงนี้เพราะการปล่อยให้หน้าจอโหลดแล้วขึ้น error
 * เต็มจอมันอ่านไม่รู้เรื่อง ไม่ใช่เพราะมันกันอะไรได้
 */
export default function AdminLayout() {
  const { profile, initializing } = useAuth();
  const width = useWindowWidth();
  const wide = width >= breakpoints.tablet;

  if (initializing) return <Splash />;
  if (profile == null) return <Redirect href="/(auth)/login" />;
  if (!profile.isAdmin) return <Redirect href="/(buyer)" />;

  return (
    <ConsoleShell
      role="admin"
      wide={wide}
      items={NAV}
      // คอนโซลนี้ใช้ `<Slot>` ไม่ใช่ `<Tabs>` — จอแคบจึงต้องมีแถบนำทางของตัวเอง
      narrowNav="row"
      brand={{ title: 'ANAN', subtitle: 'โหมดผู้ดูแลระบบ', icon: 'shield-checkmark-outline' }}
    >
      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        <Slot />
      </ScrollView>
    </ConsoleShell>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  contentInner: { padding: space.xl, gap: space.lg, maxWidth: 1100 },
});
