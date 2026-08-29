import { IsIn, IsOptional } from 'class-validator';

export class NotificationScopeQuery {
  /**
   * คอนโซลที่ถาม — บัญชีเดียวสวมได้ทั้งสองบทบาท แต่ละกล่องจึงต้องเห็นเฉพาะ
   * เรื่องของบทบาทตัวเอง ("มีผู้สมัครใหม่" ไม่ควรโผล่ในกล่องของผู้ซื้อ)
   * ไม่ส่งมา = เห็นทั้งหมดเหมือนเดิม
   */
  @IsOptional()
  @IsIn(['all', 'buyer', 'seller'])
  scope?: 'all' | 'buyer' | 'seller';
}

export class ListNotificationsQuery extends NotificationScopeQuery {
  /** `unread` = เฉพาะที่ยังไม่อ่าน (ใช้กับแท็บ) */
  @IsOptional()
  @IsIn(['all', 'unread'])
  filter?: 'all' | 'unread';
}

export interface NotificationResponse {
  id: number;
  type: string;
  title: string;
  body: string | null;
  /**
   * path ในแอปที่กดแล้วไปต่อได้ — DB มี CHECK บังคับว่าต้องขึ้นต้นด้วย `/`
   * (กัน stored phishing link ที่ชี้ออกนอกแอป)
   */
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}

/** ห่อด้วย object เพราะหน้าจอต้องใช้ badge จำนวนที่ยังไม่อ่านคู่กันเสมอ */
export interface NotificationListResponse {
  items: NotificationResponse[];
  unreadCount: number;
}
