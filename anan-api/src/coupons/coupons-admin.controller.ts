import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CouponsAdminService } from './coupons-admin.service';
import {
  AdminCouponQuery,
  CreateCouponDto,
  UpdateCouponDto,
  type AdminCouponResponse,
} from './dto/coupon.dto';

/**
 * คูปอง — ฝั่งผู้ดูแลแพลตฟอร์ม (feature 18 · W13 Flow A)
 *
 * `@Roles('admin')` อยู่ที่ระดับ class เหมือน controller อื่นของคอนโซลผู้ดูแล —
 * endpoint ใหม่ในไฟล์นี้จึงถูกปิดโดยปริยาย ไม่ต้องพึ่งความจำของคนเขียน
 *
 * **ไม่มี DELETE โดยตั้งใจ** — คูปองที่ถูกใช้ไปแล้วต้องอ้างอิงกลับได้ตลอด
 * ปิดด้วย `POST :id/deactivate` แทน
 */
@Controller('admin/coupons')
@Roles('admin')
export class CouponsAdminController {
  constructor(private readonly coupons: CouponsAdminService) {}

  @Get()
  list(@Query() query: AdminCouponQuery): Promise<AdminCouponResponse[]> {
    return this.coupons.list(query);
  }

  @Post()
  create(
    @Body() dto: CreateCouponDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminCouponResponse> {
    return this.coupons.create(dto, user.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCouponDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminCouponResponse> {
    return this.coupons.update(id, dto, user.id);
  }

  @Post(':id/deactivate')
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminCouponResponse> {
    return this.coupons.deactivate(id, user.id);
  }
}
