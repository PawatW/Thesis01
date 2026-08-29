import { Global, Module } from '@nestjs/common';
import { MailSettingsService } from './mail-settings.service';
import { MailService } from './mail.service';

/**
 * อีเมลขาออก — global เพราะเป็นบริการพื้นฐานแบบเดียวกับ PrismaService
 * (module ไหนจะส่งเมลก็ inject ได้เลย ไม่ต้องไล่ import กันเป็นทอด ๆ)
 *
 * `MailSettingsService` export ออกไปด้วยเพราะหน้าจอผู้ดูแลต้องอ่าน/เขียนค่าเดียวกัน
 * กับที่ `MailService` ใช้ส่งจริง — ถ้าแยกกันเมื่อไหร่ หน้าจอจะโชว์ค่าที่ไม่มีผล
 */
@Global()
@Module({
  providers: [MailService, MailSettingsService],
  exports: [MailService, MailSettingsService],
})
export class MailModule {}
