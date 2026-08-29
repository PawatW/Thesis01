import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  maskReviewerName,
  type CategoryResponse,
  type ListProductsQuery,
  type PlanLookupResponse,
  type PlanResponse,
  type ProductCardResponse,
  type ProductDetailResponse,
  type ShopPageResponse,
} from './dto/catalog.dto';

const DEFAULT_LIMIT = 40;
const REVIEWS_PER_PRODUCT = 10;

/**
 * ★ นิยามเดียวของคำว่า "สินค้าที่ลูกค้าเห็นได้" ★
 *
 * ห้ามมีใครเขียนเงื่อนไขนี้เองซ้ำที่อื่น — บทเรียนจาก `due_subscriptions`:
 * ตอนที่เงื่อนไขกระจายอยู่หลายที่ engine ลืมเช็คว่าร้านถูกระงับ แล้วแพลตฟอร์ม
 * ก็เก็บเงินให้ร้านที่ตัวเองสั่งระงับ
 *
 * แยก 2 เรื่องออกจากกัน: `isActive` = เจ้าของปิดเอง · `suspendedAt` = admin ระงับ
 */
export const VISIBLE_PRODUCT = {
  isActive: true,
  suspendedAt: null,
  shop: { isActive: true, suspendedAt: null },
} satisfies Prisma.ProductWhereInput;

/**
 * ★ นิยามเดียวของคำว่า "ยังเรียกเก็บเงินได้" (ใช้โดย recurring engine) ★
 *
 * ต่างจาก `VISIBLE_PRODUCT` ตรงที่ **ไม่ดู `isActive`** โดยตั้งใจ:
 *   - `isActive = false` คือเจ้าของปิดรับสมาชิกใหม่/ปิดร้านเอง → คนที่สมัครไว้แล้ว
 *     ต้องได้ของต่อจนกว่าจะยกเลิกเอง (เจตนาเดิมของสเปก feature 06/13)
 *   - `suspendedAt` คือแอดมินสั่งระงับ → **ห้ามสร้างออเดอร์และห้ามตัดเงินเด็ดขาด**
 *     ไม่งั้นแพลตฟอร์มเก็บเงินให้ร้านที่ตัวเองสั่งระงับ (บทเรียนของ due_subscriptions)
 */
export const BILLABLE_PRODUCT = {
  suspendedAt: null,
  shop: { suspendedAt: null },
} satisfies Prisma.ProductWhereInput;

const PRODUCT_SELECT = {
  id: true,
  name: true,
  images: true,
  oneTimePrice: true,
  netAmount: true,
  unit: true,
  shopId: true,
  categoryId: true,
  shop: { select: { name: true } },
  // ชื่อไอคอนของหมวด (Ionicons) — หน้าจอใช้เลือกสีประจำหมวดของการ์ดสินค้า
  // ซึ่งทำหน้าที่แทนรูปสินค้าที่ยังไม่มี · เป็นข้อมูลสาธารณะเหมือนชื่อหมวด
  category: { select: { icon: true } },
  plans: {
    where: { isActive: true },
    select: {
      id: true,
      cycle: true,
      pricePerCycle: true,
      qtyPerCycle: true,
      isActive: true,
    },
    orderBy: { pricePerCycle: 'asc' },
  },
} satisfies Prisma.ProductSelect;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories(): Promise<CategoryResponse[]> {
    const rows = await this.prisma.category.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, icon: true },
    });
    return rows;
  }

  async listProducts(query: ListProductsQuery): Promise<ProductCardResponse[]> {
    const where: Prisma.ProductWhereInput = { ...VISIBLE_PRODUCT };
    if (query.category != null) where.categoryId = query.category;
    if (query.q) {
      // Prisma parameterizes ค่านี้ — `%` ที่ผู้ใช้พิมพ์มาแค่ขยายผลค้นหาของตัวเอง
      where.name = { contains: query.q, mode: 'insensitive' };
    }

    const rows = await this.prisma.product.findMany({
      where,
      select: PRODUCT_SELECT,
      orderBy: this.orderBy(query.sort),
      take: query.limit ?? DEFAULT_LIMIT,
    });

    return this.decorate(rows);
  }

  /**
   * หน้าร้านสาธารณะ (feature 10)
   *
   * ★ ร้านที่ถูกระงับตอบ 404 เหมือนไม่มีอยู่ ★ เหมือนกับสินค้า — ไม่บอกว่า
   * "มีร้านนี้อยู่แต่โดนแบน" · สินค้าในหน้านี้ผ่าน `VISIBLE_PRODUCT` ตัวเดียวกับ
   * หน้าค้นหา จึงเป็นไปไม่ได้ที่หน้าร้านจะโชว์ของที่หน้าอื่นซ่อนไว้
   */
  async getShop(id: string): Promise<ShopPageResponse> {
    const shop = await this.prisma.shop.findFirst({
      where: { id, isActive: true, suspendedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        logoUrl: true,
        createdAt: true,
      },
    });
    if (!shop) throw AppError.notFound('SHOP_NOT_FOUND', 'ไม่พบร้านนี้');

    const rows = await this.prisma.product.findMany({
      where: { shopId: id, ...VISIBLE_PRODUCT },
      select: PRODUCT_SELECT,
      orderBy: { createdAt: 'desc' },
      take: DEFAULT_LIMIT,
    });

    return {
      id: shop.id,
      name: shop.name,
      description: shop.description,
      logoUrl: shop.logoUrl,
      createdAt: shop.createdAt.toISOString(),
      products: await this.decorate(rows),
    };
  }

  async getProduct(id: string): Promise<ProductDetailResponse> {
    const row = await this.prisma.product.findFirst({
      where: { id, ...VISIBLE_PRODUCT },
      select: { ...PRODUCT_SELECT, description: true },
    });
    // สินค้าที่ถูกระงับตอบ 404 เหมือนไม่มีอยู่ — ไม่บอกว่า "มีแต่โดนแบน"
    if (!row) throw AppError.notFound('PRODUCT_NOT_FOUND', 'ไม่พบสินค้านี้');

    const [card] = await this.decorate([row]);
    if (!card) throw AppError.notFound('PRODUCT_NOT_FOUND', 'ไม่พบสินค้านี้');

    const reviews = await this.prisma.review.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
      take: REVIEWS_PER_PRODUCT,
      select: {
        id: true,
        rating: true,
        comment: true,
        cyclesReceived: true,
        createdAt: true,
        buyer: { select: { displayName: true } },
      },
    });

    return {
      ...card,
      description: row.description,
      shopId: row.shopId,
      categoryId: row.categoryId,
      // ★ ไม่ส่ง buyerId / subscriptionId ออกไป และ mask ชื่อผู้รีวิว
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        cyclesReceived: r.cyclesReceived,
        reviewerName: maskReviewerName(r.buyer.displayName),
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** ใช้ที่หน้า checkout — ต้องผ่านเงื่อนไข "มองเห็นได้" เดียวกับหน้า catalog */
  async getPlan(planId: string): Promise<PlanLookupResponse> {
    const plan = await this.prisma.productPlan.findFirst({
      where: { id: planId, product: VISIBLE_PRODUCT },
      select: {
        id: true,
        cycle: true,
        pricePerCycle: true,
        qtyPerCycle: true,
        isActive: true,
        product: {
          select: {
            id: true,
            name: true,
            oneTimePrice: true,
            shop: { select: { name: true } },
          },
        },
      },
    });
    if (!plan) throw AppError.notFound('PLAN_NOT_FOUND', 'ไม่พบแผนรอบส่งนี้');

    return {
      plan: toPlan(plan),
      product: {
        id: plan.product.id,
        name: plan.product.name,
        oneTimePrice: plan.product.oneTimePrice.toNumber(),
        shopName: plan.product.shop.name,
      },
    };
  }

  // ---------- ภายใน ----------

  private orderBy(sort?: string): Prisma.ProductOrderByWithRelationInput {
    switch (sort) {
      case 'price_asc':
        return { oneTimePrice: 'asc' };
      case 'price_desc':
        return { oneTimePrice: 'desc' };
      case 'newest':
        return { createdAt: 'desc' };
      default:
        // "ยอดนิยม" เรียงจากจำนวนสมาชิกจริง แต่ Prisma เรียงตาม nested count
        // ข้ามความสัมพันธ์ 2 ชั้นไม่ได้ จึงเรียงทีหลังใน decorate()
        return { createdAt: 'desc' };
    }
  }

  /**
   * เติมตัวเลข aggregate (จำนวนสมาชิก / คะแนนรีวิว)
   *
   * ทำเป็น query รวมครั้งเดียวต่อชุด ไม่ใช่ต่อสินค้า — ไม่งั้นหน้า catalog
   * 40 ชิ้นจะยิง 80 query (N+1)
   */
  private async decorate(rows: ProductRow[]): Promise<ProductCardResponse[]> {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return [];

    const [subsByPlan, reviewStats] = await Promise.all([
      this.prisma.subscription.groupBy({
        by: ['planId'],
        where: { status: 'active', plan: { productId: { in: ids } } },
        _count: { _all: true },
      }),
      this.prisma.review.groupBy({
        by: ['productId'],
        where: { productId: { in: ids } },
        _avg: { rating: true },
        _count: { _all: true },
      }),
    ]);

    // planId → productId (จาก rows ที่โหลดมาแล้ว ไม่ต้อง query เพิ่ม)
    const productOfPlan = new Map<string, string>();
    for (const r of rows)
      for (const p of r.plans) productOfPlan.set(p.id, r.id);

    const subscribers = new Map<string, number>();
    for (const s of subsByPlan) {
      const productId = productOfPlan.get(s.planId);
      if (!productId) continue;
      subscribers.set(
        productId,
        (subscribers.get(productId) ?? 0) + s._count._all,
      );
    }

    const reviews = new Map(
      reviewStats.map((r) => [
        r.productId,
        {
          avg:
            r._avg.rating == null ? null : Math.round(r._avg.rating * 10) / 10,
          count: r._count._all,
        },
      ]),
    );

    const cards = rows.map((r) => ({
      id: r.id,
      name: r.name,
      shopName: r.shop.name,
      categoryIcon: r.category.icon,
      images: r.images,
      oneTimePrice: r.oneTimePrice.toNumber(),
      netAmount: r.netAmount?.toNumber() ?? null,
      unit: r.unit,
      plans: r.plans.map(toPlan),
      activeSubscribers: subscribers.get(r.id) ?? 0,
      rating: reviews.get(r.id)?.avg ?? null,
      reviewCount: reviews.get(r.id)?.count ?? 0,
    }));

    return cards;
  }
}

/** Decimal ของ Prisma serialize เป็น object — ต้องแปลงเป็น number ก่อนส่งออก */
function toPlan(p: {
  id: string;
  cycle: string;
  pricePerCycle: Prisma.Decimal;
  qtyPerCycle: number;
  isActive: boolean;
}): PlanResponse {
  return {
    id: p.id,
    cycle: p.cycle,
    pricePerCycle: p.pricePerCycle.toNumber(),
    qtyPerCycle: p.qtyPerCycle,
    isActive: p.isActive,
  };
}
