import { Redirect, Stack } from 'expo-router';

import { Splash } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { landingHref } from '@/features/auth/roles';
import { colors } from '@/lib/theme';

export default function AuthLayout() {
  const { profile, initializing } = useAuth();

  if (initializing) return <Splash />;
  // ล็อกอินเสร็จแล้วไปคอนโซลของบทบาทตัวเอง ไม่ใช่หน้าซื้อของเสมอไป
  if (profile != null) return <Redirect href={landingHref(profile)} />;

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
