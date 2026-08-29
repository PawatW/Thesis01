import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminService } from './admin.service';
import {
  UpdateCategoryDto,
  UpsertCategoryDto,
  type AdminStatsResponse,
  type CategoryAdminResponse,
} from './dto/admin.dto';

/**
 * ภาพรวมแพลตฟอร์ม + จัดการหมวดสินค้า (feature 14 · W10 Flow A/B)
 *
 * `@Roles('admin')` อยู่ที่ระดับ class — endpoint ใหม่ในไฟล์นี้จึงถูกปิดโดย
 * ปริยาย ไม่ต้องพึ่งว่าคนเขียนจะจำใส่ทีละเมธอด (บทเรียนเดียวกับ global guard)
 */
@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats(): Promise<AdminStatsResponse> {
    return this.admin.stats();
  }

  @Get('categories')
  categories(): Promise<CategoryAdminResponse[]> {
    return this.admin.listCategories();
  }

  @Post('categories')
  createCategory(
    @Body() dto: UpsertCategoryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CategoryAdminResponse> {
    return this.admin.createCategory(dto, user.id);
  }

  @Patch('categories/:id')
  updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CategoryAdminResponse> {
    return this.admin.updateCategory(id, dto, user.id);
  }

  @Delete('categories/:id')
  @HttpCode(204)
  removeCategory(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.admin.removeCategory(id, user.id);
  }
}
