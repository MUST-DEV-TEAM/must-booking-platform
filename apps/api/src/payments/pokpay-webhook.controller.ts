import { BadRequestException, Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';

import { Public } from '../tenancy/tenant-context.decorator';
import { PokPayPaymentService } from './pokpay-payment.service';

@Public()
@Controller('webhooks/pokpay')
export class PokPayWebhookController {
  constructor(@Inject(PokPayPaymentService) private readonly payments: PokPayPaymentService) {}

  @Post()
  @HttpCode(200)
  async receive(@Body() body: { orderId?: unknown }): Promise<{ received: true }> {
    const orderId = typeof body?.orderId === 'string' ? body.orderId : '';
    const processed = await this.payments.processAuthoritativeOrder(orderId);
    if (!processed.ok) throw new BadRequestException(processed.error.message);
    return { received: true };
  }
}
