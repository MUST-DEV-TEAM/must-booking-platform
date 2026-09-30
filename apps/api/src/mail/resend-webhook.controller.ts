import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';

import { Public } from '../tenancy/tenant-context.decorator';
import { verifyResendWebhookSignature } from './resend-webhook-signature';
import { ResendWebhookService, type ResendWebhookEvent } from './resend-webhook.service';

// An unmatched event this young is probably racing our own "sent" bookkeeping (Resend can report
// "delivered" within milliseconds), so ask Resend to retry. Older unmatched events belong to mail
// this system does not track and are acknowledged so they are not retried for a day.
const RECENT_EVENT_WINDOW_MS = 2 * 60 * 1000;

@Public()
@Controller('webhooks/resend')
export class ResendWebhookController {
  constructor(@Inject(ResendWebhookService) private readonly webhooks: ResendWebhookService) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Headers('svix-id') id: string | undefined,
    @Headers('svix-timestamp') timestamp: string | undefined,
    @Headers('svix-signature') signature: string | undefined,
    @Req() request: RawBodyRequest<object>,
  ): Promise<{ received: true }> {
    const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
    if (!secret) {
      // Never accept unsigned events just because the secret is not configured yet.
      throw new ServiceUnavailableException('Resend webhook signing secret is not configured.');
    }
    if (!request.rawBody) throw new BadRequestException('Webhook raw body is unavailable.');
    if (!verifyResendWebhookSignature(request.rawBody, { id, timestamp, signature }, secret))
      throw new UnauthorizedException('Invalid webhook signature.');

    let event: ResendWebhookEvent;
    try {
      event = JSON.parse(request.rawBody.toString('utf8')) as ResendWebhookEvent;
    } catch {
      throw new BadRequestException('Webhook body is not valid JSON.');
    }

    const outcome = await this.webhooks.apply(event);
    if (outcome === 'unmatched') {
      const createdAt = event.created_at ? Date.parse(event.created_at) : NaN;
      const recent = Number.isNaN(createdAt) || Date.now() - createdAt < RECENT_EVENT_WINDOW_MS;
      if (recent) throw new ServiceUnavailableException('Email not recorded yet; retry.');
    }
    return { received: true };
  }
}
