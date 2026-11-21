import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { BILLABLE_PRODUCT } from '../catalog/catalog.service';
import {
  addDays,
  daysUntil,
  isCycle,
  nextCycleAfter,
  toISODate,
  todayInBangkok,
  tryParseISODate,
} from '../common/date';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors/app-exception';
import { SELLER_ORDERS_LINK } from '../common/links';
import { CouponsService } from '../coupons/coupons.service';
import {
  combineDiscounts,
  computeDiscount,
  grossAmount,
} from '../coupons/discount';
import { PaymentProvider } from '../payments/payment.provider';
import { PrismaService } from '../prisma/prisma.service';
import type { EngineRunDetail, EngineRunResponse } from './dto/engine.dto';

/** แจ้งล่วงหน้ากี่วันก่อนถึงรอบ — ต้องมีเวลาพอให้ผู้ซื้อกด skip ทัน (W06) */
const NOTICE_DAYS = 3;

/** ส่งแล้วเกินกี่วันถึงปิดออเดอร์ให้เอง — ต้องนานพอให้ของถึงและผู้ซื้อได้กดเอง (feature 16) */
const AUTO_CONFIRM_DAYS = 7;

/** time-travel ย้อน/ไปข้างหน้าได้ครึ่งปี — พอสำหรับเดโม่รอบ 2 เดือนหลายรอบ */
const MAX_TRAVEL_DAYS = 180;

/** env ที่ยอมให้ time-travel ได้ — allowlist ไม่ใช่ `!== 'production'` (ดูเหตุผลใน AppThrottlerGuard) */
const TIME_TRAVEL_ENVS = ['development', 'test'];

const DUE_INCLUDE = {
  plan: {
    select: {
      cycle: true,
      pricePerCycle: true,
      product: {
        select: { id: true, name: true, shop: { select: { ownerId: true } } },
      },
    },
  },
  address: {
    select: {
      recipientName: true,
      phone: true,
      addressLine: true,
      province: true,
      postcode: true,
    },
  },
  /** บัตรที่ผูกกับรายการ — provider ใช้ตัดสินผลการตัดเงิน (มีแค่ last4 ในระบบ) */
  paymentMethod: { select: { id: true, last4: true } },
} satisfies Prisma.SubscriptionInclude;

type DueSubscription = Prisma.SubscriptionGetPayload<{
  include: typeof DUE_INCLUDE;
}>;

/**
 * ผลของการทำงาน 1 รายการ
 *  - `created` ออเดอร์เกิด + ตัดเงินผ่าน
 *  - `unpaid`  ออเดอร์เกิดแต่บัตรถูกปฏิเสธ (จำลอง) — ผู้ซื้อกดจ่ายซ้ำได้
 *  - `skipped` ชน UNIQUE = รอบนี้สร้างไปแล้ว (รันซ้ำวันเดิม ไม่ใช่ความผิดพลาด)
 *  - `failed`  ข้อมูลไม่ครบหรือมีคนแก้สถานะกลางคัน — ต้องเห็นในรายงาน
 */
type OrderOutcome = 'created' | 'unpaid' | 'skipped' | 'failed';

/**
 * Recurring engine — หัวใจทางเทคนิคของระบบ ([W06](context/workflows/w06-recurring-cycle.md))
 *
 * งานรายวัน 4 อย่าง: แจ้งล่วงหน้า T-3 → สร้างออเดอร์+ตัดเงินจำลอง → สรุปให้ร้าน
 * → เก็บกวาด แล้วบันทึกผลลง `engine_runs` เพื่อให้ตรวจย้อนหลังได้
 *
 * ★ กฎ 2 ข้อที่ห้ามพลาด ★
 * 1. **idempotent** — รันซ้ำวันเดิมกี่ครั้งก็ได้ออเดอร์ชุดเดิม ความ idempotent
 *    มาจาก `UNIQUE(subscription_id, cycle_date)` ที่ฐานข้อมูล ไม่ใช่การเช็คในโค้ด
 *    (เช็คในโค้ดคือ "อ่านแล้วค่อยเขียน" ซึ่ง 2 process ที่รันพร้อมกันผ่านได้ทั้งคู่)
 * 2. **เลื่อน `next_order_date` เฉพาะรายการที่สร้างออเดอร์สำเร็จจริง** — ถ้าเลื่อนทุก
 *    รายการที่ถึงรอบแต่ออเดอร์ดันชน unique รอบนั้นจะหายเงียบ = ผู้ซื้อไม่ได้ของ
 *    ที่นี่จึงมัดออเดอร์ + การจ่ายเงิน + การเลื่อนวัน ไว้ในทรานแซกชันเดียวกัน
 */
@Injectable()
export class EngineService {
  private readonly logger = new Logger(EngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentProvider,
    private readonly audit: AuditService,
    private readonly coupons: CouponsService,
  ) {}

  /**
   * ตี 1 ตามเวลาไทยทุกวัน — เลือกเวลานี้เพราะเป็นช่วงที่คนใช้งานน้อยที่สุด
   * และผู้ซื้อที่ตั้งใจ skip ยังมีทั้งวันก่อนหน้าให้กด
   */
  @Cron('0 1 * * *', { timeZone: 'Asia/Bangkok' })
  async daily(): Promise<void> {
    // e2e สร้างแอปจริงหลายตัวต่อการรัน 1 ครั้ง — ถ้าเผลอรันเทสตอนตี 1 พอดี
    // cron จะไปสร้างออเดอร์จริงแทรกกลางเทส แล้วผลจะเพี้ยนแบบหาสาเหตุไม่เจอ
    if (process.env.NODE_ENV === 'test') return;

    const runDate = todayInBangkok();
    this.logger.log(`เริ่มงานประจำวัน — ${toISODate(runDate)}`);
    const result = await this.run(runDate);
    this.logger.log(
      `จบงานประจำวัน — ออเดอร์ใหม่ ${result.ordersCreated} · แจ้งเตือน ${result.notificationsCreated}`,
    );
  }

  /**
   * ★ นิยามเดียวของคำว่า "ถึงรอบแล้ว" ★ ห้ามมีใครเขียน where นี้เองซ้ำที่อื่น
   *
   * `lte` ไม่ใช่ `equals` — ถ้า cron ไม่ได้รันไปหลายวัน (เครื่องปิด/เซิร์ฟเวอร์ล่ม)
   * รอบที่ค้างต้องถูกเก็บตกในวันถัดมา ไม่ใช่หายไปเฉย ๆ
   */
  dueSubscriptions(runDate: Date): Promise<DueSubscription[]> {
    return this.prisma.subscription.findMany({
      where: {
        status: 'active',
        nextOrderDate: { lte: runDate },
        // ร้าน/สินค้าที่แอดมินระงับต้องไม่ถูกเรียกเก็บเงิน (BILLABLE_PRODUCT
        // จงใจไม่ดู isActive — ร้านที่ปิดรับสมาชิกใหม่เองยังต้องส่งของให้คนเดิม)
        plan: { product: BILLABLE_PRODUCT },
      },
      include: DUE_INCLUDE,
      orderBy: { nextOrderDate: 'asc' },
    });
  }

  /**
   * ★ ทางเข้าเดียวสำหรับการสั่งรันจากภายนอก (admin / สคริปต์เดโม่) ★
   *
   * ด่านของ time-travel อยู่ที่นี่ไม่ใช่ที่ controller เพราะ "ระบุวันที่เองได้ไหม"
   * เป็นกฎธุรกิจ ไม่ใช่การแปลง HTTP — ถ้าปล่อยไว้ที่ controller คนที่เรียก
   * `run(someDate)` จาก service อื่นใน Phase ถัดไปจะข้ามด่านโดยไม่รู้ตัว
   */
  async runManually(
    rawRunDate?: string | null,
    actorId?: string,
  ): Promise<EngineRunResponse> {
    const runDate = this.resolveRunDate(rawRunDate);
    const result = await this.run(runDate);

    // ★ บันทึกหลังรันเสร็จ ไม่ใช่ในทรานแซกชันของ engine ★ engine ทำงานเป็น
    // หลายทรานแซกชันย่อยอยู่แล้ว การผูก log ไว้กับตัวใดตัวหนึ่งจึงไม่ได้แปลว่า
    // "รันสำเร็จทั้งหมด" · ที่นี่บันทึกสิ่งที่เกิดขึ้นจริงพร้อมตัวเลขผลลัพธ์
    await this.audit.recordDetached({
      action: 'engine_run_manual',
      actorId,
      targetType: 'engine_run',
      targetId: String(result.id),
      summary: `สั่งรัน engine เองสำหรับวันที่ ${result.runDate} — ออเดอร์ใหม่ ${result.ordersCreated} ใบ · แจ้งเตือน ${result.notificationsCreated} ใบ`,
      detail: { runDate: result.runDate, ordersCreated: result.ordersCreated },
    });

    return result;
  }

  /** รัน 1 รอบแล้วบันทึกผล — `runDate` คือ "วันนี้" ในสายตาของ engine */
  async run(runDate: Date): Promise<EngineRunResponse> {
    // ★ ต้องมาก่อน notifyUpcoming ★ รายการที่เปิดคืนวันนี้ (resume_on = วันนี้+3)
    // จะได้แจ้งเตือน T-3 ตามปกติในรอบเดียวกัน
    const autoResumed = await this.autoResume(runDate);
    const upcoming = await this.notifyUpcoming(runDate);
    const orders = await this.createDueOrders(runDate);
    const autoConfirmed = await this.autoCloseShippedOrders(runDate);
    const shopsNotified = await this.summariseForShops(orders.perShop);
    const tokensPurged = await this.purgeExpiredTokens();

    const detail: EngineRunDetail = {
      due: orders.due,
      skipped: orders.skipped,
      upcoming,
      shopsNotified,
      tokensPurged,
      autoConfirmed,
      paymentsFailed: orders.unpaid,
      failed: orders.failed,
      autoResumed,
    };

    const row = await this.prisma.engineRun.create({
      data: {
        runDate,
        ordersCreated: orders.created,
        // นับทุกใบที่ engine สร้าง: T-3 + แจ้งผู้ซื้อว่ามีออเดอร์ + สรุปให้ร้าน
        notificationsCreated:
          upcoming +
          orders.created +
          shopsNotified +
          autoConfirmed +
          autoResumed,
        detail: { ...detail },
      },
    });

    return {
      id: row.id,
      runDate: toISODate(row.runDate),
      ordersCreated: row.ordersCreated,
      notificationsCreated: row.notificationsCreated,
      detail,
      ranAt: row.ranAt.toISOString(),
    };
  }

  async recentRuns(limit: number): Promise<EngineRunResponse[]> {
    const rows = await this.prisma.engineRun.findMany({
      orderBy: { ranAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      runDate: toISODate(row.runDate),
      ordersCreated: row.ordersCreated,
      notificationsCreated: row.notificationsCreated,
      // map ทีละฟิลด์ ไม่ cast ทั้งก้อนส่งออก — คอลัมน์ jsonb ที่ปล่อยผ่านตรง ๆ
      // แปลว่าอะไรก็ตามที่ใครใส่ลง detail วันหลัง (เช่น id ของผู้ซื้อไว้ debug)
      // จะหลุดออก API เองโดยไม่มีใครทัก (CLAUDE.md ข้อ 7 — ห้ามส่ง entity ดิบ)
      detail: toRunDetail(row.detail),
      ranAt: row.ranAt.toISOString(),
    }));
  }

  // ---------- งานย่อย ----------

  /**
   * งานที่ 0 — เปิดรายการที่ "หยุดพัก N รอบ" คืนเอง (Phase 8.3 · feature 06 R2)
   *
   * เปิดล่วงหน้า `NOTICE_DAYS` วันก่อน `resume_on` โดยตั้งใจ: ผู้ซื้อจะได้แจ้งเตือน
   * T-3 แบบเดียวกับรอบปกติ และยังกดข้าม/หยุดต่อได้ก่อนถูกตัดเงิน · ถ้าเปิดตรงวัน
   * ระบบจะตัดเงินทันทีโดยไม่มีใครเตือนเลย
   *
   * - `BILLABLE_PRODUCT` ด้วย: ร้านถูกระงับระหว่างพัก → ห้ามเปิดคืน ไม่งั้นได้รายการ
   *   active บนร้านที่ถูกระงับ (ผิดกฎ "ระงับแล้วเงินหยุด" ของ Phase 6)
   * - รอบแรกต้องไม่ย้อนหลัง: `max(resume_on, พรุ่งนี้)` — กรณีร้านเพิ่งปลดระงับหรือ
   *   engine ไม่ได้รันหลายวัน (กฎเดียวกับปุ่ม "กลับมาใช้งาน")
   * - เงื่อนไขทั้งหมดอยู่ใน where ของคำสั่งเขียน: ผู้ซื้อกดกลับมาเอง/ยกเลิกพร้อมกัน
   *   ฝั่งนั้นชนะ ที่นี่ข้ามไปเงียบ ๆ
   */
  private async autoResume(runDate: Date): Promise<number> {
    const horizon = addDays(runDate, NOTICE_DAYS);
    const tomorrow = addDays(runDate, 1);
    const rows = await this.prisma.subscription.findMany({
      where: {
        status: 'paused',
        pausedReason: 'user',
        resumeOn: { lte: horizon },
        plan: { product: BILLABLE_PRODUCT },
      },
      select: {
        id: true,
        buyerId: true,
        resumeOn: true,
        cycleAnchorDate: true,
        plan: { select: { product: { select: { name: true } } } },
      },
      take: 500,
    });

    let resumed = 0;
    for (const sub of rows) {
      const resumeOn = sub.resumeOn;
      if (resumeOn === null) continue;
      const next = resumeOn > tomorrow ? resumeOn : tomorrow;
      /**
       * ★ คงหมุดเดิมเมื่อกลับมาตรงวันบนกริด ★ `resume_on` คิดจากกริดของหมุดอยู่แล้ว
       * (`skipFrom`) ถ้าย้ายหมุดไปที่วันนั้น รายการที่หมุดเป็นวันที่ 31 แล้ว resume_on
       * ถูกหนีบเป็น 30 เม.ย. จะยุบเป็นวันที่ 30 ถาวร — ปัญหาเดียวกับที่หมุดมีไว้แก้
       * ย้ายหมุดเฉพาะตอนถูกหนีบเป็นพรุ่งนี้ (ร้านเพิ่งปลดระงับ/engine ไม่ได้รัน)
       * ซึ่งคือการนิยามตารางใหม่ — กฎเดียวกับปุ่ม "กลับมาใช้งาน"
       */
      const keepAnchor =
        next.getTime() === resumeOn.getTime() &&
        sub.cycleAnchorDate <= resumeOn;
      try {
        await this.prisma.$transaction(async (tx) => {
          const updated = await tx.subscription.updateMany({
            where: {
              id: sub.id,
              status: 'paused',
              pausedReason: 'user',
              resumeOn,
            },
            data: {
              status: 'active',
              pausedAt: null,
              pausedReason: null,
              resumeOn: null,
              nextOrderDate: next,
              cycleAnchorDate: keepAnchor ? sub.cycleAnchorDate : next,
            },
          });
          if (updated.count === 0) return;

          await tx.subscriptionEvent.create({
            data: {
              subscriptionId: sub.id,
              event: 'resumed',
              detail: { auto: true, next_order_date: toISODate(next) },
            },
          });
          await tx.notification.create({
            data: {
              userId: sub.buyerId,
              type: 'subscription_resumed',
              title: 'ครบกำหนดหยุดพักแล้ว',
              body: `${sub.plan.product.name} — กลับมาส่งรอบวันที่ ${toISODate(next)} · ยังข้ามรอบหรือหยุดต่อได้ก่อนถึงวัน`,
              linkPath: `/subscriptions/${sub.id}`,
            },
          });
          resumed++;
        });
      } catch (e) {
        this.logger.error(
          `เปิดรายการ ${sub.id} คืนอัตโนมัติไม่สำเร็จ: ${String(e)}`,
        );
      }
    }
    return resumed;
  }

  /**
   * งานที่ 1 — แจ้งล่วงหน้า T-3 พร้อมบอกว่ากด skip ได้ถึงเมื่อไหร่
   *
   * กันแจ้งซ้ำด้วยการฝังวันรอบไว้ใน `linkPath` (`?cycle=YYYY-MM-DD`) แล้วเช็คว่ามี
   * ใบเดิมอยู่หรือยัง — ใช้ค่าที่ระบุ "รอบไหน" ได้จริงแทนการเดาจากเวลาที่สร้าง
   * เพราะ time-travel ทำให้ `created_at` ไม่ตรงกับวันที่ engine คิดว่าเป็นวันนี้
   */
  private async notifyUpcoming(runDate: Date): Promise<number> {
    const target = addDays(runDate, NOTICE_DAYS);
    const subs = await this.prisma.subscription.findMany({
      where: {
        status: 'active',
        nextOrderDate: target,
        plan: { product: BILLABLE_PRODUCT },
      },
      include: DUE_INCLUDE,
    });

    let created = 0;
    for (const sub of subs) {
      const linkPath = `/subscriptions/${sub.id}?cycle=${toISODate(target)}`;
      const gross = grossAmount(sub.plan.pricePerCycle, sub.quantity);

      /**
       * ★ ต้องบอกเรื่องคูปองตรงนี้ ★ (feature 18)
       *
       * นี่คือจุดเดียวที่ระบบเดินเข้าไปหาผู้ซื้อก่อนถึงรอบ ถ้าไม่บอกว่ามีคูปอง
       * ใช้ได้ ก็จะไม่มีใครรู้ว่าฟีเจอร์นี้มีอยู่ — และถ้าจองไว้แล้วต้องโชว์ยอด
       * หลังลด ไม่งั้นเลขบนแจ้งเตือนไม่ตรงกับที่ตัดจริงในอีก 3 วัน
       */
      const couponLine = await this.couponLineFor(sub, target, gross);

      try {
        await this.prisma.notification.create({
          data: {
            userId: sub.buyerId,
            type: 'upcoming_cycle',
            title: `อีก ${NOTICE_DAYS} วันถึงรอบส่ง`,
            body: `${sub.plan.product.name} — ตัดเงินจำลอง ${couponLine.amountText} · ข้ามรอบได้ถึงวันที่ ${toISODate(addDays(target, -1))}${couponLine.suffix}`,
            linkPath,
          },
        });
        created++;
      } catch (e) {
        // ชน `notifications_upcoming_cycle_once` = แจ้งรอบนี้ไปแล้ว
        // (ให้ index เป็นคนตัดสิน ไม่ใช่ SELECT ก่อนหน้า — cron ตี 1 ชนกับ
        // admin กดปุ่ม Run now เมื่อไหร่ การเช็คก่อนเขียนจะผ่านทั้งคู่)
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          continue;
        }
        throw e;
      }
    }
    return created;
  }

  /**
   * ข้อความส่วนของคูปองในแจ้งเตือน T-3 (feature 18)
   *
   * 3 กรณี: จองไว้แล้ว (โชว์ยอดหลังลด) · ยังไม่จองแต่มีใบที่ใช้ได้ (ชวนให้ไปกด) ·
   * ไม่มีคูปองเลย (ข้อความเดิมไม่เปลี่ยน)
   */
  private async couponLineFor(
    sub: { id: string; buyerId: string; plan: { product: { id: string } } },
    cycleDate: Date,
    gross: Prisma.Decimal,
  ): Promise<{ amountText: string; suffix: string }> {
    const plain = { amountText: `฿${gross.toFixed(2)}`, suffix: '' };

    const held = await this.prisma.couponRedemption.findMany({
      where: { subscriptionId: sub.id, cycleDate, status: 'reserved' },
      select: {
        tier: true,
        discountType: true,
        discountValue: true,
        maxDiscountAmount: true,
        minOrderAmount: true,
        coupon: { select: { code: true } },
      },
    });

    if (held.length > 0) {
      const of = (tier: 'platform' | 'shop'): Prisma.Decimal | null => {
        const row = held.find((h) => h.tier === tier);
        if (row === undefined) return null;
        const calc = computeDiscount(gross, row);
        return calc.ok ? calc.discount : null;
      };
      // ★ รวมสองระดับด้วยสูตรเดียวกับตอนตัดเงินจริง ★ ถ้าคิดคนละสูตร
      // เลขบนแจ้งเตือนจะไม่ตรงกับที่ถูกตัดในอีก 3 วัน
      const combined = combineDiscounts(gross, of('platform'), of('shop'));
      if (combined.total.lte(0)) return plain;
      const codes = held.map((h) => h.coupon.code).join(' + ');
      return {
        amountText: `฿${combined.net.toFixed(2)}`,
        suffix: ` · ใช้คูปอง ${codes} ลด ฿${combined.total.toFixed(2)}`,
      };
    }

    // ยังไม่จอง — ดูแค่ว่ามีใบที่ยังไม่เคยใช้และครอบสินค้านี้อยู่ไหม
    // (ไม่ต้องคำนวณทุกใบ — แค่ชวนให้ไปกด)
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: sub.plan.product.id },
      select: { id: true, shopId: true, couponPolicy: true },
    });
    if (product.couponPolicy === 'none') return plain;

    const now = new Date();
    const usable = await this.prisma.coupon.count({
      where: {
        isActive: true,
        startsAt: { lte: now },
        endsAt: { gte: now },
        ...(product.couponPolicy === 'both'
          ? {}
          : {
              tier:
                product.couponPolicy === 'platform_only' ? 'platform' : 'shop',
            }),
        OR: [
          { products: { some: { productId: product.id } } },
          { tier: 'shop', appliesToAllProducts: true, shopId: product.shopId },
        ],
        redemptions: {
          none: {
            buyerId: sub.buyerId,
            status: { in: ['reserved', 'consumed'] },
          },
        },
      },
    });
    return usable === 0
      ? plain
      : {
          ...plain,
          suffix: ' · มีคูปองใช้ได้กับรอบนี้ กดดูในหน้ารายการของฉัน',
        };
  }

  /** งานที่ 2 — สร้างออเดอร์ + ตัดเงินจำลอง + เลื่อนรอบ (ทีละรายการ ทรานแซกชันละ 1 sub) */
  private async createDueOrders(runDate: Date): Promise<{
    due: number;
    created: number;
    unpaid: number;
    skipped: number;
    failed: number;
    perShop: Map<string, number>;
  }> {
    const due = await this.dueSubscriptions(runDate);
    const perShop = new Map<string, number>();
    let created = 0;
    let unpaid = 0;
    let skipped = 0;
    let failed = 0;

    for (const sub of due) {
      // แยกทรานแซกชันต่อรายการโดยตั้งใจ: sub ที่มีปัญหา 1 รายการต้องไม่ทำให้
      // ทั้งรอบล้ม (ถ้ามัดรวมก้อนเดียว ออเดอร์ของคนอื่นจะหายไปด้วย)
      const outcome = await this.createOneOrder(sub, runDate);
      if (outcome === 'created') {
        created++;
        const owner = sub.plan.product.shop.ownerId;
        perShop.set(owner, (perShop.get(owner) ?? 0) + 1);
      } else if (outcome === 'unpaid') {
        // ★ ไม่เข้า perShop ★ ร้านยังไม่ต้องรู้จักออเดอร์ที่ยังไม่ได้เงิน
        // (ไม่งั้นร้านจัดของให้ออเดอร์ที่อาจไม่มีวันถูกจ่าย)
        created++;
        unpaid++;
      } else if (outcome === 'skipped') {
        skipped++;
      } else {
        failed++;
      }
    }

    return { due: due.length, created, unpaid, skipped, failed, perShop };
  }

  private async createOneOrder(
    sub: DueSubscription,
    runDate: Date,
  ): Promise<OrderOutcome> {
    const cycleDate = sub.nextOrderDate;
    if (!cycleDate || !isCycle(sub.plan.cycle)) return 'failed';

    // รอบถัดไปคิดจากหมุดเสมอ และต้องพ้นวันที่รันไปแล้ว — กรณีเก็บตกหลัง cron
    // หยุดไปหลายเดือน จะได้ออเดอร์ค้าง 1 ใบแล้วเดินต่อจากปัจจุบัน ไม่ใช่ไล่
    // สร้างย้อนหลังทุกงวด (ผู้ซื้อไม่ควรถูกตัดเงินรัว — ตัดสินใจนี้อยู่ในเล่ม)
    const nextOrderDate = nextCycleAfter(
      sub.cycleAnchorDate,
      sub.plan.cycle,
      runDate,
    );
    const gross = grossAmount(sub.plan.pricePerCycle, sub.quantity);

    let outcome: 'created' | 'unpaid' = 'created';

    try {
      await this.prisma.$transaction(async (tx) => {
        /**
         * ใช้คูปองที่ผู้ซื้อจองไว้กับรอบนี้ (feature 18 · W13 Flow D)
         *
         * อยู่ในทรานแซกชันเดียวกับการสร้างออเดอร์โดยตั้งใจ — รันซ้ำวันเดิมจะชน
         * `UNIQUE(subscription_id, cycle_date)` แล้ว rollback ทั้งก้อน คูปองจึง
         * ถูกใช้ได้ครั้งเดียวโดยไม่ต้องมีกลไกกันซ้ำของตัวเอง (กฎข้อ 5)
         */
        const used = await this.coupons.consumeForCycle(tx, {
          subscriptionId: sub.id,
          cycleDate,
          gross,
        });
        const amount = used.net;

        const order = await tx.order.create({
          data: {
            subscriptionId: sub.id,
            buyerId: sub.buyerId,
            cycleDate,
            status: 'pending',
            amount,
            quantity: sub.quantity,
            // ★ ส่วนลดรวมของทั้งสองระดับ ★ กฎการหนีบเมื่อรวมเกินยอดอยู่ใน
            // `combineDiscounts()` — ที่นี่แค่บันทึกผลที่คิดมาแล้ว
            discountAmount: used.discount,
            platformRedemptionId: used.platform?.redemptionId ?? null,
            shopRedemptionId: used.shop?.redemptionId ?? null,
            addressSnapshot: {
              recipient_name: sub.address.recipientName,
              phone: sub.address.phone,
              address_line: sub.address.addressLine,
              province: sub.address.province,
              postcode: sub.address.postcode,
            },
          },
        });

        /**
         * ตัดเงิน (จำลอง) ผ่าน `PaymentProvider` — ดูเหตุผลที่ต้องผ่าน interface
         * ใน `src/payments/payment.provider.ts`
         *
         * ต่างจาก checkout: รอบถัดไปที่จ่ายไม่ผ่าน **ต้องไม่ rollback ออเดอร์ทิ้ง**
         * เพราะรอบนั้นเกิดขึ้นจริงตามกำหนดแล้ว ผู้ซื้อต้องเห็นมันเพื่อกดจ่ายซ้ำได้
         * (ถ้าลบทิ้ง `next_order_date` จะเลื่อนไปเงียบ ๆ = รอบนั้นหายไปทั้งรอบ)
         */
        const charge = await this.payments.charge({
          orderId: order.id,
          amount: amount.toNumber(),
          card: sub.paymentMethod,
        });
        const declined = charge.status === 'failed';

        await tx.payment.create({
          data: {
            orderId: order.id,
            amount,
            status: declined ? 'failed' : 'paid',
            paidAt: declined ? null : new Date(),
          },
        });

        // เงื่อนไขอยู่ใน where: ถ้าผู้ใช้กด skip/pause ระหว่างที่ engine กำลังทำงาน
        // อยู่ แถวจะไม่ตรงแล้ว count = 0 → โยนเพื่อ rollback ทั้งก้อน
        const moved = await tx.subscription.updateMany({
          where: { id: sub.id, status: 'active', nextOrderDate: cycleDate },
          data: { nextOrderDate },
        });
        if (moved.count === 0) {
          throw new Error('subscription เปลี่ยนสถานะระหว่างสร้างออเดอร์');
        }

        /**
         * เก็บกวาดใบจองที่ค้างอยู่กับรอบที่ผ่านไปแล้ว — ปิดช่องแคบ ๆ ที่การจองไป
         * commit หลัง engine พอดี ทำให้ใบนั้นผูกอยู่กับรอบที่ไม่มีวันถูกใช้
         * ถ้าไม่มีตรงนี้ โควตาของคูปองจะรั่วไปเรื่อย ๆ โดยไม่มีใครทัก
         */
        await this.coupons.releaseStaleReservations(tx, {
          subscriptionId: sub.id,
          before: nextOrderDate,
        });

        // ระบุโค้ดที่ใช้ให้ครบทั้งสองระดับ — ผู้ซื้อต้องกระทบยอดเองได้จากแจ้งเตือน
        const usedCodes = [used.platform, used.shop]
          .filter((t) => t !== null)
          .map((t) => t.couponCode);
        const savedText =
          usedCodes.length === 0
            ? ''
            : ` (คูปอง ${usedCodes.join(' + ')} ลด ฿${used.discount.toFixed(2)})`;

        await tx.notification.create({
          data: {
            userId: sub.buyerId,
            type: 'order_created',
            title: declined
              ? 'ตัดเงินรอบนี้ไม่สำเร็จ'
              : 'สร้างออเดอร์รอบใหม่แล้ว',
            body: declined
              ? `${sub.plan.product.name} — ${charge.failureReason ?? 'บัตรถูกปฏิเสธ'} · กดจ่ายอีกครั้งได้ที่หน้าออเดอร์`
              : `${sub.plan.product.name} — ตัดเงินจำลอง ฿${amount.toFixed(2)}${savedText}`,
            linkPath: declined
              ? `/orders/${order.id}`
              : `/subscriptions/${sub.id}`,
          },
        });

        // คูปองใช้ไม่ได้แล้วตอนตัดเงินจริง (ร้านลดราคาจนต่ำกว่าขั้นต่ำ) — คืนให้
        // แล้วบอกผู้ซื้อ ไม่ใช่ให้คูปองหายไปเงียบ ๆ พร้อมยอดที่ตัดเต็ม
        if (used.releasedCodes.length > 0) {
          await tx.notification.create({
            data: {
              userId: sub.buyerId,
              type: 'coupon_released',
              title: 'คูปองถูกคืนแล้ว',
              body: `${sub.plan.product.name} — ยอดรอบนี้ไม่ถึงขั้นต่ำของคูปอง ${used.releasedCodes.join(' และ ')} ระบบคืนคูปองให้แล้ว ใช้กับรอบหน้าได้`,
              linkPath: `/subscriptions/${sub.id}`,
            },
          });
        }

        for (const tier of ['platform', 'shop'] as const) {
          const hit = used[tier];
          if (hit === null) continue;
          await tx.subscriptionEvent.create({
            data: {
              subscriptionId: sub.id,
              event: 'coupon_applied',
              detail: {
                coupon_code: hit.couponCode,
                tier,
                cycle_date: toISODate(cycleDate),
                discount_amount: hit.discount.toNumber(),
              },
            },
          });
        }

        outcome = declined ? 'unpaid' : 'created';
      });
      return outcome;
    } catch (e) {
      // ★ ชน UNIQUE(subscription_id, cycle_date) = รอบนี้สร้างไปแล้ว ★
      // นี่คือกลไก idempotency ทั้งหมดของ engine: ไม่ใช่ความผิดพลาด และ
      // เพราะอยู่ในทรานแซกชันเดียวกัน `next_order_date` ก็ไม่ถูกเลื่อนตามไปด้วย
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return 'skipped';
      }
      this.logger.error(
        `สร้างออเดอร์ของ subscription ${sub.id} ไม่สำเร็จ: ${String(e)}`,
      );
      return 'failed';
    }
  }

  /** งานที่ 3 — สรุปให้ร้านเป็นก้อนเดียว ไม่ใช่แจ้งทีละออเดอร์จนกล่องแจ้งเตือนล้น */
  private async summariseForShops(
    perShop: Map<string, number>,
  ): Promise<number> {
    if (perShop.size === 0) return 0;

    await this.prisma.notification.createMany({
      data: [...perShop].map(([ownerId, count]) => ({
        userId: ownerId,
        type: 'engine_summary' as const,
        title: 'ออเดอร์ใหม่ประจำวัน',
        body: `วันนี้มีออเดอร์ใหม่ ${count} รายการ`,
        linkPath: SELLER_ORDERS_LINK,
      })),
    });
    return perShop.size;
  }

  /**
   * ★ ด่านของ time-travel ★ role admin อย่างเดียวไม่พอ
   *
   * การส่ง `runDate` เองคือการสั่งให้ระบบเขียนข้อมูลด้วยวันที่ที่ไม่ใช่วันจริง
   * (สร้างออเดอร์ + ตัดเงินจำลองย้อนหลัง) บนเครื่องจริงจึงต้องปิดตายไว้
   * แม้บัญชี admin จะถูกขโมยไปก็ยังทำไม่ได้ ต้องเข้าถึง env ของเซิร์ฟเวอร์ด้วย
   */
  private resolveRunDate(raw?: string | null): Date {
    // `== null` ครอบทั้ง undefined และ null — client ที่ส่ง `runDate: null`
    // มาแปลว่า "ไม่ระบุ" ไม่ใช่ "ขอ time-travel" (จะได้ไม่โดน 403 แบบงง ๆ)
    if (raw == null) return todayInBangkok();

    // อ่านจาก process.env ตอนเรียกจริง ไม่ใช่ผ่าน ConfigService — รูปแบบเดียวกับ
    // AppThrottlerGuard เพราะ `ConfigModule.forRoot()` ถูก evaluate ครั้งเดียว
    // ตอนโหลด AppModule ค่าที่ ConfigService ถืออยู่จึงแช่แข็งตั้งแต่บูต และเทส
    // ที่ต้องพิสูจน์ว่า "ปิดสวิตช์แล้วใช้ไม่ได้จริง" จะสลับค่าไม่ได้เลย
    // (ค่าที่หายไป/สะกดผิด = ปิด — fail closed)
    const demoMode = process.env.DEMO_MODE === 'true';
    const env = process.env.NODE_ENV ?? '';
    if (!demoMode || !TIME_TRAVEL_ENVS.includes(env)) {
      throw AppError.forbidden(
        'TIME_TRAVEL_DISABLED',
        'ระบุวันที่จำลองได้เฉพาะเครื่องเดโม่เท่านั้น',
      );
    }

    const parsed = tryParseISODate(raw);
    if (!parsed) throw AppError.badRequest('INVALID_DATE', 'วันที่ไม่ถูกต้อง');

    const offset = Math.abs(daysUntil(parsed, todayInBangkok()));
    if (offset > MAX_TRAVEL_DAYS) {
      throw AppError.unprocessable(
        'RUN_DATE_OUT_OF_RANGE',
        `จำลองวันที่ได้ในช่วง ±${MAX_TRAVEL_DAYS} วันจากวันนี้`,
      );
    }
    return parsed;
  }

  /**
   * งานที่ 4 — ปิดออเดอร์ที่ส่งไปแล้วเกิน 7 วันและไม่มีใครทักท้วง (feature 16)
   *
   * ★ ไม่แตะ `confirmedAt` เด็ดขาด ★ นั่นคือช่องของ "ผู้ซื้อยืนยันเอง" เท่านั้น
   * ถ้าระบบเผลอไปตั้งให้ ตัวเลข "อัตราที่ผู้ซื้อยืนยันรับของเอง" ที่จะเขียนในเล่ม
   * จะกลายเป็น 100% ทุกกรณีและไม่มีความหมายอีกต่อไป
   *
   * ออเดอร์ที่มีเคสปัญหาเปิดค้างอยู่จะไม่ถูกปิด — เรื่องยังไม่จบ
   */
  private async autoCloseShippedOrders(runDate: Date): Promise<number> {
    const cutoff = addDays(runDate, -AUTO_CONFIRM_DAYS);

    const stale = await this.prisma.order.findMany({
      where: {
        status: 'shipped',
        // นับจากวันที่ของออกจากร้านจริง ไม่ใช่วันตัดรอบ — ร้านที่ส่งช้าไม่ควร
        // ทำให้ออเดอร์ถูกปิดก่อนของถึงมือผู้ซื้อ
        shippedAt: { lte: cutoff },
        // ข้ามเฉพาะใบที่ยัง "เถียงกันอยู่" — เคสที่ร้านปิดไปแล้วต้องเดินต่อได้
        // ไม่งั้นออเดอร์ที่ผู้ซื้อไม่กลับมากดจะค้าง `shipped` ตลอดกาล
        // ซึ่งคือปัญหาเดียวกับที่ feature 15/16 ตั้งใจปิด (W11 Postcondition)
        OR: [{ issue: { is: null } }, { issue: { status: { not: 'open' } } }],
      },
      select: {
        id: true,
        buyerId: true,
        subscription: {
          select: { plan: { select: { product: { select: { name: true } } } } },
        },
      },
      take: 500,
    });

    let closed = 0;
    for (const order of stale) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const updated = await tx.order.updateMany({
            // สถานะเดิมอยู่ใน where: ผู้ซื้อกดยืนยันเองระหว่างนี้ก็ปล่อยให้เขาชนะ
            where: { id: order.id, status: 'shipped' },
            data: { status: 'delivered' },
          });
          if (updated.count === 0) return;

          await tx.notification.create({
            data: {
              userId: order.buyerId,
              type: 'order_status',
              title: 'ปิดออเดอร์อัตโนมัติ',
              body: `${order.subscription.plan.product.name} — ส่งเกิน ${AUTO_CONFIRM_DAYS} วันแล้วไม่มีการแจ้งปัญหา ระบบจึงปิดรอบนี้ให้`,
              linkPath: `/orders/${order.id}`,
            },
          });
          closed++;
        });
      } catch (e) {
        this.logger.error(
          `ปิดออเดอร์ ${order.id} อัตโนมัติไม่สำเร็จ: ${String(e)}`,
        );
      }
    }
    return closed;
  }

  /**
   * งานที่ 5 — เก็บกวาด token ที่หมดอายุแล้ว (refresh + ตั๋วรีเซ็ตรหัสผ่าน)
   *
   * สองตารางนี้โตขึ้นทุกครั้งที่มีคนล็อกอิน/หมุน token/กดลืมรหัสผ่าน และไม่มีใคร
   * ลบให้เลย · ใบที่หมดอายุแล้วใช้แลกอะไรไม่ได้อีก การเก็บไว้จึงมีแต่ข้อเสีย
   * (ยิ่งเป็นตั๋วรีเซ็ต ยิ่งไม่ควรค้าง — มันคือกุญแจของบัญชีที่ไม่มีวันได้ใช้แล้ว)
   */
  private async purgeExpiredTokens(): Promise<number> {
    const cutoff = new Date();
    const [refresh, resets] = await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: cutoff } },
      }),
      this.prisma.passwordResetToken.deleteMany({
        where: { expiresAt: { lt: cutoff } },
      }),
    ]);
    return refresh.count + resets.count;
  }
}

/** อ่านคอลัมน์ jsonb ทีละฟิลด์ที่ประกาศไว้ — ของแปลกปลอมใน detail ไม่หลุดออก API */
function toRunDetail(raw: Prisma.JsonValue | null): EngineRunDetail {
  const source: Record<string, unknown> =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const num = (key: keyof EngineRunDetail): number =>
    typeof source[key] === 'number' ? source[key] : 0;

  return {
    due: num('due'),
    skipped: num('skipped'),
    upcoming: num('upcoming'),
    shopsNotified: num('shopsNotified'),
    tokensPurged: num('tokensPurged'),
    autoConfirmed: num('autoConfirmed'),
    paymentsFailed: num('paymentsFailed'),
    failed: num('failed'),
    autoResumed: num('autoResumed'),
  };
}
