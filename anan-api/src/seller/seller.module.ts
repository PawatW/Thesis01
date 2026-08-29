import { Module } from '@nestjs/common';
import { SellerOrdersController } from './orders.controller';
import { SellerOrdersService } from './orders.service';
import { SellerProductsController } from './products.controller';
import { SellerProductsService } from './products.service';
import { ShopController } from './shop.controller';
import { ShopService } from './shop.service';

/**
 * ทุกอย่างของฝั่งร้านอยู่โมดูลเดียว เพราะทั้งสาม controller ใช้คำตอบเดียวกันของ
 * คำถาม "ร้านไหนคือร้านของคนนี้ และร้านนั้นถูกระงับอยู่หรือเปล่า" (`ShopService`)
 */
@Module({
  controllers: [
    ShopController,
    SellerProductsController,
    SellerOrdersController,
  ],
  providers: [ShopService, SellerProductsService, SellerOrdersService],
  exports: [ShopService],
})
export class SellerModule {}
