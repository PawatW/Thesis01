import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CouponsModule } from '../coupons/coupons.module';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [CatalogModule, CouponsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
