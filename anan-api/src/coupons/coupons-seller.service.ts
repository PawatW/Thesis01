import { Injectable } from '@nestjs/common';
import { Prisma, type CouponTier } from '@prisma/client';
import { AppError } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { COUPON_INCLUDE, toAdminCoupon } from './coupons-admin.service';
import { computeDiscount, discountLabel, grossAmount } from './discount';
import type {
  CreateShopCouponDto,
  ProductCouponsResponse,
  SellerCouponResponse,
  SetProductCouponsDto,
  ShopCouponResponse,
  UpdateCouponDto,
} from './dto/coupon.dto';

/** เพดานแถวของทุกรายการที่ส่งออก (security-rules B-11) */
const MAX_ROWS = 100;

/**
 * คูปองฝั่งร้านค้า (feature 18 ชั้นที่ 2 · W13 Flow B)
 *
 * ร้านทำได้ 2 อย่าง:
 *   1. **ออกคูปองของร้านเอง** (`tier = shop`) — ครอบทั้งร้านหรือเลือกสินค้าเอง
 *   2. **กดเข้าร่วมแคมเปญของแพลตฟอร์ม** รายสินค้า (`coupon_products`)
 * และตั้ง **นโยบายคูปองรายสินค้า** ว่าชิ้นไหนรับระดับไหนบ้าง
 *
 * ★ ทั้งสองอย่างคือคำตอบของ "ใครรับภาระส่วนลด" ★ ร้านเป็นคนกดเองทั้งคู่
 * ระบบจึงไม่ต้องมีโมเดลส่วนแบ่งรายได้/ค่าคอมมิชชัน (ซึ่งไม่มีในขอบเขต thesis)
 *
 * ★ `tier` ไม่เคยมาจาก body ★ ทุกเมธอดในไฟล์นี้เขียน `tier: 'shop'` ตายตัว —
 * ถ้ารับจาก DTO ร้านจะออกคูปองระดับแพลตฟอร์มได้ด้วย curl บรรทัดเดียว
 */
@Injectable()
export class CouponsSellerService {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================================
  // คูปองที่ร้านออกเอง
  // ==========================================================

  async listMine(ownerId: string): Promise<ShopCouponResponse[]> {
    const shopId = await this.requireShopId(ownerId, 'read');
    const rows = await this.prisma.coupon.findMany({
      where: { tier: 'shop', shopId },
      orderBy: [{ isActive: 'desc' }, { endsAt: 'desc' }],
      include: { ...COUPON_INCLUDE, products: { select: { productId: true } } },
      take: MAX_ROWS,
    });
    if (rows.length === 0) return [];

    const tallies = await this.prisma.couponRedemption.groupBy({
      by: ['couponId', 'status'],
      where: { couponId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    });
    const now = new Date();

    return rows.map((row) => {
      const mine = tallies.filter((t) => t.couponId === row.id);
      const countOf = (s: string) =>
        mine.find((t) => t.status === s)?._count._all ?? 0;
      return {
        ...toAdminCoupon(row, now),
        productCount: row._count.products,
        productIds: row.products.map((p) => p.productId),
        reservedCount: countOf('reserved'),
        consumedCount: countOf('consumed'),
        releasedCount: countOf('released'),
      };
    });
  }

  /**
   * ออกคูปองของร้าน
   *
   * ขอบเขตมี 2 โหมด: ครอบทั้งร้าน (รวมสินค้าที่เพิ่มทีหลัง) หรือเลือกสินค้าเอง —
   * โหมดหลังต้องเป็นสินค้าของร้านผู้เรียกทุกชิ้น ตรวจด้วย `count` ที่ผูก `shopId`
   * ไม่ใช่เชื่อ id ที่ส่งมา
   */
  async create(
    ownerId: string,
    dto: CreateShopCouponDto,
  ): Promise<ShopCouponResponse> {
    const shopId = await this.requireShopId(ownerId, 'write');
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this.assertTerms(dto, startsAt, endsAt);

    const productIds = dto.appliesToAllProducts ? [] : (dto.productIds ?? []);
    if (!dto.appliesToAllProducts) {
      if (productIds.length === 0) {
        throw AppError.unprocessable(
          'COUPON_SCOPE_EMPTY',
          'เลือกสินค้าที่ใช้คูปองนี้ได้อย่างน้อย 1 ชิ้น หรือตั้งเป็นใช้ได้ทั้งร้าน',
        );
      }
      await this.assertOwnedProducts(shopId, productIds);
    }

    const created = await this.guardDuplicateCode(() =>
      this.prisma.coupon.create({
        data: {
          code: dto.code,
          title: dto.title,
          description: dto.description ?? null,
          // ★ ตายตัว ★ ไม่รับจาก DTO (ดูหมายเหตุหัวคลาส)
          tier: 'shop',
          shopId,
          appliesToAllProducts: dto.appliesToAllProducts,
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          maxDiscountAmount: dto.maxDiscountAmount ?? null,
          minOrderAmount: dto.minOrderAmount ?? null,
          startsAt,
          endsAt,
          maxRedemptions: dto.maxRedemptions ?? null,
          createdBy: ownerId,
          ...(productIds.length === 0
            ? {}
            : {
                products: {
                  create: productIds.map((productId) => ({
                    productId,
                    enabledBy: ownerId,
                  })),
                },
              }),
        },
        include: {
          ...COUPON_INCLUDE,
          products: { select: { productId: true } },
        },
      }),
    );

    return {
      ...toAdminCoupon(created, new Date()),
      productCount: created._count.products,
      productIds: created.products.map((p) => p.productId),
      reservedCount: 0,
      consumedCount: 0,
      releasedCount: 0,
    };
  }

  /** แก้คูปองของร้านตัวเอง — ข้อจำกัดเดียวกับฝั่ง admin (ชนิด/มูลค่าแก้ไม่ได้) */
  async update(
    ownerId: string,
    id: string,
    dto: UpdateCouponDto,
  ): Promise<ShopCouponResponse> {
    const shopId = await this.requireShopId(ownerId, 'write');
    const current = await this.loadOwnedCoupon(shopId, id);

    const endsAt = dto.endsAt === undefined ? undefined : new Date(dto.endsAt);
    if (endsAt && endsAt <= current.startsAt) {
      throw AppError.unprocessable(
        'COUPON_WINDOW_INVALID',
        'วันสิ้นสุดต้องอยู่หลังวันเริ่ม',
      );
    }
    if (
      dto.maxRedemptions !== undefined &&
      dto.maxRedemptions !== null &&
      dto.maxRedemptions < current.inUseCount
    ) {
      throw AppError.unprocessable(
        'COUPON_QUOTA_BELOW_USED',
        `ลดโควตาต่ำกว่าจำนวนที่ใช้ไปแล้วไม่ได้ (ตอนนี้ ${current.inUseCount})`,
      );
    }

    await this.prisma.coupon.update({
      where: { id },
      data: {
        ...(dto.title === undefined ? {} : { title: dto.title }),
        ...(dto.description === undefined
          ? {}
          : { description: dto.description }),
        ...(endsAt === undefined ? {} : { endsAt }),
        ...(dto.maxRedemptions === undefined
          ? {}
          : { maxRedemptions: dto.maxRedemptions }),
      },
    });
    return this.oneOfMine(shopId, id);
  }

  /**
   * ปิดคูปองของร้าน — ห้ามจองใหม่ แต่ **ใบที่จองไว้แล้วยังใช้ได้ตามที่จอง**
   * (ใบจองถือ snapshot ของเงื่อนไขไว้แล้ว การตัดสิทธิ์ย้อนหลังคือการผิดคำพูดกับผู้ซื้อ)
   */
  async deactivate(ownerId: string, id: string): Promise<ShopCouponResponse> {
    const shopId = await this.requireShopId(ownerId, 'write');
    await this.loadOwnedCoupon(shopId, id);

    // สถานะเดิมอยู่ใน where — กดปิดพร้อมกัน 2 หน้าต่างต้องสำเร็จครั้งเดียว
    const done = await this.prisma.coupon.updateMany({
      where: { id, shopId, isActive: true },
      data: { isActive: false },
    });
    if (done.count === 0) {
      throw AppError.conflict('COUPON_ALREADY_INACTIVE', 'คูปองนี้ปิดไปแล้ว');
    }
    return this.oneOfMine(shopId, id);
  }

  // ==========================================================
  // คูปอง + นโยบาย ของสินค้าหนึ่งชิ้น
  // ==========================================================

  /** คูปองทั้งสองระดับที่เกี่ยวกับสินค้าชิ้นนี้ + นโยบายปัจจุบัน */
  async listForProduct(
    ownerId: string,
    productId: string,
  ): Promise<ProductCouponsResponse> {
    const product = await this.loadOwnedProduct(ownerId, productId, 'read');
    const now = new Date();

    const [coupons, enrolled] = await Promise.all([
      this.prisma.coupon.findMany({
        // ใบที่หมดอายุ/ปิดแล้วไม่ต้องโผล่มาให้กดเข้าร่วม
        where: {
          isActive: true,
          endsAt: { gte: now },
          // แพลตฟอร์มทุกใบ + คูปองของร้านตัวเองเท่านั้น (ของร้านอื่นต้องไม่โผล่)
          OR: [{ tier: 'platform' }, { tier: 'shop', shopId: product.shopId }],
        },
        orderBy: [{ tier: 'asc' }, { endsAt: 'asc' }],
        take: MAX_ROWS,
      }),
      this.prisma.couponProduct.findMany({
        where: { productId },
        select: { couponId: true },
      }),
    ]);
    const enrolledIds = new Set(enrolled.map((e) => e.couponId));

    // แผนที่แพงที่สุดที่ยังเปิดอยู่ = กรณีที่ส่วนลดสูงสุดสำหรับสินค้าชิ้นนี้
    const topPrice = product.plans[0]?.pricePerCycle ?? null;

    const toRow = (coupon: (typeof coupons)[number]): SellerCouponResponse => {
      // ประเมินที่จำนวน 1 ชิ้น — ผู้ซื้อสั่งได้ 1-10 ชิ้น ตัวเลขนี้จึงเป็น "ต่อชิ้น"
      // ไม่ใช่เพดานสัมบูรณ์ (คูปอง percent ที่ไม่มีเพดานจะโตตามจำนวน)
      const calc =
        topPrice === null
          ? null
          : computeDiscount(grossAmount(topPrice, 1), coupon);
      const covered = coupon.tier === 'shop' && coupon.appliesToAllProducts;
      return {
        id: coupon.id,
        code: coupon.code,
        title: coupon.title,
        description: coupon.description,
        label: discountLabel(coupon),
        tier: coupon.tier,
        minOrderAmount: coupon.minOrderAmount?.toNumber() ?? null,
        startsAt: coupon.startsAt.toISOString(),
        endsAt: coupon.endsAt.toISOString(),
        enabled: covered || enrolledIds.has(coupon.id),
        coveredByAllProducts: covered,
        maxDiscountPerCycle:
          calc !== null && calc.ok ? calc.discount.toNumber() : null,
      };
    };

    return {
      couponPolicy: product.couponPolicy,
      platform: coupons.filter((c) => c.tier === 'platform').map(toRow),
      shop: coupons.filter((c) => c.tier === 'shop').map(toRow),
    };
  }

  /**
   * ตั้งคูปอง + นโยบายของสินค้าหนึ่ง — แทนที่ทั้งชุด (idempotent)
   *
   * ส่งชุดเดิมมาซ้ำได้โดยไม่มีอะไรเปลี่ยน · ส่ง `[]` = ถอนออกทุกใบ
   * คูปองของร้านที่ตั้งเป็น "ทั้งร้าน" ไม่ต้องอยู่ในชุดนี้ (ครอบอยู่แล้วโดยอัตโนมัติ)
   */
  async setForProduct(
    ownerId: string,
    productId: string,
    dto: SetProductCouponsDto,
  ): Promise<ProductCouponsResponse> {
    // ★ 'write' ★ ร้าน/สินค้าที่ผู้ดูแลระงับต้องแก้อะไรไม่ได้ รวมถึงการเข้าร่วมคูปอง
    const product = await this.loadOwnedProduct(ownerId, productId, 'write');

    if (dto.couponIds.length > 0) {
      const now = new Date();
      // ★ ต้องเป็นคูปองแพลตฟอร์ม หรือคูปองของร้านตัวเองเท่านั้น ★
      // ถ้าไม่ผูก shopId ร้านจะดึงคูปองของร้านอื่นมาแปะสินค้าตัวเองได้
      const usable = await this.prisma.coupon.count({
        where: {
          id: { in: dto.couponIds },
          isActive: true,
          endsAt: { gte: now },
          OR: [{ tier: 'platform' }, { tier: 'shop', shopId: product.shopId }],
        },
      });
      if (usable !== dto.couponIds.length) {
        throw AppError.notFound(
          'COUPON_NOT_FOUND',
          'มีคูปองที่เลือกไว้ปิด หมดอายุ หรือไม่ใช่ของร้านนี้',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: { couponPolicy: dto.couponPolicy },
      });
      await tx.couponProduct.deleteMany({
        where: { productId, couponId: { notIn: dto.couponIds } },
      });
      if (dto.couponIds.length > 0) {
        await tx.couponProduct.createMany({
          data: dto.couponIds.map((couponId) => ({
            couponId,
            productId,
            enabledBy: ownerId,
          })),
          // ใบที่เข้าร่วมอยู่แล้วไม่ต้องเขียนใหม่ — `enabledAt` เดิมคือข้อเท็จจริง
          skipDuplicates: true,
        });
      }
    });

    return this.listForProduct(ownerId, productId);
  }

  // ---------- ภายใน ----------

  /**
   * ร้านของผู้เรียก — `write` เพิ่มเงื่อนไขว่าร้านต้องไม่ถูกผู้ดูแลระงับ
   * (กฎเดียวกับ `SellerProductsService` — ร้านที่ถูกระงับแก้อะไรไม่ได้)
   */
  private async requireShopId(
    ownerId: string,
    mode: 'read' | 'write',
  ): Promise<string> {
    const shop = await this.prisma.shop.findFirst({
      where: { ownerId, ...(mode === 'write' ? { suspendedAt: null } : {}) },
      select: { id: true },
    });
    if (!shop)
      throw AppError.notFound('SHOP_NOT_FOUND', 'ไม่พบร้านของบัญชีนี้');
    return shop.id;
  }

  /** คูปองของร้านผู้เรียกเท่านั้น — ของร้านอื่นตอบ 404 ไม่ใช่ 403 */
  private async loadOwnedCoupon(shopId: string, id: string) {
    const coupon = await this.prisma.coupon.findFirst({
      where: { id, tier: 'shop', shopId },
      select: { id: true, startsAt: true, inUseCount: true, isActive: true },
    });
    if (!coupon) throw AppError.notFound('COUPON_NOT_FOUND', 'ไม่พบคูปองนี้');
    return coupon;
  }

  private async oneOfMine(
    shopId: string,
    id: string,
  ): Promise<ShopCouponResponse> {
    const row = await this.prisma.coupon.findUniqueOrThrow({
      where: { id },
      include: { ...COUPON_INCLUDE, products: { select: { productId: true } } },
    });
    const tallies = await this.prisma.couponRedemption.groupBy({
      by: ['status'],
      where: { couponId: id },
      _count: { _all: true },
    });
    const countOf = (s: string) =>
      tallies.find((t) => t.status === s)?._count._all ?? 0;
    void shopId;
    return {
      ...toAdminCoupon(row, new Date()),
      productCount: row._count.products,
      productIds: row.products.map((p) => p.productId),
      reservedCount: countOf('reserved'),
      consumedCount: countOf('consumed'),
      releasedCount: countOf('released'),
    };
  }

  /** สินค้าทุกชิ้นต้องเป็นของร้านนี้จริง — นับเทียบจำนวน ไม่เชื่อ id ที่ส่งมา */
  private async assertOwnedProducts(
    shopId: string,
    productIds: string[],
  ): Promise<void> {
    const mine = await this.prisma.product.count({
      where: { id: { in: productIds }, shopId },
    });
    if (mine !== productIds.length) {
      throw AppError.notFound(
        'PRODUCT_NOT_FOUND',
        'มีสินค้าที่เลือกไว้ไม่ใช่ของร้านนี้',
      );
    }
  }

  /**
   * สินค้าของร้านผู้เรียกเท่านั้น — ownership อยู่ใน `where` ไม่ใช่ `if`
   * ของร้านอื่นตอบ 404 ไม่ใช่ 403 (403 เป็นการยืนยันว่า id นี้มีอยู่จริง)
   */
  private async loadOwnedProduct(
    ownerId: string,
    productId: string,
    mode: 'read' | 'write',
  ) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        shop: { ownerId, ...(mode === 'write' ? { suspendedAt: null } : {}) },
        ...(mode === 'write' ? { suspendedAt: null } : {}),
      },
      select: {
        id: true,
        shopId: true,
        couponPolicy: true,
        plans: {
          where: { isActive: true },
          orderBy: { pricePerCycle: 'desc' },
          take: 1,
          select: { pricePerCycle: true },
        },
      },
    });
    if (!product) {
      throw AppError.notFound('PRODUCT_NOT_FOUND', 'ไม่พบสินค้านี้');
    }
    return product;
  }

  /**
   * กฎที่ CHECK ที่ DB บังคับอยู่แล้ว แต่ต้องตรวจที่นี่ด้วยเพื่อให้ได้ 422 ที่อ่านออก
   * แทน 500 จาก constraint violation (กฎข้อ 9 — ต้องมีทั้ง DTO/service และ DB)
   */
  private assertTerms(
    dto: CreateShopCouponDto,
    startsAt: Date,
    endsAt: Date,
  ): void {
    if (endsAt <= startsAt) {
      throw AppError.unprocessable(
        'COUPON_WINDOW_INVALID',
        'วันสิ้นสุดต้องอยู่หลังวันเริ่ม',
      );
    }
    if (dto.discountType === 'percent' && dto.discountValue > 100) {
      throw AppError.unprocessable(
        'COUPON_PERCENT_TOO_HIGH',
        'ส่วนลดแบบเปอร์เซ็นต์เกิน 100% ไม่ได้',
      );
    }
    if (
      dto.discountType === 'fixed' &&
      dto.maxDiscountAmount !== undefined &&
      dto.maxDiscountAmount !== null
    ) {
      throw AppError.unprocessable(
        'COUPON_CAP_NOT_ALLOWED',
        'เพดานส่วนลดใช้ได้เฉพาะคูปองแบบเปอร์เซ็นต์',
      );
    }
  }

  private async guardDuplicateCode<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // โค้ด unique ทั้งตาราง (ไม่ใช่ต่อร้าน) — ผู้ซื้อพูดถึงคูปองด้วยโค้ด
        // โค้ดซ้ำสองใบคนละร้านจะทำให้ใบเสร็จอธิบายกันไม่รู้เรื่อง
        throw AppError.conflict(
          'COUPON_CODE_TAKEN',
          'โค้ดนี้ถูกใช้ไปแล้ว (โค้ดต้องไม่ซ้ำกับร้านอื่นและของแพลตฟอร์ม)',
        );
      }
      throw e;
    }
  }
}

/** ระดับที่ร้านออกได้ — มีค่าเดียว มีไว้ให้ชื่อพูดแทนตัวเลข */
export const SELLER_TIER: CouponTier = 'shop';
