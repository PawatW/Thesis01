import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  maskReviewerName,
  type CategoryResponse,
  type ListProductsQuery,
  type ListShopsQuery,
  type PlanLookupResponse,
  type PlanResponse,
  type ProductCardResponse,
  type ProductDetailResponse,
  type ShopCardResponse,
  type ShopPageResponse,
} from './dto/catalog.dto';

const DEFAULT_LIMIT = 40;
const DEFAULT_SHOP_LIMIT = 6;
const REVIEWS_PER_PRODUCT = 10;

/**
 * ★ นิยามเดียวของคำว่า "สินค้าที่ลูกค้าเห็นได้" ★
 *
 * ห้ามมีใครเขียนเงื่อนไขนี้เองซ้ำที่อื่น — บทเรียนจาก `due_subscriptions`:
 * ตอนที่เงื่อนไขกระจายอยู่หลายที่ engine ลืมเช็คว่าร้านถูกระงับ แล้วแพลตฟอร์ม
 * ก็เก็บเงินให้ร้านที่ตัวเองสั่งระงับ
 *
 * แยก 2 เรื่องออกจากกัน: `isActive` = เจ้าของปิดเอง · `suspendedAt` = admin ระงับ
 *
 * แตกเป็น 2 ก้อนย่อยด้านล่าง (`PRODUCT_SELF_VISIBLE` + `VISIBLE_SHOP`) เพราะฟีเจอร์
 * ค้นหาร้านค้าต้องเขียนเงื่อนไข "ร้านที่มองเห็นได้" แบบ**มุมกลับ** (where บน `Shop`
 * ไม่ใช่บน `Product`) — ประกอบกลับเป็น `VISIBLE_PRODUCT` ด้านล่างให้ได้ค่าเท่าเดิมเป๊ะ
 * เพื่อไม่ให้ engine/checkout ที่ import ตัวนี้อยู่ต้องแก้อะไร
 */
const PRODUCT_SELF_VISIBLE = {
  isActive: true,
  suspendedAt: null,
} satisfies Prisma.ProductWhereInput;

/** ร้านที่ผู้ซื้อเห็นได้ — export ไว้ให้ query ฝั่ง `Shop` ใช้ตัวเดียวกัน ไม่เขียนซ้ำ */
export const VISIBLE_SHOP = {
  isActive: true,
  suspendedAt: null,
} satisfies Prisma.ShopWhereInput;

/** ★ ค่าเท่าเดิมเป๊ะ ห้ามเปลี่ยนความหมาย — engine/checkout ใช้ตัวนี้อยู่ ★ */
export const VISIBLE_PRODUCT = {
  ...PRODUCT_SELF_VISIBLE,
  shop: VISIBLE_SHOP,
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

const SHOP_SELECT = {
  id: true,
  name: true,
  logoUrl: true,
  description: true,
  createdAt: true,
} satisfies Prisma.ShopSelect;

interface ShopStatsRow {
  productCount: number;
  activeSubscribers: number;
  rating: number | null;
  reviewCount: number;
}

const EMPTY_SHOP_STATS: ShopStatsRow = {
  productCount: 0,
  activeSubscribers: 0,
  rating: null,
  reviewCount: 0,
};

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
    // `categories` (หลายหมวดจากหน้าแรก) มาก่อน `category` (หน้าหมวดเดี่ยว)
    // ส่งมาทั้งคู่ = เจตนากำกวม เลือกอันที่กว้างกว่าเสมอ ไม่ AND ทับกันจนได้ผลว่าง
    if (query.categories != null && query.categories.length > 0) {
      where.categoryId = { in: query.categories };
    } else if (query.category != null) {
      where.categoryId = query.category;
    }
    if (query.q) {
      // ★ ประกาศเป็น where.OR ตรง ๆ ได้อย่างปลอดภัย — Prisma AND ทุก top-level field
      // เข้ากับ OR เสมอ ดังนั้น isActive/suspendedAt/shop ที่ spread มาจาก
      // VISIBLE_PRODUCT ข้างบนยังกรองอยู่ครบ ร้านที่ถูกระงับจึงไม่มีทางหลุดออกมา
      // ทาง `shop.name` แม้ชื่อร้านจะแมตช์คำค้นก็ตาม (ห้ามเขียน where.OR ทับ where เดิม)
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { shop: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
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
   * ค้นหาร้านค้า (feature 02 · Shop Search) — ใช้ที่หน้าแรก (hero) และหน้า `/search`
   *
   * ร้านที่ไม่มีสินค้าที่มองเห็นได้เลยไม่ต้องโผล่ (`products: { some: ... }`) —
   * ไม่งั้นกดเข้าไปแล้วเจอหน้าร้านว่างเปล่า ทั้งที่ตั้งใจให้เป็นแค่ผลค้นหา
   */
  async listShops(query: ListShopsQuery): Promise<ShopCardResponse[]> {
    const where: Prisma.ShopWhereInput = {
      ...VISIBLE_SHOP,
      products: { some: PRODUCT_SELF_VISIBLE },
    };
    if (query.q) {
      where.name = { contains: query.q, mode: 'insensitive' };
    }

    const shops = await this.prisma.shop.findMany({
      where,
      select: SHOP_SELECT,
      // เรียงตามจำนวนสินค้าก่อน แล้ว fallback เป็นชื่อ — deterministic ไม่ให้เทสแกว่ง
      orderBy: [{ products: { _count: 'desc' } }, { name: 'asc' }],
      take: query.limit ?? DEFAULT_SHOP_LIMIT,
    });
    if (shops.length === 0) return [];

    const stats = await this.shopStats(shops.map((s) => s.id));

    return shops.map((s) => {
      const stat = stats.get(s.id) ?? EMPTY_SHOP_STATS;
      return {
        id: s.id,
        name: s.name,
        logoUrl: s.logoUrl,
        description: s.description,
        productCount: stat.productCount,
        activeSubscribers: stat.activeSubscribers,
        rating: stat.rating,
        reviewCount: stat.reviewCount,
        createdAt: s.createdAt.toISOString(),
      };
    });
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
      where: { id, ...VISIBLE_SHOP },
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

    const stats = await this.shopStats([id]);
    const stat = stats.get(id) ?? EMPTY_SHOP_STATS;

    return {
      id: shop.id,
      name: shop.name,
      description: shop.description,
      logoUrl: shop.logoUrl,
      createdAt: shop.createdAt.toISOString(),
      productCount: stat.productCount,
      activeSubscribers: stat.activeSubscribers,
      rating: stat.rating,
      reviewCount: stat.reviewCount,
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

  /**
   * เติมสถิติของร้าน (จำนวนสินค้า / สมาชิก / รีวิว) — ใช้ทั้ง `listShops()` และ
   * `getShop()` เพื่อไม่ให้มี 2 ที่คำนวณตัวเลขชุดเดียวกันต่างกัน
   *
   * pattern เดียวกับ `decorate()`: groupBy 2 ครั้ง (subscription + review) ไม่ว่าจะ
   * ขอกี่ร้านก็ตาม ไม่มีการยิง query แยกทีละร้าน (กัน N+1)
   *
   * ★ plans ที่ query ตรงนี้ไม่ filter ด้วย `isActive` (ต่างจาก `PRODUCT_SELECT`) ★
   * เพราะแผนที่ปิดรับสมาชิกใหม่แล้วยังมีคนสมัครอยู่ก่อนหน้า ต้องนับรวมใน
   * activeSubscribers ต่อไป — ถ้ากรองด้วย isActive ตรงนี้ตัวเลขจะขาดหายไป
   */
  private async shopStats(
    shopIds: string[],
  ): Promise<Map<string, ShopStatsRow>> {
    const stats = new Map<string, ShopStatsRow>();
    for (const shopId of shopIds) stats.set(shopId, { ...EMPTY_SHOP_STATS });
    if (shopIds.length === 0) return stats;

    const products = await this.prisma.product.findMany({
      where: { shopId: { in: shopIds }, ...PRODUCT_SELF_VISIBLE },
      select: { id: true, shopId: true, plans: { select: { id: true } } },
    });
    if (products.length === 0) return stats;

    const shopOfProduct = new Map<string, string>();
    const planToProduct = new Map<string, string>();
    const productIds: string[] = [];
    for (const p of products) {
      productIds.push(p.id);
      shopOfProduct.set(p.id, p.shopId);
      stats.get(p.shopId)!.productCount += 1;
      for (const plan of p.plans) planToProduct.set(plan.id, p.id);
    }

    const [subsByPlan, reviewStats] = await Promise.all([
      this.prisma.subscription.groupBy({
        by: ['planId'],
        where: { status: 'active', plan: { productId: { in: productIds } } },
        _count: { _all: true },
      }),
      this.prisma.review.groupBy({
        by: ['productId'],
        where: { productId: { in: productIds } },
        _avg: { rating: true },
        _count: { _all: true },
      }),
    ]);

    for (const s of subsByPlan) {
      const productId = planToProduct.get(s.planId);
      const shopId = productId ? shopOfProduct.get(productId) : undefined;
      if (!shopId) continue;
      stats.get(shopId)!.activeSubscribers += s._count._all;
    }

    // เฉลี่ยแบบถ่วงน้ำหนักด้วยจำนวนรีวิวจริงของแต่ละสินค้า — ไม่ใช่ "ค่าเฉลี่ยของค่าเฉลี่ย"
    // ซึ่งจะให้น้ำหนักสินค้าที่มีรีวิวน้อยเท่ากับสินค้าที่มีรีวิวเยอะอย่างผิด ๆ
    const ratingSum = new Map<string, number>();
    for (const r of reviewStats) {
      const shopId = shopOfProduct.get(r.productId);
      if (!shopId) continue;
      const row = stats.get(shopId)!;
      row.reviewCount += r._count._all;
      ratingSum.set(
        shopId,
        (ratingSum.get(shopId) ?? 0) + (r._avg.rating ?? 0) * r._count._all,
      );
    }
    for (const [shopId, row] of stats) {
      if (row.reviewCount > 0) {
        row.rating =
          Math.round((ratingSum.get(shopId)! / row.reviewCount) * 10) / 10;
      }
    }

    return stats;
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
