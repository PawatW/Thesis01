import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import { toUserResponse, type UserResponse } from './dto/user-response.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findMe(userId: string): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.notFound('USER_NOT_FOUND', 'ไม่พบบัญชีผู้ใช้');
    return toUserResponse(user);
  }

  async updateMe(userId: string, dto: UpdateProfileDto): Promise<UserResponse> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      // ระบุฟิลด์ทีละตัว ไม่ spread dto เข้าไปตรง ๆ
      // ถ้า spread วันหนึ่งที่มีคนเผลอเพิ่มฟิลด์ใน DTO มันจะไหลลง DB เองทันที
      data: {
        displayName: dto.displayName,
        phone: dto.phone,
        avatarUrl: dto.avatarUrl,
      },
    });
    return toUserResponse(user);
  }
}
