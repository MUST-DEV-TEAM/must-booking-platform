import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

import { Public } from './tenant-context.decorator';
import { WordpressPairingService } from './wordpress-pairing.service';

type RedeemRequest = IncomingMessage & { socket: { remoteAddress?: string } };

// Deliberately not under /tenants/:tenantId/properties/:propertyId — the
// whole point of the pairing code is that WordPress doesn't know those IDs
// yet when it calls this. Public by necessity, same as any other guest-
// facing route; rate-limited inside WordpressPairingService.redeem.
@Controller('wordpress-pairing')
export class WordpressPairingRedeemController {
  constructor(
    @Inject(WordpressPairingService) private readonly pairing: WordpressPairingService,
  ) {}

  @Public()
  @Post('redeem')
  @HttpCode(200)
  async redeem(@Body() body: unknown, @Req() request: RedeemRequest) {
    const code = this.code(body);
    return this.pairing.redeem(code, this.clientIp(request));
  }

  private code(body: unknown): string {
    const value = (body ?? {}) as Record<string, unknown>;
    if (typeof value.code !== 'string' || !value.code.trim())
      throw new BadRequestException('A connection code is required.');
    return value.code;
  }

  private clientIp(request: RedeemRequest): string {
    return request.socket.remoteAddress ?? 'unknown';
  }
}
