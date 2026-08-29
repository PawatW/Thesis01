import { Module } from '@nestjs/common';
import { CouponsModule } from '../coupons/coupons.module';
import { EngineController } from './engine.controller';
import { EngineService } from './engine.service';

@Module({
  imports: [CouponsModule],
  controllers: [EngineController],
  providers: [EngineService],
  exports: [EngineService],
})
export class EngineModule {}
