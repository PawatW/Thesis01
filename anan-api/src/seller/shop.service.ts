import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cyclesPerMonth, isCycle, startOfThaiMonth } from '../common/date';
import { BILLABLE_PRODUCT } from '../catalog/catalog.service';
import { AppError } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  toShopResponse,
  type DashboardResponse,
  type OpenShopDto,
  type ShopResponse,
  type UpdateShopDto,
} from './dto/shop.dto';

const RECENT_EVENTS = 8;

/**
 * ร้านค้าของผู้ใช้ที่กำลังเรียก — ใช้ร่วมกันทุก service ฝั่งร้าน
 *
 * แยกออกมาเป็นเมธอดเดียวเพราะเป็นคำตอบของคำถาม "ร้านไหนคือร้านของคนนี้"
 * ถ้าปล่อยให้แต่ละที่ query เอง วันหนึ่งจะมีที่ที่ลืมเช็ค `suspendedAt`
 */
@Injectable()
export class ShopService {
  constructor(private readonly prisma: PrismaService) {}

  /** ร้านของผู้เรียก (ยังไม่สนว่าถูกระงับหรือไม่) — ใช้กับการ "อ่าน" */
  async requireShop(userId: string): Promise<{
    id: string;
    suspendedAt: Date | null;
  }> {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: userId },
      select: { id: true, suspendedAt: true },
    });
    if (!shop) {
      throw AppError.notFound('SHOP_NOT_FOUND', 'บัญชีนี้ยังไม่มีร้านค้า');
    }
    return shop;
  }

  /**
   * ร้านที่ยัง "ทำงานได้" — ใช้กับทุกการ **เขียน** ของฝั่งร้าน
   *
   * ร้านที่ถูกผู้ดูแลระงับต้องลงสินค้าใหม่/แก้ของเดิมไม่ได้ ไม่งั้นการระงับ
   * ก็แค่ซ่อนของจาก catalog แต่ร้านยังทำงานต่อได้เหมือนไม่มีอะไรเกิดขึ้น
   */
  async requireOperableShop(userId: string): Promise<{ id: string }> {
    const shop = await this.requireShop(userId);
    if (shop.suspendedAt !== null) {
      throw AppError.conflict(
        'SHOP_SUSPENDED',
        'ร้านนี้ถูกระงับโดยผู้ดูแลระบบ — แก้ไขข้อมูลร้านไม่ได้จนกว่าจะได้รับการปลดระงับ',
      );
    }
    return { id: shop.id };
  }

  /**
   * เปิดร้าน — endpoint เดียวของฝั่งร้านที่ยังไม่ต้องมี role seller
   *
   * `users.isSeller` ถูกตั้งในทรานแซกชันเดียวกับการสร้างร้าน (architecture.md §4)
   * ไม่ใช่ให้ client ยิงมาบอก — ไม่งั้นใครก็ยกระดับตัวเองเป็นร้านได้โดยไม่มีร้านจริง
   */
  async open(userId: string, dto: OpenShopDto): Promise<ShopResponse> {
    try {
      const shop = await this.prisma.$transaction(async (tx) => {
        const created = await tx.shop.create({
          data: {
            ownerId: userId,
            name: dto.name,
            description: dto.description,
            logoUrl: dto.logoUrl,
          },
        });
        await tx.user.update({
          where: { id: userId },
          data: { isSeller: true },
        });
        return created;
      });
      return toShopResponse(shop);
    } catch (e) {
      // ให้ unique `shops.owner_id` เป็นคนตัดสินว่าซ้ำ ไม่ใช่ SELECT ก่อนหน้า
      // (1 บัญชี = 1 ร้าน · กดปุ่มรัว 2 ครั้งต้องไม่ได้ 2 ร้าน)
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw AppError.conflict('SHOP_EXISTS', 'บัญชีนี้มีร้านค้าอยู่แล้ว');
      }
      throw e;
    }
  }

  async mine(userId: string): Promise<ShopResponse> {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: userId },
    });
    if (!shop) {
      throw AppError.notFound('SHOP_NOT_FOUND', 'บัญชีนี้ยังไม่มีร้านค้า');
    }
    return toShopResponse(shop);
  }

  async update(userId: string, dto: UpdateShopDto): Promise<ShopResponse> {
    // เงื่อนไข "ต้องไม่ถูกระงับ" อยู่ใน where ของคำสั่งเขียน ไม่ใช่ if ข้างบน —
    // ถ้า admin สั่งระงับระหว่างที่ร้านค้างหน้าจออยู่ คำสั่งนี้ต้องไม่ผ่าน
    const updated = await this.prisma.shop.updateMany({
      where: { ownerId: userId, suspendedAt: null },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name }),
        ...(dto.description === undefined
          ? {}
          : { description: dto.description }),
        ...(dto.logoUrl === undefined ? {} : { logoUrl: dto.logoUrl }),
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
    });

    if (updated.count === 0) {
      // แยกให้ชัดว่า "ไม่มีร้าน" กับ "ถูกระงับ" — ข้อความต่างกันคนละเรื่อง
      await this.requireOperableShop(userId);
    }
    return this.mine(userId);
  }

  /**
   * ตัวเลขหน้า dashboard — **aggregate ล้วน ไม่มีแถวของผู้ซื้อเลย**
   *
   * ร้านเห็นข้อมูลผู้ซื้อได้เท่าที่ต้องส่งของเท่านั้น (CLAUDE.md ข้อ 7) จำนวน
   * subscriber / MRR / churn จึงเป็นตัวเลขรวม ไม่ใช่รายชื่อ
   */
  async dashboard(userId: string): Promise<DashboardResponse> {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: userId },
    });
    if (!shop) {
      throw AppError.notFound('SHOP_NOT_FOUND', 'บัญชีนี้ยังไม่มีร้านค้า');
    }

    const ofThisShop: Prisma.SubscriptionWhereInput = {
      plan: { product: { shopId: shop.id } },
    };
    /**
     * ★ MRR ต้องใช้ตัวกรองเดียวกับ engine ★ (`BILLABLE_PRODUCT`)
     * สินค้า/ร้านที่ผู้ดูแลระงับจะไม่มีออเดอร์และไม่มีเงินเกิดขึ้นเลย ถ้ายังนับ
     * รวมอยู่ ร้านจะเห็น "รายได้ต่อเดือน" ที่ไม่มีวันเกิดขึ้นจริง
     */
    const billableOfThisShop: Prisma.SubscriptionWhereInput = {
      plan: { product: { shopId: shop.id, ...BILLABLE_PRODUCT } },
    };
    const monthStart = startOfThaiMonth();

    const [byPlan, cancelledThisMonth, activeProducts, pendingOrders, events] =
      await Promise.all([
        // ★ รวมที่ฐานข้อมูล ไม่ดึงแถว subscription ขึ้นมานับเอง ★
        // ได้ 2 อย่างพร้อมกัน: ไม่แตะ buyerId/addressId ของใครเลย และจำนวนแถวที่
        // วิ่งกลับมาถูกจำกัดด้วย "จำนวนแผนของร้าน" ไม่ใช่ "จำนวนสมาชิก" (B-11)
        this.prisma.subscription.groupBy({
          by: ['planId'],
          where: { ...billableOfThisShop, status: 'active' },
          _count: { _all: true },
          _sum: { quantity: true },
        }),
        this.prisma.subscriptionEvent.count({
          where: {
            event: 'cancelled',
            createdAt: { gte: monthStart },
            subscription: ofThisShop,
          },
        }),
        this.prisma.product.count({
          where: { shopId: shop.id, isActive: true, suspendedAt: null },
        }),
        this.prisma.order.count({
          where: {
            status: { in: ['pending', 'preparing'] },
            subscription: ofThisShop,
            // ออเดอร์ที่ผู้ซื้อยังจ่ายไม่สำเร็จไม่ใช่ "งานค้างของร้าน"
            // (ร้านมองไม่เห็นออเดอร์พวกนี้ในรายการอยู่แล้ว — เฟส 5)
            NOT: { payment: { status: 'failed' } },
          },
        }),
        this.prisma.subscriptionEvent.findMany({
          where: {
            event: { in: ['created', 'cancelled', 'paused', 'resumed'] },
            subscription: ofThisShop,
          },
          orderBy: { createdAt: 'desc' },
          take: RECENT_EVENTS,
          select: {
            event: true,
            createdAt: true,
            subscription: {
              select: {
                plan: { select: { product: { select: { name: true } } } },
              },
            },
          },
        }),
      ]);

    // ราคาของแต่ละแผนที่มีสมาชิกอยู่ — จำนวนแถวเท่ากับจำนวนแผน ไม่ใช่จำนวนคน
    const plans =
      byPlan.length === 0
        ? []
        : await this.prisma.productPlan.findMany({
            where: { id: { in: byPlan.map((g) => g.planId) } },
            select: { id: true, cycle: true, pricePerCycle: true },
          });
    const priceOf = new Map(plans.map((p) => [p.id, p]));

    // normalize ด้วย `cyclesPerMonth` ตัวเดียวกับที่ฝั่งแอปใช้ — ตัวเลขบน
    // dashboard ของร้านกับยอดที่ผู้ซื้อเห็นจึงมาจากสูตรเดียวกันเสมอ
    const monthlyRevenue = byPlan.reduce((sum, group) => {
      const plan = priceOf.get(group.planId);
      if (!plan || !isCycle(plan.cycle)) return sum;
      const units = group._sum.quantity ?? 0;
      return (
        sum + plan.pricePerCycle.toNumber() * units * cyclesPerMonth(plan.cycle)
      );
    }, 0);

    return {
      shop: toShopResponse(shop),
      activeSubscribers: byPlan.reduce((n, g) => n + g._count._all, 0),
      monthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
      cancelledThisMonth,
      activeProducts,
      pendingOrders,
      recentEvents: events.map((e) => ({
        event: e.event,
        productName: e.subscription.plan.product.name,
        at: e.createdAt.toISOString(),
      })),
    };
  }
}
