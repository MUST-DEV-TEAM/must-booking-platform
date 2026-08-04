import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Post, Req } from '@nestjs/common';

import { Public } from '../../tenancy/tenant-context.decorator';
import { ClockWebhookService } from './clock-webhook.service';

type WebhookRequest = { headers: { 'content-length'?: string } };

// Public, unauthenticated (Clock/Amazon SNS calls this directly — it can't
// carry a MUST session cookie). Security is the real AWS SNS signature
// verification plus the random webhookPublicId in the path, not a session.
@Controller('clock-webhooks')
export class ClockWebhookController {
  constructor(@Inject(ClockWebhookService) private readonly webhooks: ClockWebhookService) {}

  @Post(':webhookPublicId')
  @HttpCode(HttpStatus.OK)
  @Public()
  async receive(
    @Param('webhookPublicId') webhookPublicId: string,
    @Body() body: unknown,
    @Req() req: WebhookRequest,
  ) {
    const contentLength = req.headers['content-length']
      ? Number(req.headers['content-length'])
      : undefined;
    await this.webhooks.handle(webhookPublicId, body, contentLength);
    return { received: true };
  }
}
