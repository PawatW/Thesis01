import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isCycle } from '../common/date';
import { AppError } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateProductDto,
  SellerPlanResponse,
  SellerProductResponse,
  UpdatePlanDto,
  UpdateProductDto,
} from './dto/product.dto';
import { ShopService } from './shop.service';

/** เพดานสินค้าต่อร้านที่คืนในคำขอเดียว (B-11) */
const MAX_PRODUCTS = 200;

const PRODUCT_SELECT = {
  id: true,
  name: true,
  description: true,
  categoryId: true,
  images: true,
  oneTimePrice: true,
  netAmount: true,
  unit: true,
  isActive: true,
  suspendedAt: true,
  createdAt: true,
  plans: {
    select: {
      id: true,
      cycle: true,
      pricePerCycle: true,
      qtyPerCycle: true,
      isActive: true,
    },
    orderBy: { cycle: 'asc' },
  },
} satisfies Prisma.ProductSelect;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

@Injectable()
export class SellerProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shops: ShopService,
  ) {}

  async list(userId: string): Promise<SellerProductResponse[]> {
    const shop = await this.shops.requireShop(userId);
    const rows = await this.prisma.product.findMany({
      where: { shopId: shop.id },
      select: PRODUCT_SELECT,
      orderBy: { createdAt: 'desc' },
      // เพดานแถวเหมือนทุก endpoint ที่คืนรายการ (security-rules B-11) —
      // ร้านในเดโม่มีสินค้าหลักสิบชิ้น เกินกว่านี้ค่อยทำ pagination จริง
      take: MAX_PRODUCTS,
    });
    return this.withSubscriberCounts(rows);
  }

  async findOne(userId: string, id: string): Promise<SellerProductResponse> {
    // ownership อยู่ใน where ผ่านความสัมพันธ์ — ของร้านอื่นตอบ 404 ไม่ใช่ 403
    const row = await this.prisma.product.findFirst({
      where: { id, shop: { ownerId: userId } },
      select: PRODUCT_SELECT,
    });
    if (!row) throw AppError.notFound('PRODUCT_NOT_FOUND', 'ไม่พบสินค้านี้');
    const [card] = await this.withSubscriberCounts([row]);
    if (!card) throw AppError.notFound('PRODUCT_NOT_FOUND', 'ไม่พบสินค้านี้');
    return card;
  }

  /** ลงสินค้า — สินค้า + แผนต้องเกิดพร้อมกัน ไม่งั้นได้สินค้าที่สมัครไม่ได้ */
  async create(
    userId: string,
    dto: CreateProductDto,
  ): Promise<SellerProductResponse> {
    const shop = await this.shops.requireOperableShop(userId);

    const cycles = dto.plans.map((p) => p.cycle);
    if (new Set(cycles).size !== cycles.length) {
      throw AppError.badRequest('DUPLICATE_CYCLE', 'มีรอบส่งซ้ำกันในรายการ');
    }
    for (const cycle of cycles) {
      if (!isCycle(cycle)) {
        throw AppError.badRequest('INVALID_CYCLE', 'รอบส่งไม่ถูกต้อง');
      }
    }

    // หมวดต้องมีจริง — FK จะปฏิเสธอยู่แล้วแต่จะได้ 500 แทนข้อความที่อ่านรู้เรื่อง
    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
      select: { id: true },
    });
    if (!category) {
      throw AppError.badRequest('CATEGORY_NOT_FOUND', 'ไม่พบหมวดสินค้านี้');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          shopId: shop.id,
          categoryId: dto.categoryId,
          name: dto.name,
          description: dto.description,
          images: dto.images,
          oneTimePrice: dto.oneTimePrice,
          netAmount: dto.netAmount,
          unit: dto.unit,
        },
        select: { id: true },
      });
      await tx.productPlan.createMany({
        data: dto.plans.map((p) => ({
          productId: product.id,
          cycle: p.cycle,
          pricePerCycle: p.pricePerCycle,
          qtyPerCycle: p.qtyPerCycle,
        })),
      });
      return product;
    });

    return this.findOne(userId, created.id);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateProductDto,
  ): Promise<SellerProductResponse> {
    await this.shops.requireOperableShop(userId);

    if (dto.categoryId !== undefined) {
      const category = await this.prisma.category.findUnique({
        where: { id: dto.categoryId },
        select: { id: true },
      });
      if (!category) {
        throw AppError.badRequest('CATEGORY_NOT_FOUND', 'ไม่พบหมวดสินค้านี้');
      }
    }

    // ★ ownership + "ไม่ถูกระงับ" อยู่ใน where ของคำสั่งเขียนทั้งคู่ ★
    const updated = await this.prisma.product.updateMany({
      where: { id, suspendedAt: null, shop: { ownerId: userId } },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name }),
        ...(dto.categoryId === undefined ? {} : { categoryId: dto.categoryId }),
        ...(dto.description === undefined
          ? {}
          : { description: dto.description }),
        ...(dto.images === undefined ? {} : { images: dto.images }),
        ...(dto.oneTimePrice === undefined
          ? {}
          : { oneTimePrice: dto.oneTimePrice }),
        ...(dto.netAmount === undefined ? {} : { netAmount: dto.netAmount }),
        ...(dto.unit === undefined ? {} : { unit: dto.unit }),
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
    });
    if (updated.count === 0) await this.explainProductFailure(userId, id);

    return this.findOne(userId, id);
  }

  /** เปิดรอบส่งเพิ่มให้สินค้าที่มีอยู่ — cycle ที่มีแล้วชน UQ `product_id + cycle` */
  async addPlan(
    userId: string,
    productId: string,
    input: { cycle: string; pricePerCycle: number; qtyPerCycle: number },
  ): Promise<SellerProductResponse> {
    await this.shops.requireOperableShop(userId);
    if (!isCycle(input.cycle)) {
      throw AppError.badRequest('INVALID_CYCLE', 'รอบส่งไม่ถูกต้อง');
    }

    try {
      // สร้างแผนใน `connect` ที่ผูกเงื่อนไขความเป็นเจ้าของไว้ด้วย — ถ้าสินค้าไม่ใช่
      // ของร้านนี้ (หรือถูกระงับ) Prisma จะหาไม่เจอแล้วโยน P2025 ไม่ใช่เขียนสำเร็จ
      // (อ่านก่อนแล้วค่อยเขียนเป็นคนละคำสั่ง — กฎข้อ 3)
      await this.prisma.productPlan.create({
        data: {
          cycle: input.cycle,
          pricePerCycle: input.pricePerCycle,
          qtyPerCycle: input.qtyPerCycle,
          product: {
            connect: {
              id: productId,
              suspendedAt: null,
              shop: { ownerId: userId },
            },
          },
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2025'
      ) {
        await this.explainProductFailure(userId, productId);
      }
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw AppError.conflict(
          'PLAN_EXISTS',
          'สินค้านี้มีรอบส่งนี้อยู่แล้ว — แก้ราคาที่แผนเดิมได้เลย',
        );
      }
      throw e;
    }
    return this.findOne(userId, productId);
  }

  /**
   * แก้แผน — **ทุกการเปลี่ยนที่ทำให้ผู้ซื้อเสียเปรียบต้องแจ้งสมาชิกทันที**
   *
   * ผู้ซื้อจ่ายเงื่อนไขใหม่ตั้งแต่รอบถัดไปโดยไม่ได้กดอะไรเลย ถ้าไม่แจ้งก็เท่ากับ
   * ถูกเปลี่ยนสัญญาลับหลัง (consumer protection — feature 11 · เขียนในเล่มได้)
   *
   * ★ "เสียเปรียบ" ไม่ได้มีแค่ราคาขึ้น ★ ลดจำนวนชิ้นต่อรอบโดยคงราคาเดิม
   * (2 ชิ้น ฿200 → 1 ชิ้น ฿200) คือการขึ้นราคาต่อชิ้นเท่าตัว — ต้องแจ้งเหมือนกัน
   *
   * การแจ้งเตือน + `subscription_events.price_changed` อยู่ในทรานแซกชันเดียวกับ
   * การอัปเดต: เงื่อนไขเปลี่ยนแล้วแจ้งไม่สำเร็จ ต้องไม่เกิดขึ้นเลย
   */
  async updatePlan(
    userId: string,
    planId: string,
    dto: UpdatePlanDto,
  ): Promise<SellerProductResponse> {
    await this.shops.requireOperableShop(userId);

    const plan = await this.prisma.productPlan.findFirst({
      where: {
        id: planId,
        product: { suspendedAt: null, shop: { ownerId: userId } },
      },
      select: {
        id: true,
        cycle: true,
        pricePerCycle: true,
        qtyPerCycle: true,
        productId: true,
        product: { select: { name: true } },
      },
    });
    if (!plan) {
      throw AppError.notFound('PLAN_NOT_FOUND', 'ไม่พบรอบส่งนี้');
    }

    const oldPrice = plan.pricePerCycle.toNumber();
    const newPrice = dto.pricePerCycle ?? oldPrice;
    const oldQty = plan.qtyPerCycle;
    const newQty = dto.qtyPerCycle ?? oldQty;

    // ราคาต่อชิ้นแย่ลง = ผู้ซื้อเสียเปรียบ ไม่ว่าจะมาจากการขึ้นราคาหรือลดจำนวน
    const worseForBuyer = newPrice / newQty > oldPrice / oldQty;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.productPlan.updateMany({
        where: {
          id: planId,
          // ★ ownership อยู่ใน where ของคำสั่งเขียนด้วย ★ ไม่ใช่แค่ใน findFirst
          // ข้างบน — กฎข้อ 3 ของโปรเจกต์ (อ่านแล้วค่อยเขียนคือคนละคำสั่ง)
          product: { suspendedAt: null, shop: { ownerId: userId } },
          // ค่าเดิมอยู่ใน where เป็น optimistic lock: ถ้าอีกหน้าจอของร้านเดียวกัน
          // แก้ไปก่อน คำสั่งนี้ต้องไม่ทับ แล้วแจ้งสมาชิกด้วยตัวเลขที่ไม่มีอยู่จริง
          pricePerCycle: plan.pricePerCycle,
          qtyPerCycle: oldQty,
        },
        data: {
          ...(dto.pricePerCycle === undefined
            ? {}
            : { pricePerCycle: dto.pricePerCycle }),
          ...(dto.qtyPerCycle === undefined
            ? {}
            : { qtyPerCycle: dto.qtyPerCycle }),
          ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
        },
      });
      if (updated.count === 0) {
        throw AppError.conflict(
          'PLAN_CHANGED',
          'รอบส่งนี้เพิ่งถูกแก้ไปแล้ว กรุณารีเฟรชหน้าจอ',
        );
      }
      if (!worseForBuyer) return;

      // สมาชิกที่ยังมีชีวิตอยู่ทุกคน (รวมคนที่หยุดชั่วคราว — กลับมาก็เจอเงื่อนไขใหม่)
      const subscribers = await tx.subscription.findMany({
        where: { planId, status: { in: ['active', 'paused'] } },
        select: { id: true, buyerId: true },
      });
      if (subscribers.length === 0) return;

      const detail = {
        from: oldPrice,
        to: newPrice,
        qty_from: oldQty,
        qty_to: newQty,
        cycle: plan.cycle,
      };
      const change =
        newQty === oldQty
          ? `จาก ฿${oldPrice.toFixed(2)} เป็น ฿${newPrice.toFixed(2)} ต่อรอบ`
          : `จาก ฿${oldPrice.toFixed(2)} / ${oldQty} ชิ้น เป็น ฿${newPrice.toFixed(2)} / ${newQty} ชิ้น ต่อรอบ`;

      await tx.subscriptionEvent.createMany({
        data: subscribers.map((s) => ({
          subscriptionId: s.id,
          event: 'price_changed' as const,
          detail,
        })),
      });
      await tx.notification.createMany({
        data: subscribers.map((s) => ({
          userId: s.buyerId,
          type: 'price_changed' as const,
          title: 'เงื่อนไขรอบส่งมีการเปลี่ยนแปลง',
          body: `${plan.product.name} — ${change} มีผลตั้งแต่รอบถัดไป`,
          linkPath: `/subscriptions/${s.id}`,
        })),
      });
    });

    return this.findOne(userId, plan.productId);
  }

  // ---------- ภายใน ----------

  /**
   * บอกให้ตรงว่าทำไมเขียนไม่สำเร็จ — ไม่ใช่ของเรา (404) หรือถูกระงับ (409)
   * แยกออกมาเพื่อไม่ให้ 2 กรณีนี้กลายเป็นข้อความเดียวกันที่ผู้ใช้แก้อะไรไม่ได้
   */
  private async explainProductFailure(
    userId: string,
    productId: string,
  ): Promise<never> {
    const mine = await this.prisma.product.findFirst({
      where: { id: productId, shop: { ownerId: userId } },
      select: { suspendedAt: true },
    });
    if (mine?.suspendedAt) {
      throw AppError.conflict(
        'PRODUCT_SUSPENDED',
        'สินค้านี้ถูกระงับโดยผู้ดูแลระบบ — แก้ไขไม่ได้',
      );
    }
    throw AppError.notFound('PRODUCT_NOT_FOUND', 'ไม่พบสินค้านี้');
  }

  /** นับสมาชิกต่อแผนด้วย query เดียวต่อชุด ไม่ใช่ต่อสินค้า (กัน N+1) */
  private async withSubscriberCounts(
    rows: ProductRow[],
  ): Promise<SellerProductResponse[]> {
    const planIds = rows.flatMap((r) => r.plans.map((p) => p.id));
    const [active, affected] =
      planIds.length === 0
        ? [[], []]
        : await Promise.all([
            this.prisma.subscription.groupBy({
              by: ['planId'],
              where: { planId: { in: planIds }, status: 'active' },
              _count: { _all: true },
            }),
            // คนที่หยุดชั่วคราวก็ได้รับแจ้งเตือนตอนแก้ราคา จึงต้องนับแยกไว้ให้
            // หน้าจอบอกตัวเลขที่ตรงกับจำนวนคนที่ระบบจะแจ้งจริง
            this.prisma.subscription.groupBy({
              by: ['planId'],
              where: {
                planId: { in: planIds },
                status: { in: ['active', 'paused'] },
              },
              _count: { _all: true },
            }),
          ]);
    const byPlan = new Map(active.map((c) => [c.planId, c._count._all]));
    const affectedByPlan = new Map(
      affected.map((c) => [c.planId, c._count._all]),
    );

    return rows.map((row) => {
      const plans: SellerPlanResponse[] = row.plans.map((p) => ({
        id: p.id,
        cycle: p.cycle,
        pricePerCycle: p.pricePerCycle.toNumber(),
        qtyPerCycle: p.qtyPerCycle,
        isActive: p.isActive,
        activeSubscribers: byPlan.get(p.id) ?? 0,
        affectedSubscribers: affectedByPlan.get(p.id) ?? 0,
      }));

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        categoryId: row.categoryId,
        images: row.images,
        oneTimePrice: row.oneTimePrice.toNumber(),
        netAmount: row.netAmount === null ? null : row.netAmount.toNumber(),
        unit: row.unit,
        isActive: row.isActive,
        isSuspended: row.suspendedAt !== null,
        activeSubscribers: plans.reduce((n, p) => n + p.activeSubscribers, 0),
        plans,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}
