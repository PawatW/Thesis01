import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { CouponsService } from './coupons.service';
import {
  PlanCouponsQuery,
  type AvailableCouponResponse,
} from './dto/coupon.dto';

/**
 * คูปองที่ใช้ได้กับแผนหนึ่งตอน checkout (feature 18 · W13 Flow C — รอบแรก)
 *
 * ★ ไม่ใช่ `@Public()` ต่างจาก `CatalogController` ที่ใช้ path prefix เดียวกัน ★
 * รายการนี้ขึ้นกับตัวผู้เรียก (ใบที่เคยใช้ไปแล้วถูกกรองออก) จึงต้องมี token
 * — คนที่ยังไม่ล็อกอินก็ยังกด subscribe ไม่ได้อยู่แล้ว
 *
 * ส่วน endpoint ของคูปองรายรอบ (จอง/ถอน) อยู่ที่ `SubscriptionsController`
 * เพราะเป็น action ที่ 8 ของ W05 ไม่ใช่เรื่องของ catalog
 */
@Controller('catalog/plans/:planId/coupons')
export class CouponsBuyerController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  forPlan(
    @CurrentUser() user: AuthUser,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Query() query: PlanCouponsQuery,
  ): Promise<AvailableCouponResponse[]> {
    return this.coupons.listForPlan(user.id, planId, query.quantity ?? 1);
  }
}
