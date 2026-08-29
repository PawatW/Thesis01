import { Redirect, Stack } from 'expo-router';

import { Splash } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { colors, fonts } from '@/lib/theme';

/**
 * Checkout is the one screen that moves money, so it gets the same gate as
 * (buyer): a signed-out deep link must never render the card form (rule B-10).
 * The database refuses the writes anyway — this is the layer that keeps the user
 * from filling in a form that was always going to fail.
 */
export default function CheckoutLayout() {
  const { profile, initializing } = useAuth();

  if (initializing) return <Splash />;
  if (profile == null) return <Redirect href="/(auth)/login" />;

  // header on: the user must always be able to back out of a payment screen
  return (
    <Stack
      screenOptions={{
        title: 'ยืนยันการสมัคร',
        contentStyle: { backgroundColor: colors.background },
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { fontFamily: fonts.semibold, color: colors.text },
        headerTintColor: colors.primaryStrong,
      }}
    />
  );
}
