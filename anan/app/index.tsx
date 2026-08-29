import { Redirect } from 'expo-router';

import { Splash } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { landingHref } from '@/features/auth/roles';

/**
 * ประตูทางเข้า: รู้ session เมื่อไหร่ก็ส่งไปคอนโซลของบทบาทนั้น
 *
 * ของเดิมส่งทุกคนไป `(buyer)` ไม่ว่าจะเป็นใคร — บัญชีร้านจึงเปิดแอปมาเจอเมนู
 * ของผู้ซื้อทุกครั้ง แล้วต้องเดินเข้าโปรไฟล์เพื่อกด "ไปที่ร้านของฉัน" เอง
 */
export default function Index() {
  const { profile, initializing } = useAuth();

  if (initializing) return <Splash />;
  return <Redirect href={landingHref(profile)} />;
}
