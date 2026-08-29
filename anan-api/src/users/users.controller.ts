import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import type { UserResponse } from './dto/user-response.dto';
import { UsersService } from './users.service';

@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentUser() user: AuthUser): Promise<UserResponse> {
    return this.users.findMe(user.id);
  }

  @Patch()
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponse> {
    // id มาจาก token เท่านั้น — ไม่มี endpoint ไหนรับ userId จาก client
    return this.users.updateMe(user.id, dto);
  }
}
