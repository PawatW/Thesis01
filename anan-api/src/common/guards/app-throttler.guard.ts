import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * ThrottlerGuard ที่ปิดได้เฉพาะตอนรัน test
 *
 * ทำไมต้องมี: e2e ยิง /auth/login หลายสิบครั้งต่อไฟล์ ถ้า rate limit ทำงาน
 * test จะล้มด้วย 429 ทั้งที่โค้ดถูก — แต่การเอา throttler ออกจาก test app
 * ทั้งดุ้นก็แปลว่าเราไม่ได้ทดสอบระบบตัวเดียวกับที่ deploy
 *
 * ทางออก: ปิดได้ด้วย env แต่ **ปิดไม่ได้เลยเมื่อ NODE_ENV=production**
 * ต่อให้มีคนเผลอตั้งค่าไว้บนเครื่อง production สวิตช์นี้ก็ไม่ทำงาน
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  /**
   * เขียนเป็น allowlist (ต้องเป็น test เท่านั้น) ไม่ใช่ blocklist (`!== 'production'`)
   * เพราะแบบหลัง fail-open: `NODE_ENV` ที่ไม่ได้ตั้ง, สะกดว่า `prod`, หรือ `Production`
   * จะเปิดให้ปิด rate limit ได้หมด — และ `npm run start:prod` ก็ไม่ได้ตั้งค่านี้ให้
   */
  protected shouldSkip(): Promise<boolean> {
    const disabled =
      process.env.NODE_ENV === 'test' &&
      process.env.THROTTLE_DISABLED === 'true';
    return Promise.resolve(disabled);
  }
}
