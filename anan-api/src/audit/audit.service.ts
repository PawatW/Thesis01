import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ร่องรอยของการกระทำที่มีสิทธิ์สูง — ปิดความเสี่ยง A-3 ที่ค้างมาตั้งแต่ Phase 6
 *
 * ★ เขียนอย่างเดียว ★ ไม่มีเมธอด update/delete ที่นี่ และไม่มี endpoint ให้แก้
 * — log ที่คนถูกตรวจสอบแก้ได้ไม่ใช่ log
 *
 * ★ `summary` ถูกสรุปเป็นข้อความไทยตั้งแต่ตอนเขียน ★ ไม่ใช่ตอนอ่าน เพราะของที่
 * ถูกอ้างถึง (ร้าน/สินค้า/หมวด) อาจถูกลบไปแล้วตอนที่ผู้ดูแลเปิดหน้า log —
 * ถ้าไปประกอบข้อความตอนอ่าน แถวเก่าจะกลายเป็น "ลบหมวด (ไม่พบชื่อ)" ทั้งกระดาน
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * บันทึก 1 เหตุการณ์
   *
   * `tx` ใส่มาเมื่อการกระทำนั้นอยู่ในทรานแซกชัน — ต้องใส่เสมอถ้าใส่ได้ เพราะ
   * "ระงับร้านสำเร็จแต่ log ไม่ขึ้น" คือสภาพที่ทำให้ log เชื่อถือไม่ได้ทั้งตาราง
   */
  async record(
    input: {
      action: AuditAction;
      summary: string;
      actorId?: string | null;
      targetType?: string;
      targetId?: string;
      detail?: Prisma.InputJsonValue;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        action: input.action,
        // CHECK ที่ DB จำกัด 500 ตัว — ตัดตั้งแต่ที่นี่ดีกว่าปล่อยให้ทั้งทรานแซกชันล้ม
        // เพราะข้อความยาวเกิน (การกระทำสำคัญกว่าความครบถ้วนของประโยคสรุป)
        summary: input.summary.slice(0, 500),
        actorId: input.actorId ?? null,
        targetType: input.targetType,
        targetId: input.targetId,
        detail: input.detail,
      },
    });
  }

  /**
   * บันทึกแบบ "ล้มแล้วไม่ลาก tx ตาย" — ใช้เฉพาะจุดที่การกระทำจบไปแล้วจริง ๆ
   * และการเขียน log ไม่ควรย้อนผลนั้น (เช่น ตั้งรหัสผ่านใหม่สำเร็จไปแล้ว)
   */
  async recordDetached(
    input: Parameters<AuditService['record']>[0],
  ): Promise<void> {
    try {
      await this.record(input);
    } catch (e) {
      this.logger.error(
        `เขียน audit log ไม่สำเร็จ (${input.action}): ${String(e)}`,
      );
    }
  }
}
