import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ConsoleNav,
  ConsoleNavRow,
  type ConsoleBrand,
  type NavItem,
} from '@/components/console/ConsoleNav';
import { ModeSwitcher, SignOutButton } from '@/components/console/ModeSwitcher';
import type { AppRole } from '@/features/auth/roles';
import { colors, radius, roleShells, space, type } from '@/lib/theme';

export type { ConsoleBrand, NavItem };

/**
 * เปลือกของคอนโซลหนึ่งบทบาท — ที่เดียวที่ประกอบ "แถบนำทาง + ตัวตน + ทางออก"
 *
 * จอกว้าง: sidebar ซ้าย (ConsoleNav) · จอแคบ: แถบบนบาง ๆ แล้วปล่อยให้ bottom
 * tabs ของ expo-router ทำหน้าที่นำทางเหมือนเดิม — สองขนาดจอเห็นสีประจำบทบาท
 * และปุ่มสลับโหมดเท่ากัน ต่างแค่ที่ทาง
 */
export function ConsoleShell({
  role,
  brand,
  items,
  wide,
  narrowNav = 'tabs',
  children,
}: {
  role: AppRole;
  brand: ConsoleBrand;
  items: NavItem[];
  wide: boolean;
  /**
   * จอแคบนำทางด้วยอะไร — `tabs` = มี bottom tabs ของ expo-router อยู่แล้ว
   * (ผู้ซื้อ/ร้านค้า) · `row` = ไม่มี ต้องมีแถบแนวนอนให้ ไม่งั้นไปไหนไม่ได้เลย
   * (ผู้ดูแลใช้ `<Slot>` ไม่ใช่ `<Tabs>`)
   */
  narrowNav?: 'tabs' | 'row';
  children: ReactNode;
}) {
  const shell = roleShells[role];

  if (wide) {
    return (
      <View style={styles.wide}>
        <ConsoleNav
          shell={shell}
          brand={brand}
          items={items}
          footer={
            <>
              <ModeSwitcher current={role} shell={shell} />
              <SignOutButton shell={shell} />
            </>
          }
        />
        <View style={styles.content}>{children}</View>
      </View>
    );
  }

  return (
    <View style={styles.narrow}>
      <ConsoleTopBar role={role} brand={brand} />
      {narrowNav === 'row' ? <ConsoleNavRow shell={shell} items={items} /> : null}
      {/* แถบบนกินระยะ safe-area ไปแล้ว — ถ้าไม่รีเซ็ตตรงนี้ `Screen` ของทุกหน้า
          จะเว้นระยะบนซ้ำอีกชั้นบนมือถือที่มีติ่งจอ */}
      <TopInsetConsumed>{children}</TopInsetConsumed>
    </View>
  );
}

/** แถบบนของจอแคบ: บอกว่าอยู่คอนโซลไหน + ทางสลับโหมด/ออกจากระบบ */
export function ConsoleTopBar({ role, brand }: { role: AppRole; brand: ConsoleBrand }) {
  const shell = roleShells[role];
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: shell.barBg,
          borderBottomColor: shell.navBorder,
          paddingTop: insets.top + space.sm,
        },
      ]}
    >
      <View style={[styles.barMark, { backgroundColor: shell.itemActiveBg }]}>
        {brand.logoUrl != null && brand.logoUrl.length > 0 ? (
          <Image source={{ uri: brand.logoUrl }} style={styles.logo} resizeMode="cover" />
        ) : (
          <Ionicons name={brand.icon} size={16} color={shell.iconActive} />
        )}
      </View>
      <View style={styles.barText}>
        <Text id="console-brand" style={[type.h4, { color: shell.brand }]} numberOfLines={1}>
          {brand.title}
        </Text>
        <Text id="console-role" style={[type.label, { color: shell.brandMuted }]} numberOfLines={1}>
          {brand.subtitle}
        </Text>
      </View>
      <ModeSwitcher current={role} shell={shell} variant="row" />
      <SignOutButton shell={shell} variant="row" />
    </View>
  );
}

function TopInsetConsumed({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
      <View style={styles.content}>{children}</View>
    </SafeAreaInsetsContext.Provider>
  );
}

const styles = StyleSheet.create({
  wide: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  narrow: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, minWidth: 0 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
  },
  barMark: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logo: { width: '100%', height: '100%' },
  barText: { flex: 1, minWidth: 0 },
});
