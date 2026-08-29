import {
  Controller,
  Get,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { todayInBangkok, toISODate } from '../common/date';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * ใช้เช็คว่า API + DB ยังคุยกันได้ ไม่คืนข้อมูลภายในใด ๆ
   *
   * DB ล่ม → ตอบ **503** ไม่ใช่ 200 พร้อม `db:'down'` — ไม่งั้น uptime monitor
   * และ load balancer จะเห็นว่าปกติแล้วส่ง traffic เข้าเครื่องที่ใช้งานไม่ได้
   */
  @Public()
  @Get()
  async check(): Promise<{ status: string; db: string; today: string }> {
    const today = toISODate(todayInBangkok());
    if (!(await this.health.isDatabaseUp())) {
      throw new ServiceUnavailableException({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'DB_UNAVAILABLE',
        message: 'ระบบฐานข้อมูลไม่พร้อมใช้งานชั่วคราว',
      });
    }
    return { status: 'ok', db: 'up', today };
  }
}
