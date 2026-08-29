import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppError } from '../common/errors/app-exception';
import { ShopService } from '../seller/shop.service';
import type { UploadSignatureResponse } from './dto/upload.dto';

/** ให้ลายเซ็นหมดอายุเร็ว — ถ้าหลุดไป ก็ใช้อัปโหลดได้ในกรอบเวลาสั้น ๆ เท่านั้น */
const SIGNATURE_TTL_SECONDS = 600;

/** เพดานเดียวกับที่หน้าจอบังคับ — Cloudinary เป็นคนปฏิเสธไฟล์ที่เกิน */
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp'];

/**
 * ลายเซ็นสำหรับอัปโหลดตรงจากเครื่องผู้ใช้ไป Cloudinary (feature 10/11)
 *
 * ทำไมไม่ให้ไฟล์วิ่งผ่าน API ของเรา: รูป 5 รูปต่อสินค้าจะกินแบนด์วิดท์และ
 * เวลาของ Node ไปเปล่า ๆ — แต่ **api_secret ห้ามออกจากเซิร์ฟเวอร์เด็ดขาด**
 * (ถ้าไปอยู่ในบันเดิลของ Expo ใครก็อัปอะไรเข้าบัญชีเราก็ได้) จึงส่งแค่ลายเซ็น
 * ที่ผูกกับ folder ของร้านนั้น + เวลาหมดอายุ
 */
@Injectable()
export class UploadsService {
  constructor(private readonly shops: ShopService) {}

  async signForMyShop(userId: string): Promise<UploadSignatureResponse> {
    // ร้านที่ถูกระงับอัปรูปใหม่ไม่ได้ — ไม่งั้นยังแก้หน้าร้านได้ทั้งที่ถูกระงับ
    const shop = await this.shops.requireOperableShop(userId);

    // อ่านจาก process.env ตอนเรียกจริง ไม่ผ่าน ConfigService — เหตุผลเดียวกับ
    // `EngineService.resolveRunDate()`: `ConfigModule.forRoot()` ถูก evaluate
    // ครั้งเดียวตอนโหลด AppModule ค่าจึงแช่แข็ง และเทสที่ต้องพิสูจน์ทั้งสองสภาพ
    // ("ตั้งค่าแล้ว" กับ "ยังไม่ตั้ง") สลับค่าไม่ได้เลย
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      // ตอบให้ชัดว่า "เครื่องนี้ยังไม่ได้ตั้งค่า" (503 ไม่ใช่ 500) ไม่ใช่ปล่อยให้
      // client ไปพังเองที่ปลายทางแล้วผู้ใช้เห็นข้อความจาก Cloudinary ที่อ่านไม่รู้เรื่อง
      throw AppError.serviceUnavailable(
        'UPLOADS_NOT_CONFIGURED',
        'เครื่องนี้ยังไม่ได้ตั้งค่าที่เก็บรูป — ใส่ลิงก์รูปเองได้ชั่วคราว',
      );
    }

    // ★ folder ผูกกับ shopId ที่มาจาก token ★ ไม่ใช่ค่าที่ client ส่งมา
    // ร้าน A จึงเขียนทับรูปในโฟลเดอร์ของร้าน B ไม่ได้แม้จะแก้โค้ดฝั่งแอป
    const folder = `anan/shops/${shop.id}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const allowedFormats = ALLOWED_FORMATS.join(',');

    // Cloudinary กำหนดว่าลายเซ็นคือ sha1 ของพารามิเตอร์ที่ **เรียงตามชื่อ** + api_secret
    //
    // ★ `allowed_formats` ต้องอยู่ในลายเซ็นด้วย ★ ไม่ใช่ส่งไปเฉย ๆ ให้หน้าจออ่าน —
    // อะไรที่ไม่ได้เซ็น client แก้ได้หมด แล้วลายเซ็นก็ยังใช้ได้อยู่
    // (ข้อจำกัดที่เหลือ: `resource_type` อยู่นอกลายเซ็นตามดีไซน์ของ Cloudinary
    //  จะปิดให้สนิทต้องใช้ signed upload preset — บันทึกไว้ใน security-design §5)
    const params = `allowed_formats=${allowedFormats}&folder=${folder}&timestamp=${timestamp}`;
    const signature = createHash('sha1')
      .update(`${params}${apiSecret}`)
      .digest('hex');

    return {
      cloudName,
      apiKey,
      folder,
      timestamp,
      signature,
      expiresInSeconds: SIGNATURE_TTL_SECONDS,
      maxBytes: MAX_BYTES,
      // ต้องส่งค่านี้กลับไปแนบใน request ที่ยิงหา Cloudinary **ตรงตามนี้เป๊ะ**
      // เพราะมันถูกเซ็นไว้แล้ว — แก้เมื่อไหร่ลายเซ็นใช้ไม่ได้ทันที
      allowedFormats: ALLOWED_FORMATS,
    };
  }
}
