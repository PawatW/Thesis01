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
  IssueQueueQuery,
  ModerationQuery,
  SetSuspensionDto,
  type AdminIssueResponse,
  type AdminProductResponse,
  type AdminShopResponse,
  type SuspensionResultResponse,
} from './dto/moderation.dto';
import { ModerationService } from './moderation.service';

/**
 * Moderation — ระงับร้าน/สินค้า และคิวเคสปัญหา (feature 14 · W10 Flow C)
 *
 * การระงับใช้ `POST` ไม่ใช่ `PATCH` โดยตั้งใจ: มันไม่ใช่การแก้ฟิลด์เดียว
 * แต่เป็นคำสั่งที่มีผลข้างเคียงกับ subscription ของผู้ซื้อจำนวนมาก
 */
@Controller('admin')
@Roles('admin')
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('shops')
  shops(@Query() query: ModerationQuery): Promise<AdminShopResponse[]> {
    return this.moderation.listShops(query);
  }

  @Get('products')
  products(@Query() query: ModerationQuery): Promise<AdminProductResponse[]> {
    return this.moderation.listProducts(query);
  }

  @Post('shops/:id/suspension')
  @HttpCode(200)
  suspendShop(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetSuspensionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<SuspensionResultResponse> {
    return this.moderation.setShopSuspension(
      id,
      dto.suspend,
      user.id,
      dto.reason,
    );
  }

  @Post('products/:id/suspension')
  @HttpCode(200)
  suspendProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetSuspensionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<SuspensionResultResponse> {
    return this.moderation.setProductSuspension(
      id,
      dto.suspend,
      user.id,
      dto.reason,
    );
  }

  @Get('issues')
  issues(@Query() query: IssueQueueQuery): Promise<AdminIssueResponse[]> {
    return this.moderation.listIssues(query.status);
  }
}
