import { Injectable } from '@nestjs/common';
import { Prisma, type SubscriptionStatus } from '@prisma/client';
import {
  addCycle,
  addDays,
  daysUntil,
  isCycle,
  nextCycleAfter,
  toISODate,
  todayInBangkok,
  tryParseISODate,
  type Cycle,
} from '../common/date';
import { AppError } from '../common/errors/app-exception';
import { SELLER_ORDERS_LINK } from '../common/links';
import { PaymentProvider } from '../payments/payment.provider';
import { VISIBLE_PRODUCT } from '../catalog/catalog.service';
import {
  CouponsService,
  uniqueTargetOf,
  type UsableCoupon,
} from '../coupons/coupons.service';
import {
  blockedReasonText,
  combineDiscounts,
  computeDiscount,
  grossAmount,
} from '../coupons/discount';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CheckoutResultResponse,
  CreateSubscriptionDto,
  ReviewResponse,
  SubscriptionCardResponse,
  UpsertReviewDto,
} from './dto/subscription.dto';

/** เริ่มรอบแรกได้เร็วสุดพรุ่งนี้ ช้าสุด 60 วัน — ตรงกับตัวเลือกในหน้า checkout */
const MIN_START_OFFSET = 1;
const MAX_START_OFFSET = 60;

/**
 * เพดานของการเลื่อนวันส่ง — W05 บอกแค่ "ต้องเป็นวันในอนาคต" แต่ปล่อยไว้แบบนั้น
 * ผู้ใช้ยิง `9999-12-31` ได้ ซึ่งเท่ากับยกเลิกแบบไม่ทิ้งร่องรอยว่ายกเลิก
 * (สถิติ churn ในเล่มจะเพี้ยนตาม) — อยากหยุดยาวกว่านี้ให้ใช้ pause
 */
const MAX_RESCHEDULE_DAYS = 180;

const CARD_INCLUDE = {
  plan: {
    select: {
      cycle: true,
      pricePerCycle: true,
      product: {
        select: {
          id: true,
          name: true,
          images: true,
          // ownerId ใช้ส่งแจ้งเตือนให้ร้านตอนผู้ซื้อยกเลิก — ไม่ถูกส่งออกไปกับ response
          shop: { select: { name: true, ownerId: true } },
        },
      },
    },
  },
  /** ดาวของผู้ซื้อคนนี้เอง — เอาแค่ `rating` ไม่ต้องลากทั้งแถวออกมา */
  review: { select: { rating: true } },
  /**
   * จำนวนรอบที่ "ส่งถึงแล้ว" — ประตูของการรีวิว (feature 17)
   *
   * นับด้วยเงื่อนไขเดียวกับที่ `upsertReview()` ใช้ ไม่งั้นหน้าจอจะเปิดปุ่มให้กด
   * แล้ว API ตอบ 422 กลับมา ซึ่งอ่านแล้วเหมือนระบบพัง
   */
  _count: { select: { orders: { where: { status: 'delivered' } } } },
  /**
   * คูปองที่จองค้างไว้ (feature 18) — ดึงมากับการ์ดเลยเพื่อไม่ให้หน้าจอต้องยิง
   * เพิ่มอีก 1 คำขอต่อ 1 รายการ · กรองด้วย `cycleDate === nextOrderDate` ที่
   * `toCard()` เพราะ Prisma เทียบคอลัมน์ของแถวแม่ใน where ของ relation ไม่ได้
   */
  couponRedemptions: {
    where: { status: 'reserved' },
    select: {
      cycleDate: true,
      tier: true,
      discountType: true,
      discountValue: true,
      maxDiscountAmount: true,
      minOrderAmount: true,
      coupon: { select: { code: true } },
    },
  },
} satisfies Prisma.SubscriptionInclude;

type SubscriptionRow = Prisma.SubscriptionGetPayload<{
  include: typeof CARD_INCLUDE;
}>;

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentProvider,
    private readonly coupons: CouponsService,
  ) {}

  async listMine(buyerId: string): Promise<SubscriptionCardResponse[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { buyerId },
      include: CARD_INCLUDE,
      orderBy: [
        { nextOrderDate: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
    });
    return rows.map(toCard);
  }

  async findMine(
    buyerId: string,
    id: string,
  ): Promise<SubscriptionCardResponse> {
    // ownership อยู่ใน where — ของคนอื่นตอบ 404 ไม่ใช่ 403
    const row = await this.prisma.subscription.findFirst({
      where: { id, buyerId },
      include: CARD_INCLUDE,
    });
    if (!row)
      throw AppError.notFound('SUBSCRIPTION_NOT_FOUND', 'ไม่พบรายการนี้');
    return toCard(row);
  }

  /**
   * สมัครรับสินค้า — flow ที่แตะ 5 ตารางพร้อมกัน (architecture.md §5)
   *
   * ทุกอย่างต้องสำเร็จด้วยกันหรือไม่เกิดเลย: subscription + order รอบแรก +
   * การตัดเงินจำลอง + audit event + แจ้งเตือนร้าน
   * ถ้าแยกเป็นหลาย request จาก client แล้วเน็ตหลุดกลางทาง จะได้ subscription
   * ที่ไม่มีออเดอร์ หรือออเดอร์ที่ไม่มีการจ่ายเงิน
   */
  async create(
    buyerId: string,
    dto: CreateSubscriptionDto,
  ): Promise<CheckoutResultResponse> {
    const startDate = this.parseStartDate(dto.startDate);

    // ---- 1. แผน: ต้องเปิดรับสมาชิก และร้าน/สินค้าต้องไม่ถูกระงับ ----
    const plan = await this.prisma.productPlan.findFirst({
      where: { id: dto.planId, isActive: true, product: VISIBLE_PRODUCT },
      select: {
        id: true,
        cycle: true,
        pricePerCycle: true,
        product: {
          select: {
            id: true,
            name: true,
            shopId: true,
            couponPolicy: true,
            shop: { select: { ownerId: true } },
          },
        },
      },
    });
    if (!plan) {
      // แยกไม่ออกระหว่าง "ไม่มีแผนนี้" กับ "แผนเพิ่งปิด" โดยตั้งใจ —
      // ทั้งสองกรณีผู้ซื้อทำอะไรต่อไม่ได้เหมือนกัน
      throw AppError.conflict('PLAN_UNAVAILABLE', 'แผนนี้ปิดรับสมาชิกใหม่แล้ว');
    }
    if (!isCycle(plan.cycle)) {
      throw AppError.unprocessable('PLAN_INVALID', 'ข้อมูลแผนไม่ถูกต้อง');
    }

    // ---- 2. ที่อยู่ + บัตร ต้องเป็นของผู้เรียกจริง (ช่องโหว่ S-04 ของเดิม) ----
    const [address, paymentMethod] = await Promise.all([
      this.prisma.address.findFirst({
        where: { id: dto.addressId, userId: buyerId },
      }),
      this.prisma.paymentMethod.findFirst({
        where: { id: dto.paymentMethodId, userId: buyerId },
        select: { id: true, last4: true },
      }),
    ]);
    if (!address)
      throw AppError.notFound('ADDRESS_NOT_FOUND', 'ไม่พบที่อยู่นี้');
    if (!paymentMethod) {
      throw AppError.notFound('PAYMENT_METHOD_NOT_FOUND', 'ไม่พบบัตรใบนี้');
    }

    // ---- 3. กันสมัครซ้ำ ----
    // ปุ่มที่กดรัว/เน็ตช้าแล้วผู้ใช้กดใหม่ ทำให้เกิดรายการซ้ำและตัดเงิน 2 ครั้ง
    // เช็คตรงนี้มีไว้ให้ได้ข้อความที่อ่านรู้เรื่องในกรณีปกติ — **ด่านจริงคือ
    // partial unique index `subs_one_live_per_plan_address` ที่ DB** เพราะการ
    // อ่านแล้วค่อยเขียนเป็นคนละคำสั่ง มีช่องให้ 2 request ที่ยิงพร้อมกันผ่านทั้งคู่
    // (คนละที่อยู่ยังสมัครแผนเดิมซ้ำได้ เช่น ส่งบ้านกับส่งที่ทำงาน)
    await this.assertNoDuplicate(buyerId, plan.id, address.id);

    // ---- 4. ราคาอ่านจาก DB เท่านั้น ----
    const gross = grossAmount(plan.pricePerCycle, dto.quantity);
    const nextOrderDate = addCycle(startDate, plan.cycle);

    // ---- 5. คูปองของรอบแรก (feature 18) ----
    // ตรวจนอกทรานแซกชันเพื่อให้ผู้ซื้อได้ข้อความที่อ่านออกก่อนถูกตัดเงิน
    // (ในทรานแซกชันจะจอง+ใช้ทันทีเพราะออเดอร์รอบแรกเกิดเดี๋ยวนี้)
    const picked: { coupon: UsableCoupon; discount: Prisma.Decimal }[] = [];
    for (const couponId of dto.couponIds ?? []) {
      const coupon = await this.coupons.loadUsableCoupon({
        couponId,
        product: plan.product,
        buyerId,
        cycleDate: startDate,
        billableOnly: false,
      });
      const calc = computeDiscount(gross, coupon);
      if (!calc.ok) {
        throw AppError.unprocessable(
          'COUPON_NOT_APPLICABLE',
          blockedReasonText(calc.reason, coupon),
        );
      }
      picked.push({ coupon, discount: calc.discount });
    }

    const result = await this.runGuardingDuplicates(() =>
      this.prisma.$transaction(async (tx) => {
        const subscription = await tx.subscription.create({
          data: {
            buyerId,
            planId: plan.id,
            addressId: address.id,
            paymentMethodId: paymentMethod.id,
            quantity: dto.quantity,
            status: 'active',
            startDate,
            // หมุดของกริดรอบเริ่มที่วันแรกเสมอ — ทุกวันตัดรอบหลังจากนี้คือ
            // startDate + k×cycle ไม่ใช่การบวกทบจากรอบก่อนหน้า
            cycleAnchorDate: startDate,
            nextOrderDate,
          },
          include: CARD_INCLUDE,
        });

        /**
         * จอง + ใช้คูปองในทรานแซกชันเดียวกัน — รอบแรกเกิดขึ้นเดี๋ยวนี้จึงไม่มี
         * ช่วง "จองค้าง" เหมือนรอบถัด ๆ ไป · เดินผ่าน `consumeForCycle` ตัวเดียว
         * กับที่ engine ใช้ เพื่อให้ยอดรอบแรกกับรอบหลังคำนวณด้วยโค้ดชุดเดียวกัน
         */
        for (const p of picked) {
          await this.coupons.reserveInTx(tx, {
            coupon: p.coupon,
            subscriptionId: subscription.id,
            buyerId,
            cycleDate: startDate,
            discount: p.discount,
          });
        }
        const used = await this.coupons.consumeForCycle(tx, {
          subscriptionId: subscription.id,
          cycleDate: startDate,
          gross,
        });
        const amount = used.net;

        const order = await tx.order.create({
          data: {
            subscriptionId: subscription.id,
            buyerId,
            cycleDate: startDate,
            status: 'pending',
            amount,
            discountAmount: used.discount,
            platformRedemptionId: used.platform?.redemptionId ?? null,
            shopRedemptionId: used.shop?.redemptionId ?? null,
            // คัดลอกที่อยู่ ณ ตอนนี้ — แก้ที่อยู่ทีหลังต้องไม่ย้อนไปแก้ประวัติ
            addressSnapshot: {
              recipient_name: address.recipientName,
              phone: address.phone,
              address_line: address.addressLine,
              province: address.province,
              postcode: address.postcode,
            },
          },
        });

        /**
         * ตัดเงิน (จำลอง) ผ่าน `PaymentProvider` — ไม่เขียน `status: 'paid'` ตรง ๆ
         *
         * เรียกในทรานแซกชันได้เพราะ provider ของเดโม่เป็นการคำนวณล้วน ไม่ออกนอกเครื่อง
         * (gateway จริงต้องอยู่นอกทรานแซกชัน + ใช้ idempotency key — เป็น future work)
         */
        const charge = await this.payments.charge({
          orderId: order.id,
          amount: amount.toNumber(),
          card: paymentMethod,
        });
        if (charge.status === 'failed') {
          // รอบแรกจ่ายไม่ผ่าน = ไม่เกิดอะไรเลย ทั้ง subscription และออเดอร์ถูก
          // rollback ไปพร้อมกัน — ดีกว่าปล่อยให้มีสมาชิกที่ไม่เคยจ่ายรอบไหนสำเร็จ
          throw AppError.paymentRequired(
            'PAYMENT_FAILED',
            charge.failureReason ?? 'ตัดเงินไม่สำเร็จ',
          );
        }

        await tx.payment.create({
          data: {
            orderId: order.id,
            amount,
            status: 'paid',
            paidAt: new Date(),
          },
        });

        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: subscription.id,
            event: 'created',
            detail: {
              quantity: dto.quantity,
              cycle: plan.cycle,
              start_date: toISODate(startDate),
            },
          },
        });

        for (const tier of ['platform', 'shop'] as const) {
          const hit = used[tier];
          if (hit === null) continue;
          await tx.subscriptionEvent.create({
            data: {
              subscriptionId: subscription.id,
              event: 'coupon_applied',
              detail: {
                coupon_code: hit.couponCode,
                tier,
                cycle_date: toISODate(startDate),
                discount_amount: hit.discount.toNumber(),
              },
            },
          });
        }

        await tx.notification.create({
          data: {
            userId: plan.product.shop.ownerId,
            type: 'new_subscriber',
            title: 'มีผู้สมัครรับสินค้าใหม่',
            body: `${plan.product.name} — ${cycleText(plan.cycle)}`,
            linkPath: SELLER_ORDERS_LINK,
          },
        });

        return {
          subscription,
          order,
          couponCodes: [used.platform, used.shop]
            .filter((t) => t !== null)
            .map((t) => t.couponCode),
        };
      }),
    );

    return {
      subscription: toCard(result.subscription),
      firstOrder: {
        id: result.order.id,
        cycleDate: toISODate(result.order.cycleDate),
        amount: result.order.amount.toNumber(),
        discountAmount: result.order.discountAmount.toNumber(),
        couponCodes: result.couponCodes,
        status: result.order.status,
      },
    };
  }

  // ==========================================================
  // 7 actions ของ W05 — "ความยืดหยุ่นในคลิกเดียว" คือจุดขายของแอป
  //
  // ทุกตัวมีรูปแบบเดียวกัน: อ่านของตัวเอง → ตรวจว่าสถานะปัจจุบันทำได้ไหม →
  // เขียนพร้อม event ในทรานแซกชันเดียว โดยเงื่อนไขที่ต้องแข่งกับ request อื่น
  // (สถานะ, วันรอบ, แผน) อยู่ใน `where` ของคำสั่งเขียน ไม่ใช่ใน `if` ข้างบน
  // — บทเรียนจาก refresh token: เช็คแล้วค่อยเขียนเป็นคนละคำสั่งมีช่องให้ 2
  // request ที่ยิงพร้อมกันผ่านทั้งคู่ (กดปุ่มรัว = ข้ามรอบ 2 รอบในคลิกเดียว)
  // ==========================================================

  /** ข้ามรอบถัดไป — ขยับไป 1 ช่องบนกริดเดิม (หมุดไม่ขยับ) */
  async skip(buyerId: string, id: string): Promise<SubscriptionCardResponse> {
    const sub = await this.loadForAction(buyerId, id, ['active']);
    const from = this.requireNextOrderDate(sub);

    // หนีบกับวันนี้ด้วยเหตุผลเดียวกับ resume: ถ้ารายการค้างมาจากตอนที่ engine
    // ไม่ได้รัน (`nextOrderDate` อยู่ในอดีต) การขยับ 1 ช่องอาจยังได้วันที่ผ่านมาแล้ว
    // → engine ก็ยังตัดเงินรอบนั้นอยู่ดี ทั้งที่ผู้ใช้เพิ่งกด "ข้ามรอบ"
    const after = from > todayInBangkok() ? from : todayInBangkok();
    const to = nextCycleAfter(sub.cycleAnchorDate, this.cycleOf(sub), after);

    return this.commit(sub, {
      guard: { nextOrderDate: from },
      data: { nextOrderDate: to },
      event: 'skipped',
      detail: { from: toISODate(from), to: toISODate(to) },
    });
  }

  /** หยุดชั่วคราว — engine ข้ามรายการนี้จนกว่าจะกลับมาใช้งาน */
  async pause(buyerId: string, id: string): Promise<SubscriptionCardResponse> {
    const sub = await this.loadForAction(buyerId, id, ['active']);

    return this.commit(sub, {
      data: {
        status: 'paused',
        pausedAt: new Date(),
        // 'user' เท่านั้น — 'shop_suspended' เป็นของ admin (ผู้ซื้อตั้งเองไม่ได้)
        pausedReason: 'user',
      },
      event: 'paused',
      detail: { reason: 'user' },
    });
  }

  /**
   * กลับมาใช้งาน — วันรอบถัดไปต้องไม่อยู่ในอดีต
   *
   * ถ้าปล่อยวันเดิมไว้ คนที่หยุดไป 3 เดือนจะโดน engine ยิงออเดอร์ทันทีที่กดกลับมา
   * (เงื่อนไขของ engine คือ `nextOrderDate <= วันนี้`) จึงเลื่อนเป็นพรุ่งนี้เป็นอย่างเร็ว
   * และตั้งหมุดใหม่ที่วันนั้น เพราะรอบต่อ ๆ ไปต้องนับจากวันที่กลับมา
   */
  async resume(buyerId: string, id: string): Promise<SubscriptionCardResponse> {
    const sub = await this.loadForAction(buyerId, id, ['paused']);

    // ★ ผู้ซื้อปลดแช่แข็งที่ระบบตั้งไว้เองไม่ได้ (T-7) ★ ร้านถูกระงับแล้วผู้ซื้อ
    // กด resume ได้เมื่อไหร่ แพลตฟอร์มก็กลับไปเก็บเงินให้ร้านที่ตัวเองสั่งระงับ
    if (sub.pausedReason === 'shop_suspended') {
      throw AppError.conflict(
        'SHOP_SUSPENDED',
        'ร้านนี้ถูกระงับชั่วคราว — ระบบจะกลับมาส่งให้เองเมื่อร้านเปิดอีกครั้ง',
      );
    }

    const tomorrow = addDays(todayInBangkok(), 1);
    const keepCurrent =
      sub.nextOrderDate !== null && sub.nextOrderDate > tomorrow;
    const next = keepCurrent ? (sub.nextOrderDate as Date) : tomorrow;

    return this.commit(sub, {
      // pausedReason อยู่ใน where ด้วย: ถ้า admin แช่แข็งร้านระหว่างที่ผู้ใช้กด
      // ปุ่มค้างอยู่ คำสั่งนี้ต้องไม่ผ่าน แทนที่จะ resume ทับการแช่แข็ง
      guard: { pausedReason: 'user' },
      data: {
        status: 'active',
        pausedAt: null,
        pausedReason: null,
        nextOrderDate: next,
        cycleAnchorDate: keepCurrent ? sub.cycleAnchorDate : next,
      },
      event: 'resumed',
      detail: { next_order_date: toISODate(next) },
    });
  }

  /** เลื่อนวันส่งของรอบถัดไป — รอบต่อ ๆ ไปนับจากวันใหม่ (หมุดย้ายตาม) */
  async reschedule(
    buyerId: string,
    id: string,
    rawDate: string,
  ): Promise<SubscriptionCardResponse> {
    const sub = await this.loadForAction(buyerId, id, ['active']);
    const from = this.requireNextOrderDate(sub);

    const target = tryParseISODate(rawDate);
    if (!target) {
      throw AppError.badRequest('INVALID_DATE', 'วันที่ไม่ถูกต้อง');
    }
    const offset = daysUntil(target, todayInBangkok());
    if (offset < 1 || offset > MAX_RESCHEDULE_DAYS) {
      throw AppError.unprocessable(
        'RESCHEDULE_OUT_OF_RANGE',
        `เลื่อนได้ตั้งแต่พรุ่งนี้ถึง ${MAX_RESCHEDULE_DAYS} วันข้างหน้า`,
      );
    }

    return this.commit(sub, {
      guard: { nextOrderDate: from },
      data: { nextOrderDate: target, cycleAnchorDate: target },
      event: 'rescheduled',
      detail: { from: toISODate(from), to: toISODate(target) },
    });
  }

  /**
   * เปลี่ยนรอบส่ง — วันรอบถัดไปคงเดิม แต่ความถี่/ราคาหลังจากนั้นเป็นของแผนใหม่
   * เลือกได้เฉพาะแผนที่ยังเปิดรับของ **สินค้าชิ้นเดิม** (client ส่ง planId อะไรมาก็ได้)
   */
  async changePlan(
    buyerId: string,
    id: string,
    planId: string,
  ): Promise<SubscriptionCardResponse> {
    const sub = await this.loadForAction(buyerId, id, ['active']);
    if (sub.planId === planId) return toCard(sub);

    const plan = await this.prisma.productPlan.findFirst({
      where: {
        id: planId,
        isActive: true,
        productId: sub.plan.product.id,
        product: VISIBLE_PRODUCT,
      },
      select: { id: true, cycle: true, pricePerCycle: true },
    });
    if (!plan) {
      throw AppError.conflict(
        'PLAN_UNAVAILABLE',
        'เลือกได้เฉพาะรอบส่งของสินค้าชิ้นนี้ที่ยังเปิดรับอยู่',
      );
    }
    if (!isCycle(plan.cycle)) {
      throw AppError.unprocessable('PLAN_INVALID', 'ข้อมูลแผนไม่ถูกต้อง');
    }

    // กฎเดียวกับตอนสมัคร: แผนเดิม + ที่อยู่เดิม ห้ามซ้ำ ไม่งั้นเปลี่ยนรอบเป็น
    // ทางลัดสร้างรายการซ้ำที่ POST /subscriptions ปิดไว้แล้ว
    await this.assertNoDuplicate(buyerId, plan.id, sub.addressId, sub.id);

    const anchor = sub.nextOrderDate ?? sub.cycleAnchorDate;
    return this.commit(sub, {
      guard: { planId: sub.planId },
      // หมุดย้ายมาที่รอบถัดไป: รอบหน้าวันเดิม แต่รอบถัด ๆ ไปเดินตามความถี่ใหม่
      data: { planId: plan.id, cycleAnchorDate: anchor },
      event: 'cycle_changed',
      detail: {
        from_cycle: sub.plan.cycle,
        to_cycle: plan.cycle,
        price_per_cycle: plan.pricePerCycle.toNumber(),
      },
    });
  }

  /** เปลี่ยนที่อยู่จัดส่ง — ออเดอร์เก่าไม่กระทบเพราะเก็บ snapshot ไว้แล้ว */
  async changeAddress(
    buyerId: string,
    id: string,
    addressId: string,
  ): Promise<SubscriptionCardResponse> {
    const sub = await this.loadForAction(buyerId, id, ['active', 'paused']);
    if (sub.addressId === addressId) return toCard(sub);

    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId: buyerId },
      select: { id: true },
    });
    if (!address) {
      throw AppError.notFound('ADDRESS_NOT_FOUND', 'ไม่พบที่อยู่นี้');
    }

    await this.assertNoDuplicate(buyerId, sub.planId, address.id, sub.id);

    return this.commit(sub, {
      guard: { addressId: sub.addressId },
      data: { addressId: address.id },
      event: 'address_changed',
      // ข้อยกเว้นเดียวของกฎคืนคูปอง: เปลี่ยนที่อยู่ไม่แตะวันรอบ รอบที่จองไว้ยังเกิดตามเดิม
      keepCoupons: true,
    });
  }

  /** ยกเลิกถาวร — CHECK `subs_state_consistent` ที่ DB ห้ามกลับออกจากสถานะนี้ */
  async cancel(buyerId: string, id: string): Promise<SubscriptionCardResponse> {
    const sub = await this.loadForAction(buyerId, id, ['active', 'paused']);

    return this.commit(sub, {
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        // ทั้งสองค่าเป็นข้อบังคับของ CHECK: cancelled ต้องไม่มีรอบถัดไปค้าง
        // และ paused_reason มีได้เฉพาะตอนที่ยังหยุดอยู่จริง
        nextOrderDate: null,
        pausedReason: null,
      },
      event: 'cancelled',
      detail: { from_status: sub.status },
      notify: async (tx) => {
        await tx.notification.create({
          data: {
            userId: sub.plan.product.shop.ownerId,
            type: 'subscriber_cancelled',
            title: 'มีผู้ยกเลิกการสมัคร',
            body: `${sub.plan.product.name} — ${cycleText(sub.plan.cycle)}`,
            linkPath: SELLER_ORDERS_LINK,
          },
        });
      },
    });
  }

  // ==========================================================
  // รีวิว (feature 17 · W12)
  // ==========================================================

  /**
   * เขียน/แก้รีวิว — 1 รีวิวต่อ 1 subscription (unique ที่ DB)
   *
   * ★ เขียนได้เมื่อเคยได้รับของจริงเท่านั้น ★ ไม่ใช่แค่ "เคยสมัคร" — รีวิวที่เขียน
   * ได้โดยไม่เคยรับของก็คือรีวิวปลอม ซึ่งทำลายคุณค่าทั้งหมดของหน้าเปรียบเทียบ
   *
   * `cyclesReceived` นับใหม่ทุกครั้งจากออเดอร์จริง — ป้าย "รับมาแล้ว N รอบ" จึงเป็น
   * ข้อเท็จจริงที่ตรวจย้อนได้ ไม่ใช่ตัวเลขที่ผู้รีวิวพิมพ์เอง (จุดต่างจาก e-commerce
   * ทั่วไปที่เขียนไว้ในเล่ม) · subscription ที่ยกเลิกไปแล้วก็ยังรีวิวได้ตามสเปก
   */
  async upsertReview(
    buyerId: string,
    id: string,
    dto: UpsertReviewDto,
  ): Promise<ReviewResponse> {
    const sub = await this.prisma.subscription.findFirst({
      where: { id, buyerId },
      select: { id: true, plan: { select: { productId: true } } },
    });
    if (!sub) {
      throw AppError.notFound('SUBSCRIPTION_NOT_FOUND', 'ไม่พบรายการนี้');
    }

    // "ได้รับของจริง" = ออเดอร์ที่ส่งถึงแล้ว — ออเดอร์ที่ถูกยกเลิก/คืนเงินไม่นับ
    const cyclesReceived = await this.prisma.order.count({
      where: { subscriptionId: id, status: 'delivered' },
    });
    if (cyclesReceived === 0) {
      throw AppError.unprocessable(
        'NOTHING_RECEIVED_YET',
        'รีวิวได้หลังได้รับสินค้ารอบแรก',
      );
    }

    const comment =
      dto.comment === undefined || dto.comment === '' ? null : dto.comment;

    const review = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.review.upsert({
        where: { subscriptionId: id },
        create: {
          subscriptionId: id,
          productId: sub.plan.productId,
          buyerId,
          rating: dto.rating,
          comment,
          cyclesReceived,
        },
        update: { rating: dto.rating, comment, cyclesReceived },
      });
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: id,
          event: 'reviewed',
          detail: { rating: dto.rating, cycles_received: cyclesReceived },
        },
      });
      return saved;
    });

    return toReview(review);
  }

  /** รีวิวของฉันบนรายการนี้ — ใช้โหลดค่าเดิมมาแก้ */
  async myReview(buyerId: string, id: string): Promise<ReviewResponse | null> {
    const review = await this.prisma.review.findFirst({
      // ownership อยู่ใน where ผ่านทั้ง buyerId และ subscription ของตัวเอง
      where: { subscriptionId: id, buyerId },
    });
    return review === null ? null : toReview(review);
  }

  // ---------- ภายใน ----------

  /**
   * อ่านรายการของผู้เรียกเอง + ตรวจว่าสถานะปัจจุบันทำ action นี้ได้
   *
   * ของคนอื่นตอบ 404 ไม่ใช่ 403 — 403 เป็นการยืนยันว่า id นี้มีอยู่จริงในระบบ
   */
  private async loadForAction(
    buyerId: string,
    id: string,
    allowed: SubscriptionStatus[],
  ): Promise<SubscriptionRow> {
    const row = await this.prisma.subscription.findFirst({
      where: { id, buyerId },
      include: CARD_INCLUDE,
    });
    if (!row) {
      throw AppError.notFound('SUBSCRIPTION_NOT_FOUND', 'ไม่พบรายการนี้');
    }
    if (!allowed.includes(row.status)) {
      if (row.status === 'cancelled') {
        throw AppError.conflict(
          'SUBSCRIPTION_CANCELLED',
          'รายการนี้ถูกยกเลิกถาวรแล้ว — สมัครใหม่ได้จากหน้าสินค้า',
        );
      }
      throw AppError.conflict(
        row.status === 'paused' ? 'SUBSCRIPTION_PAUSED' : 'SUBSCRIPTION_ACTIVE',
        'รายการนี้เปลี่ยนสถานะไปแล้ว กรุณารีเฟรชหน้าจอ',
      );
    }
    return row;
  }

  /**
   * เขียน subscription + event ในทรานแซกชันเดียว (architecture.md §5)
   *
   * `guard` คือค่าที่เราอ่านมาตอนตรวจสิทธิ์ — ใส่กลับเข้าไปใน where เพื่อให้
   * คำสั่งนี้ผ่านก็ต่อเมื่อโลกยังเป็นแบบเดิมอยู่ ถ้ามีใครเปลี่ยนไปก่อน count
   * จะเป็น 0 แล้วตอบ 409 ให้ผู้ใช้รีเฟรช ดีกว่าเขียนทับสิ่งที่ไม่ได้ตั้งใจ
   */
  private async commit(
    sub: SubscriptionRow,
    opts: {
      guard?: Prisma.SubscriptionScalarWhereInput;
      // Unchecked เพราะ action ที่เปลี่ยนแผน/ที่อยู่ต้องเขียน FK ตรง ๆ
      // (ค่าที่ใส่มาจาก service เท่านั้น ไม่ได้รับมาจาก body ของ client)
      data: Prisma.SubscriptionUncheckedUpdateManyInput;
      event: Prisma.SubscriptionEventCreateManyInput['event'];
      detail?: Prisma.InputJsonValue;
      notify?: (tx: Prisma.TransactionClient) => Promise<void>;
      /**
       * ไม่คืนคูปองที่จองไว้ — ใส่เฉพาะ action ที่ **ไม่แตะวันรอบ** (เปลี่ยนที่อยู่)
       * ค่าปริยายคือ "คืน" เพื่อให้ action ที่เพิ่มมาใหม่ได้พฤติกรรมที่ถูกต้อง
       * โดยไม่ต้องพึ่งความจำของคนเขียน
       */
      keepCoupons?: true;
    },
  ): Promise<SubscriptionCardResponse> {
    return this.runGuardingDuplicates(() =>
      this.prisma.$transaction(async (tx) => {
        const updated = await tx.subscription.updateMany({
          where: {
            id: sub.id,
            buyerId: sub.buyerId,
            status: sub.status,
            ...opts.guard,
          },
          data: opts.data,
        });
        if (updated.count === 0) {
          throw AppError.conflict(
            'SUBSCRIPTION_CHANGED',
            'รายการนี้เพิ่งเปลี่ยนไปแล้ว กรุณารีเฟรชหน้าจอ',
          );
        }

        // ทุก action ต้องทิ้งรอย — เป็นข้อมูลดิบของกราฟ churn ในเล่ม (W05)
        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: sub.id,
            event: opts.event,
            detail: opts.detail ?? {},
          },
        });

        /**
         * ★ กฎเดียวของคูปอง ไม่มีข้อยกเว้น ★ (feature 18 · W13 Flow E)
         *
         * อะไรก็ตามที่ทำให้ `next_order_date` เปลี่ยนโดยไม่เกิดออเดอร์ ต้องคืน
         * คูปองที่จองไว้กับรอบนั้น — เขียนที่นี่ที่เดียวแทนการไล่ใส่ทีละ action
         * ทำให้ skip · pause · เลื่อนวันส่ง · เปลี่ยนรอบส่ง · ยกเลิก ได้พฤติกรรม
         * เดียวกันหมด และคูปองไม่มีทางค้างอยู่กับรอบที่ไม่มีวันเกิด
         */
        if (opts.keepCoupons !== true) {
          const released = await this.coupons.releaseReserved(tx, {
            subscriptionId: sub.id,
            reason: 'cycle_changed',
          });
          if (released > 0) {
            await tx.subscriptionEvent.create({
              data: {
                subscriptionId: sub.id,
                event: 'coupon_released',
                detail: { reason: 'cycle_changed', action: opts.event },
              },
            });
          }
        }

        if (opts.notify) await opts.notify(tx);

        const row = await tx.subscription.findUniqueOrThrow({
          where: { id: sub.id },
          include: CARD_INCLUDE,
        });
        return toCard(row);
      }),
    );
  }

  /**
   * ★ ด่านสุดท้ายของกฎ "ห้ามมีรายการซ้ำ" ★
   *
   * `assertNoDuplicate` เป็นการอ่านแล้วค่อยเขียนซึ่ง 2 request ที่ยิงพร้อมกันผ่านได้
   * ทั้งคู่ — ตัวที่กันจริงคือ partial unique index `subs_one_live_per_plan_address`
   * ที่ DB (migration 20260817120000) ตรงนี้แค่แปลง P2002 ให้เป็นข้อความเดียวกัน
   * กับเส้นทางปกติ ไม่ใช่ 500 (รูปแบบเดียวกับ `AuthService.register()` กับอีเมลซ้ำ)
   */
  private async runGuardingDuplicates<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // ★ ต้องดู target ★ ตั้งแต่มีคูปอง (feature 18) การสมัครหนึ่งครั้งชน
        // unique ได้ 3 ตัว — ถ้าเหมาว่าเป็น "สมัครซ้ำ" หมด คนที่เคยใช้คูปองใบนี้
        // แล้วมาสมัครสินค้าชิ้นใหม่จะได้ข้อความว่า "สมัครไปแล้ว" ซึ่งไม่จริงเลย
        const target = uniqueTargetOf(e);
        if (target.includes('coupon_once_per_user')) {
          throw AppError.conflict(
            'COUPON_ALREADY_USED',
            'คุณใช้คูปองใบนี้ไปแล้ว',
          );
        }
        if (target.includes('coupon_one_per_cycle')) {
          throw AppError.conflict(
            'COUPON_ALREADY_APPLIED',
            'รอบนี้จองคูปองไว้แล้ว',
          );
        }
        throw AppError.conflict(
          'ALREADY_SUBSCRIBED',
          'คุณมีรายการแบบเดียวกันส่งไปที่อยู่นี้อยู่แล้ว',
        );
      }
      throw e;
    }
  }

  /** แผนเดียวกัน + ที่อยู่เดียวกัน + ยังไม่ยกเลิก = รายการซ้ำ (กฎเดียวกับตอนสมัคร) */
  private async assertNoDuplicate(
    buyerId: string,
    planId: string,
    addressId: string,
    exceptId?: string,
  ): Promise<void> {
    const duplicate = await this.prisma.subscription.findFirst({
      where: {
        buyerId,
        planId,
        addressId,
        status: { in: ['active', 'paused'] },
        ...(exceptId === undefined ? {} : { id: { not: exceptId } }),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw AppError.conflict(
        'ALREADY_SUBSCRIBED',
        'คุณมีรายการแบบเดียวกันส่งไปที่อยู่นี้อยู่แล้ว',
      );
    }
  }

  private cycleOf(sub: SubscriptionRow): Cycle {
    const cycle = sub.plan.cycle;
    if (!isCycle(cycle)) {
      throw AppError.unprocessable('PLAN_INVALID', 'ข้อมูลแผนไม่ถูกต้อง');
    }
    return cycle;
  }

  /** active ต้องมีวันรอบถัดไปเสมอ (CHECK subs_state_consistent) — กันไว้อีกชั้น */
  private requireNextOrderDate(sub: SubscriptionRow): Date {
    if (!sub.nextOrderDate) {
      throw AppError.conflict(
        'NO_NEXT_ORDER_DATE',
        'รายการนี้ไม่มีรอบถัดไปแล้ว',
      );
    }
    return sub.nextOrderDate;
  }

  private parseStartDate(raw: string): Date {
    const parsed = tryParseISODate(raw);
    if (!parsed) {
      throw AppError.badRequest('INVALID_DATE', 'วันที่เริ่มรอบไม่ถูกต้อง');
    }

    // เทียบกับ "วันนี้" ตามปฏิทินไทย ไม่ใช่ UTC — ช่วง 00:00-07:00 จะเพี้ยนไป 1 วัน
    const offset = daysUntil(parsed, todayInBangkok());
    if (offset < MIN_START_OFFSET || offset > MAX_START_OFFSET) {
      throw AppError.unprocessable(
        'START_DATE_OUT_OF_RANGE',
        `เลือกวันเริ่มรอบได้ตั้งแต่พรุ่งนี้ถึง ${MAX_START_OFFSET} วันข้างหน้า`,
      );
    }
    return parsed;
  }
}

function toCard(row: SubscriptionRow): SubscriptionCardResponse {
  return {
    id: row.id,
    status: row.status,
    pausedReason: row.pausedReason,
    startDate: toISODate(row.startDate),
    nextOrderDate: row.nextOrderDate ? toISODate(row.nextOrderDate) : null,
    cycleAnchorDate: toISODate(row.cycleAnchorDate),
    quantity: row.quantity,
    cycle: row.plan.cycle,
    pricePerCycle: row.plan.pricePerCycle.toNumber(),
    planId: row.planId,
    addressId: row.addressId,
    productId: row.plan.product.id,
    productName: row.plan.product.name,
    shopName: row.plan.product.shop.name,
    images: row.plan.product.images,
    cyclesReceived: row._count.orders,
    myRating: row.review?.rating ?? null,
    ...appliedCouponsOf(row),
  };
}

/**
 * คูปองที่จองไว้กับ **รอบถัดไป** เท่านั้น — ใบที่ค้างอยู่กับรอบเก่า (ซึ่ง engine
 * จะเก็บกวาดในรอบถัดไป) ต้องไม่โผล่มาบนการ์ดให้ผู้ซื้อเข้าใจผิดว่ายังใช้ได้
 *
 * คำนวณยอดสดทุกครั้ง ไม่ใช้ค่าที่บันทึกตอนจอง เพราะราคาอาจขยับไปแล้ว
 * และรวมสองระดับด้วย `combineDiscounts()` ตัวเดียวกับที่ engine ใช้ตอนตัดเงินจริง
 * — ถ้าคิดคนละสูตร เลขบนการ์ดจะไม่ตรงกับที่ถูกตัดในรอบถัดไป
 */
function appliedCouponsOf(row: SubscriptionRow): {
  coupons: SubscriptionCardResponse['coupons'];
  couponDiscount: number;
  couponNetAmount: number;
} {
  const gross = grossAmount(row.plan.pricePerCycle, row.quantity);
  const empty = {
    coupons: [],
    couponDiscount: 0,
    couponNetAmount: gross.toNumber(),
  };
  if (row.nextOrderDate === null) return empty;

  const held = row.couponRedemptions.filter(
    (r) => r.cycleDate.getTime() === row.nextOrderDate?.getTime(),
  );
  if (held.length === 0) return empty;

  const of = (tier: 'platform' | 'shop'): Prisma.Decimal | null => {
    const hit = held.find((h) => h.tier === tier);
    if (hit === undefined) return null;
    const calc = computeDiscount(gross, hit);
    return calc.ok ? calc.discount : null;
  };
  const combined = combineDiscounts(gross, of('platform'), of('shop'));

  const coupons = (['platform', 'shop'] as const)
    .map((tier) => {
      const hit = held.find((h) => h.tier === tier);
      if (hit === undefined) return null;
      const amount = combined[tier];
      if (amount.lte(0)) return null;
      return {
        tier,
        code: hit.coupon.code,
        discountAmount: amount.toNumber(),
      };
    })
    .filter((c) => c !== null);

  return {
    coupons,
    couponDiscount: combined.total.toNumber(),
    couponNetAmount: combined.net.toNumber(),
  };
}

function cycleText(cycle: string): string {
  if (cycle === '2w') return 'ทุก 2 สัปดาห์';
  if (cycle === '2m') return 'ทุก 2 เดือน';
  return 'ทุกเดือน';
}

/** ไม่ส่ง `buyerId` / `subscriptionId` ออกไปกับรีวิว (feature 17) */
function toReview(row: {
  id: string;
  rating: number;
  comment: string | null;
  cyclesReceived: number;
  createdAt: Date;
  updatedAt: Date;
}): ReviewResponse {
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    cyclesReceived: row.cyclesReceived,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    // เทียบเวลาสร้างกับเวลาแก้ล่าสุด — ต่างกันเมื่อไหร่แปลว่าถูกแก้
    edited: row.updatedAt.getTime() - row.createdAt.getTime() > 1000,
  };
}
