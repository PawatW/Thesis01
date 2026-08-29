import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';
import {
  CreatePaymentMethodDto,
  type PaymentMethodResponse,
} from './dto/payment-method.dto';
import { PaymentMethodsService } from './payment-methods.service';

@Controller('me/payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethods: PaymentMethodsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<PaymentMethodResponse[]> {
    return this.paymentMethods.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePaymentMethodDto,
  ): Promise<PaymentMethodResponse> {
    return this.paymentMethods.create(user.id, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.paymentMethods.remove(user.id, id);
  }
}
