import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/features/auth/AuthProvider';
import { ROLE_META, rolesOf, type AppRole } from '@/features/auth/roles';
import { radius, space, type, type RoleShell } from '@/lib/theme';

/**
 * ตัวสลับโหมดที่อยู่ติดตัวทุกหน้า (W02)
 *
 * ของเดิมทางเข้าโหมดร้าน/ผู้ดูแลซ่อนอยู่ในหน้าโปรไฟล์ของ**ฝั่งผู้ซื้อ** ที่เดียว
 * เจ้าของร้านที่อยู่ในคอนโซลร้านจึงต้องเดินย้อนออกไปฝั่งผู้ซื้อก่อนเสมอ ทั้งที่
 * เป็นบัญชีเดียวกัน · ตอนนี้ทุกคอนโซลถือตัวสลับของตัวเองไว้ที่ท้ายแถบนำทาง
 *
 * แสดงโหมดตามที่ `rolesOf()` ตอบ (ผู้ดูแลได้ครบ 3 โหมด) — และถึงจะแก้โค้ดให้โผล่
 * ปุ่มที่ไม่ควรมีมา ก็เข้าไปได้แค่หน้าจอเปล่า เพราะ endpoint ฝั่งนั้นตรวจสิทธิ์
 * จาก DB เองทุก request ปุ่มบนหน้าจอไม่เคยเป็นคนตัดสิน
 */
export function ModeSwitcher({
  current,
  shell,
  variant = 'stack',
}: {
  current: AppRole;
  shell: RoleShell;
  variant?: 'stack' | 'row';
}) {
  const { profile } = useAuth();
  const router = useRouter();
  const others = rolesOf(profile).filter((role) => role !== current);

  if (others.length === 0) return null;

  if (variant === 'row') {
    return (
      <View style={styles.row}>
        {others.map((role) => (
          <Pressable
            key={role}
            id={`mode-switch-${role}`}
            accessibilityRole="button"
            accessibilityLabel={ROLE_META[role].label}
            onPress={() => router.replace(ROLE_META[role].href)}
            style={({ pressed }) =>
              StyleSheet.flatten([
                styles.iconButton,
                { backgroundColor: pressed ? shell.itemPressedBg : shell.itemActiveBg },
              ])
            }
          >
            <Ionicons name={ROLE_META[role].icon} size={18} color={shell.iconActive} />
          </Pressable>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <Text style={[type.label, { color: shell.brandMuted }]}>สลับโหมด</Text>
      {others.map((role) => (
        <Pressable
          key={role}
          id={`mode-switch-${role}`}
          accessibilityRole="button"
          onPress={() => router.replace(ROLE_META[role].href)}
          style={({ pressed }) =>
            StyleSheet.flatten([
              styles.item,
              pressed ? { backgroundColor: shell.itemPressedBg } : null,
            ])
          }
        >
          <Ionicons name={ROLE_META[role].icon} size={18} color={shell.icon} />
          <Text style={[type.small, { color: shell.label, flex: 1 }]} numberOfLines={1}>
            {ROLE_META[role].label}
          </Text>
          <Ionicons name="arrow-forward" size={14} color={shell.brandMuted} />
        </Pressable>
      ))}
    </View>
  );
}

/** ออกจากระบบ — ต้องกดได้จากทุกคอนโซล ไม่ใช่เฉพาะหน้าโปรไฟล์ของผู้ซื้อ */
export function SignOutButton({
  shell,
  variant = 'stack',
}: {
  shell: RoleShell;
  variant?: 'stack' | 'row';
}) {
  const { signOut } = useAuth();
  const router = useRouter();

  async function handle() {
    await signOut();
    router.replace('/(auth)/login');
  }

  if (variant === 'row') {
    return (
      <Pressable
        id="console-signout"
        accessibilityRole="button"
        accessibilityLabel="ออกจากระบบ"
        onPress={() => void handle()}
        style={({ pressed }) =>
          StyleSheet.flatten([
            styles.iconButton,
            { backgroundColor: pressed ? shell.itemPressedBg : shell.itemActiveBg },
          ])
        }
      >
        <Ionicons name="log-out-outline" size={18} color={shell.icon} />
      </Pressable>
    );
  }

  return (
    <Pressable
      id="console-signout"
      accessibilityRole="button"
      onPress={() => void handle()}
      style={({ pressed }) =>
        StyleSheet.flatten([styles.item, pressed ? { backgroundColor: shell.itemPressedBg } : null])
      }
    >
      <Ionicons name="log-out-outline" size={18} color={shell.icon} />
      <Text style={[type.small, { color: shell.label }]}>ออกจากระบบ</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 2 },
  row: { flexDirection: 'row', gap: space.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
