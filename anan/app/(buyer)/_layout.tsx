import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';

import { ConsoleShell, type NavItem } from '@/components/console/ConsoleShell';
import { Splash } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { rolesOf } from '@/features/auth/roles';
import { useUnreadCount } from '@/features/notifications/useUnreadCount';
import { breakpoints, colors, fonts } from '@/lib/theme';
import { useWindowWidth } from '@/lib/useWindowWidth';

/**
 * คอนโซลผู้ซื้อ — หน้าร้าน: เดินดูของ สมัครรับ ติดตามรอบส่ง
 *
 *  - <1200px : bottom tabs ของ expo-router + แถบบนบาง ๆ ที่บอกโหมด
 *  - ≥1200px : sidebar ซ้ายตาม design-system §4 และซ่อนแถบล่าง
 *
 * `<Tabs>` ยังเป็นตัวคุม routing เหมือนเดิมทุกอย่าง — เปลี่ยนแค่ที่ทางของแถบนำทาง
 * จึงไม่กระทบ state, deep link หรือ back button
 */
export default function BuyerLayout() {
  const { profile, initializing } = useAuth();
  const width = useWindowWidth();
  const wide = width >= breakpoints.desktop;
  const unread = useUnreadCount('buyer');

  const NAV: NavItem[] = [
    { id: 'nav-buyer-home', href: '/(buyer)', label: 'หน้าแรก', icon: 'home-outline', match: ['/'] },
    {
      id: 'nav-buyer-subscriptions',
      href: '/(buyer)/subscriptions',
      label: 'ของฉัน',
      icon: 'repeat-outline',
      match: ['/subscriptions'],
    },
    {
      id: 'nav-buyer-orders',
      href: '/(buyer)/orders',
      label: 'ออเดอร์',
      icon: 'cube-outline',
      match: ['/orders', '/orders/'],
    },
    {
      id: 'nav-buyer-notifications',
      href: '/(buyer)/notifications',
      label: 'แจ้งเตือน',
      icon: 'notifications-outline',
      match: ['/notifications'],
      badge: unread,
    },
    {
      id: 'nav-buyer-profile',
      href: '/(buyer)/profile',
      label: 'โปรไฟล์',
      icon: 'person-outline',
      match: ['/profile', '/profile/'],
    },
  ];

  if (initializing) return <Splash />;
  if (profile == null) return <Redirect href="/(auth)/login" />;

  const tabs = (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primaryStrong,
        tabBarInactiveTintColor: colors.textMuted,
        // จอกว้างใช้ sidebar แทน — ซ่อนแถบล่างไม่ให้ซ้ำซ้อน
        tabBarStyle: wide
          ? { display: 'none' }
          : { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'หน้าแรก',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="subscriptions"
        options={{
          title: 'ของฉัน',
          tabBarIcon: ({ color, size }) => <Ionicons name="repeat-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'ออเดอร์',
          tabBarIcon: ({ color, size }) => <Ionicons name="cube-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'แจ้งเตือน',
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'โปรไฟล์',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );

  return (
    <ConsoleShell
      role="buyer"
      wide={wide}
      items={NAV}
      brand={{
        title: 'ANAN',
        // บัญชีที่มีหมวกใบเดียวไม่ต้องถูกบอกว่า "โหมดผู้ซื้อ" ทุกหน้า — มันไม่มี
        // โหมดอื่นให้สับสน · คนที่มีร้าน/ดูแลระบบด้วยเท่านั้นที่ต้องรู้ว่าอยู่ที่ไหน
        subtitle: rolesOf(profile).length > 1 ? 'โหมดผู้ซื้อ' : profile.displayName,
        icon: 'bag-handle-outline',
      }}
    >
      {tabs}
    </ConsoleShell>
  );
}
