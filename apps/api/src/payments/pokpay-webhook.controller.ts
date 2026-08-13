import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';

import { Public } from '../tenancy/tenant-context.decorator';
import { PublicRateLimitGuard } from '../tenancy/public-rate-limit.guard';
import { PUBLIC_WEBHOOK_RATE_LIMIT, PublicRateLimit } from '../tenancy/public-rate-limit.decorator';
import { PokPayPaymentService } from './pokpay-payment.service';

@Public()
@Controller('webhooks/pokpay')
export class PokPayWebhookController {
  constructor(@Inject(PokPayPaymentService) private readonly payments: PokPayPaymentService) {}

  @Post()
  @HttpCode(200)
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(PUBLIC_WEBHOOK_RATE_LIMIT)
  async receive(@Body() body: { orderId?: unknown }): Promise<{ received: true }> {
    const orderId = typeof body?.orderId === 'string' ? body.orderId : '';
    const processed = await this.payments.processAuthoritativeOrder(orderId);
    if (!processed.ok) throw new BadRequestException(processed.error.message);
    return { received: true };
  }
}
