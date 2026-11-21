import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { AppError } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import type {
  NotificationListResponse,
  NotificationResponse,
} from './dto/notification.dto';

/** เพดานแถว (security-rules B-11) — แจ้งเตือนเก่ากว่านี้ไม่มีใครย้อนไปอ่าน */
const MAX_ROWS = 50;

/**
 * ชนิดที่เป็นของ "คอนโซลร้าน" — เรื่องที่เจ้าของร้านต้องรู้ ไม่ใช่ผู้ซื้อ
 *
 * `engine_summary` อยู่ฝั่งนี้เพราะ engine ส่งสรุป "ออเดอร์ใหม่ประจำวัน"
 * ให้เจ้าของร้าน (engine.service.ts `summariseForShops`) ไม่ได้ส่งให้ผู้ซื้อ
 *
 * แบ่งเป็นรายชื่อฝั่งเดียวแล้วให้ฝั่งผู้ซื้อเป็น "ที่เหลือทั้งหมด" โดยตั้งใจ:
 * ชนิดใหม่ที่ลืมจัดหมวดจะไปโผล่ในกล่องผู้ซื้อ (เห็นแล้วรู้ว่าลืม) ดีกว่าหายไป
 * จากทุกกล่องจนไม่มีใครรู้ว่ามีการแจ้งเตือนใบนั้นอยู่
 */
const SELLER_TYPES = [
  NotificationType.new_subscriber,
  NotificationType.subscriber_cancelled,
  NotificationType.engine_summary,
  // Phase 8.3 — ผู้ซื้อกด "ส่งรอบนี้เลย" ร้านต้องรู้เพื่อจัดของ
  NotificationType.early_order,
] as const;

/** where ของชนิดตามคอนโซลที่ถาม — `all` = ไม่กรอง (ค่าเริ่มต้นเดิม) */
function scopeWhere(scope: 'all' | 'buyer' | 'seller'): {
  type?: { in: NotificationType[] } | { notIn: NotificationType[] };
} {
  if (scope === 'seller') return { type: { in: [...SELLER_TYPES] } };
  if (scope === 'buyer') return { type: { notIn: [...SELLER_TYPES] } };
  return {};
}

/**
 * การแจ้งเตือนของผู้ใช้ (feature 08 · W06)
 *
 * ★ ไม่มี endpoint ไหนให้ "สร้าง" แจ้งเตือน ★ ทุกใบถูกเขียนโดย service อื่นใน
 * ทรานแซกชันเดียวกับเหตุการณ์ที่ทำให้มันเกิด (สมัคร · ถึงรอบ · ร้านยกเลิก ·
 * ขึ้นราคา · ระงับร้าน …) — ที่นี่มีแค่ "อ่าน" กับ "ทำเครื่องหมายว่าอ่านแล้ว"
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    filter: 'all' | 'unread' = 'all',
    scope: 'all' | 'buyer' | 'seller' = 'all',
  ): Promise<NotificationListResponse> {
    const inScope = { userId, ...scopeWhere(scope) };

    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        // ownership อยู่ใน where — ไม่มีทางขอของคนอื่นได้แม้จะรู้ id
        where: { ...inScope, ...(filter === 'unread' ? { readAt: null } : {}) },
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
      }),
      // นับเฉพาะ scope เดียวกับที่ถาม — ไม่งั้น badge ของคอนโซลร้านจะขึ้นเลข
      // ของแจ้งเตือนฝั่งผู้ซื้อที่กดยังไงก็ไม่ลด
      this.prisma.notification.count({ where: { ...inScope, readAt: null } }),
    ]);

    return { items: rows.map(toNotification), unreadCount };
  }

  /**
   * ทำเครื่องหมายว่าอ่านแล้ว 1 ใบ — **idempotent**
   *
   * `readAt` เดิมอยู่ใน where: กดซ้ำหรือเปิดสองเครื่องพร้อมกันต้องไม่เขียนทับ
   * เวลาที่อ่านครั้งแรก (ไม่งั้น "อ่านเมื่อไหร่" เพี้ยนทุกครั้งที่แตะ)
   */
  async markRead(userId: string, id: number): Promise<NotificationResponse> {
    const row = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!row) {
      throw AppError.notFound('NOTIFICATION_NOT_FOUND', 'ไม่พบการแจ้งเตือนนี้');
    }

    if (row.readAt === null) {
      await this.prisma.notification.updateMany({
        where: { id, userId, readAt: null },
        data: { readAt: new Date() },
      });
      // อ่านกลับจาก DB แทนการเดาเวลาเอง — ถ้าอีกเครื่องกดก่อนเสี้ยววินาที
      // เวลาที่ถูกต้องคือของแถวนั้น ไม่ใช่ `new Date()` ตัวที่สองในโค้ดนี้
      return toNotification(
        await this.prisma.notification.findFirstOrThrow({
          where: { id, userId },
        }),
      );
    }
    return toNotification(row);
  }

  /**
   * อ่านทั้งหมด — คืนจำนวนที่เพิ่งถูกทำเครื่องหมาย
   *
   * จำกัดด้วย scope เดียวกับที่หน้าจอกำลังเปิดอยู่: กด "อ่านทั้งหมด" ในกล่อง
   * ของร้านต้องไม่ล้างของที่ยังไม่ได้อ่านในกล่องผู้ซื้อไปด้วย
   */
  async markAllRead(
    userId: string,
    scope: 'all' | 'buyer' | 'seller' = 'all',
  ): Promise<{ marked: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, ...scopeWhere(scope), readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: result.count };
  }
}

function toNotification(row: {
  id: number;
  type: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationResponse {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    linkPath: row.linkPath,
    readAt: row.readAt === null ? null : row.readAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
