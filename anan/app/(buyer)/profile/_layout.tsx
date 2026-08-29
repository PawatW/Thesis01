import { Stack } from 'expo-router';

import { colors, fonts } from '@/lib/theme';

export default function ProfileStack() {
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { fontFamily: fonts.semibold, color: colors.text },
        headerTintColor: colors.primaryStrong,
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="addresses" options={{ title: 'ที่อยู่ของฉัน' }} />
      <Stack.Screen name="payment-methods" options={{ title: 'บัตรของฉัน' }} />
      <Stack.Screen name="open-shop" options={{ title: 'เปิดร้านค้า' }} />
    </Stack>
  );
}
