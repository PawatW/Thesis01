import { NotificationFeed } from '@/features/notifications/NotificationFeed';

/**
 * Feature 08 — การแจ้งเตือนของ **ผู้ซื้อ**
 *
 * เรื่องของร้าน (มีผู้สมัครใหม่ · ออเดอร์ใหม่ประจำวัน) ไม่ขึ้นที่นี่แล้ว — ไปอยู่ใน
 * กล่องของคอนโซลร้าน `(seller)/notifications` ซึ่งเป็นที่ที่เจ้าของร้านทำงานจริง
 * การแบ่งอยู่ที่ API (`?scope=`) ไม่ใช่การซ่อนบนหน้าจอ
 */
export default function BuyerNotificationsScreen() {
  return (
    <NotificationFeed
      scope="buyer"
      idPrefix="noti"
      title="การแจ้งเตือน"
      emptyBody="ระบบจะแจ้งเมื่อใกล้ถึงรอบส่ง ร้านอัปเดตสถานะ หรือมีอะไรเปลี่ยนกับรายการของคุณ"
    />
  );
}
