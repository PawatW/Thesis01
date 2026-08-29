import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { toISODate } from '../common/date';
import { AppError } from '../common/errors/app-exception';
import { SELLER_ORDERS_LINK } from '../common/links';
import { PaymentProvider } from '../payments/payment.provider';
import { PrismaService } from '../prisma/prisma.service';
import type {
  BuyerOrderResponse,
  OrderIssueResponse,
  ReportIssueDto,
} from './dto/order.dto';

/** เพดานแถวของรายการออเดอร์ (security-rules B-11) */
const MAX_ORDERS = 200;

/** ยืนยันรับของได้เมื่อของออกจากร้านแล้วเท่านั้น (CHECK `orders_confirm_after_ship` กันซ้ำที่ DB) */
const CONFIRMABLE: OrderStatus[] = ['shipped', 'delivered'];

/** แจ้งปัญหาได้ตั้งแต่ร้านเริ่มจัดของ — ก่อนหน้านั้นยังไม่มีอะไรให้มีปัญหา (feature 16) */
const REPORTABLE: OrderStatus[] = ['preparing', 'shipped', 'delivered'];

const ORDER_INCLUDE = {
  payment: { select: { status: true, paidAt: true, refundedAt: true } },
  /**
   * โค้ดคูปองของรอบนี้ แยกตามระดับ — เอาแค่โค้ดกับยอดไปโชว์บนใบเสร็จ
   * ไม่ลากทั้งใบจองออกมา (feature 18)
   */
  platformRedemption: {
    select: { discountAmount: true, coupon: { select: { code: true } } },
  },
  shopRedemption: {
    select: { discountAmount: true, coupon: { select: { code: true } } },
  },
  issue: {
    select: {
      id: true,
      type: true,
      detail: true,
      status: true,
      resolutionNote: true,
      createdAt: true,
      resolvedAt: true,
    },
  },
  subscription: {
    select: {
      id: true,
      status: true,
      quantity: true,
      plan: {
        select: {
          cycle: true,
          product: {
            select: {
              id: true,
              name: true,
              images: true,
              shop: { select: { name: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/**
 * ออเดอร์ในมุมของผู้ซื้อ (features 07 · 16)
 *
 * ★ `confirmedAt` คือคอลัมน์เดียวที่ร้านเขียนไม่ได้เลย ★ `delivered` ร้านกดเองได้
 * จึงพิสูจน์อะไรไม่ได้ — สัญญาณที่เชื่อได้ว่าของถึงมือจริงคือผู้ซื้อกดเอง
 * (W11 Flow B · trigger `guard_order_update` ปิดทางเขียนจากที่อื่นไว้อีกชั้น)
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentProvider,
  ) {}

  async list(
    buyerId: string,
    tab: 'open' | 'done' = 'open',
  ): Promise<BuyerOrderResponse[]> {
    const status: OrderStatus[] =
      tab === 'open'
        ? ['pending', 'preparing', 'shipped']
        : ['delivered', 'cancelled'];

    const rows = await this.prisma.order.findMany({
      // ownership อยู่ใน where — `orders.buyer_id` เป็นส่วนหนึ่งของ FK คู่
      // (subscription_id, buyer_id) จึงเพี้ยนไปจากเจ้าของจริงไม่ได้
      where: { buyerId, status: { in: status } },
      include: ORDER_INCLUDE,
      // cycleDate ซ้ำกันได้ (คนละ subscription ตรงรอบวันเดียวกัน) — ต้องมีตัวตัดสิน
      // ที่สอง ไม่งั้นลำดับบนหน้าจอสลับไปมาระหว่างการรีเฟรชโดยไม่มีอะไรเปลี่ยน
      orderBy: [{ cycleDate: 'desc' }, { createdAt: 'desc' }],
      take: MAX_ORDERS,
    });
    return rows.map(toBuyerOrder);
  }

  async findOne(buyerId: string, id: string): Promise<BuyerOrderResponse> {
    const row = await this.prisma.order.findFirst({
      where: { id, buyerId },
      include: ORDER_INCLUDE,
    });
    if (!row) throw AppError.notFound('ORDER_NOT_FOUND', 'ไม่พบออเดอร์นี้');
    return toBuyerOrder(row);
  }

  /**
   * ยืนยันรับของ — **idempotent** กดซ้ำต้องไม่ error (W11 E3)
   *
   * ตั้ง `confirmedAt` และดัน `delivered` ให้ในคำสั่งเดียว: ผู้ซื้อบอกว่าของถึงแล้ว
   * ก็ไม่มีเหตุผลให้ค้างสถานะ `shipped` รอร้านมากดอีกที
   */
  async confirmReceipt(
    buyerId: string,
    id: string,
  ): Promise<BuyerOrderResponse> {
    const order = await this.prisma.order.findFirst({
      where: { id, buyerId },
      select: { id: true, status: true, confirmedAt: true },
    });
    if (!order) throw AppError.notFound('ORDER_NOT_FOUND', 'ไม่พบออเดอร์นี้');

    // ยืนยันไปแล้ว → คืนค่าเดิมเฉย ๆ ไม่ใช่ 409 (กดซ้ำเพราะเน็ตช้าเป็นเรื่องปกติ)
    if (order.confirmedAt !== null) return this.findOne(buyerId, id);

    if (!CONFIRMABLE.includes(order.status)) {
      throw AppError.conflict(
        order.status === 'cancelled' ? 'ORDER_CANCELLED' : 'ORDER_NOT_SHIPPED',
        order.status === 'cancelled'
          ? 'ออเดอร์นี้ถูกยกเลิกไปแล้ว'
          : 'ยืนยันได้เมื่อร้านส่งของออกมาแล้วเท่านั้น',
      );
    }

    const updated = await this.prisma.order.updateMany({
      // สถานะเดิมอยู่ใน where: ถ้าร้านยกเลิกออเดอร์ระหว่างที่ผู้ซื้อค้างหน้าจอ
      // คำสั่งนี้ต้องไม่ผ่าน (ไม่งั้นออเดอร์ที่คืนเงินแล้วกลายเป็น delivered)
      where: { id, buyerId, status: { in: CONFIRMABLE }, confirmedAt: null },
      data: { status: 'delivered', confirmedAt: new Date() },
    });
    if (updated.count === 0) {
      throw AppError.conflict(
        'ORDER_CHANGED',
        'ออเดอร์นี้เพิ่งเปลี่ยนสถานะไปแล้ว กรุณารีเฟรชหน้าจอ',
      );
    }
    return this.findOne(buyerId, id);
  }

  /**
   * จ่ายเงินซ้ำหลังบัตรถูกปฏิเสธ (feature 09 เฟส 5)
   *
   * ★ ยอดไม่ได้มาจาก client ★ อ่านจาก `orders.amount` ที่บันทึกไว้ตอนสร้างรอบ
   * และเรียกผ่าน `PaymentProvider` ตัวเดียวกับ checkout/engine — ไม่มีที่ไหน
   * ในระบบที่เขียน `status: 'paid'` เองโดยไม่ผ่าน provider
   *
   * ร้านเพิ่งเห็นออเดอร์ใบนี้ตอนจ่ายสำเร็จ จึงต้องแจ้งเตือนร้านที่จุดนี้
   * (engine ไม่ได้แจ้งไว้ เพราะตอนนั้นออเดอร์ยังไม่ได้เงิน)
   */
  async retryPayment(buyerId: string, id: string): Promise<BuyerOrderResponse> {
    const order = await this.prisma.order.findFirst({
      where: { id, buyerId },
      select: {
        id: true,
        status: true,
        amount: true,
        payment: { select: { id: true, status: true } },
        subscription: {
          select: {
            paymentMethod: { select: { id: true, last4: true } },
            plan: {
              select: {
                product: {
                  select: { name: true, shop: { select: { ownerId: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!order) throw AppError.notFound('ORDER_NOT_FOUND', 'ไม่พบออเดอร์นี้');

    if (order.payment === null || order.payment.status !== 'failed') {
      throw AppError.conflict(
        'PAYMENT_NOT_RETRYABLE',
        order.payment?.status === 'paid'
          ? 'รอบนี้จ่ายเรียบร้อยแล้ว'
          : 'ออเดอร์นี้ไม่อยู่ในสถานะที่จ่ายซ้ำได้',
      );
    }
    if (order.status === 'cancelled') {
      throw AppError.conflict(
        'ORDER_CANCELLED',
        'ออเดอร์นี้ถูกยกเลิกไปแล้ว — ไม่ต้องจ่ายรอบนี้',
      );
    }

    const charge = await this.payments.charge({
      orderId: order.id,
      amount: order.amount.toNumber(),
      card: order.subscription.paymentMethod,
    });
    if (charge.status === 'failed') {
      throw AppError.paymentRequired(
        'PAYMENT_FAILED',
        charge.failureReason ?? 'ตัดเงินไม่สำเร็จ',
      );
    }

    const paymentId = order.payment.id;
    await this.prisma.$transaction(async (tx) => {
      // สถานะเดิมอยู่ใน where: กดจ่ายซ้ำพร้อมกัน 2 เครื่องต้องสำเร็จแค่ครั้งเดียว
      const updated = await tx.payment.updateMany({
        where: { id: paymentId, status: 'failed' },
        data: { status: 'paid', paidAt: new Date() },
      });
      if (updated.count === 0) {
        throw AppError.conflict(
          'PAYMENT_NOT_RETRYABLE',
          'รอบนี้จ่ายเรียบร้อยแล้ว',
        );
      }

      await tx.notification.create({
        data: {
          userId: order.subscription.plan.product.shop.ownerId,
          type: 'order_created',
          title: 'มีออเดอร์ใหม่ที่จ่ายเงินแล้ว',
          body: `${order.subscription.plan.product.name} — ผู้ซื้อชำระเงินสำเร็จ พร้อมให้จัดของ`,
          linkPath: SELLER_ORDERS_LINK,
        },
      });
    });

    return this.findOne(buyerId, id);
  }

  /**
   * แจ้งปัญหา — 1 ออเดอร์ = 1 เคส (unique `order_id` ที่ DB เป็นด่านจริง)
   *
   * ร้านต้องรู้ทันทีเพราะเป็นสัญญาณคุณภาพที่ admin ใช้ตัดสินใจระงับร้าน (W11 Flow C)
   */
  async reportIssue(
    buyerId: string,
    id: string,
    dto: ReportIssueDto,
  ): Promise<BuyerOrderResponse> {
    const order = await this.prisma.order.findFirst({
      where: { id, buyerId },
      select: {
        id: true,
        status: true,
        subscription: {
          select: {
            plan: {
              select: {
                product: {
                  select: { name: true, shop: { select: { ownerId: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!order) throw AppError.notFound('ORDER_NOT_FOUND', 'ไม่พบออเดอร์นี้');

    if (order.status === 'cancelled') {
      throw AppError.conflict(
        'ORDER_CANCELLED',
        'ออเดอร์นี้ถูกยกเลิกและคืนเงินแล้ว',
      );
    }
    if (!REPORTABLE.includes(order.status)) {
      throw AppError.conflict(
        'ORDER_NOT_STARTED',
        'ร้านยังไม่เริ่มจัดของ — รออีกสักครู่ก่อนแจ้งปัญหา',
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.orderIssue.create({
          data: {
            orderId: id,
            reporterId: buyerId,
            type: dto.type,
            detail: dto.detail,
          },
        });
        await tx.notification.create({
          data: {
            userId: order.subscription.plan.product.shop.ownerId,
            type: 'order_status',
            title: 'มีผู้ซื้อแจ้งปัญหาออเดอร์',
            body: `${order.subscription.plan.product.name} — ${issueTypeText(dto.type)}`,
            linkPath: SELLER_ORDERS_LINK,
          },
        });
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw AppError.conflict(
          'ISSUE_EXISTS',
          'ออเดอร์นี้มีเคสที่แจ้งไว้แล้ว — ดูสถานะเคสเดิมได้ที่หน้าออเดอร์',
        );
      }
      throw e;
    }
    return this.findOne(buyerId, id);
  }
}

/**
 * เลขที่ใบเสร็จจำลอง — `RC-XXXXXXXX` จาก 8 ตัวแรกของ uuid ออเดอร์
 *
 * ไม่ใช้ running number เพราะต้องมีตารางนับกลางที่ต้องล็อกทุกครั้งที่ออกใบเสร็จ
 * ซึ่งเกินความจำเป็นของระบบจำลอง · ค่านี้คงที่ตลอดอายุของออเดอร์ (ออกใบเดิมซ้ำได้)
 */
export function receiptNo(orderId: string): string {
  return `RC-${orderId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export function issueTypeText(type: string): string {
  if (type === 'not_received') return 'ของไม่ถึง';
  if (type === 'wrong_item') return 'ได้ของผิด';
  if (type === 'damaged') return 'ของเสียหาย';
  return 'อื่น ๆ';
}

function toIssue(issue: OrderRow['issue']): OrderIssueResponse | null {
  if (issue == null) return null;
  return {
    id: issue.id,
    type: issue.type,
    detail: issue.detail,
    status: issue.status,
    resolutionNote: issue.resolutionNote,
    createdAt: issue.createdAt.toISOString(),
    resolvedAt:
      issue.resolvedAt === null ? null : issue.resolvedAt.toISOString(),
  };
}

/** อ่าน address_snapshot ทีละคีย์ที่รู้จัก — ไม่ปล่อย jsonb ดิบออก API */
function toShipTo(raw: Prisma.JsonValue): BuyerOrderResponse['shipTo'] {
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

function toBuyerOrder(row: OrderRow): BuyerOrderResponse {
  const product = row.subscription.plan.product;
  return {
    id: row.id,
    cycleDate: toISODate(row.cycleDate),
    status: row.status,
    amount: row.amount.toNumber(),
    discountAmount: row.discountAmount.toNumber(),
    coupons: [
      row.platformRedemption === null
        ? null
        : {
            tier: 'platform' as const,
            code: row.platformRedemption.coupon.code,
            discountAmount: row.platformRedemption.discountAmount.toNumber(),
          },
      row.shopRedemption === null
        ? null
        : {
            tier: 'shop' as const,
            code: row.shopRedemption.coupon.code,
            discountAmount: row.shopRedemption.discountAmount.toNumber(),
          },
    ].filter((c) => c !== null),
    quantity: row.subscription.quantity,
    trackingNote: row.trackingNote,
    confirmedAt:
      row.confirmedAt === null ? null : row.confirmedAt.toISOString(),
    cancelledAt:
      row.cancelledAt === null ? null : row.cancelledAt.toISOString(),
    cancelReason: row.cancelReason,
    paymentStatus: row.payment?.status ?? null,
    paidAt:
      row.payment?.paidAt == null ? null : row.payment.paidAt.toISOString(),
    receiptNo: row.payment?.paidAt == null ? null : receiptNo(row.id),
    refundedAt:
      row.payment?.refundedAt == null
        ? null
        : row.payment.refundedAt.toISOString(),
    subscriptionId: row.subscription.id,
    subscriptionStatus: row.subscription.status,
    productId: product.id,
    productName: product.name,
    productImage: product.images[0] ?? null,
    shopName: product.shop.name,
    cycle: row.subscription.plan.cycle,
    shipTo: toShipTo(row.addressSnapshot),
    issue: toIssue(row.issue),
    createdAt: row.createdAt.toISOString(),
  };
}
