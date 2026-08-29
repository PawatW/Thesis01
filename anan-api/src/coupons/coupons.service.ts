import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type CouponPolicy,
  type CouponReleaseReason,
  type CouponTier,
  type SubscriptionStatus,
} from '@prisma/client';
import { BILLABLE_PRODUCT, VISIBLE_PRODUCT } from '../catalog/catalog.service';
import { toISODate, todayInBangkok } from '../common/date';
import { AppError } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  blockedReasonText,
  combineDiscounts,
  computeDiscount,
  discountLabel,
  grossAmount,
} from './discount';
import type {
  AppliedCouponResponse,
  AvailableCouponResponse,
  CouponTierResponse,
  SubscriptionCouponsResponse,
} from './dto/coupon.dto';

/**
 * คูปองส่วนลดรายรอบ 2 ระดับ (feature 18 · W13) — ตรรกะกลางที่ทุกฝั่งเรียกใช้
 *
 * ★ คูปองที่นี่เป็นของที่ "จองไว้กับรอบ" ไม่ใช่ของที่ "ใช้แล้วจบ" ★
 * เพราะรอบที่ 2 เป็นต้นไป engine เป็นคนสร้างออเดอร์ตอนตี 1 โดยผู้ซื้อไม่อยู่
 * ผู้ซื้อจึงจองล่วงหน้าในหน้าต่างเดียวกับที่กด "ข้ามรอบ" ได้ แล้ว engine ใช้จริง
 *
 * ★ 2 ระดับ ซ้อนได้สูงสุด 1 ใบต่อระดับต่อรอบ ★
 *   - `platform` ผู้ดูแลออก → ร้าน "กดเข้าร่วม" รายสินค้า
 *   - `shop`     ร้านออกเอง → ครอบทั้งร้าน หรือเลือกสินค้าเอง
 *   เพดาน 2 ใบมาจาก partial unique `coupon_one_per_cycle_tier` ที่ DB
 *   และด่านสุดท้ายว่าสินค้าชิ้นนั้นรับระดับไหน อยู่ที่ `products.coupon_policy`
 *
 * เจ้าของ 3 เมธอดที่ระบบอื่นเรียก:
 *   - `releaseReserved()`  — `SubscriptionsService.commit()` กับ moderation เรียก
 *   - `consumeForCycle()`  — engine กับ checkout เรียกตอนสร้างออเดอร์
 *   - `reserveInTx()`      — checkout เรียกตอนสมัครพร้อมคูปองรอบแรก
 */
@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================================
  // ฝั่งผู้ซื้อ — ดูคูปองที่ใช้ได้ / จอง / ถอน
  // ==========================================================

  /** คูปองของรอบถัดไปของ subscription หนึ่ง แยกตามระดับ */
  async listForSubscription(
    buyerId: string,
    subscriptionId: string,
  ): Promise<SubscriptionCouponsResponse> {
    const sub = await this.loadSubscription(buyerId, subscriptionId);
    const gross = grossAmount(sub.plan.pricePerCycle, sub.quantity);
    const gate = this.bookingGate(sub.status, sub.nextOrderDate);
    const product = sub.plan.product;

    const applied = await this.appliedFor(subscriptionId, sub.nextOrderDate);

    const tierOf = async (tier: CouponTier): Promise<CouponTierResponse> => {
      const allowed = policyAllows(product.couponPolicy, tier);
      const held = applied[tier];
      // ใบที่จองไว้แล้วต้องโชว์เสมอ แม้ระดับนั้นเพิ่งถูกร้านปิดไป (ยึด snapshot)
      if (held !== null) {
        return { allowed, blockedReason: null, applied: held, available: [] };
      }
      if (!allowed) {
        return {
          allowed: false,
          blockedReason: policyBlockedText(product.couponPolicy, tier),
          applied: null,
          available: [],
        };
      }
      if (!gate.canApply) {
        return {
          allowed,
          blockedReason: gate.reason,
          applied: null,
          available: [],
        };
      }
      return {
        allowed,
        blockedReason: null,
        applied: null,
        available: await this.availableFor({
          product,
          tier,
          buyerId,
          gross,
          cycleDate: sub.nextOrderDate as Date,
        }),
      };
    };

    const [platform, shop] = await Promise.all([
      tierOf('platform'),
      tierOf('shop'),
    ]);

    // ยอดรวมคิดที่นี่ที่เดียว — หน้าจอห้ามบวกเอง (กฎการหนีบอยู่ใน combineDiscounts)
    const combined = combineDiscounts(
      gross,
      applied.platform === null
        ? null
        : new Prisma.Decimal(applied.platform.discountAmount),
      applied.shop === null
        ? null
        : new Prisma.Decimal(applied.shop.discountAmount),
    );

    return {
      cycleDate: sub.nextOrderDate ? toISODate(sub.nextOrderDate) : null,
      grossAmount: gross.toNumber(),
      discountAmount: combined.total.toNumber(),
      netAmount: combined.net.toNumber(),
      canApply: gate.canApply,
      blockedReason: gate.reason,
      platform,
      shop,
    };
  }

  /**
   * คูปองที่ใช้ได้กับแผนหนึ่งตอน checkout — ยังไม่มี subscription ให้ผูก
   *
   * ใช้ `VISIBLE_PRODUCT` (ไม่ใช่ `BILLABLE_PRODUCT`) เพราะนี่คือการสมัครใหม่:
   * สินค้าที่ร้านปิดรับสมาชิกใหม่ไม่ควรโผล่มาให้เลือกคูปองตั้งแต่แรก
   */
  async listForPlan(
    buyerId: string,
    planId: string,
    quantity: number,
  ): Promise<AvailableCouponResponse[]> {
    const plan = await this.prisma.productPlan.findFirst({
      where: { id: planId, isActive: true, product: VISIBLE_PRODUCT },
      select: { pricePerCycle: true, product: { select: PRODUCT_FOR_COUPON } },
    });
    if (!plan) return [];

    const gross = grossAmount(plan.pricePerCycle, quantity);
    // รอบแรกถูกตัดเงินทันทีตอนกดยืนยัน จึงใช้ "วันนี้" เป็นรอบที่ต้องยังใช้ได้
    const cycleDate = todayInBangkok();

    const tiers = (['platform', 'shop'] as const).filter((t) =>
      policyAllows(plan.product.couponPolicy, t),
    );
    const lists = await Promise.all(
      tiers.map((tier) =>
        this.availableFor({
          product: plan.product,
          tier,
          buyerId,
          gross,
          cycleDate,
        }),
      ),
    );
    return lists.flat();
  }

  /**
   * จองคูปองกับรอบถัดไป — ระดับมาจากตัวคูปอง ไม่ใช่จากค่าที่ client ส่ง
   *
   * ★ โควตาถูกกินตั้งแต่ตอนจอง ★ ไม่ใช่ตอนตัดเงิน — ไม่งั้นวันตัดเงินจริงจะมีคน
   * ถือสิทธิ์เกินจำนวนที่ประกาศไว้ · การตัดสินว่าโควตาเหลือไหมอยู่ใน `where` ของ
   * `updateMany` ไม่ใช่ SELECT ก่อนเขียน (ยิงพร้อมกัน 3 เส้นบนใบสุดท้าย = ผ่าน 1)
   */
  async apply(
    buyerId: string,
    subscriptionId: string,
    couponId: string,
  ): Promise<SubscriptionCouponsResponse> {
    const sub = await this.loadSubscription(buyerId, subscriptionId);
    const gate = this.bookingGate(sub.status, sub.nextOrderDate);
    if (!gate.canApply) {
      throw AppError.conflict('CYCLE_NOT_BOOKABLE', gate.reason ?? '');
    }
    const cycleDate = sub.nextOrderDate as Date;
    const gross = grossAmount(sub.plan.pricePerCycle, sub.quantity);

    const coupon = await this.loadUsableCoupon({
      couponId,
      product: sub.plan.product,
      buyerId,
      cycleDate,
      billableOnly: true,
    });
    const calc = computeDiscount(gross, coupon);
    if (!calc.ok) {
      throw AppError.unprocessable(
        'COUPON_NOT_APPLICABLE',
        blockedReasonText(calc.reason, coupon),
      );
    }

    await this.guardDuplicateBooking(() =>
      this.prisma.$transaction(async (tx) => {
        await this.reserveInTx(tx, {
          coupon,
          subscriptionId,
          buyerId,
          cycleDate,
          discount: calc.discount,
        });

        /**
         * ★ ตรวจซ้ำว่ารอบยังไม่ถูก engine กินไป ★
         *
         * engine อาจถูกสั่งรัน (time-travel ของ admin) ระหว่างที่คำขอนี้ทำงานอยู่
         * อ่านซ้ำ *หลัง* เขียนแล้วภายในทรานแซกชันเดียวกัน ทำให้เห็นผลของ engine
         * ที่ commit ไปก่อนหน้า แล้ว rollback ทั้งก้อนได้
         *
         * ยังเหลือช่องแคบ ๆ ที่ engine commit หลังบรรทัดนี้ — ใบที่ค้างจะถูก
         * `releaseStaleReservations()` เก็บกวาดในรอบถัดไปของ engine
         */
        const fresh = await tx.subscription.findUnique({
          where: { id: subscriptionId },
          select: { status: true, nextOrderDate: true },
        });
        if (
          fresh?.status !== 'active' ||
          fresh.nextOrderDate?.getTime() !== cycleDate.getTime()
        ) {
          throw AppError.conflict(
            'CYCLE_CHANGED',
            'รอบถัดไปเพิ่งเปลี่ยนไปแล้ว กรุณารีเฟรชหน้าจอ',
          );
        }

        await tx.subscriptionEvent.create({
          data: {
            subscriptionId,
            event: 'coupon_applied',
            detail: {
              coupon_code: coupon.code,
              tier: coupon.tier,
              cycle_date: toISODate(cycleDate),
              discount_amount: calc.discount.toNumber(),
            },
          },
        });
      }),
    );

    return this.listForSubscription(buyerId, subscriptionId);
  }

  /** ถอนคูปองของระดับหนึ่งออกจากรอบ — คืนโควตาให้คนอื่นทันที */
  async remove(
    buyerId: string,
    subscriptionId: string,
    tier: CouponTier,
  ): Promise<SubscriptionCouponsResponse> {
    // เรียกเพื่อยืนยันความเป็นเจ้าของ (โยน 404 ถ้าไม่ใช่ของผู้เรียก)
    await this.loadSubscription(buyerId, subscriptionId);

    await this.prisma.$transaction(async (tx) => {
      const released = await this.releaseReserved(tx, {
        subscriptionId,
        reason: 'user_removed',
        tier,
      });
      if (released === 0) {
        throw AppError.conflict(
          'NO_COUPON_APPLIED',
          'รายการนี้ไม่ได้จองคูปองระดับนี้ไว้',
        );
      }
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId,
          event: 'coupon_released',
          detail: { reason: 'user_removed', tier },
        },
      });
    });

    return this.listForSubscription(buyerId, subscriptionId);
  }

  // ==========================================================
  // ตรรกะกลางที่ระบบอื่นเรียก (subscriptions · engine · moderation)
  // ==========================================================

  /**
   * จอง 1 ใบภายในทรานแซกชันที่ผู้เรียกเปิดไว้
   *
   * แยกออกมาเพราะ checkout ต้องจอง+ใช้ในทรานแซกชันเดียวกับที่สร้าง subscription
   * (ทุกอย่างของการสมัครต้องสำเร็จด้วยกันหรือไม่เกิดเลย — architecture.md §5)
   */
  async reserveInTx(
    tx: Prisma.TransactionClient,
    input: {
      coupon: UsableCoupon;
      subscriptionId: string;
      buyerId: string;
      cycleDate: Date;
      discount: Prisma.Decimal;
    },
  ): Promise<string> {
    // ★ เงื่อนไขโควตาอยู่ใน where ★ count 0 = มีคนคว้าใบสุดท้ายไปก่อน
    const claimed = await tx.coupon.updateMany({
      where: { id: input.coupon.id, isActive: true, ...this.quotaAvailable },
      data: { inUseCount: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw AppError.conflict('COUPON_EXHAUSTED', 'คูปองนี้ถูกใช้ครบจำนวนแล้ว');
    }

    const redemption = await tx.couponRedemption.create({
      data: {
        couponId: input.coupon.id,
        subscriptionId: input.subscriptionId,
        buyerId: input.buyerId,
        cycleDate: input.cycleDate,
        // snapshot ระดับไว้ด้วย — partial unique เกาะคอลัมน์นี้ และคูปองอาจถูกลบ
        // สิทธิ์ทีหลัง แต่รอบที่จองไว้ต้องยังรู้ว่ามันอยู่ช่องไหน
        tier: input.coupon.tier,
        status: 'reserved',
        // snapshot เงื่อนไข — admin/ร้านแก้ทีหลังต้องไม่ย้อนไปแก้ของที่จองแล้ว
        discountType: input.coupon.discountType,
        discountValue: input.coupon.discountValue,
        maxDiscountAmount: input.coupon.maxDiscountAmount,
        minOrderAmount: input.coupon.minOrderAmount,
        discountAmount: input.discount,
      },
      select: { id: true },
    });
    return redemption.id;
  }

  /**
   * ใช้คูปองของรอบนี้ (ทั้งสองระดับ) — เรียกจาก **ในทรานแซกชันเดียวกับที่สร้างออเดอร์**
   *
   * ★ คำนวณใหม่เสมอจาก snapshot ของ *เงื่อนไข* ★ ไม่ใช่ยอดที่จองไว้ตรง ๆ
   * เพราะยอดก่อนลดเปลี่ยนได้ระหว่างที่จองค้างอยู่ (ร้านขึ้น/ลดราคา · เปลี่ยนแผน)
   *
   * ถ้าคำนวณใหม่แล้วใช้ไม่ได้ (ร้านลดราคาจนต่ำกว่าขั้นต่ำ) → **คืนคูปอง** ไม่ใช่
   * ใช้ที่ 0 บาท ซึ่งจะทำให้คูปองหายไปฟรี ๆ และผิด CHECK ที่ orders ด้วย
   */
  async consumeForCycle(
    tx: Prisma.TransactionClient,
    input: { subscriptionId: string; cycleDate: Date; gross: Prisma.Decimal },
  ): Promise<ConsumeResult> {
    const rows = await tx.couponRedemption.findMany({
      where: {
        subscriptionId: input.subscriptionId,
        cycleDate: input.cycleDate,
        status: 'reserved',
      },
      select: {
        id: true,
        couponId: true,
        tier: true,
        discountType: true,
        discountValue: true,
        maxDiscountAmount: true,
        minOrderAmount: true,
        coupon: { select: { code: true } },
      },
    });

    const applied: Partial<Record<CouponTier, AppliedTier>> = {};
    const released: string[] = [];

    for (const row of rows) {
      const calc = computeDiscount(input.gross, row);
      if (!calc.ok) {
        await this.releaseOne(tx, {
          redemptionId: row.id,
          couponId: row.couponId,
          reason: 'min_order_not_met',
        });
        released.push(row.coupon.code);
        continue;
      }
      applied[row.tier] = {
        redemptionId: row.id,
        couponCode: row.coupon.code,
        discount: calc.discount,
      };
    }

    // ★ รวมสองระดับที่นี่ที่เดียว ★ กฎการหนีบเมื่อรวมเกินยอดอยู่ใน discount.ts
    const combined = combineDiscounts(
      input.gross,
      applied.platform?.discount ?? null,
      applied.shop?.discount ?? null,
    );

    const consume = async (
      tier: CouponTier,
      finalDiscount: Prisma.Decimal,
    ): Promise<AppliedTier | null> => {
      const hit = applied[tier];
      if (hit === undefined) return null;
      // ใบที่ถูกหนีบจนเหลือ 0 = ไม่มีผลกับยอดจริง → คืนแทนที่จะบันทึกเป็นใช้แล้ว
      if (finalDiscount.lte(0)) {
        await this.releaseOne(tx, {
          redemptionId: hit.redemptionId,
          couponId: rows.find((r) => r.id === hit.redemptionId)!.couponId,
          reason: 'min_order_not_met',
        });
        released.push(hit.couponCode);
        return null;
      }
      // สถานะเดิมอยู่ใน where — สองเส้นทางที่ใช้ใบเดียวกันพร้อมกันต้องสำเร็จเส้นเดียว
      const done = await tx.couponRedemption.updateMany({
        where: { id: hit.redemptionId, status: 'reserved' },
        data: {
          status: 'consumed',
          consumedAt: new Date(),
          discountAmount: finalDiscount,
        },
      });
      if (done.count === 0) return null;
      return { ...hit, discount: finalDiscount };
    };

    const platform = await consume('platform', combined.platform);
    const shop = await consume('shop', combined.shop);

    const total = (platform?.discount ?? ZERO).add(shop?.discount ?? ZERO);
    return {
      platform,
      shop,
      discount: total,
      net: input.gross.sub(total),
      releasedCodes: released,
    };
  }

  /**
   * คืนคูปองที่จองค้างของ subscription หนึ่ง — คืนจำนวนใบที่คืนสำเร็จ
   *
   * ★ กฎเดียวของทั้งระบบ ★ อะไรก็ตามที่ทำให้ `next_order_date` เปลี่ยนโดยไม่เกิด
   * ออเดอร์ ต้องเรียกตัวนี้ในทรานแซกชันเดียวกัน (skip · pause · เลื่อนวันส่ง ·
   * เปลี่ยนรอบส่ง · ยกเลิก · ร้านถูกระงับ) — กฎข้อเดียวแทนการไล่เขียนเคสพิเศษ
   * และกันไม่ให้คูปองค้างอยู่กับรอบที่ไม่มีวันเกิด
   */
  async releaseReserved(
    tx: Prisma.TransactionClient,
    input: {
      subscriptionId: string;
      reason: CouponReleaseReason;
      /** คืนเฉพาะระดับนี้ — ไม่ใส่ = คืนทุกใบที่ยังจองอยู่ */
      tier?: CouponTier;
      /** จำกัดเฉพาะรอบก่อนวันนี้ — ใช้ตอน engine เก็บกวาดใบที่ค้างจากรอบที่ผ่านไปแล้ว */
      cycleDateBefore?: Date;
      /** แจ้งผู้ซื้อเมื่อ **ระบบ** เป็นคนคืน (ผู้ซื้อกดเองไม่ต้องแจ้ง) */
      notify?: { userId: string; productName: string; linkPath?: string };
    },
  ): Promise<number> {
    const rows = await tx.couponRedemption.findMany({
      where: {
        subscriptionId: input.subscriptionId,
        status: 'reserved',
        ...(input.tier === undefined ? {} : { tier: input.tier }),
        ...(input.cycleDateBefore
          ? { cycleDate: { lt: input.cycleDateBefore } }
          : {}),
      },
      select: {
        id: true,
        couponId: true,
        cycleDate: true,
        coupon: { select: { code: true } },
      },
    });

    let released = 0;
    for (const row of rows) {
      const ok = await this.releaseOne(tx, {
        redemptionId: row.id,
        couponId: row.couponId,
        reason: input.reason,
      });
      if (!ok) continue;
      released++;

      if (input.notify) {
        await tx.notification.create({
          data: {
            userId: input.notify.userId,
            type: 'coupon_released',
            title: 'คูปองถูกคืนแล้ว',
            body: `${input.notify.productName} — คูปอง ${row.coupon.code} ของรอบ ${toISODate(row.cycleDate)} ถูกคืนให้แล้ว ใช้กับรอบใหม่ได้`,
            linkPath: input.notify.linkPath,
          },
        });
      }
    }
    return released;
  }

  /**
   * เก็บกวาดใบที่จองไว้กับรอบที่ผ่านไปแล้ว — เรียกจาก engine หลังเลื่อนรอบ
   *
   * ปิดช่องแคบ ๆ ที่การจองไป commit หลัง engine พอดี: ใบนั้นจะค้างอยู่กับรอบใน
   * อดีตซึ่งไม่มีวันถูกใช้ ถ้าไม่มีตัวนี้ โควตาจะรั่วไปเรื่อย ๆ โดยไม่มีใครทัก
   */
  async releaseStaleReservations(
    tx: Prisma.TransactionClient,
    input: { subscriptionId: string; before: Date },
  ): Promise<number> {
    return this.releaseReserved(tx, {
      subscriptionId: input.subscriptionId,
      reason: 'cycle_changed',
      cycleDateBefore: input.before,
    });
  }

  /**
   * หาคูปองที่ใช้ได้จริงกับสินค้า/ผู้ซื้อ/รอบนี้ — โยน 404 ถ้าใช้ไม่ได้
   *
   * ★ ตอบ 404 ไม่ใช่ 403 เมื่อไม่เข้าเงื่อนไข ★ ผู้ซื้อไม่ควรแยกออกว่า
   * "ไม่มีคูปองนี้" ต่างจาก "มีแต่สินค้านี้ไม่ร่วม" (enumeration)
   */
  async loadUsableCoupon(input: {
    couponId: string;
    product: ProductForCoupon;
    buyerId: string;
    cycleDate: Date;
    billableOnly: boolean;
  }): Promise<UsableCoupon> {
    const now = new Date();
    const coupon = await this.prisma.coupon.findFirst({
      where: {
        id: input.couponId,
        isActive: true,
        startsAt: { lte: now },
        endsAt: { gte: cycleWindowStart(input.cycleDate) },
        ...this.coverageOf(input.product, input.billableOnly),
      },
      select: COUPON_TERMS_SELECT,
    });
    if (!coupon) {
      throw AppError.notFound(
        'COUPON_NOT_FOUND',
        'คูปองนี้ใช้กับรายการนี้ไม่ได้',
      );
    }

    // ★ ด่านนโยบายรายสินค้า ★ ร้านปิดระดับนี้ไว้ = ใช้ไม่ได้ แม้คูปองจะครอบอยู่
    if (!policyAllows(input.product.couponPolicy, coupon.tier)) {
      throw AppError.conflict(
        'COUPON_TIER_NOT_ALLOWED',
        policyBlockedText(input.product.couponPolicy, coupon.tier),
      );
    }

    // ใช้ไปแล้ว → 409 (ไม่ใช่ 404) เพราะผู้ซื้อรู้อยู่แล้วว่าคูปองใบนี้มีจริง
    const used = await this.prisma.couponRedemption.findFirst({
      where: {
        couponId: coupon.id,
        buyerId: input.buyerId,
        status: { in: ['reserved', 'consumed'] },
      },
      select: { id: true },
    });
    if (used) {
      throw AppError.conflict('COUPON_ALREADY_USED', 'คุณใช้คูปองใบนี้ไปแล้ว');
    }
    if (!hasQuota(coupon)) {
      throw AppError.conflict('COUPON_EXHAUSTED', 'คูปองนี้ถูกใช้ครบจำนวนแล้ว');
    }
    return coupon;
  }

  // ---------- ภายใน ----------

  /**
   * เงื่อนไข "คูปองใบนี้ครอบสินค้าชิ้นนี้ไหม" — ใช้ร่วมกันทั้งตอนหาและตอนตรวจ
   *
   * มีสองทาง: ติ๊กไว้ใน `coupon_products` (ทั้งสองระดับใช้ทางนี้ได้) หรือเป็น
   * คูปองของร้านที่ตั้งเป็น "ทั้งร้าน" ซึ่งครอบสินค้าที่เพิ่มทีหลังด้วย
   */
  private coverageOf(
    product: ProductForCoupon,
    billableOnly: boolean,
  ): Prisma.CouponWhereInput {
    const visible = billableOnly ? BILLABLE_PRODUCT : VISIBLE_PRODUCT;
    return {
      OR: [
        { products: { some: { productId: product.id, product: visible } } },
        {
          tier: 'shop',
          appliesToAllProducts: true,
          shopId: product.shopId,
        },
      ],
    };
  }

  /**
   * เงื่อนไข "โควตายังเหลือ" สำหรับ `where` ของคำสั่งเขียน — เทียบสองคอลัมน์ในแถวเดียวกัน
   *
   * ต้องเป็น OR เพราะการเทียบคอลัมน์กับ NULL ให้ผลเป็น NULL ไม่ใช่ true
   * คูปองที่ไม่จำกัดจำนวน (`max_redemptions IS NULL`) จะตกหล่นถ้าเขียนกิ่งเดียว
   */
  private get quotaAvailable(): Prisma.CouponWhereInput {
    return {
      OR: [
        { maxRedemptions: null },
        { inUseCount: { lt: this.prisma.coupon.fields.maxRedemptions } },
      ],
    };
  }

  private async loadSubscription(buyerId: string, id: string) {
    // ownership อยู่ใน where — ของคนอื่นตอบ 404 ไม่ใช่ 403
    const sub = await this.prisma.subscription.findFirst({
      where: { id, buyerId },
      select: {
        id: true,
        status: true,
        quantity: true,
        nextOrderDate: true,
        plan: {
          select: {
            pricePerCycle: true,
            product: { select: PRODUCT_FOR_COUPON },
          },
        },
      },
    });
    if (!sub) {
      throw AppError.notFound('SUBSCRIPTION_NOT_FOUND', 'ไม่พบรายการนี้');
    }
    return sub;
  }

  /** จองได้ไหม — สถานะต้อง active และต้องยังไม่ถึงวันตัดรอบ */
  private bookingGate(
    status: SubscriptionStatus,
    nextOrderDate: Date | null,
  ): { canApply: boolean; reason: string | null } {
    if (status !== 'active') {
      return {
        canApply: false,
        reason:
          status === 'cancelled'
            ? 'รายการนี้ถูกยกเลิกแล้ว'
            : 'ใช้คูปองได้เมื่อรายการกลับมาใช้งานแล้ว',
      };
    }
    if (!nextOrderDate) {
      return { canApply: false, reason: 'รายการนี้ไม่มีรอบถัดไปแล้ว' };
    }
    // เดดไลน์เดียวกับ "ข้ามรอบ": ถึงสิ้นวันก่อนวันตัดรอบ เพราะ engine รันตี 1
    if (nextOrderDate <= todayInBangkok()) {
      return {
        canApply: false,
        reason: 'รอบนี้ใกล้ถึงกำหนดแล้ว ใช้กับรอบถัดไปได้',
      };
    }
    return { canApply: true, reason: null };
  }

  /** ใบที่จองไว้กับรอบถัดไป แยกตามระดับ */
  private async appliedFor(
    subscriptionId: string,
    cycleDate: Date | null,
  ): Promise<Record<CouponTier, AppliedCouponResponse | null>> {
    const empty = { platform: null, shop: null };
    if (!cycleDate) return empty;

    const rows = await this.prisma.couponRedemption.findMany({
      where: { subscriptionId, cycleDate, status: 'reserved' },
      select: {
        id: true,
        tier: true,
        discountType: true,
        discountValue: true,
        maxDiscountAmount: true,
        minOrderAmount: true,
        coupon: { select: { id: true, code: true, title: true } },
      },
    });
    if (rows.length === 0) return empty;

    const sub = await this.prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      select: { quantity: true, plan: { select: { pricePerCycle: true } } },
    });
    const gross = grossAmount(sub.plan.pricePerCycle, sub.quantity);

    const out: Record<CouponTier, AppliedCouponResponse | null> = { ...empty };
    for (const row of rows) {
      // โชว์ยอดที่คำนวณสด ไม่ใช่ค่าที่จองไว้ — ราคาอาจขยับไปแล้วตั้งแต่วันจอง
      const calc = computeDiscount(gross, row);
      out[row.tier] = {
        redemptionId: row.id,
        couponId: row.coupon.id,
        code: row.coupon.code,
        title: row.coupon.title,
        label: discountLabel(row),
        tier: row.tier,
        cycleDate: toISODate(cycleDate),
        discountAmount: calc.ok ? calc.discount.toNumber() : 0,
      };
    }
    return out;
  }

  /** คูปองระดับหนึ่งที่เกี่ยวข้องกับสินค้านี้ — ใบที่ใช้ไม่ได้ส่งไปด้วยพร้อมเหตุผล */
  private async availableFor(input: {
    product: ProductForCoupon;
    tier: CouponTier;
    buyerId: string;
    gross: Prisma.Decimal;
    cycleDate: Date;
  }): Promise<AvailableCouponResponse[]> {
    const now = new Date();
    const rows = await this.prisma.coupon.findMany({
      where: {
        isActive: true,
        tier: input.tier,
        startsAt: { lte: now },
        endsAt: { gte: cycleWindowStart(input.cycleDate) },
        ...this.coverageOf(input.product, false),
        // ★ ใบที่ผู้ซื้อคนนี้ใช้ไปแล้ว ไม่ต้องโผล่มาให้เห็นเลย ★
        redemptions: {
          none: {
            buyerId: input.buyerId,
            status: { in: ['reserved', 'consumed'] },
          },
        },
      },
      select: COUPON_TERMS_SELECT,
      orderBy: { endsAt: 'asc' },
      // เพดานแถว (security-rules B-11) — ผู้ซื้อคนหนึ่งไม่ควรได้แคมเปญทั้งตาราง
      take: MAX_ROWS,
    });

    return rows.map((coupon) => {
      const calc = hasQuota(coupon)
        ? computeDiscount(input.gross, coupon)
        : null;
      const base = {
        id: coupon.id,
        code: coupon.code,
        title: coupon.title,
        description: coupon.description,
        label: discountLabel(coupon),
        tier: coupon.tier,
        endsAt: coupon.endsAt.toISOString(),
      };
      if (calc === null) {
        return {
          ...base,
          usable: false,
          discountAmount: null,
          blockedReason: 'คูปองนี้ถูกใช้ครบจำนวนแล้ว',
        };
      }
      if (!calc.ok) {
        return {
          ...base,
          usable: false,
          discountAmount: null,
          blockedReason: blockedReasonText(calc.reason, coupon),
        };
      }
      return {
        ...base,
        usable: true,
        discountAmount: calc.discount.toNumber(),
        blockedReason: null,
      };
    });
  }

  /** คืน 1 ใบ + คืนโควตา — คืน false เมื่อมีคนเปลี่ยนสถานะไปก่อนแล้ว */
  private async releaseOne(
    tx: Prisma.TransactionClient,
    input: {
      redemptionId: string;
      couponId: string;
      reason: CouponReleaseReason;
    },
  ): Promise<boolean> {
    const done = await tx.couponRedemption.updateMany({
      where: { id: input.redemptionId, status: 'reserved' },
      data: {
        status: 'released',
        releasedAt: new Date(),
        releasedReason: input.reason,
      },
    });
    if (done.count === 0) return false;

    // คืนทีละใบตามจำนวนที่ปล่อยสำเร็จจริง — `in_use_count` จึงตรงกับจำนวนแถว
    // ที่ยังไม่ released เสมอ (invariant ชั้น L3 ใน docs/testing.md)
    await tx.coupon.update({
      where: { id: input.couponId },
      data: { inUseCount: { decrement: 1 } },
    });
    return true;
  }

  /**
   * แปลง P2002 ของ partial unique 2 ตัวให้เป็นข้อความที่อ่านรู้เรื่อง
   * (`coupon_one_per_cycle_tier` = ระดับนี้จองไปแล้ว · `coupon_once_per_user` = ใช้ใบนี้ไปแล้ว)
   */
  private async guardDuplicateBooking<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const target = uniqueTargetOf(e);
        if (target.includes('once_per_user')) {
          throw AppError.conflict(
            'COUPON_ALREADY_USED',
            'คุณใช้คูปองใบนี้ไปแล้ว',
          );
        }
        throw AppError.conflict(
          'COUPON_ALREADY_APPLIED',
          'รอบนี้จองคูปองระดับนี้ไว้แล้ว — ถอนใบเดิมออกก่อนถ้าจะเปลี่ยน',
        );
      }
      throw e;
    }
  }
}

// ============================================================
// ตัวช่วยระดับไฟล์
// ============================================================

/** เพดานแถวของรายการที่ส่งออก (security-rules B-11) */
const MAX_ROWS = 50;

const ZERO = new Prisma.Decimal(0);

interface AppliedTier {
  redemptionId: string;
  couponCode: string;
  discount: Prisma.Decimal;
}

/** ผลของการใช้คูปองในรอบหนึ่ง — สองช่องเป็นอิสระจากกัน */
export interface ConsumeResult {
  platform: AppliedTier | null;
  shop: AppliedTier | null;
  /** ส่วนลดรวมหลังหนีบแล้ว — เท่ากับ platform + shop เสมอ */
  discount: Prisma.Decimal;
  net: Prisma.Decimal;
  /** โค้ดของใบที่ถูกคืนตอนตัดเงิน (เงื่อนไขไม่ผ่านแล้ว) — ใช้แจ้งผู้ซื้อ */
  releasedCodes: string[];
}

/** สินค้าเท่าที่ตรรกะคูปองต้องรู้ */
const PRODUCT_FOR_COUPON = {
  id: true,
  shopId: true,
  name: true,
  couponPolicy: true,
} satisfies Prisma.ProductSelect;

export type ProductForCoupon = Prisma.ProductGetPayload<{
  select: typeof PRODUCT_FOR_COUPON;
}>;

const COUPON_TERMS_SELECT = {
  id: true,
  code: true,
  title: true,
  description: true,
  tier: true,
  shopId: true,
  discountType: true,
  discountValue: true,
  maxDiscountAmount: true,
  minOrderAmount: true,
  endsAt: true,
  maxRedemptions: true,
  inUseCount: true,
} satisfies Prisma.CouponSelect;

/** เข้ากันได้กับ `CouponTerms` โดยโครงสร้าง — `computeDiscount()` รับได้ตรง ๆ */
export type UsableCoupon = Prisma.CouponGetPayload<{
  select: typeof COUPON_TERMS_SELECT;
}>;

/**
 * ชื่อ index ที่ทำให้เกิด P2002 — `meta.target` เป็น `unknown` จึงต้องแปลงเอง
 * (Postgres ส่งมาเป็น array ของชื่อคอลัมน์/ชื่อ constraint แล้วแต่กรณี)
 *
 * ต้องรู้ให้ได้ว่าชนตัวไหน เพราะการสมัคร 1 ครั้งชน unique ได้หลายตัวตั้งแต่มีคูปอง
 * ถ้าเหมาเป็นอย่างเดียว ผู้ใช้จะได้ข้อความที่ไม่ตรงกับสิ่งที่เกิดขึ้นจริง
 */
export function uniqueTargetOf(
  e: Prisma.PrismaClientKnownRequestError,
): string {
  const target: unknown = e.meta?.target;
  if (Array.isArray(target)) return target.map((t) => String(t)).join(',');
  return typeof target === 'string' ? target : '';
}

function hasQuota(c: { maxRedemptions: number | null; inUseCount: number }) {
  return c.maxRedemptions === null || c.inUseCount < c.maxRedemptions;
}

/** นโยบายของสินค้าเปิดรับระดับนี้ไหม — ด่านสุดท้ายที่ร้านตั้งเองรายสินค้า */
export function policyAllows(policy: CouponPolicy, tier: CouponTier): boolean {
  if (policy === 'none') return false;
  if (policy === 'both') return true;
  return policy === (tier === 'platform' ? 'platform_only' : 'shop_only');
}

function policyBlockedText(policy: CouponPolicy, tier: CouponTier): string {
  if (policy === 'none') return 'สินค้าชิ้นนี้ไม่ร่วมรายการคูปอง';
  return tier === 'platform'
    ? 'สินค้าชิ้นนี้รับเฉพาะคูปองของร้าน'
    : 'สินค้าชิ้นนี้รับเฉพาะคูปองของแพลตฟอร์ม';
}

/**
 * คูปองต้องยังไม่หมดอายุ ณ วันที่ตัดรอบ — เทียบกับต้นวันตามเวลาไทย
 *
 * ไม่ต้องแม่นระดับชั่วโมงเพราะการจอง **ยึด snapshot ตอนจอง** อยู่แล้ว: คูปองที่
 * หมดอายุหลังจองยังใช้ได้ตามที่จองไว้ (ถ้าคืนเงียบ ๆ ผู้ซื้อจะโดนตัดเต็มโดยไม่รู้ตัว)
 */
function cycleWindowStart(cycleDate: Date): Date {
  const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
  return new Date(cycleDate.getTime() - BANGKOK_OFFSET_MS);
}
