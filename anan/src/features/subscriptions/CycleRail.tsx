import { StyleSheet, Text, View } from 'react-native';

import { categoryTone, colors, radius, space, type } from '@/lib/theme';
import { daysUntil, formatThaiDate } from '@/features/subscriptions/api';

/** จำนวนวันของหนึ่งรอบ — ใช้เป็นตัวหารของแถบ ไม่ใช่ปฏิทินจริง จึงประมาณได้ */
const CYCLE_DAYS: Record<string, number> = { '2w': 14, '1m': 30, '2m': 61 };

/**
 * แถบจังหวะรอบส่ง — "ตอนนี้อยู่ตรงไหนระหว่างรอบที่แล้วกับรอบหน้า"
 *
 * ทำไมต้องมี: ANAN ขาย *เวลา* ไม่ใช่ *ราคา* — สิ่งที่ marketplace ซื้อครั้งเดียว
 * ให้ไม่ได้คือ "ของจะมาอีกเมื่อไหร่" แต่ของเดิมแสดงข้อมูลนั้นเป็น caption 12px
 * สีเทามุมขวาล่างของแถว ซึ่งกลับหัวกับคุณค่าของโปรเจกต์
 *
 * มันไม่ได้แค่สวย — มันทำงาน: กดหยุดชั่วคราวแล้วแถบเป็นเทาค้าง กดข้ามรอบแล้ว
 * แถบกระโดดถอย ผู้ใช้เห็นผลของปุ่มที่เพิ่งกดโดยไม่ต้องอ่าน toast
 *
 * ใช้ `<View>` ล้วน ไม่มี SVG ไม่มี dependency ใหม่ — ทำงานเหมือนกันทั้ง web
 * และ native ตามกฎข้อ 3
 */
export function CycleRail({
  cycle,
  nextOrderDate,
  status,
  categoryIcon,
  id,
}: {
  cycle: string;
  nextOrderDate: string | null;
  status: 'active' | 'paused' | 'cancelled';
  categoryIcon?: string | null;
  id?: string;
}) {
  const days = daysUntil(nextOrderDate);
  const total = CYCLE_DAYS[cycle] ?? 30;
  const idle = status !== 'active' || days == null;

  // เดินมาแล้วกี่ส่วนของรอบ — หนีบไว้ 4-100% เพื่อให้หัวจุดไม่หลุดออกนอกราง
  const progress = idle ? 1 : Math.min(100, Math.max(4, ((total - Math.max(0, days)) / total) * 100));

  // หน้าที่รู้หมวด (การ์ดสินค้า) ใช้สีหมวดให้เข้าชุดกัน · หน้าที่ไม่รู้ (รายการ
  // subscription — `SubscriptionCard` ไม่มี categoryIcon) ใช้เขียวสนของแบรนด์
  // ไม่ใช่เทากลางของ fallback ซึ่งทำให้แถบดูหม่นทั้งหน้า
  const tone = categoryIcon == null ? null : categoryTone(categoryIcon);
  const fill = idle
    ? colors.timeIdle
    : days != null && days <= 3
      ? colors.timeUrgent
      : (tone?.solid ?? colors.primary);

  return (
    <View id={id} style={styles.wrap}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${progress}%`, backgroundColor: fill }]} />
        <View style={[styles.head, { left: `${progress}%`, backgroundColor: fill }]} />
      </View>
      <Text style={styles.caption} numberOfLines={1}>
        {idle
          ? status === 'paused'
            ? 'ไม่มีรอบถัดไปจนกว่าจะกลับมาใช้งาน'
            : 'ไม่มีรอบถัดไป'
          : formatThaiDate(nextOrderDate)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 5, marginTop: 2 },
  track: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.timeTrack,
    justifyContent: 'center',
  },
  fill: { height: 4, borderRadius: radius.pill },
  // จุดหัวแถบ — marginLeft ดึงกลับครึ่งหนึ่งของตัวเองให้จุดอยู่ตรงตำแหน่งจริง
  head: { position: 'absolute', width: 9, height: 9, borderRadius: radius.pill, marginLeft: -4.5 },
  caption: { ...type.caption, color: colors.textFaint, alignSelf: 'flex-end' },
});

/** ระยะห่างมาตรฐานใต้แถบ ให้ทุกที่ที่ใช้เว้นเท่ากัน */
export const cycleRailGap = space.sm;
