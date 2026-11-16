import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { PaymentProvider } from '@must/domain-contracts';

import { IntegrationConnectionsService } from '../integrations/integration-connections.service';
import { PAYMENT_PROVIDER } from './payment.provider';
import { StripeWebhookService } from './stripe-webhook.service';
import { Public } from '../tenancy/tenant-context.decorator';
import { PublicRateLimitGuard } from '../tenancy/public-rate-limit.guard';
import { STRIPE_WEBHOOK_RATE_LIMIT, PublicRateLimit } from '../tenancy/public-rate-limit.decorator';

// Each hotel's Stripe connection has its own endpoint, `/webhooks/stripe/<random id>`, and its own
// signing secret. The id only finds the connection; the Stripe signature is what proves the call.
@Public()
@Controller('webhooks/stripe')
export class StripeWebhookController {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
    @Inject(StripeWebhookService) private readonly webhooks: StripeWebhookService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
  ) {}

  @Post(':webhookPublicId')
  @HttpCode(200)
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(STRIPE_WEBHOOK_RATE_LIMIT)
  async receive(
    @Param('webhookPublicId') webhookPublicId: string,
    @Headers('stripe-signature') signature: string | undefined,
    @Req() request: RawBodyRequest<object>,
  ): Promise<{ received: true }> {
    if (!request.rawBody) {
      throw new BadRequestException('Stripe webhook raw body is unavailable.');
    }
    const connection = await this.connections.stripeWebhookConnection(webhookPublicId);
    if (!connection) throw new NotFoundException();

    const verified = await this.payments.verifyWebhookEvent(
      {
        tenantId: connection.tenantId,
        propertyId: '00000000-0000-4000-8000-000000000000',
        stripeWebhook: { secretKey: connection.secretKey, webhookSecret: connection.webhookSecret },
      } as Parameters<PaymentProvider['verifyWebhookEvent']>[0],
      request.rawBody,
      signature ?? '',
    );
    if (!verified.ok) throw new BadRequestException(verified.error.message);

    const event = verified.value;
    if (event.tenantId && event.tenantId !== connection.tenantId)
      throw new BadRequestException('This event does not belong to this Stripe connection.');
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
