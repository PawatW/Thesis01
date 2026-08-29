import { Module } from '@nestjs/common';
import { SellerModule } from '../seller/seller.module';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [SellerModule],
  controllers: [UploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
