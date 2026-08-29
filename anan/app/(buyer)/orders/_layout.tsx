import { Stack } from 'expo-router';

import { colors, fonts } from '@/lib/theme';

export default function OrdersStack() {
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
      <Stack.Screen name="[id]" options={{ title: 'รายละเอียดออเดอร์' }} />
    </Stack>
  );
}
