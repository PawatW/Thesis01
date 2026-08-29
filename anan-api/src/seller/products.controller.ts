import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateProductDto,
  PlanInputDto,
  UpdatePlanDto,
  UpdateProductDto,
  type SellerProductResponse,
} from './dto/product.dto';
import { SellerProductsService } from './products.service';

/** สินค้าและรอบส่งของร้านตัวเอง (feature 11 · W07) */
@Controller('seller')
@Roles('seller')
export class SellerProductsController {
  constructor(private readonly products: SellerProductsService) {}

  @Get('products')
  list(@CurrentUser() user: AuthUser): Promise<SellerProductResponse[]> {
    return this.products.list(user.id);
  }

  @Post('products')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProductDto,
  ): Promise<SellerProductResponse> {
    return this.products.create(user.id, dto);
  }

  @Get('products/:id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SellerProductResponse> {
    return this.products.findOne(user.id, id);
  }

  @Patch('products/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<SellerProductResponse> {
    return this.products.update(user.id, id, dto);
  }

  @Post('products/:id/plans')
  addPlan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PlanInputDto,
  ): Promise<SellerProductResponse> {
    return this.products.addPlan(user.id, id, dto);
  }

  @Patch('plans/:id')
  updatePlan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
  ): Promise<SellerProductResponse> {
    return this.products.updatePlan(user.id, id, dto);
  }
}
