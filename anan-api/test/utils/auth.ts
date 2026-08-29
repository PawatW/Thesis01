import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { api } from './app';

/**
 * ผู้ใช้สำหรับ e2e ทุกคนใช้อีเมลขึ้นต้นด้วย prefix นี้
 * เพื่อให้ `cleanupTestUsers` ลบเฉพาะของตัวเอง — ไม่แตะข้อมูล seed
 * (บทเรียนเดิม: test ที่นับทั้งตารางจะล้มทันทีที่ seed มีข้อมูลเพิ่ม)
 */
export const E2E_PREFIX = 'e2e-';

/**
 * คูปองที่ e2e สร้างขึ้นเอง — โค้ดต้องเป็นตัวพิมพ์ใหญ่ (CHECK `coupons_code_format`)
 * จึงใช้ prefix แยกจากอีเมล ให้ `cleanupTestCoupons` ลบเฉพาะของตัวเอง
 */
export const E2E_COUPON_PREFIX = 'E2E';
export const TEST_PASSWORD = 'E2ePassword2026!';

export interface TestUser {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

let counter = 0;

export async function registerTestUser(
  app: INestApplication,
  tag: string,
): Promise<TestUser> {
  const email = `${E2E_PREFIX}${tag}-${Date.now()}-${counter++}@test.local`;

  const res = await api(app)
    .post('/api/v1/auth/register')
    .send({ email, password: TEST_PASSWORD, displayName: `ทดสอบ ${tag}` })
    .expect(201);

  const body = res.body as {
    accessToken: string;
    refreshToken: string;
    user: { id: string; email: string };
  };

  return {
    id: body.user.id,
    email: body.user.email,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
  };
}

/**
 * ลบผู้ใช้ที่ test สร้าง
 *
 * ★ ต้องลบลูกตามลำดับเอง ★ พึ่ง cascade อย่างเดียวไม่ได้ เพราะ
 * `orders → subscriptions` และ `subscriptions → addresses` เป็น ON DELETE
 * **RESTRICT** โดยตั้งใจ (ประวัติต้องไม่หายตามที่อยู่ที่ถูกลบ)
 * พอ Phase 2 เริ่มสร้าง subscription ใน e2e การลบ user จะโดน P2003
 * แล้ว `afterAll` ของทุกไฟล์จะล้มพร้อมกันโดยดูเหมือน flake ที่ไม่เกี่ยวกัน
 */
export async function cleanupTestUsers(prisma: PrismaService): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: E2E_PREFIX } },
    select: { id: true },
  });
  if (users.length === 0) return;
  const userIds = users.map((u) => u.id);

  await prisma.$transaction([
    prisma.payment.deleteMany({
      where: { order: { buyerId: { in: userIds } } },
    }),
    prisma.orderIssue.deleteMany({ where: { reporterId: { in: userIds } } }),
    prisma.review.deleteMany({ where: { buyerId: { in: userIds } } }),
    prisma.order.deleteMany({ where: { buyerId: { in: userIds } } }),
    // ★ ต้องอยู่หลังออเดอร์ ★ FK `orders.coupon_redemption_id` เป็น RESTRICT
    // (ถ้าเป็น SET NULL ออเดอร์จะเหลือส่วนลดที่ไม่มีที่มา → ผิด CHECK)
    prisma.couponRedemption.deleteMany({
      where: { buyerId: { in: userIds } },
    }),
    prisma.subscriptionEvent.deleteMany({
      where: { subscription: { buyerId: { in: userIds } } },
    }),
    prisma.subscription.deleteMany({ where: { buyerId: { in: userIds } } }),
    prisma.notification.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.paymentMethod.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.address.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.passwordResetToken.deleteMany({
      where: { userId: { in: userIds } },
    }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  ]);
}

/**
 * ลบคูปองที่ e2e สร้าง — เรียก **หลัง** `cleanupTestUsers` เสมอ
 * เพราะใบจองจะลบได้ก็ต่อเมื่อไม่มีออเดอร์ชี้อยู่แล้ว
 */
export async function cleanupTestCoupons(prisma: PrismaService): Promise<void> {
  const where = { coupon: { code: { startsWith: E2E_COUPON_PREFIX } } };
  await prisma.$transaction([
    prisma.couponRedemption.deleteMany({ where }),
    prisma.couponProduct.deleteMany({ where }),
    prisma.coupon.deleteMany({
      where: { code: { startsWith: E2E_COUPON_PREFIX } },
    }),
  ]);
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
