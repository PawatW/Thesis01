import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { discountLabel } from './discount';
import type {
  AdminCouponQuery,
  AdminCouponResponse,
  CreateCouponDto,
  UpdateCouponDto,
} from './dto/coupon.dto';

/** เพดานแถวของทุกรายการที่ส่งออก (security-rules B-11) */
const MAX_ROWS = 100;

/**
 * ออก/แก้/ปิดคูปอง — ฝั่งผู้ดูแลแพลตฟอร์ม (feature 18 ชั้นที่ 1)
 *
 * ★ ไม่มีเมธอดลบ ★ ใบที่ถูกใช้ไปแล้วต้องอ้างอิงกลับได้ตลอด (ออเดอร์ที่ลดแล้วชี้มา
 * ที่ใบจอง และใบจองชี้มาที่คูปอง) — การลบทำให้ยอดเงินในอดีตอธิบายไม่ได้
 *
 * ทุกการกระทำที่นี่ลง `audit_logs` เพราะเป็นการเปลี่ยนเงื่อนไขที่กระทบเงินจริงของร้าน
 */
@Injectable()
export class CouponsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: AdminCouponQuery): Promise<AdminCouponResponse[]> {
    const now = new Date();
    const where: Prisma.CouponWhereInput = {
      // ผู้ดูแลเห็นคูปองของร้านด้วย (อ่านอย่างเดียว) — ต้องตอบได้ว่าแคมเปญไหน
      // ของใคร ตอนมีเคสร้องเรียนเรื่องส่วนลด
      ...(query.tier === undefined ? {} : { tier: query.tier }),
      ...(query.status === 'active'
        ? { isActive: true, startsAt: { lte: now }, endsAt: { gte: now } }
        : query.status === 'inactive'
          ? { OR: [{ isActive: false }, { endsAt: { lt: now } }] }
          : {}),
    };

    const rows = await this.prisma.coupon.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { endsAt: 'desc' }],
      include: COUPON_INCLUDE,
      take: MAX_ROWS,
    });
    if (rows.length === 0) return [];

    // นับสถานะของใบจองด้วย groupBy ครั้งเดียว — `_count` ของ Prisma ใส่ตัวกรอง
    // หลายชุดบน relation เดียวกันไม่ได้ (ชื่อ key ชนกัน)
    const tallies = await this.prisma.couponRedemption.groupBy({
      by: ['couponId', 'status'],
      where: { couponId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    });

    return rows.map((row) => {
      const mine = tallies.filter((t) => t.couponId === row.id);
      const countOf = (s: string) =>
        mine.find((t) => t.status === s)?._count._all ?? 0;
      return {
        ...toAdminCoupon(row, now),
        productCount: row._count.products,
        reservedCount: countOf('reserved'),
        consumedCount: countOf('consumed'),
        releasedCount: countOf('released'),
      };
    });
  }

  async create(
    dto: CreateCouponDto,
    actorId: string,
  ): Promise<AdminCouponResponse> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this.assertTerms(dto, startsAt, endsAt);

    const created = await this.guardDuplicateCode(() =>
      this.prisma.$transaction(async (tx) => {
        const coupon = await tx.coupon.create({
          data: {
            code: dto.code,
            title: dto.title,
            description: dto.description ?? null,
            discountType: dto.discountType,
            discountValue: dto.discountValue,
            maxDiscountAmount: dto.maxDiscountAmount ?? null,
            minOrderAmount: dto.minOrderAmount ?? null,
            startsAt,
            endsAt,
            maxRedemptions: dto.maxRedemptions ?? null,
            createdBy: actorId,
          },
          include: COUPON_INCLUDE,
        });
        await this.audit.record(
          {
            action: 'coupon_created',
            actorId,
            targetType: 'coupon',
            targetId: coupon.id,
            summary: `ออกคูปอง ${coupon.code} (${discountLabel(coupon)})`,
            detail: {
              code: coupon.code,
              discount_type: coupon.discountType,
              discount_value: coupon.discountValue.toNumber(),
              max_redemptions: coupon.maxRedemptions,
            },
          },
          tx,
        );
        return coupon;
      }),
    );

    return {
      ...toAdminCoupon(created, new Date()),
      productCount: 0,
      reservedCount: 0,
      consumedCount: 0,
      releasedCount: 0,
    };
  }

  /**
   * แก้คูปองที่ออกไปแล้ว — **ชนิดกับมูลค่าแก้ไม่ได้** (ดูเหตุผลใน DTO)
   *
   * `maxRedemptions` ลดลงต่ำกว่าจำนวนที่จองไปแล้วไม่ได้ ไม่งั้นจะผิด CHECK
   * `coupons_quota_within_max` แล้วทั้งคำขอจะล้มด้วย 500 แทนที่จะเป็นข้อความที่อ่านออก
   */
  async update(
    id: string,
    dto: UpdateCouponDto,
    actorId: string,
  ): Promise<AdminCouponResponse> {
    const current = await this.prisma.coupon.findUnique({
      where: { id },
      select: { id: true, code: true, startsAt: true, inUseCount: true },
    });
    if (!current) throw AppError.notFound('COUPON_NOT_FOUND', 'ไม่พบคูปองนี้');

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

    const updated = await this.prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon.update({
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
        include: COUPON_INCLUDE,
      });
      await this.audit.record(
        {
          action: 'coupon_updated',
          actorId,
          targetType: 'coupon',
          targetId: id,
          summary: `แก้ไขคูปอง ${coupon.code}`,
          detail: { fields: Object.keys(dto) },
        },
        tx,
      );
      return coupon;
    });

    return this.withTallies(updated);
  }

  /**
   * ปิดคูปอง — ห้ามจองใหม่ แต่ **ใบที่จองไว้แล้วยังใช้ได้ตามที่จอง**
   * (ใบจองถือ snapshot ของเงื่อนไขไว้แล้ว การตัดสิทธิ์ย้อนหลังคือการผิดคำพูดกับผู้ซื้อ)
   */
  async deactivate(id: string, actorId: string): Promise<AdminCouponResponse> {
    const coupon = await this.prisma.coupon.findUnique({
      where: { id },
      select: { id: true, code: true, isActive: true },
    });
    if (!coupon) throw AppError.notFound('COUPON_NOT_FOUND', 'ไม่พบคูปองนี้');
    if (!coupon.isActive) {
      throw AppError.conflict('COUPON_ALREADY_INACTIVE', 'คูปองนี้ปิดไปแล้ว');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // สถานะเดิมอยู่ใน where — กดปิดพร้อมกัน 2 หน้าต่างต้องสำเร็จครั้งเดียว
      const done = await tx.coupon.updateMany({
        where: { id, isActive: true },
        data: { isActive: false },
      });
      if (done.count === 0) {
        throw AppError.conflict('COUPON_ALREADY_INACTIVE', 'คูปองนี้ปิดไปแล้ว');
      }
      await this.audit.record(
        {
          action: 'coupon_deactivated',
          actorId,
          targetType: 'coupon',
          targetId: id,
          summary: `ปิดคูปอง ${coupon.code}`,
        },
        tx,
      );
      return tx.coupon.findUniqueOrThrow({
        where: { id },
        include: COUPON_INCLUDE,
      });
    });

    return this.withTallies(updated);
  }

  // ---------- ภายใน ----------

  /**
   * กฎที่ CHECK ที่ DB บังคับอยู่แล้ว แต่ต้องตรวจที่นี่ด้วยเพื่อให้ได้ 422 ที่อ่านออก
   * แทน 500 จาก constraint violation (กฎข้อ 9 — ต้องมีทั้ง DTO/service และ DB)
   */
  private assertTerms(
    dto: CreateCouponDto,
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

  private async withTallies(row: CouponWithMeta): Promise<AdminCouponResponse> {
    const tallies = await this.prisma.couponRedemption.groupBy({
      by: ['status'],
      where: { couponId: row.id },
      _count: { _all: true },
    });
    const countOf = (s: string) =>
      tallies.find((t) => t.status === s)?._count._all ?? 0;
    return {
      ...toAdminCoupon(row, new Date()),
      productCount: row._count.products,
      reservedCount: countOf('reserved'),
      consumedCount: countOf('consumed'),
      releasedCount: countOf('released'),
    };
  }

  private async guardDuplicateCode<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw AppError.conflict('COUPON_CODE_TAKEN', 'โค้ดนี้ถูกใช้ไปแล้ว');
      }
      throw e;
    }
  }
}

/** ข้อมูลที่ทุก response ของคูปองต้องใช้ — ระดับ + ร้านเจ้าของ + จำนวนสินค้าที่ร่วม */
export const COUPON_INCLUDE = {
  _count: { select: { products: true } },
  shop: { select: { name: true } },
} satisfies Prisma.CouponInclude;

export type CouponWithMeta = Prisma.CouponGetPayload<{
  include: typeof COUPON_INCLUDE;
}>;

/** ไม่ส่ง `createdBy` ออกไป — ผู้ดูแลคนอื่นไม่จำเป็นต้องรู้ว่าใครกด (มีใน audit log แล้ว) */
export function toAdminCoupon(
  row: CouponWithMeta,
  now: Date,
): Omit<
  AdminCouponResponse,
  'productCount' | 'reservedCount' | 'consumedCount' | 'releasedCount'
> {
  const state = !row.isActive
    ? 'disabled'
    : now < row.startsAt
      ? 'scheduled'
      : now > row.endsAt
        ? 'expired'
        : 'running';

  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    tier: row.tier,
    shopName: row.shop?.name ?? null,
    appliesToAllProducts: row.appliesToAllProducts,
    discountType: row.discountType,
    discountValue: row.discountValue.toNumber(),
    maxDiscountAmount: row.maxDiscountAmount?.toNumber() ?? null,
    minOrderAmount: row.minOrderAmount?.toNumber() ?? null,
    label: discountLabel(row),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    maxRedemptions: row.maxRedemptions,
    maxPerUser: row.maxPerUser,
    isActive: row.isActive,
    state,
    inUseCount: row.inUseCount,
    createdAt: row.createdAt.toISOString(),
  };
}
