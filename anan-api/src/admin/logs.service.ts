import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  LOG_PAGE_SIZE,
  toAuditLogResponse,
  toEmailLogResponse,
  type AuditLogQuery,
  type AuditLogResponse,
  type EmailLogQuery,
  type EmailLogResponse,
  type PagedResponse,
} from './dto/logs.dto';

/**
 * หน้า log ของผู้ดูแล — **อ่านอย่างเดียว**
 *
 * ไม่มีเมธอดลบหรือแก้ในไฟล์นี้โดยตั้งใจ: log ที่คนถูกตรวจสอบลบได้ไม่ใช่ log
 * (ถ้าวันหนึ่งตารางโตเกินไป ทางแก้คือ retention job ฝั่งฐานข้อมูล ไม่ใช่ปุ่มลบ)
 *
 * อ่านเกิน 1 แถวเพื่อรู้ว่ายังมีหน้าถัดไปไหม — ถูกกว่า `count(*)` ทั้งตารางที่โต
 * ขึ้นเรื่อย ๆ และหน้าจอต้องการแค่ "มีต่อไหม" ไม่ได้ต้องการจำนวนหน้าทั้งหมด
 */
@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) {}

  async audit(query: AuditLogQuery): Promise<PagedResponse<AuditLogResponse>> {
    const page = query.page ?? 1;
    const rows = await this.prisma.auditLog.findMany({
      where: query.action ? { action: query.action } : undefined,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * LOG_PAGE_SIZE,
      take: LOG_PAGE_SIZE + 1,
      include: { actor: { select: { displayName: true } } },
    });
    return page_(rows, page, toAuditLogResponse);
  }

  async email(query: EmailLogQuery): Promise<PagedResponse<EmailLogResponse>> {
    const page = query.page ?? 1;
    const rows = await this.prisma.emailLog.findMany({
      where: query.status ? { status: query.status } : undefined,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * LOG_PAGE_SIZE,
      take: LOG_PAGE_SIZE + 1,
    });
    return page_(rows, page, toEmailLogResponse);
  }
}

function page_<TRow, TOut>(
  rows: TRow[],
  page: number,
  map: (row: TRow) => TOut,
): PagedResponse<TOut> {
  const hasMore = rows.length > LOG_PAGE_SIZE;
  return {
    rows: rows.slice(0, LOG_PAGE_SIZE).map(map),
    page,
    pageSize: LOG_PAGE_SIZE,
    hasMore,
  };
}
