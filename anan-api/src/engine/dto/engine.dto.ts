import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * สั่งให้ engine ทำงานเดี๋ยวนี้ (หน้า admin + สคริปต์เดโม่)
 *
 * `runDate` = time-travel: ให้ engine เชื่อว่าวันนี้เป็นวันอื่นเพื่อโชว์รอบถัดไป
 * ตอนนำเสนอ — เป็นการ **เขียนข้อมูลย้อนหลัง** จึงถือเป็น privileged action
 * ที่เปิดได้เฉพาะเครื่องเดโม่ (ตรวจที่ service ไม่ใช่แค่ที่ DTO)
 */
export class RunEngineDto {
  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'รูปแบบวันที่ไม่ถูกต้อง' })
  runDate?: string;
}

/** สรุปผลการรัน 1 ครั้ง — ตรงกับแถวที่บันทึกไว้ใน `engine_runs` */
export interface EngineRunResponse {
  id: number;
  runDate: string;
  ordersCreated: number;
  notificationsCreated: number;
  detail: EngineRunDetail;
  ranAt: string;
}

export interface EngineRunDetail {
  /** จำนวน subscription ที่เข้าเงื่อนไข "ถึงรอบ" ในการรันครั้งนี้ */
  due: number;
  /** ชนกับออเดอร์ที่มีอยู่แล้ว = รันซ้ำวันเดิม (ไม่ใช่ความผิดพลาด) */
  skipped: number;
  /** แจ้งล่วงหน้า T-3 ที่สร้างใหม่ */
  upcoming: number;
  /** จำนวนร้านที่ได้สรุปออเดอร์ประจำวัน */
  shopsNotified: number;
  /** refresh token ที่หมดอายุแล้วและถูกลบทิ้งในรอบนี้ */
  tokensPurged: number;
  /** ออเดอร์ที่ส่งเกิน 7 วันแล้วระบบปิดให้ (ไม่ได้แตะ `confirmed_at`) */
  autoConfirmed: number;
  /**
   * รอบที่สร้างออเดอร์แล้วแต่บัตรถูกปฏิเสธ (จำลอง) — นับรวมอยู่ใน `ordersCreated`
   * ด้วย เพราะแถวออเดอร์เกิดจริง แต่ร้านยังไม่เห็นจนกว่าผู้ซื้อจะจ่ายสำเร็จ
   */
  paymentsFailed: number;
  /** รายการที่ทำงานไม่สำเร็จ — ต้องเห็นในรายงาน ไม่ใช่หายเงียบ */
  failed: number;
}
