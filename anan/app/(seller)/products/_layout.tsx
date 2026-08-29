import { Stack } from 'expo-router';

import { colors, fonts } from '@/lib/theme';

/** สินค้าของร้าน: รายการ + หน้าแก้ไขรายชิ้น (feature 11) */
export default function SellerProductsStack() {
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
      <Stack.Screen name="[id]" options={{ title: 'แก้ไขสินค้า' }} />
    </Stack>
  );
}
