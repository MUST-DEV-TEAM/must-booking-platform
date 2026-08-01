import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { PaymentProvider } from '@must/domain-contracts';

import { PAYMENT_PROVIDER } from './payment.provider';
import { StripeWebhookService } from './stripe-webhook.service';
import { Public } from '../tenancy/tenant-context.decorator';

// Stripe endpoint secrets are account-scoped; the real tenant scope is returned only after the
// signed event has been verified, before any database work begins.
const WEBHOOK_VERIFICATION_CONTEXT = {
  tenantId: '00000000-0000-4000-8000-000000000000',
  propertyId: '00000000-0000-4000-8000-000000000000',
};

@Public()
@Controller('webhooks/stripe')
export class StripeWebhookController {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
    @Inject(StripeWebhookService) private readonly webhooks: StripeWebhookService,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Headers('stripe-signature') signature: string | undefined,
    @Req() request: RawBodyRequest<object>,
  ): Promise<{ received: true }> {
    if (!request.rawBody) {
      throw new BadRequestException('Stripe webhook raw body is unavailable.');
    }
    const verified = await this.payments.verifyWebhookEvent(
      WEBHOOK_VERIFICATION_CONTEXT,
      request.rawBody,
      signature ?? '',
    );
    if (!verified.ok) throw new BadRequestException(verified.error.message);

    const event = verified.value;
    if (
      (event.type === 'checkout.session.completed' ||
        event.type === 'checkout.session.async_payment_succeeded') &&
      event.paymentStatus === 'paid'
    ) {
      const processed = await this.webhooks.processPaymentSucceeded(event);
      if (!processed.ok) throw new InternalServerErrorException(processed.error.message);
    }
    return { received: true };
  }
}
