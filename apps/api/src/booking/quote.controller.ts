import { Body, Controller, Inject, Post, Req } from '@nestjs/common';

import { PublicTenantScoped } from '../tenancy/tenant-context.decorator';
import { QuoteService } from './quote.service';

type TenantPropertyRequest = {
  tenantContext: { tenantId: string; propertyId: string };
  guestSessionId: string;
};

@Controller('tenants/:tenantId/properties/:propertyId/quotes')
export class QuoteController {
  constructor(@Inject(QuoteService) private readonly quotes: QuoteService) {}

  @Post()
  @PublicTenantScoped({ propertyParam: 'propertyId' })
  create(@Body() body: unknown, @Req() request: TenantPropertyRequest) {
    return this.quotes.create(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      request.guestSessionId,
      this.input(body),
    );
  }

  private input(body: unknown) {
    const value = (body ?? {}) as Record<string, unknown>;
    return {
      roomTypeId: typeof value.roomTypeId === 'string' ? value.roomTypeId : '',
      roomId: typeof value.roomId === 'string' ? value.roomId : undefined,
      ratePlanId: typeof value.ratePlanId === 'string' ? value.ratePlanId : '',
      startsOn: typeof value.startsOn === 'string' ? value.startsOn : '',
      endsOn: typeof value.endsOn === 'string' ? value.endsOn : '',
    };
  }
}
