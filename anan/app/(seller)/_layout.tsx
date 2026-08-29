import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';

import { ConsoleShell, type NavItem } from '@/components/console/ConsoleShell';
import { Splash } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useUnreadCount } from '@/features/notifications/useUnreadCount';
import { ShopProvider, useMyShop } from '@/features/seller/ShopProvider';
import { breakpoints, colors, fonts } from '@/lib/theme';
import { useWindowWidth } from '@/lib/useWindowWidth';

/**
 * คอนโซลร้านค้า — หลังร้าน: ออเดอร์ที่ต้องส่ง ราคาที่ต้องตั้ง สินค้าที่ต้องดูแล
 *
 * session เดียวกับฝั่งผู้ซื้อ ไม่ต้องล็อกอินใหม่ (W02) แต่**เปลือกคนละใบ**:
 * แถบนำทางพื้นเขียวสนเข้ม + ชื่อร้านจริงบนหัว + กล่องแจ้งเตือนของร้านเอง
 * ผู้ใช้จึงรู้ได้ในสายตาเดียวว่าตอนนี้กำลังทำงานในฐานะร้าน ไม่ใช่ผู้ซื้อ
 *
 * ด่านตรงนี้เป็น **UX** เท่านั้น: คนที่ยังไม่มีร้านจะถูกพาไปหน้าเปิดร้านแทนที่จะ
 * เห็นแท็บว่าง ๆ · กฎจริงอยู่ที่ `@Roles('seller')` + การกรองด้วย `shop.ownerId`
 * ใน service ของ API — แก้โค้ดหน้านี้ให้ผ่านก็ไม่ได้ข้อมูลร้านใครเพิ่ม
 */
export default function SellerLayout() {
  const { profile, initializing } = useAuth();

  if (initializing) return <Splash />;
  if (profile == null) return <Redirect href="/(auth)/login" />;
  if (!profile.isSeller) return <Redirect href="/(buyer)/profile/open-shop" />;

  return (
    <ShopProvider>
      <SellerConsole />
    </ShopProvider>
  );
}

function SellerConsole() {
  const width = useWindowWidth();
  const wide = width >= breakpoints.desktop;
  const unread = useUnreadCount('seller');
  const { shop } = useMyShop();

  const NAV: NavItem[] = [
    {
      id: 'nav-seller-overview',
      href: '/(seller)',
      label: 'ภาพรวม',
      icon: 'stats-chart-outline',
      match: ['/'],
    },
    {
      id: 'nav-seller-products',
      href: '/(seller)/products',
      label: 'สินค้า',
      icon: 'cube-outline',
      match: ['/products', '/products/'],
    },
    {
      id: 'nav-seller-orders',
      href: '/(seller)/orders',
      label: 'ออเดอร์',
      icon: 'receipt-outline',
      match: ['/orders'],
    },
    {
      id: 'nav-seller-coupons',
      href: '/(seller)/coupons',
      label: 'คูปองของร้าน',
      icon: 'ticket-outline',
      match: ['/coupons'],
    },
    {
      id: 'nav-seller-notifications',
      href: '/(seller)/notifications',
      label: 'แจ้งเตือน',
      icon: 'notifications-outline',
      match: ['/notifications'],
      badge: unread,
    },
    {
      id: 'nav-seller-shop',
      href: '/(seller)/shop',
      label: 'ตั้งค่าร้าน',
      icon: 'storefront-outline',
      match: ['/shop'],
    },
  ];

  const tabs = (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primaryStrong,
        tabBarInactiveTintColor: colors.textMuted,
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
          title: 'ภาพรวม',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="stats-chart-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: 'สินค้า',
          tabBarIcon: ({ color, size }) => <Ionicons name="cube-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'ออเดอร์',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="receipt-outline" color={color} size={size} />
          ),
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
        name="shop"
        options={{
          title: 'ตั้งค่าร้าน',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="storefront-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );

  return (
    <ConsoleShell
      role="seller"
      wide={wide}
      items={NAV}
      brand={{
        // ชื่อร้านจริงคือสิ่งที่บอกว่า "อยู่หลังร้านของใคร" — ระหว่างโหลดใช้คำกลาง ๆ
        title: shop?.name ?? 'ร้านของฉัน',
        subtitle: 'โหมดร้านค้า',
        icon: 'storefront-outline',
        logoUrl: shop?.logoUrl,
      }}
    >
      {tabs}
    </ConsoleShell>
  );
}
