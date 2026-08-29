import type { Ionicons } from '@expo/vector-icons';

/**
 * แปลงชื่อไอคอนที่มาจากฐานข้อมูล (`categories.icon`) เป็นชื่อที่ Ionicons รู้จัก
 *
 * ค่าในคอลัมน์นั้นเป็น `text` ธรรมดา ไม่ใช่ enum จึงเป็นค่าที่ผู้ดูแลพิมพ์อะไรก็ได้
 * **ตรวจก่อนใช้ ไม่ใช่ cast** — หมวดใหม่ที่ตั้งชื่อไอคอนผิดต้องได้ไอคอนสำรอง
 * ไม่ใช่ทำให้การ์ดทั้งใบพัง
 *
 * อยู่แยกไฟล์เพราะทั้ง `ProductCard` และ `ProductImage` ต้องใช้ — ถ้าปล่อยไว้ใน
 * ไฟล์ใดไฟล์หนึ่งจะเกิด circular import ระหว่างสองตัวนั้น
 */
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const KNOWN_ICONS = [
  'cafe',
  'sparkles',
  'medical',
  'water',
  'fitness',
  'paw',
  'happy',
  'home',
  'shirt',
  'footsteps',
] as const satisfies readonly IoniconName[];

export function iconName(icon: string | null | undefined): IoniconName {
  const found = (KNOWN_ICONS as readonly string[]).includes(icon ?? '');
  return found ? (icon as IoniconName) : 'pricetag';
}
