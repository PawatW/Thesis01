import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AddressesModule } from './addresses/addresses.module';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { CouponsModule } from './coupons/coupons.module';
import { EngineModule } from './engine/engine.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { SellerModule } from './seller/seller.module';
import { UploadsModule } from './uploads/uploads.module';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { validateEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),

    // เพดานกลางของทั้งระบบ — endpoint ที่อ่อนไหวทับด้วย @Throttle() ที่เข้มกว่า
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),

    // cron ของ recurring engine (ตัว handler ข้ามการทำงานเองเมื่อ NODE_ENV=test)
    ScheduleModule.forRoot(),

    PrismaModule,
    AuditModule,
    MailModule,
    PaymentsModule,
    HealthModule,
    AuthModule,
    UsersModule,
    AddressesModule,
    PaymentMethodsModule,
    CatalogModule,
    CouponsModule,
    SubscriptionsModule,
    OrdersModule,
    NotificationsModule,
    EngineModule,
    SellerModule,
    UploadsModule,
    AdminModule,
  ],
  providers: [
    // ★ ลำดับสำคัญ ★ throttle → ยืนยันตัวตน → ตรวจ role
    // JwtAuthGuard เป็น global: ทุก endpoint ต้องมี token โดยปริยาย
    // แล้วเปิดเป็นรายจุดด้วย @Public() — ไม่ใช่ใส่ guard ทีละ controller
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
