import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * มี service ชั้นนี้ทั้งที่มีงานบรรทัดเดียว เพราะกฎของโปรเจกต์คือ
 * **controller ห้ามรู้จัก Prisma** (CLAUDE.md ข้อ 4) — ถ้ายกเว้นให้ health
 * สคริปต์สแกนใน security-rules.md §F-1 จะมีผลลัพธ์ค้างอยู่ 1 รายการตลอด
 * แล้ววันที่มีของจริงหลุดเข้ามาก็จะไม่มีใครสังเกต
 */
@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  /** ยิง query ที่เบาที่สุดเพื่อพิสูจน์ว่า connection pool ยังใช้งานได้จริง */
  async isDatabaseUp(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
