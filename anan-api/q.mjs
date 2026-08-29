import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const o = await p.order.findMany({
  where: { discountAmount: { gt: 0 } },
  orderBy: { createdAt: 'desc' }, take: 1,
  select: { id: true, amount: true, discountAmount: true,
    payment: { select: { amount: true, status: true } },
    platformRedemption: { select: { status: true, discountAmount: true, tier: true, coupon: { select: { code: true } } } },
    shopRedemption: { select: { status: true, discountAmount: true, tier: true, coupon: { select: { code: true } } } } },
});
console.log(JSON.stringify(o, null, 1));
await p.$disconnect();
