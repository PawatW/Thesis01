import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import {
  ListNotificationsQuery,
  NotificationScopeQuery,
  type NotificationListResponse,
  type NotificationResponse,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

/** การแจ้งเตือนของผู้ใช้ที่ถือ token นี้เท่านั้น (feature 08) */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListNotificationsQuery,
  ): Promise<NotificationListResponse> {
    return this.notifications.list(user.id, query.filter, query.scope);
  }

  @Post('read')
  @HttpCode(200)
  markAllRead(
    @CurrentUser() user: AuthUser,
    @Query() query: NotificationScopeQuery,
  ): Promise<{ marked: number }> {
    return this.notifications.markAllRead(user.id, query.scope);
  }

  @Post(':id/read')
  @HttpCode(200)
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<NotificationResponse> {
    return this.notifications.markRead(user.id, id);
  }
}
