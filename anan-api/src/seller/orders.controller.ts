import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AdvanceOrderDto,
  CancelOrderDto,
  ListIssuesQuery,
  ListSellerOrdersQuery,
  ResolveIssueDto,
  type ForecastResponse,
  type SellerIssueResponse,
  type SellerOrderResponse,
} from './dto/seller-order.dto';
import { SellerOrdersService } from './orders.service';

const DEFAULT_FORECAST_DAYS = 7;

/** ออเดอร์ + forecast ของร้านตัวเอง (feature 12 · W08) */
@Controller('seller')
@Roles('seller')
export class SellerOrdersController {
  constructor(private readonly orders: SellerOrdersService) {}

  @Get('orders')
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListSellerOrdersQuery,
  ): Promise<SellerOrderResponse[]> {
    return this.orders.list(user.id, query.tab);
  }

  @Get('forecast')
  forecast(
    @CurrentUser() user: AuthUser,
    @Query('days') days?: string,
  ): Promise<ForecastResponse> {
    const parsed = Number(days);
    return this.orders.forecast(
      user.id,
      Number.isInteger(parsed) ? parsed : DEFAULT_FORECAST_DAYS,
    );
  }

  @Get('orders/:id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SellerOrderResponse> {
    return this.orders.findOne(user.id, id);
  }

  @Get('issues')
  listIssues(
    @CurrentUser() user: AuthUser,
    @Query() query: ListIssuesQuery,
  ): Promise<SellerIssueResponse[]> {
    return this.orders.listIssues(user.id, query.status);
  }

  /** ปุ่มเดียวบนหน้าจอ = endpoint เดียว: server เป็นคนบอกว่าขั้นถัดไปคืออะไร */
  @Post('orders/:id/advance')
  @HttpCode(200)
  advance(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdvanceOrderDto,
  ): Promise<SellerOrderResponse> {
    return this.orders.advance(user.id, id, dto.trackingNote);
  }

  /**
   * ยกเลิกออเดอร์ + คืนเงินจำลอง (feature 15)
   *
   * แยกจาก `advance` เพราะเป็นคนละเรื่องกัน: `advance` คือเดินหน้าตามแผน
   * ส่วนอันนี้คือทางออกเมื่อส่งไม่ได้ และมีผลกับเงินของผู้ซื้อโดยตรง
   */
  @Post('orders/:id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
  ): Promise<SellerOrderResponse> {
    return this.orders.cancel(user.id, id, dto.reason);
  }

  @Post('issues/:id/resolve')
  @HttpCode(200)
  resolveIssue(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveIssueDto,
  ): Promise<SellerIssueResponse> {
    return this.orders.resolveIssue(user.id, id, dto);
  }
}
