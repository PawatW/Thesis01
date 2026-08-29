/**
 * บทบาทของผู้ใช้ กับ "คอนโซล" ของแต่ละบทบาท
 *
 * บัญชีเดียวสวมได้หลายหมวก (ผู้ซื้อทุกคน · เจ้าของร้าน · ผู้ดูแล) — ไฟล์นี้คือ
 * ที่เดียวที่ตอบว่า "บัญชีนี้เข้าคอนโซลไหนได้บ้าง" และ "ล็อกอินแล้วควรไปที่ไหน"
 * เพื่อไม่ให้ตรรกะนี้กระจายอยู่ตาม layout หลายไฟล์แล้วเพี้ยนกันเอง
 *
 * ★ นี่คือ UX ไม่ใช่ security ★ การพาไปหน้าไหนไม่ได้ให้สิทธิ์อะไรเพิ่ม —
 * endpoint ฝั่งร้าน/ผู้ดูแลตรวจ role จาก token เองทุกครั้ง (403) คนที่แก้โค้ด
 * ในเครื่องตัวเองให้เข้า `(admin)` ได้ ก็ยังได้แค่หน้าจอเปล่ากับ error
 */

import type { Ionicons } from '@expo/vector-icons';
import type { Href } from 'expo-router';

import type { Profile } from './api';

export type AppRole = 'buyer' | 'seller' | 'admin';

export type RoleMeta = {
  /** ชื่อโหมดแบบเต็ม — ใช้ในปุ่มสลับโหมด */
  label: string;
  /** ป้ายสั้นบนหัวคอนโซล */
  short: string;
  /** บอกว่าโหมดนี้ทำอะไร — คนที่เพิ่งเปิดร้านวันแรกยังไม่รู้ว่าต่างกันตรงไหน */
  hint: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  href: Href;
};

export const ROLE_META: Record<AppRole, RoleMeta> = {
  buyer: {
    label: 'โหมดผู้ซื้อ',
    short: 'ผู้ซื้อ',
    hint: 'เลือกซื้อและจัดการรายการที่สมัครไว้',
    icon: 'bag-handle-outline',
    href: '/(buyer)',
  },
  seller: {
    label: 'โหมดร้านค้า',
    short: 'ร้านค้า',
    hint: 'ดูออเดอร์ ตั้งราคา และจัดการสินค้าของร้าน',
    icon: 'storefront-outline',
    href: '/(seller)',
  },
  admin: {
    label: 'โหมดผู้ดูแลระบบ',
    short: 'ผู้ดูแล',
    hint: 'ดูแลหมวดสินค้า ร้านค้า และ engine ของระบบ',
    icon: 'shield-checkmark-outline',
    href: '/(admin)',
  },
};

/**
 * คอนโซลที่บัญชีนี้เข้าได้ — เรียงตามลำดับที่แสดงในตัวสลับโหมด
 * ทุกบัญชีเป็นผู้ซื้อเสมอ (สมัครรับสินค้าได้ ไม่ว่าจะเปิดร้านหรือดูแลระบบอยู่)
 *
 * ★ ผู้ดูแลระบบเห็นครบทั้ง 3 โหมดเสมอ ★ คนที่ต้องตอบเคสว่า "ผู้ซื้อเห็นหน้านี้
 * เป็นยังไง" หรือ "ร้านกดตรงไหนแล้วพัง" ต้องเปิดดูของจริงได้ ไม่ใช่เดาจากตาราง
 * ใน DB · ที่นี่คือการ **เดินไปหน้านั้น** เท่านั้น ไม่ได้แจกสิทธิ์อะไรเพิ่มเลย:
 *
 *   - โหมดผู้ซื้อ  ทุกบัญชีมีอยู่แล้วโดยธรรมชาติ ไม่มีอะไรพิเศษ
 *   - โหมดร้านค้า  ยังต้องมีร้านของตัวเอง — `@Roles('seller')` ที่ API ดู
 *     `is_seller` จาก DB และ service ฝั่งร้านกรองด้วย `shop.ownerId` ทุกตัว
 *     ผู้ดูแลที่ยังไม่เปิดร้านจึงถูกพาไปหน้าเปิดร้าน ไม่ใช่เข้าไปเห็นร้านคนอื่น
 *
 * ผู้ดูแลที่อยากดูหลังร้านต้องเปิดร้านของตัวเอง (บัญชีเดโม่ `admin.demo` มีร้าน
 * ตัวอย่างให้แล้วใน seed) — การให้ผู้ดูแลสวมสิทธิ์ร้านคนอื่นเป็นคนละเรื่องและ
 * ต้องมี audit log ก่อน จึงยังไม่ทำ (ดู 14-admin.md หัวข้อ Out of scope)
 */
export function rolesOf(profile: Profile | null): AppRole[] {
  if (profile == null) return [];
  if (profile.isAdmin) return ['buyer', 'seller', 'admin'];

  const roles: AppRole[] = ['buyer'];
  if (profile.isSeller) roles.push('seller');
  return roles;
}

/**
 * หน้าแรกหลังล็อกอิน — คนที่มีร้านหรือดูแลระบบเข้ามาทำงานของบทบาทนั้นเป็นหลัก
 * การโยนทุกคนไปหน้าซื้อของทำให้บัญชีร้านต้องเดินผ่านหน้าที่ไม่ใช่ของตัวเอง
 * ทุกครั้งที่เปิดแอป (และเป็นที่มาของ "ทำไมเมนูเหมือนของผู้ซื้อ")
 */
export function landingHref(profile: Profile | null): Href {
  if (profile == null) return '/(auth)/login';
  if (profile.isAdmin) return ROLE_META.admin.href;
  if (profile.isSeller) return ROLE_META.seller.href;
  return ROLE_META.buyer.href;
}
