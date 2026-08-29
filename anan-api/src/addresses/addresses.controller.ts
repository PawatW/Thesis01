import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import { AddressesService } from './addresses.service';
import {
  CreateAddressDto,
  UpdateAddressDto,
  type AddressResponse,
} from './dto/address.dto';

@Controller('me/addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<AddressResponse[]> {
    return this.addresses.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAddressDto,
  ): Promise<AddressResponse> {
    return this.addresses.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    // ParseUUIDPipe: id ที่ไม่ใช่ uuid จบที่ 400 ไม่ต้องไปถึง Prisma
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<AddressResponse> {
    return this.addresses.update(user.id, id, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.addresses.remove(user.id, id);
  }
}
