/**
 * ANAN — ข้อมูลเดโม่
 *
 * รันด้วย: npm run db:seed
 * สคริปต์เดโม่ที่ข้อมูลชุดนี้รองรับ: context/workflows/w09-demo-script.md
 *
 * บัญชีทดสอบ (รหัสผ่านเดียวกันทุกบัญชี: DemoPass2026!)
 *   buyer.demo@anan.local    — มีที่อยู่ บัตรจำลอง และ subscription ที่กำลังใช้งาน
 *   seller.demo@anan.local   — เจ้าของร้าน Bean Story มีสมาชิกแล้ว
 *   seller2.demo@anan.local  — ร้าน Herbal Care
 *   seller3.demo@anan.local  — ร้าน Pet & Home
 *   admin.demo@anan.local    — ผู้ดูแลระบบ (+ ร้านตัวอย่างของตัวเอง ไว้สลับดูโหมดร้านค้า)
 *
 * วันที่ทั้งหมดอิงจาก "วันนี้" ตามเวลาไทย เพื่อให้เดโม่มีครบทุกสถานการณ์เสมอ:
 * รอบที่ถึงกำหนดใน 3 วัน (แจ้งเตือน T-3) · รอบที่ถึงกำหนดวันนี้ (เดโม่ engine) · รอบที่หยุดไว้
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { addDays, todayInBangkok } from '../src/common/date';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'DemoPass2026!';
const today = todayInBangkok();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const daysAgo = (d: number) => hoursAgo(d * 24);
const daysFromNow = (d: number) => hoursAgo(-d * 24);

const U = {
  buyer: '00000000-0000-4000-8000-000000000001',
  seller: '00000000-0000-4000-8000-000000000002',
  admin: '00000000-0000-4000-8000-000000000003',
  seller2: '00000000-0000-4000-8000-000000000004',
  seller3: '00000000-0000-4000-8000-000000000005',
};
const SHOP = {
  bean: '10000000-0000-4000-8000-000000000001',
  herbal: '10000000-0000-4000-8000-000000000002',
  pet: '10000000-0000-4000-8000-000000000003',
  adminDemo: '10000000-0000-4000-8000-000000000004',
};
const P = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PLAN = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADDR = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CARD = '50000000-0000-4000-8000-000000000001';
const SUB = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORDER = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const BUYER_ADDRESS_SNAPSHOT = {
  recipient_name: 'ปวัตน์ วันศิริสุข',
  phone: '0812345678',
  address_line: '99/1 ซอยงามวงศ์วาน 23 แขวงลาดยาว เขตจตุจักร',
  province: 'กรุงเทพมหานคร',
  postcode: '10900',
};
const WORK_ADDRESS_SNAPSHOT = {
  ...BUYER_ADDRESS_SNAPSHOT,
  phone: '0898765432',
  address_line: '50 ถนนงามวงศ์วาน แขวงลาดยาว เขตจตุจักร',
};

/** ล้างของเก่าตามลำดับ FK — seed ต้องรันซ้ำได้เสมอ */
async function reset(): Promise<void> {
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.review.deleteMany(),
    prisma.orderIssue.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.order.deleteMany(),
    // ★ ต้องอยู่หลังออเดอร์ ★ FK `orders.coupon_redemption_id` เป็น RESTRICT
    prisma.couponRedemption.deleteMany(),
    prisma.subscriptionEvent.deleteMany(),
    prisma.subscription.deleteMany(),
    prisma.couponProduct.deleteMany(),
    prisma.coupon.deleteMany(),
    prisma.productPlan.deleteMany(),
    prisma.product.deleteMany(),
    prisma.shop.deleteMany(),
    prisma.category.deleteMany(),
    prisma.paymentMethod.deleteMany(),
    prisma.address.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.engineRun.deleteMany(),
    // ★ ล้าง log ด้วย — และนี่ไม่ขัดกับกฎ "ห้ามลบ log" ★
    // กฎนั้นพูดถึง **API**: ไม่มี endpoint ให้ผู้ดูแลลบร่องรอยของตัวเอง
    // ส่วน `db:seed` คือคำสั่งของ dev ที่คืนเครื่องเดโม่ให้เป็นสภาพตั้งต้นทั้งเครื่อง
    // ถ้าไม่ล้าง `email_logs` จะเหลืออีเมลของบัญชีที่ถูกลบไปแล้วค้างอยู่ (PDPA)
    // และ `audit_logs` จะเต็มไปด้วยแถวที่อ้างถึงร้าน/หมวดที่ไม่มีอยู่แล้ว
    prisma.emailLog.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

async function main(): Promise<void> {
  await reset();

  // ตั้งค่าเมลกลับเป็นค่าตั้งต้น — โหมดเปลี่ยนเส้นทางที่เปิดค้างไว้จากรอบก่อน
  // จะทำให้อีเมลของเดโม่รอบใหม่ไปเข้ากล่องเดิมโดยไม่มีใครรู้
  await prisma.mailSetting.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {
      redirectEnabled: false,
      redirectTo: null,
      redirectCc: null,
      smtpHost: null,
      smtpPort: null,
      smtpSecure: false,
      mailFrom: null,
      updatedById: null,
    },
  });

  // ---------- 1. บัญชีเดโม่ ----------
  // cost 12 เท่าของจริง — ตั้งใจให้ seed ช้าหน่อย ดีกว่ามี hash คนละมาตรฐานในระบบ
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  await prisma.user.createMany({
    data: [
      { id: U.buyer, email: 'buyer.demo@anan.local', passwordHash, displayName: 'ปวัตน์ (ผู้ซื้อ)', phone: '0812345678' },
      { id: U.seller, email: 'seller.demo@anan.local', passwordHash, displayName: 'ร้านกาแฟ Bean Story', isSeller: true },
      // สิทธิ์ admin มาจาก seed/SQL เท่านั้น ไม่มี UI ไหนให้ยกระดับตัวเองได้
      //
      // `isSeller: true` ด้วย เพราะบัญชีนี้มีร้านตัวอย่างของตัวเอง (ดูหัวข้อ 3) —
      // ผู้ดูแลเห็นปุ่มครบ 3 โหมดอยู่แล้วจาก `rolesOf()` ฝั่งแอป แต่ "เห็นปุ่ม" กับ
      // "กดแล้วมีอะไรให้ดู" คนละเรื่อง: หลังร้านอ่านข้อมูลจาก `shop.ownerId` เสมอ
      // ไม่มีร้านของตัวเองก็เข้าไปเจอหน้าเปิดร้านเปล่า ๆ
      { id: U.admin, email: 'admin.demo@anan.local', passwordHash, displayName: 'ผู้ดูแลระบบ', isAdmin: true, isSeller: true },
      { id: U.seller2, email: 'seller2.demo@anan.local', passwordHash, displayName: 'ร้าน Herbal Care', isSeller: true },
      { id: U.seller3, email: 'seller3.demo@anan.local', passwordHash, displayName: 'ร้าน Pet & Home', isSeller: true },
    ],
  });

  // ---------- 2. หมวดสินค้า (10 หมวดตามข้อเสนอ) ----------
  await prisma.category.createMany({
    data: [
      { id: 1, name: 'กาแฟ', icon: 'cafe', sortOrder: 1 },
      { id: 2, name: 'สกินแคร์', icon: 'sparkles', sortOrder: 2 },
      { id: 3, name: 'ยาสีฟัน', icon: 'medical', sortOrder: 3 },
      { id: 4, name: 'แชมพู', icon: 'water', sortOrder: 4 },
      { id: 5, name: 'วิตามิน', icon: 'fitness', sortOrder: 5 },
      { id: 6, name: 'อาหารสัตว์เลี้ยง', icon: 'paw', sortOrder: 6 },
      { id: 7, name: 'ผ้าอ้อม', icon: 'happy', sortOrder: 7 },
      { id: 8, name: 'ของใช้ในบ้าน', icon: 'home', sortOrder: 8 },
      { id: 9, name: 'ชุดชั้นใน', icon: 'shirt', sortOrder: 9 },
      { id: 10, name: 'ถุงเท้า', icon: 'footsteps', sortOrder: 10 },
    ],
  });
  // id ของ categories เป็น serial — ต้องดัน sequence ตามด้วย ไม่งั้น insert ถัดไปชน PK
  await prisma.$executeRawUnsafe(
    `select setval(pg_get_serial_sequence('categories', 'id'), 10, true)`,
  );

  // ---------- 3. ร้านค้า ----------
  await prisma.shop.createMany({
    data: [
      { id: SHOP.bean, ownerId: U.seller, name: 'Bean Story', description: 'กาแฟคั่วสดทุกสัปดาห์ ส่งตรงจากโรงคั่วเชียงใหม่' },
      { id: SHOP.herbal, ownerId: U.seller2, name: 'Herbal Care', description: 'ของใช้ส่วนตัวจากสมุนไพรไทย ไม่ทดลองกับสัตว์' },
      { id: SHOP.pet, ownerId: U.seller3, name: 'Pet & Home', description: 'อาหารสัตว์เลี้ยงและของใช้ในบ้าน ซื้อยกแพ็กประหยัดกว่า' },
      // ★ ร้านของบัญชีผู้ดูแล ★ มีไว้ให้เดโม่ "สลับดูได้ทุกโหมด" กดแล้วมีของให้ดูจริง
      //
      // **ตั้งใจไม่มีสินค้า** — ร้านนี้เป็นร้านเปิดใหม่ที่ยังไม่มีอะไร ซึ่งเป็นสภาพที่
      // ควรเดโม่ให้เห็นอยู่แล้ว (หน้า dashboard/ออเดอร์ตอนยังว่าง) และที่สำคัญกว่าคือ
      // สินค้าของร้านนี้จะไปโผล่ในหน้าแรก/หน้าหมวด/หน้าเทียบสินค้า แล้วขยับลำดับที่
      // spec ของ catalog กับ compare จับไว้ · อยากได้สินค้าในร้านนี้ให้เพิ่มผ่านหน้าจอ
      // ของร้านเอาเอง จะได้เป็นข้อมูลที่ผ่าน DTO จริงทุกด่าน
      { id: SHOP.adminDemo, ownerId: U.admin, name: 'ร้านตัวอย่างของผู้ดูแล', description: 'ร้านสำหรับผู้ดูแลระบบไว้เปิดดูหน้าจอฝั่งร้านค้า — ยังไม่มีสินค้า' },
    ],
  });

  // ---------- 4. สินค้า + แผน ----------
  // oneTimePrice คือราคาอ้างอิง: pricePerCycle ต้องต่ำกว่าเสมอ ไม่งั้นป้าย
  // "ถูกกว่าซื้อครั้งเดียว" จะติดลบ (feature 03 edge case)
  //
  // `images: []` — ตั้งใจว่าง ไม่ใช่ลืมใส่
  // ของเดิมเก็บเป็นชื่อไฟล์เปล่า (`coffee-medium.jpg`) ซึ่งเป็นข้อมูลที่
  // **สร้างผ่าน API ของเราเองไม่ได้เลย** เพราะ `CreateProductDto` บังคับ
  // `@IsUrl({ protocols: ['https'] })` · seed เขียนตรงผ่าน Prisma จึงเล็ดลอดมาได้
  // แล้วไม่มีวัน render ออกมาเป็นรูปได้จริง
  //
  // ระหว่างที่ยังไม่มีรูปจริง หน้าจอใช้สีประจำหมวด + ไอคอนหมวดแทน (ดู
  // `ProductImage.tsx`) ซึ่งอ่านออกและบอกหมวดได้ · ใส่ลิงก์ https ผ่านหน้าแก้สินค้า
  // ของร้านเมื่อไหร่ รูปจริงจะขึ้นทันทีโดยไม่ต้องแก้โค้ด
  await prisma.product.createMany({
    data: [
      { id: P(1), shopId: SHOP.bean, categoryId: 1, name: 'กาแฟคั่วกลาง Arabica', description: 'เมล็ดอาราบิก้าดอยช้าง คั่วกลาง หอมช็อกโกแลตและคาราเมล', images: [], oneTimePrice: 320, netAmount: 250, unit: 'g' },
      { id: P(2), shopId: SHOP.bean, categoryId: 1, name: 'กาแฟคั่วเข้ม Espresso', description: 'บอดี้หนัก เหมาะกับเครื่องเอสเพรสโซ่และมอคค่าพอต', images: [], oneTimePrice: 340, netAmount: 250, unit: 'g' },
      { id: P(3), shopId: SHOP.bean, categoryId: 1, name: 'ดริปแบ็ก 10 ซอง', description: 'กาแฟดริปสำเร็จ พกง่าย ชงได้ทุกที่', images: [], oneTimePrice: 250, netAmount: 100, unit: 'g' },
      { id: P(4), shopId: SHOP.herbal, categoryId: 3, name: 'ยาสีฟันสมุนไพร', description: 'สูตรเกลือสมุนไพร ลดกลิ่นปาก ไม่มีสารเรืองแสง', images: [], oneTimePrice: 120, netAmount: 160, unit: 'g' },
      { id: P(5), shopId: SHOP.herbal, categoryId: 4, name: 'แชมพูมะกรูด', description: 'ลดผมร่วง หนังศีรษะสมดุล กลิ่นมะกรูดสดชื่น', images: [], oneTimePrice: 245, netAmount: 400, unit: 'ml' },
      { id: P(6), shopId: SHOP.herbal, categoryId: 2, name: 'เซรั่มไนอาซินาไมด์ 10%', description: 'ลดรอยสิวและจุดด่างดำ ใช้ได้ทั้งเช้าและกลางคืน', images: [], oneTimePrice: 459, netAmount: 30, unit: 'ml' },
      { id: P(7), shopId: SHOP.herbal, categoryId: 2, name: 'ครีมกันแดด SPF50+', description: 'เนื้อบางเบา ไม่วอกขาว ใช้ทุกวัน', images: [], oneTimePrice: 390, netAmount: 50, unit: 'ml' },
      { id: P(8), shopId: SHOP.herbal, categoryId: 5, name: 'วิตามินซี 1000mg', description: '30 เม็ด เสริมภูมิคุ้มกัน', images: [], oneTimePrice: 350, netAmount: 30, unit: 'piece' },
      { id: P(9), shopId: SHOP.pet, categoryId: 6, name: 'อาหารแมวเกรดพรีเมียม', description: 'สูตรปลาแซลมอน ไม่ใส่สีสังเคราะห์ ถุง 1.5 กก.', images: [], oneTimePrice: 620, netAmount: 1500, unit: 'g' },
      { id: P(10), shopId: SHOP.pet, categoryId: 6, name: 'ทรายแมวเต้าหู้', description: 'จับตัวเป็นก้อน ทิ้งชักโครกได้ 6 ลิตร', images: [], oneTimePrice: 290, netAmount: 6000, unit: 'ml' },
      { id: P(11), shopId: SHOP.pet, categoryId: 8, name: 'น้ำยาซักผ้าเติม', description: 'สูตรเข้มข้น กลิ่นอ่อนโยน ถุงเติม 1,400 มล.', images: [], oneTimePrice: 210, netAmount: 1400, unit: 'ml' },
      { id: P(12), shopId: SHOP.pet, categoryId: 8, name: 'กระดาษทิชชู่ 12 ม้วน', description: 'เยื่อบริสุทธิ์ 100% หนา 3 ชั้น', images: [], oneTimePrice: 189, netAmount: 12, unit: 'piece' },
    ],
  });

  await prisma.productPlan.createMany({
    data: [
      // Bean Story: กาแฟหมดเร็ว รอบ 2 สัปดาห์จึงคุ้มต่อหน่วยที่สุด
      { id: PLAN(1), productId: P(1), cycle: '2w', pricePerCycle: 279, qtyPerCycle: 1 },
      { id: PLAN(2), productId: P(1), cycle: '1m', pricePerCycle: 255, qtyPerCycle: 1 },
      { id: PLAN(3), productId: P(1), cycle: '2m', pricePerCycle: 590, qtyPerCycle: 2 },
      { id: PLAN(4), productId: P(2), cycle: '1m', pricePerCycle: 275, qtyPerCycle: 1 },
      // แผนนี้ปิดรับสมาชิกใหม่โดยตั้งใจ: คนที่สมัครไว้แล้วยังอยู่ แต่สมัครใหม่ไม่ได้
      { id: PLAN(5), productId: P(3), cycle: '2w', pricePerCycle: 219, qtyPerCycle: 1, isActive: false },
      { id: PLAN(6), productId: P(3), cycle: '1m', pricePerCycle: 199, qtyPerCycle: 1 },
      // Herbal Care
      { id: PLAN(7), productId: P(4), cycle: '1m', pricePerCycle: 99, qtyPerCycle: 1 },
      { id: PLAN(8), productId: P(4), cycle: '2m', pricePerCycle: 178, qtyPerCycle: 2 },
      { id: PLAN(9), productId: P(5), cycle: '1m', pricePerCycle: 199, qtyPerCycle: 1 },
      { id: PLAN(10), productId: P(5), cycle: '2m', pricePerCycle: 370, qtyPerCycle: 2 },
      { id: PLAN(11), productId: P(6), cycle: '2m', pricePerCycle: 389, qtyPerCycle: 1 },
      { id: PLAN(12), productId: P(7), cycle: '2m', pricePerCycle: 330, qtyPerCycle: 1 },
      { id: PLAN(13), productId: P(8), cycle: '1m', pricePerCycle: 289, qtyPerCycle: 1 },
      // Pet & Home
      { id: PLAN(14), productId: P(9), cycle: '1m', pricePerCycle: 549, qtyPerCycle: 1 },
      { id: PLAN(15), productId: P(9), cycle: '2w', pricePerCycle: 289, qtyPerCycle: 1 },
      { id: PLAN(16), productId: P(10), cycle: '1m', pricePerCycle: 249, qtyPerCycle: 1 },
      { id: PLAN(17), productId: P(11), cycle: '1m', pricePerCycle: 179, qtyPerCycle: 1 },
      { id: PLAN(18), productId: P(12), cycle: '2m', pricePerCycle: 320, qtyPerCycle: 2 },
    ],
  });

  // ---------- 5. ผู้ซื้อ: ที่อยู่ + บัตรจำลอง ----------
  await prisma.address.createMany({
    data: [
      { id: ADDR(1), userId: U.buyer, label: 'บ้าน', recipientName: 'ปวัตน์ วันศิริสุข', phone: '0812345678', addressLine: BUYER_ADDRESS_SNAPSHOT.address_line, province: 'กรุงเทพมหานคร', postcode: '10900', isDefault: true },
      { id: ADDR(2), userId: U.buyer, label: 'ที่ทำงาน', recipientName: 'ปวัตน์ วันศิริสุข', phone: '0898765432', addressLine: WORK_ADDRESS_SNAPSHOT.address_line, province: 'กรุงเทพมหานคร', postcode: '10900', isDefault: false },
    ],
  });

  // บัตรของผู้ซื้อ — เก็บได้แค่เครือข่าย + 4 ตัวท้าย + วันหมดอายุ (CLAUDE.md กฎข้อ 1)
  await prisma.paymentMethod.create({
    data: {
      id: CARD,
      userId: U.buyer,
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
      holderName: 'PAVAT W',
    },
  });

  // ---------- 6. subscription ที่กำลังใช้งาน ----------
  // cycleAnchorDate = nextOrderDate: ข้อมูลเดโม่ผูกกับ "วันนี้" ตอนรัน seed ไม่ใช่
  // วันที่สมัครจริง การตั้งหมุดไว้ที่รอบถัดไปทำให้รอบที่จะเกิดต่อจากนี้ตกวันเดียวกัน
  // ทุกเดือน (เหมือนที่ผู้ใช้เพิ่งเลื่อนวันส่ง) — ถ้าใช้ startDate เป็นหมุด กริดจะ
  // ไม่ผ่าน nextOrderDate ที่ตั้งไว้ แล้ว engine จะเลื่อนวันแปลก ๆ ในการรันครั้งแรก
  await prisma.subscription.createMany({
    data: [
      { id: SUB(1), buyerId: U.buyer, planId: PLAN(2), addressId: ADDR(1), paymentMethodId: CARD, status: 'active', quantity: 1, startDate: addDays(today, -60), cycleAnchorDate: addDays(today, 3), nextOrderDate: addDays(today, 3) },
      { id: SUB(2), buyerId: U.buyer, planId: PLAN(7), addressId: ADDR(1), paymentMethodId: CARD, status: 'active', quantity: 2, startDate: addDays(today, -30), cycleAnchorDate: today, nextOrderDate: today },
      { id: SUB(3), buyerId: U.buyer, planId: PLAN(14), addressId: ADDR(2), paymentMethodId: CARD, status: 'paused', quantity: 1, startDate: addDays(today, -90), cycleAnchorDate: addDays(today, 12), nextOrderDate: addDays(today, 12), pausedAt: daysAgo(5), pausedReason: 'user' },
    ],
  });

  await prisma.subscriptionEvent.createMany({
    data: [
      { subscriptionId: SUB(1), event: 'created', detail: {}, createdAt: daysAgo(60) },
      { subscriptionId: SUB(1), event: 'skipped', detail: { from: addDays(today, -27).toISOString().slice(0, 10), to: addDays(today, 3).toISOString().slice(0, 10) }, createdAt: daysAgo(27) },
      { subscriptionId: SUB(2), event: 'created', detail: {}, createdAt: daysAgo(30) },
      { subscriptionId: SUB(3), event: 'created', detail: {}, createdAt: daysAgo(90) },
      { subscriptionId: SUB(3), event: 'paused', detail: { reason: 'user' }, createdAt: daysAgo(5) },
    ],
  });

  // ---------- 7. ประวัติออเดอร์ (ให้เดโม่ไม่ว่างเปล่าตอนเปิดครั้งแรก) ----------
  await prisma.order.createMany({
    data: [
      { id: ORDER(1), subscriptionId: SUB(1), buyerId: U.buyer, cycleDate: addDays(today, -60), status: 'delivered', amount: 255, quantity: 1, addressSnapshot: BUYER_ADDRESS_SNAPSHOT, trackingNote: 'TH1234567890', confirmedAt: daysAgo(55), createdAt: daysAgo(60) },
      { id: ORDER(2), subscriptionId: SUB(1), buyerId: U.buyer, cycleDate: addDays(today, -30), status: 'delivered', amount: 255, quantity: 1, addressSnapshot: BUYER_ADDRESS_SNAPSHOT, trackingNote: 'TH1234567891', confirmedAt: daysAgo(25), createdAt: daysAgo(30) },
      { id: ORDER(3), subscriptionId: SUB(2), buyerId: U.buyer, cycleDate: addDays(today, -30), status: 'shipped', amount: 198, quantity: 2, addressSnapshot: BUYER_ADDRESS_SNAPSHOT, trackingNote: 'TH1234567892', createdAt: daysAgo(3) },
      { id: ORDER(4), subscriptionId: SUB(3), buyerId: U.buyer, cycleDate: addDays(today, -30), status: 'delivered', amount: 549, quantity: 1, addressSnapshot: WORK_ADDRESS_SNAPSHOT, trackingNote: 'TH1234567893', confirmedAt: daysAgo(26), createdAt: daysAgo(30) },
    ],
  });

  await prisma.payment.createMany({
    data: [
      { orderId: ORDER(1), amount: 255, status: 'paid', paidAt: daysAgo(60) },
      { orderId: ORDER(2), amount: 255, status: 'paid', paidAt: daysAgo(30) },
      { orderId: ORDER(3), amount: 198, status: 'paid', paidAt: daysAgo(3) },
      { orderId: ORDER(4), amount: 549, status: 'paid', paidAt: daysAgo(30) },
    ],
  });

  // ---------- 8. รีวิว (ยืนยันแล้วว่าผู้เขียนได้รับของจริง) ----------
  await prisma.review.createMany({
    data: [
      { subscriptionId: SUB(1), productId: P(1), buyerId: U.buyer, rating: 5, comment: 'คั่วสดจริง กลิ่นหอมตั้งแต่แกะถุง สั่งรายเดือนกำลังดีไม่เหลือค้าง', cyclesReceived: 2, createdAt: daysAgo(20) },
      { subscriptionId: SUB(3), productId: P(9), buyerId: U.buyer, rating: 4, comment: 'แมวกินดี แต่ช่วงนี้ยังเหลือเยอะเลยกดหยุดไว้ก่อน', cyclesReceived: 1, createdAt: daysAgo(6) },
    ],
  });

  // ---------- 9. การแจ้งเตือน ----------
  await prisma.notification.createMany({
    data: [
      { userId: U.buyer, type: 'upcoming_cycle', title: 'อีก 3 วันถึงรอบส่ง', body: 'กาแฟคั่วกลาง Arabica — ตัดเงินจำลอง ฿255 ข้ามรอบได้ถึงวันก่อนส่ง', linkPath: `/subscriptions/${SUB(1)}`, createdAt: hoursAgo(2) },
      { userId: U.buyer, type: 'order_status', title: 'พัสดุออกจากร้านแล้ว', body: 'ยาสีฟันสมุนไพร — เลขพัสดุ TH1234567892', linkPath: `/orders/${ORDER(3)}`, createdAt: daysAgo(3) },
      { userId: U.seller, type: 'new_subscriber', title: 'มีผู้สมัครรับสินค้าใหม่', body: 'กาแฟคั่วกลาง Arabica — รอบรายเดือน', linkPath: '/orders', readAt: daysAgo(1), createdAt: daysAgo(30) },
    ],
  });

  // ---------- 10. คูปองเดโม่ (feature 18) ----------
  // ผู้ดูแลออกคูปอง แล้วร้านเป็นคนเลือกว่าสินค้าไหนเข้าร่วม — สองใบนี้ครอบ
  // ทั้งสองชนิด (percent + เพดาน / fixed + ยอดขั้นต่ำ) เพื่อให้เดโม่เห็นครบ
  const COUPON = (n: number) =>
    `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  await prisma.coupon.createMany({
    data: [
      {
        id: COUPON(1),
        code: 'NEWROUND20',
        title: 'ลด 20% รอบไหนก็ได้ที่คุณเลือก',
        description:
          'เลือกใช้กับรอบใดรอบหนึ่งก่อนวันตัดเงิน — 1 คนใช้ได้ครั้งเดียว',
        discountType: 'percent',
        discountValue: 20,
        maxDiscountAmount: 80,
        startsAt: daysAgo(7),
        endsAt: daysFromNow(60),
        maxRedemptions: 50,
        createdBy: U.admin,
      },
      {
        id: COUPON(2),
        code: 'SAVE50',
        title: 'ลด 50 บาท เมื่อยอดรอบนั้นถึง 250 บาท',
        description: 'ใช้กับรอบที่คุณเลือกเองได้ 1 รอบ',
        discountType: 'fixed',
        discountValue: 50,
        minOrderAmount: 250,
        startsAt: daysAgo(3),
        endsAt: daysFromNow(30),
        createdBy: U.admin,
      },
      // ---- คูปองระดับร้าน (tier = shop) ----
      // ★ ซ้อนกับคูปองแพลตฟอร์มได้ ★ ถ้าสินค้าชิ้นนั้นตั้ง couponPolicy = both
      {
        id: COUPON(3),
        code: 'BEAN10',
        title: 'ลด 10% ทุกสินค้าของ Bean Story',
        description: 'คูปองของร้าน ใช้ร่วมกับคูปองของแพลตฟอร์มได้',
        tier: 'shop',
        shopId: SHOP.bean,
        // ครอบทุกสินค้าของร้าน รวมที่เพิ่มทีหลัง — ไม่ต้องมีแถวใน coupon_products
        appliesToAllProducts: true,
        discountType: 'percent',
        discountValue: 10,
        maxDiscountAmount: 60,
        startsAt: daysAgo(5),
        // ช่วงยาวกว่าใบอื่นโดยตั้งใจ — ชุดเทส L4 time-travel ไปข้างหน้า ~2 เดือน
        // ถ้าคูปองหมดอายุก่อน เคสซ้อน 2 ระดับจะแดงโดยไม่ได้แปลว่าโค้ดพัง
        endsAt: daysFromNow(120),
        maxRedemptions: 100,
        createdBy: U.seller,
      },
      {
        id: COUPON(4),
        code: 'HERBAL30',
        title: 'ลด 30 บาท เฉพาะแชมพูมะกรูด',
        description: 'คูปองของร้าน Herbal Care — เลือกสินค้าเอง',
        tier: 'shop',
        shopId: SHOP.herbal,
        appliesToAllProducts: false,
        discountType: 'fixed',
        discountValue: 30,
        startsAt: daysAgo(2),
        endsAt: daysFromNow(20),
        createdBy: U.seller2,
      },
    ],
  });

  // ร้าน Bean Story เข้าร่วมทั้งสองใบ · Herbal Care เข้าร่วมใบ percent อย่างเดียว
  await prisma.couponProduct.createMany({
    data: [
      { couponId: COUPON(1), productId: P(1), enabledBy: U.seller },
      { couponId: COUPON(1), productId: P(2), enabledBy: U.seller },
      { couponId: COUPON(2), productId: P(1), enabledBy: U.seller },
      { couponId: COUPON(1), productId: P(5), enabledBy: U.seller2 },
      // คูปองของร้านแบบเลือกสินค้าเอง — ต้องมีแถวเพราะไม่ได้ตั้งเป็น "ทั้งร้าน"
      { couponId: COUPON(4), productId: P(5), enabledBy: U.seller2 },
    ],
  });

  // ★ นโยบายคูปองรายสินค้า ★ ค่าปริยายคือ `both` — ตั้งตัวอย่างให้เห็นทั้ง 3 แบบ
  // เพื่อให้เดโม่แสดงได้ว่าร้าน "ปิดการซ้อน" รายชิ้นได้จริง
  await prisma.product.update({
    where: { id: P(2) },
    // กาแฟคั่วเข้ม — รับเฉพาะคูปองของแพลตฟอร์ม (ร้านกันไม่ให้ลดซ้อนสองชั้น)
    data: { couponPolicy: 'platform_only' },
  });
  await prisma.product.update({
    where: { id: P(3) },
    // ดริปแบ็ก — สินค้ากำไรบาง ไม่ร่วมรายการคูปองเลย
    data: { couponPolicy: 'none' },
  });

  const counts = {
    users: await prisma.user.count(),
    shops: await prisma.shop.count(),
    products: await prisma.product.count(),
    plans: await prisma.productPlan.count(),
    subscriptions: await prisma.subscription.count(),
    orders: await prisma.order.count(),
    coupons: await prisma.coupon.count(),
  };
  console.log('seed เสร็จแล้ว:', counts);
  console.log(`ทุกบัญชีใช้รหัสผ่าน: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
