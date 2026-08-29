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
import {
  ListOrdersQuery,
  ReportIssueDto,
  type BuyerOrderResponse,
} from './dto/order.dto';
import { OrdersService } from './orders.service';

/** ประวัติออเดอร์ของผู้ซื้อ + ยืนยันรับของ + แจ้งปัญหา (features 07 · 16) */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListOrdersQuery,
  ): Promise<BuyerOrderResponse[]> {
    return this.orders.list(user.id, query.tab);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BuyerOrderResponse> {
    return this.orders.findOne(user.id, id);
  }

  /** ★ มีแค่ผู้ซื้อเท่านั้นที่เรียกได้ ★ ไม่มี endpoint ไหนให้ร้านตั้ง `confirmedAt` */
  @Post(':id/confirm')
  @HttpCode(200)
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BuyerOrderResponse> {
    return this.orders.confirmReceipt(user.id, id);
  }

  /**
   * จ่ายเงินรอบนี้อีกครั้งหลังบัตรถูกปฏิเสธ (feature 09 เฟส 5)
   *
   * ไม่มี body เลย — ยอดและบัตรมาจากข้อมูลของออเดอร์ในฐานข้อมูล
   * (CLAUDE.md ข้อ 7 · เงินห้ามมาจาก client)
   */
  @Post(':id/retry-payment')
  @HttpCode(200)
  retryPayment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BuyerOrderResponse> {
    return this.orders.retryPayment(user.id, id);
  }

  @Post(':id/issues')
  report(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportIssueDto,
  ): Promise<BuyerOrderResponse> {
    return this.orders.reportIssue(user.id, id, dto);
  }
}
