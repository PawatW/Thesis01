import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { api, ApiError, createTestApp } from './utils/app';
import { cleanupTestUsers } from './utils/auth';

const SEED = {
  coffee: '20000000-0000-4000-8000-000000000001', // กาแฟคั่วกลาง Arabica (Bean Story)
  dripBag: '20000000-0000-4000-8000-000000000003',
  beanStory: '10000000-0000-4000-8000-000000000001',
  // ★ ร้านของบัญชี admin — ตั้งใจไม่มีสินค้าเลย (ดูเหตุผลใน prisma/seed.ts) ★
  adminShop: '10000000-0000-4000-8000-000000000004',
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

interface ShopCard {
  id: string;
  name: string;
  logoUrl: string | null;
  description: string | null;
  productCount: number;
  activeSubscribers: number;
  rating: number | null;
  reviewCount: number;
  createdAt: string;
}

describe('Catalog — เปิดให้คนที่ยังไม่ล็อกอินเดินดูได้', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    if (prisma) {
      // คืน seed ให้เหมือนเดิมเสมอ — test ห้ามทิ้งร้านที่ถูกระงับ/ปิดค้างไว้
      await prisma.shop.update({
        where: { id: SEED.beanStory },
        data: { isActive: true, suspendedAt: null, suspendedReason: null },
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

  describe('GET /catalog/shops (ค้นหาร้านค้า — feature 02 Shop Search)', () => {
    it('ค้นด้วย q ตัวพิมพ์เล็ก → เจอ "Bean Story" (case-insensitive)', async () => {
      const res = await api(app)
        .get('/api/v1/catalog/shops?q=bean')
        .expect(200);
      const shops = res.body as ShopCard[];
      expect(
        shops.some((s) => s.id === SEED.beanStory && s.name === 'Bean Story'),
      ).toBe(true);
    });

    it('ร้านที่ถูก admin ระงับ → หายจากผลค้นหา', async () => {
      await prisma.shop.update({
        where: { id: SEED.beanStory },
        data: { suspendedAt: new Date(), suspendedReason: 'ทดสอบ' },
      });
      try {
        const res = await api(app)
          .get('/api/v1/catalog/shops?q=Bean')
          .expect(200);
        expect(
          (res.body as ShopCard[]).some((s) => s.id === SEED.beanStory),
        ).toBe(false);
      } finally {
        await prisma.shop.update({
          where: { id: SEED.beanStory },
          data: { suspendedAt: null, suspendedReason: null },
        });
      }
    });

    it('ร้านที่เจ้าของปิดเอง (isActive=false) → หายจากผลค้นหา', async () => {
      await prisma.shop.update({
        where: { id: SEED.beanStory },
        data: { isActive: false },
      });
      try {
        const res = await api(app)
          .get('/api/v1/catalog/shops?q=Bean')
          .expect(200);
        expect(
          (res.body as ShopCard[]).some((s) => s.id === SEED.beanStory),
        ).toBe(false);
      } finally {
        await prisma.shop.update({
          where: { id: SEED.beanStory },
          data: { isActive: true },
        });
      }
    });

    it('ร้านที่ไม่มีสินค้าที่มองเห็นได้เลย (ร้านตัวอย่างของผู้ดูแล) → ไม่โผล่ในผลค้นหา', async () => {
      const res = await api(app)
        .get('/api/v1/catalog/shops?q=ผู้ดูแล')
        .expect(200);
      expect(
        (res.body as ShopCard[]).some((s) => s.id === SEED.adminShop),
      ).toBe(false);
    });

    it('response ไม่มี ownerId / suspendedAt / suspendedReason หลุด', async () => {
      const res = await api(app).get('/api/v1/catalog/shops').expect(200);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('ownerId');
      expect(raw).not.toContain('suspendedAt');
      expect(raw).not.toContain('suspendedReason');
    });

    it('limit เกินเพดาน (>20) → 400', async () => {
      await api(app).get('/api/v1/catalog/shops?limit=999').expect(400);
    });

    it('q ยาวเกิน 60 ตัวอักษร → ถูกตัดทิ้งส่วนเกินแทนที่จะ error (ทรงเดียวกับ /catalog/products)', async () => {
      const longQ = 'x'.repeat(120);
      await api(app).get(`/api/v1/catalog/shops?q=${longQ}`).expect(200);
    });

    it('GET /catalog/products?q=<ชื่อร้าน> → ได้สินค้าของร้านนั้นด้วย', async () => {
      const res = await api(app)
        .get(`/api/v1/catalog/products?q=${encodeURIComponent('Bean Story')}`)
        .expect(200);
      const rows = res.body as Card[];
      expect(rows.some((p) => p.id === SEED.coffee)).toBe(true);
      expect(rows.every((p) => p.shopName === 'Bean Story')).toBe(true);
    });

    // ★ regression guard ของ where.OR ★ ห้ามลบทิ้งแม้จะดูซ้ำกับเคส
    // "ร้านถูกระงับ → GET /catalog/products (ไม่มี q)" ข้างบน — เคสนั้นพิสูจน์แค่ว่า
    // suspendedAt กรองสินค้าออกตอนไม่มี q เท่านั้น ส่วนเคสนี้พิสูจน์คนละจุดเสี่ยง:
    // ตอนมี q, listProducts() ประกาศ `where.OR = [...]` ทับเข้าไปใน where เดิม
    // ถ้าใครมาแก้ภายหลังเป็นแพทเทิร์นที่คนเขียน Prisma พลาดกันบ่อย เช่น
    // `where.OR = [{ ...where }, { shop: { name: ... } }]` (คิดว่ากำลัง "รวม" เงื่อนไข
    // เดิมเข้าไปด้วย แต่จริง ๆ กลายเป็นสร้าง object ใหม่ที่ AND กับ where.OR ของตัวเอง
    // ไม่ใช่ AND กับ isActive/suspendedAt/shop ระดับบนสุดอีกต่อไป) สินค้าของร้านที่
    // ถูกแบนจะหลุดออกมาได้ทันทีเฉพาะตอนค้นด้วยชื่อร้าน โดยที่เคส suspend เฉย ๆ
    // (ไม่มี q) ข้างบนจะยังเขียวอยู่เหมือนเดิม — ต้องมีเคสนี้แยกไว้ต่างหาก
    it('★ regression guard: ร้านถูกระงับ + ค้นด้วยชื่อร้าน → ต้องไม่หลุดออกมาทาง where.OR', async () => {
      await prisma.shop.update({
        where: { id: SEED.beanStory },
        data: { suspendedAt: new Date(), suspendedReason: 'ทดสอบ' },
      });
      try {
        const res = await api(app)
          .get(`/api/v1/catalog/products?q=${encodeURIComponent('Bean Story')}`)
          .expect(200);
        const rows = res.body as Card[];
        expect(rows.some((p) => p.id === SEED.coffee)).toBe(false);
        expect(rows.some((p) => p.shopName === 'Bean Story')).toBe(false);
      } finally {
        await prisma.shop.update({
          where: { id: SEED.beanStory },
          data: { suspendedAt: null, suspendedReason: null },
        });
      }
    });

    // เคสคู่กัน — ร้านปิดเอง (isActive=false) ต้องกันได้เหมือนกับ suspendedAt ข้างบน
    // เพราะทั้งสองฟิลด์ถูก spread มาจาก VISIBLE_SHOP/VISIBLE_PRODUCT ระดับเดียวกัน
    it('★ regression guard: ร้านปิดเอง (isActive=false) + ค้นด้วยชื่อร้าน → ต้องไม่หลุดออกมาทาง where.OR', async () => {
      await prisma.shop.update({
        where: { id: SEED.beanStory },
        data: { isActive: false },
      });
      try {
        const res = await api(app)
          .get(`/api/v1/catalog/products?q=${encodeURIComponent('Bean Story')}`)
          .expect(200);
        const rows = res.body as Card[];
        expect(rows.some((p) => p.id === SEED.coffee)).toBe(false);
        expect(rows.some((p) => p.shopName === 'Bean Story')).toBe(false);
      } finally {
        await prisma.shop.update({
          where: { id: SEED.beanStory },
          data: { isActive: true },
        });
      }
    });

    it('productCount และ activeSubscribers ของ Bean Story ตรงกับข้อมูลจริงใน DB', async () => {
      const [dbProductCount, dbActiveSubs] = await Promise.all([
        prisma.product.count({
          where: {
            shopId: SEED.beanStory,
            isActive: true,
            suspendedAt: null,
          },
        }),
        prisma.subscription.count({
          where: {
            status: 'active',
            plan: { product: { shopId: SEED.beanStory } },
          },
        }),
      ]);

      const res = await api(app)
        .get(`/api/v1/catalog/shops/${SEED.beanStory}`)
        .expect(200);
      const body = res.body as {
        productCount: number;
        activeSubscribers: number;
      };
      expect(body.productCount).toBe(dbProductCount);
      expect(body.activeSubscribers).toBe(dbActiveSubs);
    });
  });
});
