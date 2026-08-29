import { NotificationFeed } from '@/features/notifications/NotificationFeed';

/**
 * กล่องแจ้งเตือนของคอนโซลร้าน — เรื่องที่เจ้าของร้านต้องรู้เท่านั้น
 * (มีผู้สมัครใหม่ · มีคนยกเลิก · สรุปออเดอร์ใหม่ประจำวันจาก engine)
 *
 * ของเดิมใบพวกนี้ไปกองรวมกับแจ้งเตือนฝั่งผู้ซื้อ เจ้าของร้านจึงต้องออกจากคอนโซล
 * ร้านไปอ่านในแท็บของผู้ซื้อ แล้วคุ้ยเองว่าใบไหนเป็นเรื่องของร้าน
 */
export default function SellerNotificationsScreen() {
  return (
    <NotificationFeed
      scope="seller"
      idPrefix="seller-noti"
      title="แจ้งเตือนของร้าน"
      emptyBody="ระบบจะแจ้งเมื่อมีคนสมัครรับสินค้าของร้าน ยกเลิกรายการ หรือมีออเดอร์ใหม่ประจำวันเข้ามา"
    />
  );
}
