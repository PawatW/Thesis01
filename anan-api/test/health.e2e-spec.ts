import { INestApplication } from '@nestjs/common';
import { api, ApiError, createTestApp } from './utils/app';

describe('Phase 0 — รากฐานของ API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /health → 200 และต่อฐานข้อมูลได้จริง', async () => {
    const res = await api(app).get('/api/v1/health').expect(200);
    const body = res.body as { status: string; db: string; today: string };

    expect(body.status).toBe('ok');
    expect(body.db).toBe('up');

    // ★ เทียบกับวันจริงของเขตเวลาไทย ไม่ใช่แค่ match รูปแบบ ★
    // ถ้า assert แค่ /^\d{4}-\d{2}-\d{2}$/ โค้ดที่ใช้ toISOString() (บั๊ก B-12
    // ที่โปรเจกต์นี้เคยโดนมาแล้ว) จะผ่านสบาย ๆ ทั้งที่ให้วันของเมื่อวาน
    const bangkokToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
    }).format(new Date());
    expect(body.today).toBe(bangkokToday);
  });

  it('route ที่ไม่มีจริง → 404 รูปแบบ error มาตรฐาน และไม่สะท้อน path กลับมา', async () => {
    const res = await api(app).get('/api/v1/no-such-route').expect(404);
    const body = res.body as ApiError;

    expect(body.statusCode).toBe(404);
    expect(body.code).toBe('NOT_FOUND');
    // ข้อความ error ต้องไม่ใช่ "Cannot GET /api/v1/..." ของ Express
    expect(body.message).not.toContain('/api/v1');
  });

  it('ไม่บอกว่าเบื้องหลังเป็น Express (helmet ถอด x-powered-by)', async () => {
    const res = await api(app).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
