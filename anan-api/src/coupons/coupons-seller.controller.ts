import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CouponsSellerService } from './coupons-seller.service';
import {
  CreateShopCouponDto,
  SetProductCouponsDto,
  UpdateCouponDto,
  type ProductCouponsResponse,
  type ShopCouponResponse,
} from './dto/coupon.dto';

/**
 * คูปองฝั่งร้านค้า (feature 18 · W13 Flow B)
 *
 * ร้านทำได้ 2 อย่าง: **ออกคูปองของร้านเอง** และ **กดเข้าร่วมแคมเปญของแพลตฟอร์ม
 * รายสินค้า** พร้อมตั้งนโยบายว่าสินค้าชิ้นนั้นรับคูปองระดับไหนบ้าง
 *
 * ★ `tier` ไม่มีใน DTO ★ ทุก endpoint ในไฟล์นี้ผลิตคูปอง `tier = 'shop'` ตายตัว
 * ที่ service — ถ้ารับจาก body ร้านจะออกคูปองระดับแพลตฟอร์มได้ด้วย curl บรรทัดเดียว
 *
 * `@Roles('seller')` บอกได้แค่ว่า "เป็นผู้ขาย" — ความเป็นเจ้าของร้าน/สินค้า/คูปอง
 * ยังต้องเช็คใน service ผ่าน `where` เสมอ (และร้านที่ถูกระงับเขียนอะไรไม่ได้)
 */
@Controller('seller')
@Roles('seller')
export class CouponsSellerController {
  constructor(private readonly coupons: CouponsSellerService) {}

  // ---------- คูปองที่ร้านออกเอง ----------

  @Get('coupons')
  listMine(@CurrentUser() user: AuthUser): Promise<ShopCouponResponse[]> {
    return this.coupons.listMine(user.id);
  }

  @Post('coupons')
  create(
    @Body() dto: CreateShopCouponDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ShopCouponResponse> {
    return this.coupons.create(user.id, dto);
  }

  @Patch('coupons/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCouponDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ShopCouponResponse> {
    return this.coupons.update(user.id, id, dto);
  }

  /** ไม่มี DELETE — ใบที่ถูกใช้ไปแล้วต้องอ้างอิงกลับได้ตลอด */
  @Post('coupons/:id/deactivate')
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ShopCouponResponse> {
    return this.coupons.deactivate(user.id, id);
  }

  // ---------- คูปอง + นโยบาย ของสินค้าหนึ่งชิ้น ----------

  @Get('products/:productId/coupons')
  listForProduct(
    @Param('productId', ParseUUIDPipe) productId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ProductCouponsResponse> {
    return this.coupons.listForProduct(user.id, productId);
  }

  /** PUT ไม่ใช่ POST/DELETE รายใบ — หน้าจอเป็นการ์ดเดียวที่ส่งสถานะทั้งชุด */
  @Put('products/:productId/coupons')
  setForProduct(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: SetProductCouponsDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ProductCouponsResponse> {
    return this.coupons.setForProduct(user.id, productId, dto);
  }
}
