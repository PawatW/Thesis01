import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { iconName } from '@/features/catalog/categoryIcon';
import { categoryTone, colors, radius as radii, type } from '@/lib/theme';

/**
 * รูปประกอบของสินค้า — รูปจริงถ้ามี ไม่มีก็ใช้สีประจำหมวด + ไอคอนหมวด
 *
 * ── ทำไมต้องมีทางสำรองถาวร ─────────────────────────────────────────────
 * `products.images` ในฐานข้อมูลเดโม่เก็บเป็นชื่อไฟล์เปล่า (`coffee-medium.jpg`)
 * ซึ่ง**สร้างผ่าน API ของเราเองไม่ได้เลย** — `CreateProductDto` บังคับ
 * `@IsUrl({ protocols: ['https'] })` · seed เขียนตรงผ่าน Prisma จึงเล็ดลอดมาได้
 *
 * ของเดิมวาดอักษรตัวแรกของชื่อด้วยสี `primarySoft` บนพื้น `surfaceAlt`
 * = contrast 1.11:1 → มองไม่เห็นเลย ช่องรูปจึงเป็นสี่เหลี่ยมเทาเปล่ามาตลอด
 *
 * ตอนนี้ทางสำรองอ่านออกจริงและบอกหมวดได้ ส่วนรูปจริงจะขึ้นทันทีที่ร้านใส่ลิงก์
 * https เข้ามา (ฟอร์มแก้สินค้ารับอยู่แล้ว) โดยไม่ต้องแก้โค้ดอีก
 */
export function ProductImage({
  images,
  categoryIcon,
  height,
  iconSize = 40,
  style,
  children,
}: {
  images: string[];
  categoryIcon: string | null;
  height: number;
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
  /** ป้ายส่วนลด / ปุ่มเทียบ ที่วางทับมุมรูป */
  children?: React.ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  const tone = categoryTone(categoryIcon);
  const uri = broken ? null : firstUsableImage(images);

  return (
    <View style={[styles.well, { height, backgroundColor: tone.tint }, style]}>
      {uri != null ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={120}
          // ลิงก์เสียต้องกลับไปใช้ไอคอนหมวด ไม่ใช่ปล่อยกล่องว่าง
          onError={() => setBroken(true)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Ionicons
          name={iconName(categoryIcon)}
          size={iconSize}
          color={tone.solid}
          // ไอคอนเป็นของตกแต่ง ชื่อสินค้าอยู่ข้าง ๆ อยู่แล้ว
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      )}
      {children}
    </View>
  );
}

/**
 * รูปวงกลมของ "คน/ร้าน" — โลโก้ร้าน หรือรูปโปรไฟล์ผู้ใช้
 *
 * ทางสำรองเป็นตัวอักษรแรกของชื่อ ซึ่งใช้ได้จริงต่างจากกรณีสินค้า เพราะชื่อคน
 * กับชื่อร้านสั้นและอ่านออกในวงกลมได้
 *
 * ทั้ง `shops.logo_url` และ `users.avatar_url` มีอยู่ใน API มาตั้งแต่ต้น แต่ไม่มี
 * หน้าจอไหนเคยเอามาแสดง — มีแต่ช่องให้กรอกลิงก์
 */
export function Avatar({
  url,
  name,
  size = 48,
}: {
  url: string | null | undefined;
  name: string;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const uri = broken ? null : usableUrl(url);

  return (
    <View style={[styles.logo, { width: size, height: size, borderRadius: size / 2 }]}>
      {uri != null ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={120}
          onError={() => setBroken(true)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text style={[styles.logoText, { fontSize: size * 0.4 }]}>{[...name.trim()][0] ?? '?'}</Text>
      )}
    </View>
  );
}

/**
 * ค่าที่ใช้เป็นรูปได้จริงเท่านั้น — ต้องเป็น https
 *
 * ห้ามลดเงื่อนไขลงเป็น "ขึ้นต้นด้วย http" — ค่าที่ค้างอยู่ในฐานข้อมูลเดโม่เป็น
 * ชื่อไฟล์เปล่า และ `<Image>` ที่ได้ uri ใช้ไม่ได้จะขึ้นกล่องว่างแทนที่จะ error
 */
function usableUrl(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.startsWith('https://') ? trimmed : null;
}

function firstUsableImage(images: string[]): string | null {
  for (const candidate of images) {
    const url = usableUrl(candidate);
    if (url != null) return url;
  }
  return null;
}

const styles = StyleSheet.create({
  well: {
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logo: {
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoText: { ...type.h3, color: colors.primaryStrong },
});
