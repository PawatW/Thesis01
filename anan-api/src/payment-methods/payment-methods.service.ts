import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { todayInBangkok } from '../common/date';
import { AppError } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  toPaymentMethodResponse,
  type CreatePaymentMethodDto,
  type PaymentMethodResponse,
} from './dto/payment-method.dto';

/** จำกัดจำนวนบัตรต่อบัญชี — กันการยิงสร้างรัวจนตารางบวม */
const MAX_CARDS_PER_USER = 5;

/** บัตรจริงออกให้ไกลสุดราว 10 ปี — กันการผูกบัตรที่หมดอายุปี 2099 */
const MAX_YEARS_AHEAD = 20;

@Injectable()
export class PaymentMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<PaymentMethodResponse[]> {
    const rows = await this.prisma.paymentMethod.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toPaymentMethodResponse);
  }

  async create(
    userId: string,
    dto: CreatePaymentMethodDto,
  ): Promise<PaymentMethodResponse> {
    this.assertUsableExpiry(dto.expMonth, dto.expYear);

    const count = await this.prisma.paymentMethod.count({ where: { userId } });
    if (count >= MAX_CARDS_PER_USER) {
      throw AppError.conflict(
        'TOO_MANY_CARDS',
        `เพิ่มบัตรได้สูงสุด ${MAX_CARDS_PER_USER} ใบ`,
      );
    }

    try {
      const created = await this.prisma.paymentMethod.create({
        data: {
          userId,
          brand: dto.brand,
          last4: dto.last4,
          expMonth: dto.expMonth,
          expYear: dto.expYear,
          holderName: dto.holderName,
          // kind ใช้ค่า default `card` เสมอ — ไม่รับจาก client
          // ถ้าวันหนึ่งมีชนิดอื่น ต้องเป็นการตัดสินใจในโค้ด ไม่ใช่ field ใน request
        },
      });
      return toPaymentMethodResponse(created);
    } catch (e) {
      // UNIQUE (user_id, last4, exp_month, exp_year) — ผูกบัตรใบเดิมซ้ำ
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw AppError.conflict(
          'CARD_ALREADY_ADDED',
          'บัตรใบนี้ถูกผูกไว้กับบัญชีนี้แล้ว',
        );
      }
      throw e;
    }
  }

  /** ไม่มี update: แก้บัตรไม่ได้ ลบแล้วเพิ่มใหม่ — ประวัติการจ่ายจะได้ไม่เพี้ยนย้อนหลัง */
  async remove(userId: string, id: string): Promise<void> {
    try {
      // ownership อยู่ใน where แล้ว — count === 0 บอกได้ทั้ง "ไม่มี" และ
      // "ไม่ใช่ของเรา" ไม่ต้อง query เช็คเจ้าของแยกอีกรอบ
      const res = await this.prisma.paymentMethod.deleteMany({
        where: { id, userId },
      });
      if (res.count === 0) throw notFound();
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2003'
      ) {
        throw AppError.conflict(
          'PAYMENT_METHOD_IN_USE',
          'บัตรนี้ถูกใช้อยู่ในการสมัครรับสินค้า — เปลี่ยนบัตรในรายการนั้นก่อน',
        );
      }
      throw e;
    }
  }

  /**
   * บัตรหมดอายุ "สิ้นเดือน" ของเดือนที่พิมพ์บนบัตร — 08/2026 ใช้ได้ถึง 31 ส.ค. 2026
   *
   * เทียบด้วยปฏิทินไทยตัวเดียวกับทั้งระบบ (กฎข้อ 5) ไม่ใช่ `new Date()` ดิบ ๆ
   * ที่จะกลายเป็นเมื่อวานช่วง 00:00–07:00 ตามเวลาไทย
   */
  private assertUsableExpiry(expMonth: number, expYear: number): void {
    const today = todayInBangkok();
    const thisMonth = today.getUTCFullYear() * 12 + today.getUTCMonth();
    const cardMonth = expYear * 12 + (expMonth - 1);

    if (cardMonth < thisMonth) {
      throw AppError.badRequest(
        'CARD_EXPIRED',
        'บัตรนี้หมดอายุแล้ว — ตรวจเดือน/ปีบนบัตรอีกครั้ง',
      );
    }
    if (cardMonth > thisMonth + MAX_YEARS_AHEAD * 12) {
      throw AppError.badRequest(
        'CARD_EXPIRY_TOO_FAR',
        'วันหมดอายุไกลเกินจริง — ตรวจเดือน/ปีบนบัตรอีกครั้ง',
      );
    }
  }
}

function notFound() {
  return AppError.notFound('PAYMENT_METHOD_NOT_FOUND', 'ไม่พบบัตรใบนี้');
}
