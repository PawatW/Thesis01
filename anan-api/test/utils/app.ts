import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * สร้างแอปสำหรับ e2e โดยใช้ `configureApp` ตัวเดียวกับ main.ts
 * — guard, ValidationPipe, exception filter ครบเหมือนของจริงทุกชั้น
 *
 * ถ้า test ปิด ValidationPipe หรือลืมใส่ filter เท่ากับทดสอบระบบคนละตัวกับที่
 * deploy จริง แล้วช่องโหว่ที่ควรถูกกันจะผ่านฉลุยใน test
 */
export async function createTestApp(opts?: {
  /** ให้ rate limit ทำงานจริง (ค่าเริ่มต้นปิดไว้ ไม่งั้น test ยิงรัวแล้วโดน 429 เอง) */
  throttle?: boolean;
}): Promise<{
  app: INestApplication;
  prisma: PrismaService;
}> {
  process.env.THROTTLE_DISABLED = opts?.throttle ? 'false' : 'true';

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  configureApp(app, { corsOrigins: ['http://localhost:8081'] });
  await app.init();

  return { app, prisma: app.get(PrismaService) };
}

/** ยิง request แบบมี type — ใช้แทน request(app.getHttpServer()) ทุกที่ */
export function api(app: INestApplication) {
  return request(app.getHttpServer() as App);
}

/** รูปแบบ error มาตรฐานของ API (docs/architecture.md §3) */
export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
}
