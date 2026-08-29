import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { AppError } from '../common/errors/app-exception';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

interface AccessPayload {
  sub: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  /**
   * อ่านสิทธิ์จากฐานข้อมูลใหม่ทุก request ไม่ใช่จาก claim ใน token
   *
   * แลกด้วย query 1 ครั้งต่อ request เพื่อให้การถอดสิทธิ์ (หรือลบบัญชี)
   * มีผลทันที ถ้าเชื่อ claim ในโทเค็น คนที่เพิ่งโดนถอดสิทธิ์ admin จะยัง
   * เป็น admin ต่อได้จนกว่า access token จะหมดอายุ
   */
  async validate(payload: AccessPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, isSeller: true, isAdmin: true },
    });

    if (!user) {
      throw AppError.unauthorized('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');
    }
    return user;
  }
}
