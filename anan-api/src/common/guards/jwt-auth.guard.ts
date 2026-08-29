import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AppError } from '../errors/app-exception';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * ★ ตัวนี้ถูกติดตั้งเป็น global guard ใน AppModule ★
 *
 * ทุก endpoint ต้องมี token โดยปริยาย แล้วค่อยเปิดเป็นรายจุดด้วย `@Public()`
 * — กลับด้านจากการใส่ guard ทีละ controller เพราะ "ลืมใส่ guard" จะหลุดเงียบ ๆ
 * แต่ "ลืมใส่ @Public()" จะพังทันทีตอนทดสอบ (docs/security-design.md)
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (isPublic) return true;
    return super.canActivate(ctx);
  }

  /** แปลง error ของ passport เป็นรูปแบบ error เดียวกับทั้งระบบ */
  handleRequest<TUser>(err: unknown, user: TUser): TUser {
    if (err || !user) {
      throw AppError.unauthorized('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');
    }
    return user;
  }
}
