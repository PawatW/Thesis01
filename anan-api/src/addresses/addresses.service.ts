import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  toAddressResponse,
  type AddressResponse,
  type CreateAddressDto,
  type UpdateAddressDto,
} from './dto/address.dto';

/** เพดานต่อบัญชี — ที่อยู่จริงของคนหนึ่งคนไม่ควรเกินนี้ กันการยิงสร้างจนตารางบวม */
const MAX_ADDRESSES_PER_USER = 20;

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<AddressResponse[]> {
    const rows = await this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      take: MAX_ADDRESSES_PER_USER,
    });
    return rows.map(toAddressResponse);
  }

  async create(
    userId: string,
    dto: CreateAddressDto,
  ): Promise<AddressResponse> {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const count = await tx.address.count({ where: { userId } });
        if (count >= MAX_ADDRESSES_PER_USER) {
          throw AppError.conflict(
            'TOO_MANY_ADDRESSES',
            `เพิ่มที่อยู่ได้สูงสุด ${MAX_ADDRESSES_PER_USER} รายการ`,
          );
        }

        // ที่อยู่แรกเป็นตัวหลักเสมอ แม้ client จะส่ง isDefault:false มา —
        // ไม่งั้นผู้ใช้จะมีที่อยู่แต่ checkout หาตัวหลักไม่เจอ
        const isDefault = count === 0 ? true : (dto.isDefault ?? false);
        if (isDefault) await this.clearDefault(tx, userId);

        return tx.address.create({
          data: {
            userId,
            label: dto.label,
            recipientName: dto.recipientName,
            phone: dto.phone,
            addressLine: dto.addressLine,
            province: dto.province,
            postcode: dto.postcode,
            isDefault,
          },
        });
      });

      return toAddressResponse(created);
    } catch (e) {
      throw translateDefaultClash(e);
    }
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateAddressDto,
  ): Promise<AddressResponse> {
    // ปลดที่อยู่หลักอันสุดท้ายไม่ได้ ไม่งั้นบัญชีจะเหลือ 0 ตัวหลักแล้ว
    // checkout จะหาไม่เจอทั้งที่ผู้ใช้มีที่อยู่อยู่
    if (dto.isDefault === false) {
      const current = await this.prisma.address.findFirst({
        where: { id, userId },
        select: { isDefault: true },
      });
      if (!current) throw notFound();
      if (current.isDefault) {
        throw AppError.conflict(
          'DEFAULT_REQUIRED',
          'ต้องมีที่อยู่หลักเสมอ — ตั้งที่อยู่อื่นเป็นหลักแทนก่อน',
        );
      }
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (dto.isDefault === true) await this.clearDefault(tx, userId);

        // ★ ความเป็นเจ้าของอยู่ใน where ไม่ใช่ใน if ทีหลัง ★
        // updateMany ยอมให้ใส่เงื่อนไขที่ไม่ใช่ unique key ได้ — ต่างจาก update()
        // และ count === 0 คือคำตอบเดียวที่บอกได้ว่า "ไม่มี หรือไม่ใช่ของเรา"
        // (ไม่ต้อง query เช็คเจ้าของแยกอีกรอบ)
        const res = await tx.address.updateMany({
          where: { id, userId },
          data: {
            label: dto.label,
            recipientName: dto.recipientName,
            phone: dto.phone,
            addressLine: dto.addressLine,
            province: dto.province,
            postcode: dto.postcode,
            isDefault: dto.isDefault,
          },
        });
        if (res.count === 0) throw notFound();

        return tx.address.findFirstOrThrow({ where: { id, userId } });
      });

      return toAddressResponse(updated);
    } catch (e) {
      throw translateDefaultClash(e);
    }
  }

  async remove(userId: string, id: string): Promise<void> {
    try {
      const res = await this.prisma.address.deleteMany({
        where: { id, userId },
      });
      if (res.count === 0) throw notFound();
    } catch (e) {
      // FK restrict จาก subscriptions — ประวัติต้องไม่หายตามที่อยู่ที่ถูกลบ
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2003'
      ) {
        throw AppError.conflict(
          'ADDRESS_IN_USE',
          'ที่อยู่นี้ถูกใช้อยู่ในการสมัครรับสินค้า — เปลี่ยนที่อยู่ในรายการนั้นก่อน',
        );
      }
      throw e;
    }
  }

  // ---------- ภายใน ----------

  private async clearDefault(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await tx.address.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
  }
}

/** ตอบ 404 เมื่อไม่ใช่ของผู้เรียก — ไม่ใช่ 403 เพราะ 403 ยืนยันว่า id นี้มีจริง */
function notFound() {
  return AppError.notFound('ADDRESS_NOT_FOUND', 'ไม่พบที่อยู่นี้');
}

/**
 * unique index `addresses_one_default_per_user` เป็นด่านสุดท้ายเมื่อมี 2 request
 * ตั้งที่อยู่หลักพร้อมกัน — แปลงเป็นข้อความที่ผู้ใช้เข้าใจ แทน "ข้อมูลนี้มีอยู่แล้ว"
 * ที่เป็นข้อความกลางของ P2002
 */
function translateDefaultClash(e: unknown): unknown {
  if (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === 'P2002' &&
    JSON.stringify(e.meta ?? {}).includes('user_id')
  ) {
    return AppError.conflict(
      'DEFAULT_ADDRESS_CONFLICT',
      'มีการเปลี่ยนที่อยู่หลักพร้อมกัน กรุณาลองใหม่อีกครั้ง',
    );
  }
  return e;
}
