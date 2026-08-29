import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  cyclesPerMonth,
  isCycle,
  startOfThaiMonth,
  todayInBangkok,
} from '../common/date';
import { AppError } from '../common/errors/app-exception';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AdminStatsResponse,
  CategoryAdminResponse,
  UpdateCategoryDto,
  UpsertCategoryDto,
} from './dto/admin.dto';

/**
 * งานของผู้ดูแลแพลตฟอร์ม (feature 14 · W10)
 *
 * ★ ทุกเมธอดในนี้ถือว่า caller ผ่าน `@Roles('admin')` มาแล้ว ★ แต่ยังไม่ใช่
 * ใบอนุญาตให้ดึงข้อมูลส่วนตัวของใครก็ได้ — ตัวเลขภาพรวมเป็น aggregate ล้วน
 * และหน้า moderation ขอเฉพาะสิ่งที่ใช้ "ตัดสินใจว่าร้านไหนมีปัญหา" เท่านั้น
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async stats(): Promise<AdminStatsResponse> {
    const monthStart = startOfThaiMonth();
    const today = todayInBangkok();

    const [
      users,
      shops,
      suspendedShops,
      products,
      byPlan,
      ordersToday,
      cancelledThisMonth,
      openIssues,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.shop.count(),
      this.prisma.shop.count({ where: { suspendedAt: { not: null } } }),
      this.prisma.product.count(),
      // ★ รวมที่ฐานข้อมูล ไม่ดึงแถว subscription ขึ้นมานับเอง ★
      // จำนวนแถวที่วิ่งกลับมาผูกกับ "จำนวนแผนทั้งระบบ" ไม่ใช่ "จำนวนสมาชิก" (B-11)
      this.prisma.subscription.groupBy({
        by: ['planId'],
        where: { status: 'active' },
        _count: { _all: true },
        _sum: { quantity: true },
      }),
      this.prisma.order.count({ where: { cycleDate: today } }),
      this.prisma.subscriptionEvent.count({
        where: { event: 'cancelled', createdAt: { gte: monthStart } },
      }),
      this.prisma.orderIssue.count({ where: { status: 'open' } }),
    ]);

    return {
      users,
      shops,
      suspendedShops,
      products,
      activeSubscriptions: byPlan.reduce((n, g) => n + g._count._all, 0),
      ordersToday,
      mrr: await this.monthlyRecurringRevenue(byPlan),
      cancelledThisMonth,
      openIssues,
    };
  }

  /**
   * MRR รวมทุกร้าน — สูตรเดียวกับ dashboard ของร้าน (`cyclesPerMonth`)
   *
   * ต้องเป็นสูตรเดียวกันจริง ๆ ไม่ใช่ "คล้ายกัน": ถ้าตัวเลขของ admin กับของร้าน
   * ไม่ตรงกัน จะไม่มีทางรู้เลยว่าฝั่งไหนผิด
   */
  private async monthlyRecurringRevenue(
    byPlan: { planId: string; _sum: { quantity: number | null } }[],
  ): Promise<number> {
    if (byPlan.length === 0) return 0;

    const plans = await this.prisma.productPlan.findMany({
      where: { id: { in: byPlan.map((g) => g.planId) } },
      select: { id: true, cycle: true, pricePerCycle: true },
    });
    const priceOf = new Map(plans.map((p) => [p.id, p]));

    const total = byPlan.reduce((sum, group) => {
      const plan = priceOf.get(group.planId);
      if (!plan || !isCycle(plan.cycle)) return sum;
      const units = group._sum.quantity ?? 0;
      return (
        sum + plan.pricePerCycle.toNumber() * units * cyclesPerMonth(plan.cycle)
      );
    }, 0);
    return Math.round(total * 100) / 100;
  }

  // ---------- หมวดสินค้า ----------

  async listCategories(): Promise<CategoryAdminResponse[]> {
    const rows = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
    return rows.map(toCategory);
  }

  async createCategory(
    dto: UpsertCategoryDto,
    actorId: string,
  ): Promise<CategoryAdminResponse> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.category.create({
          data: {
            name: dto.name,
            icon: dto.icon ?? null,
            sortOrder: dto.sortOrder ?? 0,
          },
          include: { _count: { select: { products: true } } },
        });
        await this.audit.record(
          {
            action: 'category_created',
            actorId,
            targetType: 'category',
            targetId: String(created.id),
            summary: `เพิ่มหมวดสินค้า "${created.name}"`,
          },
          tx,
        );
        return created;
      });
      return toCategory(row);
    } catch (e) {
      throw this.asDuplicateName(e);
    }
  }

  async updateCategory(
    id: number,
    dto: UpdateCategoryDto,
    actorId: string,
  ): Promise<CategoryAdminResponse> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.category.updateMany({
          where: { id },
          data: {
            ...(dto.name === undefined ? {} : { name: dto.name }),
            ...(dto.icon === undefined ? {} : { icon: dto.icon }),
            ...(dto.sortOrder === undefined
              ? {}
              : { sortOrder: dto.sortOrder }),
          },
        });
        if (updated.count === 0) {
          throw AppError.notFound('CATEGORY_NOT_FOUND', 'ไม่พบหมวดนี้');
        }
        await this.audit.record(
          {
            action: 'category_updated',
            actorId,
            targetType: 'category',
            targetId: String(id),
            summary: `แก้หมวดสินค้า #${id}${dto.name === undefined ? '' : ` → "${dto.name}"`}`,
            detail: { ...dto },
          },
          tx,
        );
      });
    } catch (e) {
      throw this.asDuplicateName(e);
    }

    const row = await this.prisma.category.findFirstOrThrow({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    return toCategory(row);
  }

  /**
   * ลบหมวด — **ปล่อยให้ FK เป็นคนบล็อก** ไม่ใช่การนับก่อนลบ
   *
   * การ "นับแล้วค่อยลบ" มีช่องให้สินค้าชิ้นใหม่ถูกเพิ่มระหว่างสองคำสั่ง
   * ตัวเลขที่ส่งกลับไปบอกผู้ใช้จึงอ่านหลังจากถูกปฏิเสธแล้วเท่านั้น
   */
  async removeCategory(id: number, actorId: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // อ่านชื่อไว้ก่อนลบ — หลังลบแล้วไม่มีอะไรให้อ้างถึงในหน้า log อีก
        const doomed = await tx.category.findUnique({
          where: { id },
          select: { name: true },
        });
        const res = await tx.category.deleteMany({ where: { id } });
        if (res.count === 0) {
          throw AppError.notFound('CATEGORY_NOT_FOUND', 'ไม่พบหมวดนี้');
        }
        await this.audit.record(
          {
            action: 'category_deleted',
            actorId,
            targetType: 'category',
            targetId: String(id),
            summary: `ลบหมวดสินค้า "${doomed?.name ?? `#${id}`}"`,
          },
          tx,
        );
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2003'
      ) {
        const count = await this.prisma.product.count({
          where: { categoryId: id },
        });
        throw AppError.conflict(
          'CATEGORY_IN_USE',
          `ยังมีสินค้า ${count} ชิ้นในหมวดนี้ — ย้ายสินค้าออกก่อนจึงจะลบได้`,
        );
      }
      throw e;
    }
  }

  private asDuplicateName(e: unknown): unknown {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return AppError.conflict('CATEGORY_EXISTS', 'มีหมวดชื่อนี้อยู่แล้ว');
    }
    return e;
  }
}

function toCategory(row: {
  id: number;
  name: string;
  icon: string | null;
  sortOrder: number;
  _count: { products: number };
}): CategoryAdminResponse {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    sortOrder: row.sortOrder,
    productCount: row._count.products,
  };
}
