import { Ionicons } from '@expo/vector-icons';
import { Link, usePathname, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { layout, radius, space, type, type RoleShell } from '@/lib/theme';

export type NavItem = {
  /** id จริงบน DOM — Playwright จับตัวนี้ (e2e/helpers/selectors.ts) */
  id: string;
  /** typed route ของ expo-router — พิมพ์ path ผิดจะไม่ผ่าน typecheck */
  href: Href;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /**
   * path ที่ถือว่า "อยู่ในเมนูนี้" — ต้องแยกจาก `href` เพราะ `usePathname()`
   * คืนค่าที่ตัดชื่อกลุ่มออกแล้ว (`/subscriptions` ไม่ใช่ `/(buyer)/subscriptions`)
   * เทียบกับ href ตรง ๆ จึงไม่มีวันตรง · ตัวแรกในลิสต์ใช้เทียบแบบเป๊ะ
   * ที่เหลือเทียบแบบขึ้นต้น (หน้า detail ที่ push ทับ เช่น `/orders/123`)
   */
  match: [exact: string, ...startsWith: string[]];
  /** จำนวนที่ยังไม่ได้อ่าน — ไม่ส่งหรือ 0 = ไม่ขึ้นตัวเลข */
  badge?: number;
};

export type ConsoleBrand = {
  /** บรรทัดบน — ชื่อที่ผู้ใช้เรียกที่นี่ (ชื่อแอป / ชื่อร้าน) */
  title: string;
  /** บรรทัดล่าง — บอกว่ากำลังสวมหมวกใบไหนอยู่ */
  subtitle: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** โลโก้ร้าน ถ้ามี — ใช้แทนไอคอน */
  logoUrl?: string | null;
};

/**
 * แถบนำทางซ้ายของคอนโซล (จอ ≥ breakpoint ของแต่ละโหมด)
 *
 * ของเดิมชื่อ `SideNav` และใช้ร่วมกันทั้งผู้ซื้อ/ร้านค้าโดยเปลี่ยนแค่ข้อความหัวแถบ
 * ผลคือล็อกอินด้วยบัญชีร้านแล้วหน้าตาเหมือนฝั่งผู้ซื้อทุกประการ
 *
 * ตอนนี้แถบเดียวกันรับ `shell` (สีประจำบทบาท) + `brand` (ตัวตน) + `footer`
 * (สลับโหมด/ออกจากระบบ) จึงบอกได้ในสายตาเดียวว่าอยู่คอนโซลไหน โดยยังเป็น
 * component เดียว — เมนูของทุกบทบาทจึงมีพฤติกรรม active/keyboard เหมือนกัน
 */
export function ConsoleNav({
  shell,
  brand,
  items,
  footer,
}: {
  shell: RoleShell;
  brand: ConsoleBrand;
  items: NavItem[];
  footer?: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <View style={[styles.nav, { backgroundColor: shell.navBg, borderRightColor: shell.navBorder }]}>
      <View style={styles.brand}>
        <View style={[styles.brandMark, { backgroundColor: shell.itemActiveBg }]}>
          {brand.logoUrl != null && brand.logoUrl.length > 0 ? (
            <Image source={{ uri: brand.logoUrl }} style={styles.logo} resizeMode="cover" />
          ) : (
            <Ionicons name={brand.icon} size={18} color={shell.iconActive} />
          )}
        </View>
        <View style={styles.brandText}>
          <Text id="console-brand" style={[type.h4, { color: shell.brand }]} numberOfLines={1}>
            {brand.title}
          </Text>
          <Text id="console-role" style={[type.label, { color: shell.brandMuted }]}>
            {brand.subtitle}
          </Text>
        </View>
      </View>

      <View style={styles.list}>
        {items.map((item) => {
          const [exact, ...prefixes] = item.match;
          const active = pathname === exact || prefixes.some((m) => pathname.startsWith(m));
          return (
            <Link key={item.id} href={item.href} asChild>
              <Pressable
                id={item.id}
                accessibilityRole="link"
                accessibilityState={{ selected: active }}
                /**
                 * ★ style ของลูกที่อยู่ใต้ `Link asChild` ต้องเป็น "อ็อบเจกต์ก้อนเดียว" ★
                 *
                 * เป็น array → expo-router โยน error แล้วหน้าเป็นจอขาว
                 * เป็น **ฟังก์ชัน** (`({pressed}) => …` แบบที่ Pressable รับได้ปกติ)
                 * → expo-router ไม่เรียกให้ สไตล์ทั้งก้อนถูกทิ้งเงียบ ๆ: เมนูจะกลาย
                 * เป็นไอคอนซ้อนบนตัวอักษร ไม่มีพื้นของอันที่เลือกอยู่ และไม่มีใครเห็น
                 * error สักบรรทัด (บั๊กนี้อยู่ในแถบนำทางเดิมมาตลอด — เจอตอนวัด
                 * computed style ของเมนูที่ active แล้วได้ background โปร่งใส)
                 *
                 * สถานะ "กำลังกด" จึงไม่มีในเมนู — ตัวที่เลือกอยู่ใช้พื้นบอกแทน
                 */
                style={StyleSheet.flatten([
                  styles.item,
                  active ? { backgroundColor: shell.itemActiveBg } : null,
                ])}
              >
                <Ionicons
                  name={item.icon}
                  size={20}
                  color={active ? shell.iconActive : shell.icon}
                />
                <Text
                  style={[
                    type.body,
                    { color: active ? shell.labelActive : shell.label, flex: 1 },
                    active && styles.labelActive,
                  ]}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
                {item.badge != null && item.badge > 0 ? (
                  <View
                    id={`${item.id}-badge`}
                    style={[styles.badge, { backgroundColor: shell.badgeBg }]}
                  >
                    <Text style={[type.label, { color: shell.badgeInk }]}>
                      {item.badge > 99 ? '99+' : item.badge}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            </Link>
          );
        })}
      </View>

      {footer != null ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

/**
 * แถบนำทางแนวนอนสำหรับจอแคบ — ใช้กับคอนโซลที่ไม่มี bottom tabs (ผู้ดูแล)
 *
 * ถ้าไม่มีตัวนี้ ผู้ดูแลบนมือถือจะเหลือแค่หัวจอกับเนื้อหา ไม่มีทางไปหน้าอื่นเลย
 * · id ของแต่ละเมนูเป็นชุดเดียวกับ sidebar เทสจึงจับได้ทั้งสองขนาดจอ
 */
export function ConsoleNavRow({ shell, items }: { shell: RoleShell; items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.rowNav, { backgroundColor: shell.navBg, borderBottomColor: shell.navBorder }]}
      contentContainerStyle={styles.rowNavInner}
    >
      {items.map((item) => {
        const [exact, ...prefixes] = item.match;
        const active = pathname === exact || prefixes.some((m) => pathname.startsWith(m));
        return (
          <Link key={item.id} href={item.href} asChild>
            <Pressable
              id={item.id}
              accessibilityRole="link"
              accessibilityState={{ selected: active }}
              // ข้อจำกัดเดียวกับ sidebar — ต้องเป็นอ็อบเจกต์ก้อนเดียว ห้ามเป็นฟังก์ชัน
              style={StyleSheet.flatten([
                styles.rowItem,
                active ? { backgroundColor: shell.itemActiveBg } : null,
              ])}
            >
              <Ionicons name={item.icon} size={16} color={active ? shell.iconActive : shell.icon} />
              <Text style={[type.small, { color: active ? shell.labelActive : shell.label }]}>
                {item.label}
              </Text>
              {item.badge != null && item.badge > 0 ? (
                <View
                  id={`${item.id}-badge`}
                  style={[styles.badge, { backgroundColor: shell.badgeBg }]}
                >
                  <Text style={[type.label, { color: shell.badgeInk }]}>
                    {item.badge > 99 ? '99+' : item.badge}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </Link>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  nav: {
    width: layout.sidebarWidth,
    borderRightWidth: 1,
    paddingVertical: space.xxl,
    paddingHorizontal: space.md,
    gap: space.xl,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.sm,
  },
  brandMark: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logo: { width: '100%', height: '100%' },
  brandText: { flex: 1, minWidth: 0 },
  list: { gap: 2, flex: 1 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  labelActive: { fontFamily: type.bodyStrong.fontFamily },
  badge: {
    minWidth: 22,
    paddingHorizontal: 6,
    height: 20,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { gap: space.xs },
  rowNav: { flexGrow: 0, borderBottomWidth: 1 },
  rowNavInner: { gap: space.xs, paddingHorizontal: space.md, paddingVertical: space.sm },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
});
