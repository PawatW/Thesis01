import {
  IBMPlexSansThai_400Regular,
  IBMPlexSansThai_500Medium,
  IBMPlexSansThai_600SemiBold,
  IBMPlexSansThai_700Bold,
  useFonts,
} from '@expo-google-fonts/ibm-plex-sans-thai';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Splash } from '@/components/ui';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { CompareProvider } from '@/features/compare/CompareProvider';
import { colors, fonts } from '@/lib/theme';

/**
 * Root layout: loads the Thai type family, then wraps everything in AuthProvider.
 * Route groups do their own gating — (auth) bounces signed-in users out, (buyer)
 * bounces signed-out users to login. Both are UX; the database is the real gate.
 */
export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    IBMPlexSansThai_400Regular,
    IBMPlexSansThai_500Medium,
    IBMPlexSansThai_600SemiBold,
    IBMPlexSansThai_700Bold,
  });

  if (!fontsLoaded) return <Splash />;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        {/* ถาดเปรียบเทียบต้องอยู่เหนือ Stack — ผู้ใช้เดินออกจากหน้าหมวดไปดูสินค้า
            แล้วกลับมา ของในถาดต้องยังอยู่ (feature 04) */}
        <CompareProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            headerStyle: { backgroundColor: colors.surface },
            headerTitleStyle: { fontFamily: fonts.semibold, color: colors.text },
            headerTintColor: colors.primaryStrong,
          }}
        >
          {/* Detail screens need a header: on web there is no other way back
              (no swipe gesture, and a deep link would otherwise be a dead end). */}
          <Stack.Screen name="product/[id]" options={{ headerShown: true, title: 'รายละเอียดสินค้า' }} />
          <Stack.Screen name="category/[id]" options={{ headerShown: true, title: 'สินค้าในหมวด' }} />
          <Stack.Screen name="compare" options={{ headerShown: true, title: 'เปรียบเทียบสินค้า' }} />
          <Stack.Screen name="shop/[id]" options={{ headerShown: true, title: 'ร้านค้า' }} />
          <Stack.Screen name="search" options={{ headerShown: true, title: 'ค้นหา' }} />
        </Stack>
        </CompareProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
