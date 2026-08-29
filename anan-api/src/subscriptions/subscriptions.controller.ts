import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CouponTier } from '@prisma/client';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { CouponsService } from '../coupons/coupons.service';
import {
  ApplyCouponDto,
  type SubscriptionCouponsResponse,
} from '../coupons/dto/coupon.dto';
import {
  ChangeAddressDto,
  ChangePlanDto,
  CreateSubscriptionDto,
  RescheduleDto,
  UpsertReviewDto,
  type CheckoutResultResponse,
  type ReviewResponse,
  type SubscriptionCardResponse,
} from './dto/subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

type Card = Promise<SubscriptionCardResponse>;

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly coupons: CouponsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<SubscriptionCardResponse[]> {
    return this.subscriptions.listMine(user.id);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionCardResponse> {
    return this.subscriptions.findMine(user.id, id);
  }

  /** ผู้ซื้อคือคนที่ถือ token เท่านั้น — ไม่มี buyerId ใน body ให้ปลอมได้ */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSubscriptionDto,
  ): Promise<CheckoutResultResponse> {
    return this.subscriptions.create(user.id, dto);
  }

  // ---------- 7 actions ของ W05 ----------
  // controller ไม่มี logic เลย: กฎว่าใครทำอะไรได้ในสถานะไหนอยู่ใน service ทั้งหมด
  // (ปุ่มที่ซ่อนในแอปเป็นแค่ UX — curl ยิงตรงเข้ามาได้เสมอ)
  // ทุกตัวคืนการ์ดที่อัปเดตแล้ว เพื่อให้หน้าจอวาดใหม่ได้โดยไม่ต้องยิงซ้ำ

  @Post(':id/skip')
  skip(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Card {
    return this.subscriptions.skip(user.id, id);
  }

  @Post(':id/pause')
  pause(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Card {
    return this.subscriptions.pause(user.id, id);
  }

  @Post(':id/resume')
  resume(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Card {
    return this.subscriptions.resume(user.id, id);
  }

  @Post(':id/reschedule')
  reschedule(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleDto,
  ): Card {
    return this.subscriptions.reschedule(user.id, id, dto.date);
  }

  @Post(':id/plan')
  changePlan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangePlanDto,
  ): Card {
    return this.subscriptions.changePlan(user.id, id, dto.planId);
  }

  @Post(':id/address')
  changeAddress(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeAddressDto,
  ): Card {
    return this.subscriptions.changeAddress(user.id, id, dto.addressId);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Card {
    return this.subscriptions.cancel(user.id, id);
  }

  // ---------- รีวิว (feature 17) ----------

  @Get(':id/review')
  myReview(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReviewResponse | null> {
    return this.subscriptions.myReview(user.id, id);
  }

  /** เขียนหรือแก้ก็ endpoint เดียว — รีวิวที่ 2 บนรายการเดิมคือการแก้ ไม่ใช่รีวิวใหม่ */
  @Post(':id/review')
  @HttpCode(200)
  upsertReview(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertReviewDto,
  ): Promise<ReviewResponse> {
    return this.subscriptions.upsertReview(user.id, id, dto);
  }

  // ---------- คูปองรายรอบ (feature 18 · W13 Flow C) ----------
  // action ที่ 8 ของ W05 — จองได้ในหน้าต่างเดียวกับ "ข้ามรอบ" (ถึงสิ้นวันก่อนรอบ)
  //
  // ★ body มีแค่ `couponId` ★ ไม่มี discountAmount / amount / netAmount —
  // ยอดทุกตัวคำนวณที่ service จากราคาใน DB (กฎข้อ 7 · security-design S-02)

  @Get(':id/coupons')
  listCoupons(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionCouponsResponse> {
    return this.coupons.listForSubscription(user.id, id);
  }

  @Post(':id/coupon')
  @HttpCode(200)
  applyCoupon(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyCouponDto,
  ): Promise<SubscriptionCouponsResponse> {
    return this.coupons.apply(user.id, id, dto.couponId);
  }

  /**
   * ถอนคูปองของ **ระดับหนึ่ง** ออกจากรอบ — ระดับอยู่ใน path ไม่ใช่ body
   * เพราะเป็นตัวระบุทรัพยากรที่จะถอน ไม่ใช่ข้อมูลของการถอน
   */
  @Delete(':id/coupon/:tier')
  removeCoupon(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tier', new ParseEnumPipe(CouponTier)) tier: CouponTier,
  ): Promise<SubscriptionCouponsResponse> {
    return this.coupons.remove(user.id, id, tier);
  }
}
