import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../errors/app-exception';
import { Role, ROLES_KEY } from '../decorators/roles.decorator';
import type { RequestWithUser } from '../decorators/current-user.decorator';

/**
 * ตรวจ role จาก **ค่าใน token ที่ verify แล้ว** เท่านั้น
 * ไม่เคยอ่าน role จาก header, body หรือ query — ของพวกนั้นผู้เรียกแต่งเองได้
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required || required.length === 0) return true;

    const user = ctx.switchToHttp().getRequest<RequestWithUser>().user;
    if (!user)
      throw AppError.unauthorized('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');

    const ok = required.some((r) =>
      r === 'admin' ? user.isAdmin : user.isSeller,
    );
    if (!ok) {
      throw AppError.forbidden(
        'FORBIDDEN_ROLE',
        'บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้',
      );
    }
    return true;
  }
}
