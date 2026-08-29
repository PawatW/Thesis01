import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import {
  addDays,
  isCycle,
  nextCycleAfter,
  toISODate,
  todayInBangkok,
} from '../common/date';
import { BILLABLE_PRODUCT } from '../catalog/catalog.service';
import { AppError } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ForecastResponse,
  SellerIssueResponse,
  SellerOrderResponse,
} from './dto/seller-order.dto';
import { ShopService } from './shop.service';

/** ลำดับสถานะเดียวของระบบ — ไม่มีทางลัด (W08 E1) */
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: 'preparing',
  preparing: 'shipped',
  shipped: 'delivered',
};

const STATUS_MESSAGE: Record<string, string> = {
  preparing: 'ร้านเริ่มจัดของแล้ว',
  shipped: 'พัสดุออกจากร้านแล้ว',
  delivered: 'จัดส่งสำเร็จ',
};

/** ช่วงเวลาของ forecast ที่เปิดให้เลือก — กันขอ 3650 วันแล้วกวาดทั้งตาราง */
const FORECAST_DAYS = [7, 14, 30];

/** เพดานแถวของ forecast (B-11) — ร้านในเดโม่มีสมาชิกหลักสิบ */
const MAX_FORECAST_SUBSCRIPTIONS = 2000;

/** เพดานแถวของรายการออเดอร์ต่อแท็บ (B-11) */
const MAX_ORDERS = 200;

/** 30 วัน / รอบ 2 สัปดาห์ = 3 รอบ · เผื่อไว้กันลูปไม่รู้จบถ้าข้อมูลเพี้ยน */
const MAX_CYCLES_PER_SUBSCRIPTION = 5;

/** ออเดอร์ที่ร้านยังต้องส่งให้จบ — เห็นที่อยู่ผู้รับได้แม้ร้านถูกระงับ */
const FULFILLABLE: OrderStatus[] = ['pending', 'preparing', 'shipped'];

/**
 * ยกเลิกได้ก่อนของออกจากร้านเท่านั้น (feature 15)
 * ของที่ `shipped` ไปแล้วต้องใช้ flow คืนสินค้า ซึ่งอยู่นอก scope ของเล่มนี้
 */
const CANCELLABLE: OrderStatus[] = ['pending', 'preparing'];

/** เพดานแถวของเคสปัญหา (B-11) */
const MAX_ISSUES = 200;

const ISSUE_INCLUDE = {
  order: {
    select: {
      id: true,
      cycleDate: true,
      addressSnapshot: true,
      subscription: {
        select: { plan: { select: { product: { select: { name: true } } } } },
      },
    },
  },
} satisfies Prisma.OrderIssueInclude;

type IssueRow = Prisma.OrderIssueGetPayload<{ include: typeof ISSUE_INCLUDE }>;

const ORDER_INCLUDE = {
  subscription: {
    select: {
      quantity: true,
      status: true,
      plan: {
        select: {
          cycle: true,
          product: { select: { id: true, name: true, images: true } },
        },
      },
    },
  },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

@Injectable()
export class SellerOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shops: ShopService,
  ) {}

  /**
   * ออเดอร์ของร้านตัวเองเท่านั้น
   *
   * ownership อยู่ใน `where` ผ่านความสัมพันธ์ 4 ชั้น (order → subscription → plan
   * → product → shop.ownerId) — ไม่มีการรับ `shopId` จาก client ที่ไหนเลย
   */
  async list(
    userId: string,
    tab: 'open' | 'shipped' | 'history' = 'open',
  ): Promise<SellerOrderResponse[]> {
    const shop = await this.shops.requireShop(userId);

    const status: OrderStatus[] =
      tab === 'open'
        ? ['pending', 'preparing']
        : tab === 'shipped'
          ? ['shipped']
          : ['delivered', 'cancelled'];

    const rows = await this.prisma.order.findMany({
      where: {
        status: { in: status },
        ...this.ofMyShop(userId),
        ...this.PAID_ONLY,
      },
      include: ORDER_INCLUDE,
      // ค้างส่งเรียงเก่าสุดก่อน (ของที่ค้างนานต้องเด่น) · ประวัติเรียงใหม่สุดก่อน
      orderBy: { cycleDate: tab === 'history' ? 'desc' : 'asc' },
      take: MAX_ORDERS,
    });
    return rows.map((row) => toSellerOrder(row, shop.suspendedAt !== null));
  }

  async findOne(userId: string, id: string): Promise<SellerOrderResponse> {
    const shop = await this.shops.requireShop(userId);
    const row = await this.prisma.order.findFirst({
      where: { id, ...this.ofMyShop(userId), ...this.PAID_ONLY },
      include: ORDER_INCLUDE,
    });
    if (!row) throw AppError.notFound('ORDER_NOT_FOUND', 'ไม่พบออเดอร์นี้');
    return toSellerOrder(row, shop.suspendedAt !== null);
  }

  /**
   * เลื่อนไปสถานะถัดไปทีละขั้น + แจ้งผู้ซื้อในทรานแซกชันเดียวกัน
   *
   * `status: current` อยู่ใน where ของคำสั่งเขียน → พนักงาน 2 คนกดพร้อมกัน
   * คนที่สองได้ 409 ไม่ใช่ข้ามไป 2 ขั้น (feature 12 · Validation)
   */
  async advance(
    userId: string,
    id: string,
    trackingNote?: string,
  ): Promise<SellerOrderResponse> {
    // ★ ใช้ requireShop ไม่ใช่ requireOperableShop โดยตั้งใจ ★
    // ร้านที่ถูกระงับ "ห้ามรับเงินใหม่" (engine ข้ามให้แล้ว) แต่ของที่ผู้ซื้อ
    // จ่ายไปก่อนหน้าต้องส่งให้จบ — ไม่งั้นออเดอร์ที่จ่ายแล้วค้าง `pending` ถาวร
    // โดยที่ผู้ซื้อไม่มีทางได้ของและยังไม่มีช่องทางขอคืนเงิน (feature 15 · Phase 4.5)
    await this.shops.requireShop(userId);

    const order = await this.prisma.order.findFirst({
      // ★ `PAID_ONLY` อยู่ใน where ด้วย ★ ออเดอร์ที่ยังจ่ายไม่สำเร็จตอบ 404
      // เหมือนไม่มีอยู่ — กฎอยู่ที่ service ไม่ใช่แค่ที่การซ่อนในรายการ
      where: { id, ...this.ofMyShop(userId), ...this.PAID_ONLY },
      select: {
        id: true,
        status: true,
        buyerId: true,
        subscription: {
          select: { plan: { select: { product: { select: { name: true } } } } },
        },
      },
    });
    if (!order) throw AppError.notFound('ORDER_NOT_FOUND', 'ไม่พบออเดอร์นี้');

    const next = NEXT_STATUS[order.status];
    if (!next) {
      throw AppError.conflict(
        order.status === 'cancelled' ? 'ORDER_CANCELLED' : 'ORDER_COMPLETED',
        order.status === 'cancelled'
          ? 'ออเดอร์นี้ถูกยกเลิกแล้ว'
          : 'ออเดอร์นี้ส่งถึงมือผู้ซื้อแล้ว ไม่มีขั้นถัดไป',
      );
    }
    if (trackingNote !== undefined && next !== 'shipped') {
      throw AppError.unprocessable(
        'TRACKING_NOTE_NOT_ALLOWED',
        'กรอกเลขพัสดุได้เฉพาะตอนเปลี่ยนสถานะเป็น "ส่งแล้ว"',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id, status: order.status, ...this.ofMyShop(userId) },
        data: {
          status: next,
          // เวลาที่ของออกจากร้านจริง — engine ใช้ตัวนี้นับ 7 วันก่อนปิดออเดอร์ให้
          ...(next === 'shipped' ? { shippedAt: new Date() } : {}),
          ...(trackingNote === undefined ? {} : { trackingNote }),
        },
      });
      if (updated.count === 0) {
        throw AppError.conflict(
          'ORDER_CHANGED',
          'ออเดอร์นี้เพิ่งเปลี่ยนสถานะไปแล้ว กรุณารีเฟรชหน้าจอ',
        );
      }

      await tx.notification.create({
        data: {
          userId: order.buyerId,
          type: 'order_status',
          title: STATUS_MESSAGE[next] ?? 'สถานะออเดอร์เปลี่ยนแปลง',
          body:
            next === 'shipped' && trackingNote
              ? `${order.subscription.plan.product.name} — เลขพัสดุ ${trackingNote}`
              : order.subscription.plan.product.name,
          linkPath: `/orders/${order.id}`,
        },
      });
    });

    return this.findOne(userId, id);
  }

  /**
   * ออเดอร์ล่วงหน้า — จุดขายฝั่งร้าน: รู้ก่อนว่ารอบหน้าต้องเตรียมของเท่าไหร่
   *
   * **aggregate ล้วน** ไม่มีรายชื่อผู้ซื้อ เพราะร้านยังไม่ต้องส่งของให้ใครในอนาคต
   * (data minimization — ร้านเห็นชื่อ/ที่อยู่ก็ต่อเมื่อออเดอร์เกิดจริงแล้ว)
   */
  async forecast(userId: string, days: number): Promise<ForecastResponse> {
    const shop = await this.shops.requireShop(userId);
    if (!FORECAST_DAYS.includes(days)) {
      throw AppError.badRequest(
        'INVALID_RANGE',
        `เลือกช่วงได้เฉพาะ ${FORECAST_DAYS.join(' / ')} วัน`,
      );
    }

    const today = todayInBangkok();
    const until = addDays(today, days);

    const subs = await this.prisma.subscription.findMany({
      where: {
        status: 'active',
        nextOrderDate: { lte: until },
        // ★ ตัวกรองเดียวกับ engine ★ ร้าน/สินค้าที่ถูกระงับไม่มีออเดอร์เกิดจริง
        // จึงต้องไม่โผล่ในตัวเลขที่ร้านเอาไปวางแผนสต๊อก (BILLABLE_PRODUCT)
        plan: { product: { shopId: shop.id, ...BILLABLE_PRODUCT } },
      },
      select: {
        quantity: true,
        nextOrderDate: true,
        cycleAnchorDate: true,
        plan: {
          select: {
            cycle: true,
            pricePerCycle: true,
            qtyPerCycle: true,
            product: { select: { id: true, name: true } },
          },
        },
      },
      take: MAX_FORECAST_SUBSCRIPTIONS,
    });

    const byProduct = new Map<string, ForecastResponse['items'][number]>();
    for (const sub of subs) {
      const plan = sub.plan;
      const product = plan.product;
      if (!isCycle(plan.cycle) || sub.nextOrderDate === null) continue;

      // ★ นับ "จำนวนรอบที่จะเกิดในช่วงนี้" ไม่ใช่ "จำนวนสมาชิก" ★
      // สมาชิกรอบ 2 สัปดาห์ในช่วง 30 วันเกิดออเดอร์ 2-3 ใบ — ถ้านับหัวละ 1
      // ร้านจะเตรียมของขาดครึ่ง (ตัวอย่างใน W08 จงใจให้ออเดอร์ ≠ จำนวนสมาชิก)
      let occurrences = 0;
      let cycleDate = sub.nextOrderDate;
      while (cycleDate <= until && occurrences < MAX_CYCLES_PER_SUBSCRIPTION) {
        occurrences++;
        cycleDate = nextCycleAfter(sub.cycleAnchorDate, plan.cycle, cycleDate);
      }
      if (occurrences === 0) continue;

      const row = byProduct.get(product.id) ?? {
        productId: product.id,
        productName: product.name,
        ordersCount: 0,
        units: 0,
        revenue: 0,
      };
      row.ordersCount += occurrences;
      row.units += sub.quantity * plan.qtyPerCycle * occurrences;
      row.revenue += plan.pricePerCycle.toNumber() * sub.quantity * occurrences;
      byProduct.set(product.id, row);
    }

    return {
      days,
      approximate: true,
      items: [...byProduct.values()]
        .map((r) => ({ ...r, revenue: Math.round(r.revenue * 100) / 100 }))
        .sort((a, b) => b.ordersCount - a.ordersCount),
    };
  }

  /**
   * ยกเลิกออเดอร์ที่ส่งไม่ได้ + คืนเงินจำลอง (feature 15 · W11 Flow A)
   *
   * ★ ทั้งหมดอยู่ในทรานแซกชันเดียว ★ ยกเลิกแล้วคืนเงินไม่สำเร็จต้องไม่เกิดขึ้นเลย —
   * ไม่งั้นผู้ซื้อเสียเงินให้ของที่ไม่ได้รับ ซึ่งเป็นสถานะที่ระบบไม่มีทางออกให้
   *
   * **ไม่แตะ subscription** — ปัญหาสต๊อกรอบเดียวไม่ควรทำให้ผู้ใช้เสีย subscription
   * ทั้งสาย รอบถัดไปยังเดินตามกำหนดเดิม (เจตนาที่เขียนไว้ในสเปก)
   */
  async cancel(
    userId: string,
    id: string,
    reason: string,
  ): Promise<SellerOrderResponse> {
    // ร้านที่ถูกระงับก็ยกเลิก+คืนเงินได้ — เป็นทางออกให้ผู้ซื้อ ไม่ใช่การรับเงินใหม่
    await this.shops.requireShop(userId);

    const order = await this.prisma.order.findFirst({
      where: { id, ...this.ofMyShop(userId) },
      select: {
        id: true,
        status: true,
        buyerId: true,
        amount: true,
        subscriptionId: true,
        payment: { select: { id: true, status: true } },
        subscription: {
          select: { plan: { select: { product: { select: { name: true } } } } },
        },
      },
    });
    if (!order) throw AppError.notFound('ORDER_NOT_FOUND', 'ไม่พบออเดอร์นี้');

    if (!CANCELLABLE.includes(order.status)) {
      throw AppError.conflict(
        'ORDER_NOT_CANCELLABLE',
        order.status === 'cancelled'
          ? 'ออเดอร์นี้ถูกยกเลิกไปแล้ว'
          : 'ยกเลิกได้ก่อนส่งของเท่านั้น — ของที่ส่งออกไปแล้วต้องคุยกับผู้ซื้อผ่านเคสปัญหา',
      );
    }

    const cancelledAt = new Date();
    // ★ ข้อความเรื่องเงินต้องตรงกับสิ่งที่เกิดขึ้นจริง ★ ออเดอร์ที่จ่ายไม่สำเร็จ
    // (เฟส 5) ไม่มีอะไรให้คืน — บอกว่า "คืนเงินแล้ว" คือโกหกผู้ซื้อเรื่องเงิน
    const refundPaymentId =
      order.payment?.status === 'paid' ? order.payment.id : null;
    const refundText =
      refundPaymentId === null
        ? 'รอบนี้ไม่มีการเรียกเก็บเงิน'
        : `คืนเงินจำลอง ฿${order.amount.toFixed(2)} แล้ว`;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id, status: order.status, ...this.ofMyShop(userId) },
        data: { status: 'cancelled', cancelledAt, cancelReason: reason },
      });
      if (updated.count === 0) {
        throw AppError.conflict(
          'ORDER_CHANGED',
          'ออเดอร์นี้เพิ่งเปลี่ยนสถานะไปแล้ว กรุณารีเฟรชหน้าจอ',
        );
      }

      // คืนเงินเฉพาะที่จ่ายสำเร็จจริง — payment ที่ `failed` ไว้ (เฟส 5) ให้ข้ามไป
      // ไม่ใช่ error (CHECK `payments_refund_consistent` บังคับให้ต้องมี refundedAt)
      if (refundPaymentId !== null) {
        await tx.payment.update({
          where: { id: refundPaymentId },
          data: { status: 'refunded', refundedAt: cancelledAt },
        });
      }

      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: order.subscriptionId,
          event: 'order_cancelled',
          detail: { reason, amount: order.amount.toNumber() },
        },
      });
      await tx.notification.create({
        data: {
          userId: order.buyerId,
          type: 'order_status',
          title: 'ร้านยกเลิกออเดอร์รอบนี้',
          body: `${order.subscription.plan.product.name} — ${reason} · ${refundText} รอบถัดไปยังเดินตามปกติ`,
          linkPath: `/orders/${order.id}`,
        },
      });
    });

    return this.findOne(userId, id);
  }

  /** เคสปัญหาของร้านตัวเอง — ownership ผ่านความสัมพันธ์เหมือนออเดอร์ */
  async listIssues(
    userId: string,
    status: 'open' | 'closed' = 'open',
  ): Promise<SellerIssueResponse[]> {
    await this.shops.requireShop(userId);

    const rows = await this.prisma.orderIssue.findMany({
      where: {
        status: status === 'open' ? 'open' : { in: ['resolved', 'rejected'] },
        order: this.ofMyShop(userId),
      },
      include: ISSUE_INCLUDE,
      orderBy: { createdAt: 'asc' },
      take: MAX_ISSUES,
    });
    return rows.map(toSellerIssue);
  }

  /**
   * ตอบและปิดเคส — ปิดแล้วเปิดซ้ำไม่ได้ (`status: 'open'` อยู่ใน where)
   *
   * ผู้ซื้อต้องได้รับแจ้งพร้อมหมายเหตุ ไม่ใช่เห็นเคสปิดเงียบ ๆ (W11 Flow C)
   */
  async resolveIssue(
    userId: string,
    issueId: string,
    input: { status: 'resolved' | 'rejected'; note: string },
  ): Promise<SellerIssueResponse> {
    await this.shops.requireShop(userId);

    const issue = await this.prisma.orderIssue.findFirst({
      where: { id: issueId, order: this.ofMyShop(userId) },
      select: {
        id: true,
        status: true,
        reporterId: true,
        order: {
          select: {
            id: true,
            subscription: {
              select: {
                plan: { select: { product: { select: { name: true } } } },
              },
            },
          },
        },
      },
    });
    if (!issue) throw AppError.notFound('ISSUE_NOT_FOUND', 'ไม่พบเคสนี้');
    if (issue.status !== 'open') {
      throw AppError.conflict('ISSUE_CLOSED', 'เคสนี้ปิดไปแล้ว');
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.orderIssue.updateMany({
        where: { id: issueId, status: 'open' },
        data: {
          status: input.status,
          resolutionNote: input.note,
          resolvedAt: new Date(),
          resolvedBy: userId,
        },
      });
      if (updated.count === 0) {
        throw AppError.conflict('ISSUE_CLOSED', 'เคสนี้เพิ่งถูกปิดไปแล้ว');
      }

      await tx.notification.create({
        data: {
          userId: issue.reporterId,
          type: 'order_status',
          title:
            input.status === 'resolved'
              ? 'ร้านแก้ไขเคสของคุณแล้ว'
              : 'ร้านตอบกลับเคสของคุณ',
          body: `${issue.order.subscription.plan.product.name} — ${input.note}`,
          linkPath: `/orders/${issue.order.id}`,
        },
      });
    });

    const row = await this.prisma.orderIssue.findFirstOrThrow({
      where: { id: issueId },
      include: ISSUE_INCLUDE,
    });
    return toSellerIssue(row);
  }

  /** เงื่อนไข "ออเดอร์นี้เป็นของร้านฉัน" ที่เดียว — ห้ามเขียนซ้ำเอง */
  private ofMyShop(userId: string): Prisma.OrderWhereInput {
    return {
      subscription: { plan: { product: { shop: { ownerId: userId } } } },
    };
  }

  /**
   * ★ ออเดอร์ที่ยังจ่ายเงินไม่สำเร็จต้องไม่ถึงตาร้าน ★ (feature 09 เฟส 5)
   *
   * engine สร้างออเดอร์ไว้ให้ผู้ซื้อกดจ่ายซ้ำได้ แต่ร้านไม่ควรจัดของให้รอบที่
   * ยังไม่ได้เงิน — และถ้าเห็นแล้วกดส่ง ระบบจะกลายเป็นให้ของฟรีโดยไม่มีใครสังเกต
   * ใช้ `NOT` แทนการเทียบ `= 'paid'` เพราะออเดอร์ที่ยกเลิกแล้วมี payment เป็น
   * `refunded` ซึ่งยังต้องอยู่ในแท็บประวัติของร้าน
   */
  private readonly PAID_ONLY: Prisma.OrderWhereInput = {
    NOT: { payment: { status: 'failed' } },
  };
}

const HIDDEN_RECIPIENT: SellerOrderResponse['recipient'] = {
  name: 'ถูกปิดบังระหว่างที่ร้านถูกระงับ',
  phone: '',
  addressLine: '',
  province: '',
  postcode: '',
};

/** address_snapshot เป็น jsonb — อ่านทีละคีย์ที่รู้จัก ไม่ปล่อยก้อนดิบออก API */
function toRecipient(raw: Prisma.JsonValue): SellerOrderResponse['recipient'] {
  const snap: Record<string, unknown> =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const text = (key: string): string =>
    typeof snap[key] === 'string' ? snap[key] : '';

  return {
    name: text('recipient_name'),
    phone: text('phone'),
    addressLine: text('address_line'),
    province: text('province'),
    postcode: text('postcode'),
  };
}

/**
 * @param shopSuspended ร้านถูกผู้ดูแลระงับอยู่ไหม
 *
 * เหตุผลเดียวที่ร้านเห็นชื่อ/เบอร์/ที่อยู่ผู้ซื้อคือ "ต้องส่งของ" (PDPA — data
 * minimization) ร้านที่ถูกระงับจึงยังเห็นได้เฉพาะออเดอร์ที่ยังต้องส่งให้จบ
 * ส่วนประวัติที่ปิดไปแล้วถูกปิดบัง — ไม่ใช่ช่องดูดรายชื่อลูกค้าออกไปหลังถูกแบน
 */
function toSellerOrder(
  row: OrderRow,
  shopSuspended = false,
): SellerOrderResponse {
  const product = row.subscription.plan.product;
  const canSeeRecipient = !shopSuspended || FULFILLABLE.includes(row.status);
  return {
    id: row.id,
    cycleDate: toISODate(row.cycleDate),
    status: row.status,
    amount: row.amount.toNumber(),
    quantity: row.subscription.quantity,
    trackingNote: row.trackingNote,
    productId: product.id,
    productName: product.name,
    productImage: product.images[0] ?? null,
    cycle: row.subscription.plan.cycle,
    recipient: canSeeRecipient
      ? toRecipient(row.addressSnapshot)
      : HIDDEN_RECIPIENT,
    subscriptionCancelled: row.subscription.status === 'cancelled',
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * เคสในมุมร้าน — มีชื่อผู้รับ (ต้องใช้ระบุออเดอร์) แต่ไม่มี `reporterId`
 * อายุเคสคำนวณฝั่ง server เพื่อให้ทุกหน้าจอไฮไลต์ตรงเกณฑ์เดียวกัน
 */
function toSellerIssue(row: IssueRow): SellerIssueResponse {
  const snap: Record<string, unknown> =
    row.order.addressSnapshot !== null &&
    typeof row.order.addressSnapshot === 'object' &&
    !Array.isArray(row.order.addressSnapshot)
      ? row.order.addressSnapshot
      : {};

  return {
    id: row.id,
    orderId: row.order.id,
    type: row.type,
    detail: row.detail,
    status: row.status,
    resolutionNote: row.resolutionNote,
    recipientName:
      typeof snap.recipient_name === 'string' ? snap.recipient_name : '',
    productName: row.order.subscription.plan.product.name,
    cycleDate: toISODate(row.order.cycleDate),
    ageDays: Math.floor((Date.now() - row.createdAt.getTime()) / 86_400_000),
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt === null ? null : row.resolvedAt.toISOString(),
  };
}
