import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * error รูปแบบเดียวของทั้งระบบ: { statusCode, code, message }
 *   - `code`    ค่าคงที่ให้ client แตกเคสได้ (ห้ามเปลี่ยนพร่ำเพรื่อ)
 *   - `message` ภาษาไทย พร้อมแสดงบนหน้าจอ
 *
 * ห้ามใส่รายละเอียดภายในลงใน message (ชื่อตาราง, id ของคนอื่น, SQL)
 * เพราะข้อความนี้ถึงมือ client เสมอ
 */
export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
}

export class AppException extends HttpException {
  constructor(status: HttpStatus, code: string, message: string) {
    const body: ApiErrorBody = { statusCode: status, code, message };
    super(body, status);
  }
}

/**
 * ตัวช่วยให้เลือก status ถูกตัวตามข้อตกลงใน docs/architecture.md §3
 *
 * หมายเหตุความปลอดภัย: ของที่ "มีอยู่จริงแต่ไม่ใช่ของผู้เรียก" ให้ตอบ notFound
 * ไม่ใช่ forbidden — เพราะ 403 เป็นการยืนยันว่า id นั้นมีอยู่ในระบบ
 * (ดู docs/security-design.md — enumeration)
 */
export const AppError = {
  badRequest: (code: string, message: string) =>
    new AppException(HttpStatus.BAD_REQUEST, code, message),

  unauthorized: (code: string, message: string) =>
    new AppException(HttpStatus.UNAUTHORIZED, code, message),

  /**
   * การจ่ายเงิน (จำลอง) ไม่ผ่าน — ผู้เรียกไม่ได้ทำอะไรผิด แค่บัตรถูกปฏิเสธ
   * แยกจาก 409 เพราะหน้าจอต้องพาไปเปลี่ยนบัตร ไม่ใช่ให้กดรีเฟรช
   */
  paymentRequired: (code: string, message: string) =>
    new AppException(HttpStatus.PAYMENT_REQUIRED, code, message),

  /** ใช้เมื่อ "รู้ตัวตนแล้วแต่ role ไม่ถึง" เท่านั้น */
  forbidden: (code: string, message: string) =>
    new AppException(HttpStatus.FORBIDDEN, code, message),

  notFound: (code: string, message: string) =>
    new AppException(HttpStatus.NOT_FOUND, code, message),

  /** ขัดกับสถานะปัจจุบัน เช่น ยกเลิกไปแล้ว / ข้ามรอบซ้ำ */
  conflict: (code: string, message: string) =>
    new AppException(HttpStatus.CONFLICT, code, message),

  /** ผิดกฎธุรกิจ เช่น เลื่อนรอบเกินเพดานที่กำหนด */
  unprocessable: (code: string, message: string) =>
    new AppException(HttpStatus.UNPROCESSABLE_ENTITY, code, message),

  /**
   * ระบบภายนอก/ค่าตั้งของเครื่องยังไม่พร้อม — ไม่ใช่ความผิดของผู้เรียก
   * (เช่น ยังไม่ได้ตั้งค่า Cloudinary) 503 บอกให้ลองใหม่ได้ ต่างจาก 500 ที่แปลว่าโค้ดพัง
   */
  serviceUnavailable: (code: string, message: string) =>
    new AppException(HttpStatus.SERVICE_UNAVAILABLE, code, message),
};
