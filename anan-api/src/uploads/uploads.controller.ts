import { Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { UploadSignatureResponse } from './dto/upload.dto';
import { UploadsService } from './uploads.service';

@Controller('uploads')
@Roles('seller')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /**
   * ขอลายเซ็นสำหรับอัปโหลดรูป 1 ครั้ง
   *
   * เข้มกว่าค่ากลางเพราะเป็น endpoint ที่แจก "สิทธิ์เขียนเข้าบัญชี Cloudinary"
   * ต่อ 1 สินค้าใช้มากสุด 5 ใบ — 30 ใบต่อนาทีจึงเหลือ ๆ สำหรับคนทำงานจริง
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('signature')
  @HttpCode(200)
  sign(@CurrentUser() user: AuthUser): Promise<UploadSignatureResponse> {
    return this.uploads.signForMyShop(user.id);
  }
}
