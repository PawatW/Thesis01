/**
 * ทุกอย่างในนี้ถูกส่งไปให้ client ได้อย่างปลอดภัย — **ไม่มี `api_secret`**
 *
 * `signature` คือของที่ใช้แทน secret ได้ในกรอบแคบ ๆ เท่านั้น: ผูกกับ folder
 * ของร้านนั้นและ timestamp นี้ ใช้อัปโหลดที่อื่นหรือย้อนหลังไม่ได้
 */
export interface UploadSignatureResponse {
  cloudName: string;
  apiKey: string;
  /** โฟลเดอร์ที่ลายเซ็นนี้อนุญาต — มาจาก shopId ใน token ไม่ใช่จาก client */
  folder: string;
  timestamp: number;
  signature: string;
  expiresInSeconds: number;
  maxBytes: number;
  allowedFormats: string[];
}
