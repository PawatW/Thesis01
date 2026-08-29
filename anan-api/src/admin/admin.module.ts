import { Module } from '@nestjs/common';
import { CouponsModule } from '../coupons/coupons.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { LogsService } from './logs.service';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/** ส่วนของผู้ดูแลแพลตฟอร์ม (feature 14) — engine อยู่คนละโมดูลตามเจ้าของงาน */
@Module({
  imports: [CouponsModule],
  controllers: [AdminController, ModerationController, SettingsController],
  providers: [AdminService, ModerationService, SettingsService, LogsService],
})
export class AdminModule {}
