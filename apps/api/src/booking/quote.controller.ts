import { Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';

import { PublicTenantScoped } from '../tenancy/tenant-context.decorator';
import { PublicRateLimitGuard } from '../tenancy/public-rate-limit.guard';
import { PUBLIC_QUOTE_RATE_LIMIT, PublicRateLimit } from '../tenancy/public-rate-limit.decorator';
import { QuoteService, type DisplayPriceItem } from './quote.service';

type TenantPropertyRequest = {
  tenantContext: { tenantId: string; propertyId: string };
  guestSessionId: string;
};

@Controller('tenants/:tenantId/properties/:propertyId/quotes')
export class QuoteController {
  constructor(@Inject(QuoteService) private readonly quotes: QuoteService) {}

  @Post()
  @PublicTenantScoped({ propertyParam: 'propertyId' })
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(PUBLIC_QUOTE_RATE_LIMIT)
  create(@Body() body: unknown, @Req() request: TenantPropertyRequest) {
    return this.quotes.create(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      request.guestSessionId,
      this.input(body),
    );
  }

  @Post('display-prices')
  @PublicTenantScoped({ propertyParam: 'propertyId' })
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(PUBLIC_QUOTE_RATE_LIMIT)
  async displayPrices(@Body() body: unknown, @Req() request: TenantPropertyRequest) {
    const value = (body ?? {}) as Record<string, unknown>;
    const rawItems = Array.isArray(value.items) ? value.items : [];
    // Individual-room properties can have far more cards than room types.
    // Keep the request bounded; Clock deduplicates these by room type.
    const items: DisplayPriceItem[] = rawItems.slice(0, 250).flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const current = item as Record<string, unknown>;
      const key = typeof current.key === 'string' ? current.key : '';
      const roomTypeId = typeof current.roomTypeId === 'string' ? current.roomTypeId : '';
      if (!key || !roomTypeId) return [];
      return [
        {
          key,
          roomTypeId,
          ...(typeof current.roomId === 'string' && current.roomId
            ? { roomId: current.roomId }
            : {}),
          ...(typeof current.ratePlanId === 'string' && current.ratePlanId
            ? { ratePlanId: current.ratePlanId }
            : {}),
          ...(typeof current.currency === 'string' && current.currency
            ? { currency: current.currency }
            : {}),
        },
      ];
    });
    return {
      prices: await this.quotes.displayPrices(
        request.tenantContext.tenantId,
        request.tenantContext.propertyId,
        {
          startsOn: typeof value.startsOn === 'string' ? value.startsOn : '',
          endsOn: typeof value.endsOn === 'string' ? value.endsOn : '',
          adults: typeof value.adults === 'number' ? value.adults : undefined,
          children: typeof value.children === 'number' ? value.children : undefined,
          guestCount: typeof value.guestCount === 'number' ? value.guestCount : undefined,
          roomCount: typeof value.roomCount === 'number' ? value.roomCount : undefined,
        },
        items,
      ),
    };
  }

  private input(body: unknown) {
    const value = (body ?? {}) as Record<string, unknown>;
    return {
      roomTypeId: typeof value.roomTypeId === 'string' ? value.roomTypeId : '',
      roomId: typeof value.roomId === 'string' ? value.roomId : undefined,
      ratePlanId: typeof value.ratePlanId === 'string' ? value.ratePlanId : '',
      startsOn: typeof value.startsOn === 'string' ? value.startsOn : '',
      endsOn: typeof value.endsOn === 'string' ? value.endsOn : '',
      adults: typeof value.adults === 'number' ? value.adults : undefined,
      children: typeof value.children === 'number' ? value.children : undefined,
      guestCount: typeof value.guestCount === 'number' ? value.guestCount : undefined,
    };
  }
}
