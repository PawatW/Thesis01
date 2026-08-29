import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { addDays, todayInBangkok } from '../common/date';
import { AppError } from '../common/errors/app-exception';
import { AuditService } from '../audit/audit.service';
import { CouponsService } from '../coupons/coupons.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AdminIssueResponse,
  AdminProductResponse,
  AdminShopResponse,
  ModerationQuery,
  SuspensionResultResponse,
} from './dto/moderation.dto';

/** เพดานแถวของทุกรายการในหน้านี้ (security-rules B-11) */
const MAX_ROWS = 100;

/** ช่วงที่ใช้วัด "ร้านนี้ยกเลิกออเดอร์บ่อยไหม" */
const CANCEL_WINDOW_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/**
 * Moderation (feature 14 · W10 Flow C)
 *
 * ★ กฎที่ทั้งไฟล์นี้มีอยู่เพื่อรักษา ★
 * "ระงับร้าน" ต้องแปลว่า **แพลตฟอร์มหยุดเก็บเงินให้ร้านนั้นทันที** ไม่ใช่แค่
 * ซ่อนสินค้าจากหน้าค้นหา — ไม่งั้นระบบจะยังตัดเงินผู้ซื้อเข้าร้านที่ตัวเองสั่งระงับ
 * ทุกการระงับจึงแช่แข็ง subscription ที่เกี่ยวข้องในทรานแซกชันเดียวกันเสมอ
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly coupons: CouponsService,
  ) {}

  async listShops(query: ModerationQuery): Promise<AdminShopResponse[]> {
    const since = new Date(Date.now() - CANCEL_WINDOW_DAYS * MS_PER_DAY);

    const shops = await this.prisma.shop.findMany({
      where: {
        ...(query.q === undefined
          ? {}
          : { name: { contains: query.q, mode: 'insensitive' } }),
        ...(query.filter === 'suspended' ? { suspendedAt: { not: null } } : {}),
      },
      orderBy: [{ suspendedAt: 'desc' }, { createdAt: 'asc' }],
      take: MAX_ROWS,
      include: {
        owner: { select: { displayName: true, email: true } },
        _count: { select: { products: true } },
      },
    });
    if (shops.length === 0) return [];

    const ids = shops.map((s) => s.id);
    const [subscribers, issues, cancels] = await Promise.all([
      this.prisma.subscription.groupBy({
        by: ['planId'],
        where: { status: 'active', plan: { product: { shopId: { in: ids } } } },
        _count: { _all: true },
      }),
      this.prisma.orderIssue.findMany({
        where: {
          status: 'open',
          order: {
            subscription: { plan: { product: { shopId: { in: ids } } } },
          },
        },
        select: {
          order: {
            select: {
              subscription: {
                select: {
                  plan: { select: { product: { select: { shopId: true } } } },
                },
              },
            },
          },
        },
        take: MAX_ROWS * 10,
      }),
      this.prisma.order.findMany({
        where: {
          status: 'cancelled',
          cancelledAt: { gte: since },
          subscription: { plan: { product: { shopId: { in: ids } } } },
        },
        select: {
          subscription: {
            select: {
              plan: { select: { product: { select: { shopId: true } } } },
            },
          },
        },
        take: MAX_ROWS * 10,
      }),
    ]);

    // แผน → ร้าน (ใช้แปลงผลของ groupBy ที่รวมมาตามแผน)
    const plans = await this.prisma.productPlan.findMany({
      where: { id: { in: subscribers.map((g) => g.planId) } },
      select: { id: true, product: { select: { shopId: true } } },
    });
    const shopOfPlan = new Map(plans.map((p) => [p.id, p.product.shopId]));

    const subsPerShop = new Map<string, number>();
    for (const group of subscribers) {
      const shopId = shopOfPlan.get(group.planId);
      if (shopId === undefined) continue;
      subsPerShop.set(
        shopId,
        (subsPerShop.get(shopId) ?? 0) + group._count._all,
      );
    }

    const countBy = (
      rows: {
        order?: { subscription: { plan: { product: { shopId: string } } } };
        subscription?: { plan: { product: { shopId: string } } };
      }[],
    ): Map<string, number> => {
      const map = new Map<string, number>();
      for (const row of rows) {
        const shopId = (row.order?.subscription ?? row.subscription)?.plan
          .product.shopId;
        if (shopId === undefined) continue;
        map.set(shopId, (map.get(shopId) ?? 0) + 1);
      }
      return map;
    };
    const issuesPerShop = countBy(issues);
    const cancelsPerShop = countBy(cancels);

    return shops.map((shop) => ({
      id: shop.id,
      name: shop.name,
      ownerName: shop.owner.displayName,
      ownerEmail: shop.owner.email,
      isActive: shop.isActive,
      suspendedAt:
        shop.suspendedAt === null ? null : shop.suspendedAt.toISOString(),
      suspendedReason: shop.suspendedReason,
      productCount: shop._count.products,
      activeSubscribers: subsPerShop.get(shop.id) ?? 0,
      openIssues: issuesPerShop.get(shop.id) ?? 0,
      cancelledOrders30d: cancelsPerShop.get(shop.id) ?? 0,
      createdAt: shop.createdAt.toISOString(),
    }));
  }

  async listProducts(query: ModerationQuery): Promise<AdminProductResponse[]> {
    const rows = await this.prisma.product.findMany({
      where: {
        ...(query.q === undefined
          ? {}
          : { name: { contains: query.q, mode: 'insensitive' } }),
        ...(query.filter === 'suspended' ? { suspendedAt: { not: null } } : {}),
      },
      orderBy: [{ suspendedAt: 'desc' }, { createdAt: 'desc' }],
      take: MAX_ROWS,
      include: { shop: { select: { id: true, name: true } } },
    });

    const ids = rows.map((r) => r.id);
    const active =
      ids.length === 0
        ? []
        : await this.prisma.subscription.groupBy({
            by: ['planId'],
            where: { status: 'active', plan: { productId: { in: ids } } },
            _count: { _all: true },
          });
    const plans =
      active.length === 0
        ? []
        : await this.prisma.productPlan.findMany({
            where: { id: { in: active.map((g) => g.planId) } },
            select: { id: true, productId: true },
          });
    const productOfPlan = new Map(plans.map((p) => [p.id, p.productId]));
    const subsPerProduct = new Map<string, number>();
    for (const group of active) {
      const productId = productOfPlan.get(group.planId);
      if (productId === undefined) continue;
      subsPerProduct.set(
        productId,
        (subsPerProduct.get(productId) ?? 0) + group._count._all,
      );
    }

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      shopId: row.shop.id,
      shopName: row.shop.name,
      isActive: row.isActive,
      suspendedAt:
        row.suspendedAt === null ? null : row.suspendedAt.toISOString(),
      suspendedReason: row.suspendedReason,
      activeSubscribers: subsPerProduct.get(row.id) ?? 0,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  // ---------- ระงับ / คืนสถานะ ----------

  /**
   * ระงับหรือคืนสถานะร้าน — เขียน `shops.suspended_at` **และ** จัดการ
   * subscription ของร้านนั้นในทรานแซกชันเดียว
   */
  async setShopSuspension(
    shopId: string,
    suspend: boolean,
    actorId: string,
    reason?: string,
  ): Promise<SuspensionResultResponse> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, name: true, suspendedAt: true },
    });
    if (!shop) throw AppError.notFound('SHOP_NOT_FOUND', 'ไม่พบร้านนี้');

    return this.applySuspension({
      target: { id: shop.id, name: shop.name, suspendedAt: shop.suspendedAt },
      kind: 'shop',
      actorId,
      suspend,
      reason,
      write: (tx, at, why) =>
        tx.shop.updateMany({
          where: {
            id: shopId,
            // สถานะเดิมอยู่ใน where: กดพร้อมกัน 2 หน้าต่างต้องสำเร็จครั้งเดียว
            suspendedAt: suspend ? null : { not: null },
          },
          data: { suspendedAt: at, suspendedReason: why },
        }),
      subscriptions: { plan: { product: { shopId } } },
    });
  }

  /** ระงับสินค้าชิ้นเดียว — ผลกับ subscription เหมือนกัน แต่วงแคบกว่า */
  async setProductSuspension(
    productId: string,
    suspend: boolean,
    actorId: string,
    reason?: string,
  ): Promise<SuspensionResultResponse> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, suspendedAt: true },
    });
    if (!product)
      throw AppError.notFound('PRODUCT_NOT_FOUND', 'ไม่พบสินค้านี้');

    return this.applySuspension({
      target: {
        id: product.id,
        name: product.name,
        suspendedAt: product.suspendedAt,
      },
      kind: 'product',
      actorId,
      suspend,
      reason,
      write: (tx, at, why) =>
        tx.product.updateMany({
          where: { id: productId, suspendedAt: suspend ? null : { not: null } },
          data: { suspendedAt: at, suspendedReason: why },
        }),
      subscriptions: { plan: { productId } },
    });
  }

  /**
   * แกนกลางของการระงับ/คืน — ใช้ร่วมกันทั้งร้านและสินค้า
   *
   * ทุกอย่างอยู่ในทรานแซกชันเดียว: ตัวที่ถูกระงับ · subscription ที่กระทบ ·
   * audit event · แจ้งเตือนผู้ซื้อ — เพราะ "ระงับแล้วแต่ยังตัดเงิน" คือสภาพที่
   * ต้องเป็นไปไม่ได้ ไม่ใช่แค่ไม่ควรเกิด
   */
  private async applySuspension(input: {
    target: { id: string; name: string; suspendedAt: Date | null };
    /** ใช้เลือกชนิดของ audit action — ร้านกับสินค้าใช้เส้นทางเดียวกันแต่คนละเหตุการณ์ */
    kind: 'shop' | 'product';
    actorId: string;
    suspend: boolean;
    reason?: string;
    write: (
      tx: Prisma.TransactionClient,
      at: Date | null,
      reason: string | null,
    ) => Promise<{ count: number }>;
    subscriptions: Prisma.SubscriptionWhereInput;
  }): Promise<SuspensionResultResponse> {
    const { target, suspend, reason } = input;

    if (suspend && (reason === undefined || reason === '')) {
      throw AppError.badRequest(
        'REASON_REQUIRED',
        'ระบุเหตุผลของการระงับอย่างน้อย 5 ตัวอักษร',
      );
    }
    if (suspend === (target.suspendedAt !== null)) {
      throw AppError.conflict(
        'SUSPENSION_UNCHANGED',
        suspend ? 'ถูกระงับอยู่แล้ว' : 'ไม่ได้ถูกระงับอยู่',
      );
    }

    const at = suspend ? new Date() : null;
    const why = suspend ? (reason ?? null) : null;
    const tomorrow = addDays(todayInBangkok(), 1);

    const affected = await this.prisma.$transaction(async (tx) => {
      const changed = await input.write(tx, at, why);
      if (changed.count === 0) {
        throw AppError.conflict(
          'SUSPENSION_CHANGED',
          'สถานะเพิ่งถูกเปลี่ยนไปแล้ว กรุณารีเฟรชหน้าจอ',
        );
      }

      // ★ อยู่ในทรานแซกชันเดียวกับการระงับ ★ "ระงับสำเร็จแต่ log ไม่ขึ้น" ทำให้
      // ทั้งตารางเชื่อถือไม่ได้ — เพราะแถวที่หายไปกับแถวที่ไม่เคยเกิด หน้าตาเหมือนกัน
      await this.audit.record(
        {
          action: `${input.kind}_${suspend ? 'suspended' : 'unsuspended'}`,
          actorId: input.actorId,
          targetType: input.kind,
          targetId: target.id,
          summary: suspend
            ? `ระงับ${input.kind === 'shop' ? 'ร้าน' : 'สินค้า'} "${target.name}" — ${why ?? 'ไม่ระบุเหตุผล'}`
            : `คืนสถานะ${input.kind === 'shop' ? 'ร้าน' : 'สินค้า'} "${target.name}"`,
        },
        tx,
      );

      // แถวที่จะกระทบ — อ่านก่อนเขียนเพื่อใช้ทำ event + แจ้งเตือน
      const targets = await tx.subscription.findMany({
        where: {
          ...input.subscriptions,
          ...(suspend
            ? { status: 'active' as const }
            : {
                status: 'paused' as const,
                pausedReason: 'shop_suspended' as const,
              }),
        },
        select: { id: true, buyerId: true, nextOrderDate: true },
      });
      if (targets.length === 0) return 0;

      const ids = targets.map((t) => t.id);

      if (suspend) {
        await tx.subscription.updateMany({
          where: { id: { in: ids }, status: 'active' },
          data: {
            status: 'paused',
            pausedAt: at,
            // ★ 'shop_suspended' ไม่ใช่ 'user' ★ ผู้ซื้อจึงกดกลับมาใช้งานเองไม่ได้
            // จนกว่าร้านจะถูกปลดระงับ (SubscriptionsService.resume ปฏิเสธไว้)
            pausedReason: 'shop_suspended',
          },
        });

        /**
         * คืนคูปองที่จองค้างไว้ (feature 18 · W13 Flow E)
         *
         * รอบที่จองไว้จะไม่เกิดขึ้นแล้วเพราะรายการถูกแช่แข็ง — ถ้าไม่คืน โควตา
         * จะถูกล็อกไว้กับรอบที่ไม่มีวันมาถึง และผู้ซื้อก็ใช้คูปองใบนั้นกับรอบใหม่
         * ไม่ได้ด้วย (partial unique `coupon_once_per_user` กันไว้)
         *
         * ★ ต้องแจ้งผู้ซื้อ ★ ต่างจากตอนที่ผู้ซื้อกด skip/pause เอง — ครั้งนี้
         * ระบบเป็นคนตัดสินใจแทน ถ้าเงียบไปคูปองจะหายไปโดยไม่มีใครอธิบายได้
         */
        for (const t of targets) {
          await this.coupons.releaseReserved(tx, {
            subscriptionId: t.id,
            reason: 'shop_suspended',
            notify: {
              userId: t.buyerId,
              productName: target.name,
              linkPath: `/subscriptions/${t.id}`,
            },
          });
        }
      } else {
        // คืนสถานะ: รอบถัดไปต้องไม่ย้อนหลัง — ใช้กฎเดียวกับปุ่ม "กลับมาใช้งาน"
        // ของผู้ซื้อ (max(เดิม, พรุ่งนี้) และขยับหมุดเมื่อวันรอบถูกเลื่อน)
        const late = new Set(
          targets
            .filter(
              (t) => t.nextOrderDate === null || t.nextOrderDate <= tomorrow,
            )
            .map((t) => t.id),
        );
        const onTime = ids.filter((id) => !late.has(id));

        if (onTime.length > 0) {
          await tx.subscription.updateMany({
            where: { id: { in: onTime }, pausedReason: 'shop_suspended' },
            data: { status: 'active', pausedAt: null, pausedReason: null },
          });
        }
        if (late.size > 0) {
          await tx.subscription.updateMany({
            where: { id: { in: [...late] }, pausedReason: 'shop_suspended' },
            data: {
              status: 'active',
              pausedAt: null,
              pausedReason: null,
              nextOrderDate: tomorrow,
              cycleAnchorDate: tomorrow,
            },
          });
        }
      }

      await tx.subscriptionEvent.createMany({
        data: targets.map((t) => ({
          subscriptionId: t.id,
          event: suspend ? ('paused' as const) : ('resumed' as const),
          detail: { reason: 'shop_suspended', by: 'admin' },
        })),
      });

      await tx.notification.createMany({
        data: targets.map((t) => ({
          userId: t.buyerId,
          type: suspend
            ? ('subscription_frozen' as const)
            : ('subscription_resumed' as const),
          title: suspend
            ? 'หยุดรายการชั่วคราวเพราะร้านถูกระงับ'
            : 'ร้านกลับมาเปิดแล้ว — รายการของคุณกลับมาทำงาน',
          body: suspend
            ? `${target.name} — ไม่มีการตัดเงินระหว่างนี้ ระบบจะกลับมาส่งให้เองเมื่อร้านเปิดอีกครั้ง`
            : `${target.name} — รอบถัดไปจะเริ่มใหม่ตั้งแต่พรุ่งนี้เป็นต้นไป`,
          linkPath: `/subscriptions/${t.id}`,
        })),
      });

      return targets.length;
    });

    return {
      id: target.id,
      name: target.name,
      suspendedAt: at === null ? null : at.toISOString(),
      suspendedReason: why,
      affectedSubscriptions: affected,
    };
  }

  // ---------- คิวเคสปัญหาทั้งแพลตฟอร์ม ----------

  async listIssues(
    status: 'open' | 'closed' = 'open',
  ): Promise<AdminIssueResponse[]> {
    const rows = await this.prisma.orderIssue.findMany({
      where: {
        status: status === 'open' ? 'open' : { in: ['resolved', 'rejected'] },
      },
      // เก่าสุดก่อน — เคสที่ค้างนานที่สุดคือเคสที่ต้องเข้าไปดูก่อน
      orderBy: { createdAt: 'asc' },
      take: MAX_ROWS,
      select: {
        id: true,
        orderId: true,
        type: true,
        detail: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
        order: {
          select: {
            subscription: {
              select: {
                plan: {
                  select: {
                    product: {
                      select: {
                        name: true,
                        shop: { select: { id: true, name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const now = Date.now();
    return rows.map((row) => {
      const product = row.order.subscription.plan.product;
      return {
        id: row.id,
        orderId: row.orderId,
        type: row.type,
        detail: row.detail,
        status: row.status,
        shopId: product.shop.id,
        shopName: product.shop.name,
        productName: product.name,
        ageDays: Math.floor((now - row.createdAt.getTime()) / MS_PER_DAY),
        createdAt: row.createdAt.toISOString(),
        resolvedAt:
          row.resolvedAt === null ? null : row.resolvedAt.toISOString(),
      };
    });
  }
}
