import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

export const API_PREFIX = 'api/v1';

/**
 * ตั้งค่าชั้นป้องกันทั้งหมดของแอปไว้ที่เดียว
 *
 * ทำไมไม่เขียนใน main.ts ตรง ๆ: e2e test ต้องรันบนแอปที่ตั้งค่า "เหมือนของจริงทุกชั้น"
 * ถ้าแยกกันเขียนสองที่ วันหนึ่งจะเพี้ยนกัน แล้ว test จะผ่านทั้งที่ของจริงมีรู
 * (docs/testing.md — ทดสอบระบบเดียวกับที่ deploy)
 */
export function configureApp(
  app: INestApplication,
  opts: { corsOrigins: string[] },
): void {
  app.setGlobalPrefix(API_PREFIX);

  // ถอด x-powered-by, ใส่ nosniff / frame-options / HSTS / CSP
  app.use(helmet());

  // ระบุ origin เจาะจง ไม่ใช้ '*' เพราะ API นี้รับ Authorization header
  //
  // `credentials: true` จำเป็นตั้งแต่ refresh token ย้ายไปอยู่ใน httpOnly cookie:
  // เบราว์เซอร์จะไม่แนบ cookie ข้าม origin เลยถ้า server ไม่ตอบ
  // `Access-Control-Allow-Credentials: true` · และสเปกห้ามใช้คู่กับ `origin: '*'`
  // อยู่แล้ว — ซึ่งเราไม่ได้ใช้ตั้งแต่แรก
  app.enableCors({
    origin: opts.corsOrigins,
    // ★ เมธอดที่ไม่อยู่ในลิสต์นี้ ถูกเบราว์เซอร์ตัดตั้งแต่ preflight ★
    // อาการที่เห็นคือ "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" บนหน้าจอ โดยที่ log ฝั่ง API เงียบสนิท
    // (request ไม่เคยมาถึง) — เพิ่ม endpoint ที่ใช้เมธอดใหม่เมื่อไหร่ต้องมาเติมที่นี่ด้วย
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // ตัดฟิลด์ที่ไม่ได้ประกาศใน DTO ทิ้ง แล้ว "ปฏิเสธ" ถ้ามีของแปลกปลอมส่งมา
      // กัน mass assignment: { isAdmin: true } ที่แนบมากับ body จะไม่มีวันถึง Prisma
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
}
