import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  OpenShopDto,
  UpdateShopDto,
  type DashboardResponse,
  type ShopResponse,
} from './dto/shop.dto';
import { ShopService } from './shop.service';

/**
 * ร้านค้าของผู้เรียก (feature 10 · W02)
 *
 * ★ `POST /seller/shop` จงใจไม่มี `@Roles('seller')` ★ คนที่มากดเปิดร้านยังเป็น
 * ผู้ซื้อธรรมดาอยู่ — role จะกลายเป็น seller หลังร้านถูกสร้างสำเร็จเท่านั้น
 * (JwtStrategy อ่านสิทธิ์จาก DB ใหม่ทุก request จึงมีผลทันทีในคำขอถัดไป)
 */
@Controller('seller')
export class ShopController {
  constructor(private readonly shops: ShopService) {}

  @Post('shop')
  open(
    @CurrentUser() user: AuthUser,
    @Body() dto: OpenShopDto,
  ): Promise<ShopResponse> {
    return this.shops.open(user.id, dto);
  }

  @Get('shop')
  @Roles('seller')
  mine(@CurrentUser() user: AuthUser): Promise<ShopResponse> {
    return this.shops.mine(user.id);
  }

  @Patch('shop')
  @Roles('seller')
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateShopDto,
  ): Promise<ShopResponse> {
    return this.shops.update(user.id, dto);
  }

  @Get('dashboard')
  @Roles('seller')
  dashboard(@CurrentUser() user: AuthUser): Promise<DashboardResponse> {
    return this.shops.dashboard(user.id);
  }
}
