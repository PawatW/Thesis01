import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, ApiError, createTestApp } from './utils/app';
import { cleanupTestUsers } from './utils/auth';

const SEED = {
  coffee: '20000000-0000-4000-8000-000000000001', // กาแฟคั่วกลาง Arabica (Bean Story)
  dripBag: '20000000-0000-4000-8000-000000000003',
  beanStory: '10000000-0000-4000-8000-000000000001',
  closedPlan: '30000000-0000-4000-8000-000000000005', // ปิดรับสมาชิกใหม่ใน seed
  openPlan: '30000000-0000-4000-8000-000000000002',
};

interface Card {
  id: string;
  name: string;
  shopName: string;
  plans: { id: string; isActive: boolean; pricePerCycle: number }[];
  activeSubscribers: number;
  rating: number | null;
  reviewCount: number;
}

describe('Catalog — เปิดให้คนที่ยังไม่ล็อกอินเดินดูได้', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    if (prisma) {
      // คืน seed ให้เหมือนเดิมเสมอ — test ห้ามทิ้งร้านที่ถูกระงับค้างไว้
      await prisma.shop.update({
        where: { id: SEED.beanStory },
        data: { suspendedAt: null, suspendedReason: null },
      });
      await prisma.product.update({
        where: { id: SEED.dripBag },
        data: { suspendedAt: null, suspendedReason: null },
      });
      await cleanupTestUsers(prisma);
    }
    if (app) await app.close();
  });

  it('GET /catalog/categories → ได้หมวดเรียงตาม sortOrder โดยไม่ต้องล็อกอิน', async () => {
    const res = await api(app).get('/api/v1/catalog/categories').expect(200);
    const rows = res.body as { id: number; name: string }[];

    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows[0]?.name).toBe('กาแฟ');
  });

  it('GET /catalog/products → คืนเฉพาะแผนที่เปิดรับสมาชิก และมีตัวเลข aggregate', async () => {
    const res = await api(app).get('/api/v1/catalog/products').expect(200);
    const rows = res.body as Card[];

    const coffee = rows.find((p) => p.id === SEED.coffee);
    expect(coffee).toBeDefined();
    expect(coffee?.shopName).toBe('Bean Story');
    expect(coffee?.activeSubscribers).toBeGreaterThanOrEqual(1);
    expect(coffee?.rating).toBeGreaterThan(0);

    // แผนที่ปิดแล้วต้องไม่โผล่ให้กดสมัคร
    const drip = rows.find((p) => p.id === SEED.dripBag);
    expect(drip?.plans.some((pl) => pl.id === SEED.closedPlan)).toBe(false);

    // ราคาต้องเป็นตัวเลข ไม่ใช่ object ของ Prisma.Decimal
    expect(typeof coffee?.plans[0]?.pricePerCycle).toBe('number');
  });

  it('ค้นหาด้วย q และกรองด้วย category ได้', async () => {
    const search = await api(app)
      .get('/api/v1/catalog/products?q=กาแฟ')
      .expect(200);
    const names = (search.body as Card[]).map((p) => p.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n.includes('กาแฟ'))).toBe(true);

    const byCategory = await api(app)
      .get('/api/v1/catalog/products?category=6&limit=5')
      .expect(200);
    expect((byCategory.body as Card[]).length).toBeLessThanOrEqual(5);
  });

  it('limit เกินเพดาน → 400 (กันดูดทั้งตารางในคำขอเดียว)', async () => {
    await api(app).get('/api/v1/catalog/products?limit=5000').expect(400);
  });

  it('GET /catalog/products/:id → มีรีวิวที่ mask ชื่อ และไม่มี buyerId หลุด', async () => {
    const res = await api(app)
      .get(`/api/v1/catalog/products/${SEED.coffee}`)
      .expect(200);

    const body = res.body as Card & {
      description: string | null;
      reviews: { reviewerName: string; rating: number }[];
    };
    expect(body.description).toBeTruthy();
    expect(body.reviews.length).toBeGreaterThan(0);
    expect(body.reviews[0]?.reviewerName).toMatch(/\*\*\*$/);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('buyerId');
    expect(raw).not.toContain('subscriptionId');
    expect(raw).not.toContain('ปวัตน์ วันศิริสุข');
  });

  it('★ ร้านที่ถูก admin ระงับ → สินค้าหายจาก catalog และเปิดตรงก็ 404', async () => {
    await prisma.shop.update({
      where: { id: SEED.beanStory },
      data: { suspendedAt: new Date(), suspendedReason: 'ทดสอบ' },
    });

    const list = await api(app).get('/api/v1/catalog/products').expect(200);
    expect((list.body as Card[]).some((p) => p.id === SEED.coffee)).toBe(false);

    const detail = await api(app)
      .get(`/api/v1/catalog/products/${SEED.coffee}`)
      .expect(404);
    // ตอบเหมือนไม่มีสินค้านี้อยู่จริง ไม่บอกว่า "มีแต่โดนแบน"
    expect((detail.body as ApiError).code).toBe('PRODUCT_NOT_FOUND');

    // แผนของร้านที่ถูกระงับก็ต้องเปิดหน้า checkout ไม่ได้
    await api(app).get(`/api/v1/catalog/plans/${SEED.openPlan}`).expect(404);

    await prisma.shop.update({
      where: { id: SEED.beanStory },
      data: { suspendedAt: null, suspendedReason: null },
    });
  });

  it('สินค้าที่ถูกระงับรายชิ้น → หายเฉพาะชิ้นนั้น ร้านยังขายชิ้นอื่นได้', async () => {
    await prisma.product.update({
      where: { id: SEED.dripBag },
      data: { suspendedAt: new Date(), suspendedReason: 'ทดสอบ' },
    });

    const list = await api(app).get('/api/v1/catalog/products').expect(200);
    const rows = list.body as Card[];
    expect(rows.some((p) => p.id === SEED.dripBag)).toBe(false);
    expect(rows.some((p) => p.id === SEED.coffee)).toBe(true);

    await prisma.product.update({
      where: { id: SEED.dripBag },
      data: { suspendedAt: null, suspendedReason: null },
    });
  });

  it('GET /catalog/plans/:id → ได้ราคาและชื่อร้านสำหรับหน้า checkout', async () => {
    const res = await api(app)
      .get(`/api/v1/catalog/plans/${SEED.openPlan}`)
      .expect(200);

    const body = res.body as {
      plan: { cycle: string; pricePerCycle: number };
      product: { name: string; shopName: string; oneTimePrice: number };
    };
    expect(body.plan.cycle).toBe('1m');
    expect(body.plan.pricePerCycle).toBe(255);
    expect(body.product.shopName).toBe('Bean Story');
    // ราคาซื้อครั้งเดียวต้องแพงกว่า ไม่งั้นป้ายส่วนลดจะติดลบ
    expect(body.product.oneTimePrice).toBeGreaterThan(body.plan.pricePerCycle);
  });

  it('id ที่ไม่ใช่ uuid → 400 · uuid ที่ไม่มีจริง → 404', async () => {
    await api(app).get('/api/v1/catalog/products/not-a-uuid').expect(400);
    await api(app)
      .get('/api/v1/catalog/products/00000000-0000-4000-8000-999999999999')
      .expect(404);
  });

  describe('GET /catalog/shops/:id (หน้าร้านสาธารณะ)', () => {
    it('คืนข้อมูลร้าน + สินค้าที่ยังเปิดขาย และไม่มี ownerId หลุด', async () => {
      const products = await api(app)
        .get('/api/v1/catalog/products')
        .expect(200);
      const first = (products.body as { id: string }[])[0]!;
      const detail = await api(app)
        .get(`/api/v1/catalog/products/${first.id}`)
        .expect(200);
      const shopId = (detail.body as { shopId: string }).shopId;

      const res = await api(app)
        .get(`/api/v1/catalog/shops/${shopId}`)
        .expect(200);
      const shop = res.body as { id: string; products: { id: string }[] };
      expect(shop.id).toBe(shopId);
      expect(shop.products.length).toBeGreaterThan(0);
      expect(JSON.stringify(res.body)).not.toContain('ownerId');
    });

    it('ร้านที่ไม่มีอยู่ → 404', async () => {
      await api(app)
        .get('/api/v1/catalog/shops/00000000-0000-4000-8000-0000000000ff')
        .expect(404);
    });
  });
});
