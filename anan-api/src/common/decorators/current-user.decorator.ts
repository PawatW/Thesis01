import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** ข้อมูลผู้ใช้ที่ JwtStrategy แนบไว้กับ request — มาจาก token ที่ verify แล้วเท่านั้น */
export interface AuthUser {
  id: string;
  email: string;
  isSeller: boolean;
  isAdmin: boolean;
}

export interface RequestWithUser extends Request {
  user?: AuthUser;
}

/**
 * ตัวตนของผู้เรียก
 *
 * ★ ค่านี้คือแหล่งเดียวที่ service ยอมรับว่าเป็น "ผู้ใช้ปัจจุบัน" ★
 * ห้ามรับ userId / buyerId / shopId จาก body, query หรือ param เด็ดขาด —
 * ทุกอย่างที่ client ส่งมาได้ ผู้โจมตีก็เปลี่ยนเป็น id ของคนอื่นได้
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (!req.user) {
      // ไปถึงตรงนี้ได้แปลว่า endpoint นั้นเป็น @Public() แต่ดัน inject @CurrentUser()
      throw new Error('ใช้ @CurrentUser() บน endpoint ที่ไม่ผ่าน JwtAuthGuard');
    }
    return req.user;
  },
);
