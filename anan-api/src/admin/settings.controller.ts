import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AuditLogQuery,
  EmailLogQuery,
  type AuditLogResponse,
  type EmailLogResponse,
  type PagedResponse,
} from './dto/logs.dto';
import {
  UpdateMailSettingsDto,
  type MailSettingsResponse,
} from './dto/settings.dto';
import { LogsService } from './logs.service';
import { SettingsService } from './settings.service';

/**
 * ตั้งค่าระบบ + หน้า log ของผู้ดูแล
 *
 * `@Roles('admin')` อยู่ที่ระดับ class เหมือนอีกสอง controller ของโมดูลนี้ —
 * endpoint ใหม่ในไฟล์นี้จึงถูกปิดโดยปริยาย ไม่ต้องพึ่งความจำของคนเขียน
 *
 * ไม่มี endpoint สำหรับ **ลบ** log โดยตั้งใจ (ดูเหตุผลใน `LogsService`)
 */
@Controller('admin')
@Roles('admin')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly logs: LogsService,
  ) {}

  @Get('mail-settings')
  mailSettings(): Promise<MailSettingsResponse> {
    return this.settings.getMailSettings();
  }

  /**
   * PUT ไม่ใช่ PATCH — หน้าจอส่งค่าทั้งชุดเสมอ และการรับมาบางช่องจะทำให้
   * "ปิดโหมด" กับ "ไม่ได้แตะโหมด" แยกกันไม่ออกในฝั่ง server
   */
  @Put('mail-settings')
  updateMailSettings(
    @Body() dto: UpdateMailSettingsDto,
    @CurrentUser() user: AuthUser,
  ): Promise<MailSettingsResponse> {
    return this.settings.updateMailSettings(dto, user.id);
  }

  @Get('logs/audit')
  auditLogs(
    @Query() query: AuditLogQuery,
  ): Promise<PagedResponse<AuditLogResponse>> {
    return this.logs.audit(query);
  }

  @Get('logs/email')
  emailLogs(
    @Query() query: EmailLogQuery,
  ): Promise<PagedResponse<EmailLogResponse>> {
    return this.logs.email(query);
  }
}
