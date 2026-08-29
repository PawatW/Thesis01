import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RunEngineDto, type EngineRunResponse } from './dto/engine.dto';
import { EngineService } from './engine.service';

/** ค่าเริ่มต้น/เพดานของจำนวนแถวประวัติ — กันดึงทั้งตารางด้วย query เดียว */
const DEFAULT_RUNS = 20;
const MAX_RUNS = 50;

/**
 * หน้าควบคุม engine — admin เท่านั้น (feature 13 · W10)
 *
 * ปุ่ม "Run now" มีไว้เพื่อการนำเสนอ: กรรมการจะได้เห็นรอบเกิดขึ้นสด ๆ แทนที่จะ
 * ต้องเชื่อว่า cron ทำงานตอนตี 1 จริง — และเห็นว่ากดซ้ำแล้วออเดอร์ไม่ซ้ำ
 *
 * controller ไม่มี logic: กฎว่า "ระบุวันที่จำลองได้เมื่อไหร่" อยู่ใน
 * `EngineService.runManually()` เพราะเป็นกฎธุรกิจ ไม่ใช่การแปลง HTTP
 */
@Controller('admin/engine')
@Roles('admin')
export class EngineController {
  constructor(private readonly engine: EngineService) {}

  @Post('run')
  @HttpCode(200)
  run(
    @Body() dto: RunEngineDto,
    @CurrentUser() user: AuthUser,
  ): Promise<EngineRunResponse> {
    return this.engine.runManually(dto.runDate, user.id);
  }

  @Get('runs')
  runs(@Query('limit') limit?: string): Promise<EngineRunResponse[]> {
    const parsed = Number(limit);
    const take = Number.isInteger(parsed)
      ? Math.min(Math.max(parsed, 1), MAX_RUNS)
      : DEFAULT_RUNS;
    return this.engine.recentRuns(take);
  }
}
