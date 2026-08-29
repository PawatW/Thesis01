import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { RefreshCookieService } from '../common/http/refresh-cookie';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  // ไม่ตั้ง secret ตรงนี้: ทุกครั้งที่ sign/verify ต้องระบุ secret ให้ชัด
  // ว่าเป็นของ access หรือ refresh — กันการเผลอใช้ตัวเดียวกันทั้งสองแบบ
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, RefreshCookieService],
  exports: [AuthService],
})
export class AuthModule {}
