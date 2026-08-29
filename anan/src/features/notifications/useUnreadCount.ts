import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';

import { listNotifications, type NotificationScope } from './api';

/**
 * จำนวนที่ยังไม่ได้อ่านของกล่องนี้ — ใช้ทำ badge บนเมนูของคอนโซล
 *
 * โหลดใหม่เมื่อ path เปลี่ยน (ไม่ใช่ polling): แถบนำทางไม่ถูก unmount ระหว่าง
 * เดินในคอนโซลเดียวกัน ถ้าใช้ `useEffect` ครั้งเดียวตอน mount ตัวเลขจะค้าง
 * ค่าเดิมตลอด session แม้ผู้ใช้จะเพิ่งกดอ่านไปแล้วก็ตาม
 */
export function useUnreadCount(scope: NotificationScope): number {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await listNotifications('unread', scope);
      // โหลดไม่สำเร็จ = ไม่รู้ ไม่ใช่ "ไม่มี" — คงเลขเดิมไว้ดีกว่าโชว์ 0 ที่ผิด
      if (!cancelled && data != null) setCount(data.unreadCount);
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, scope]);

  return count;
}
