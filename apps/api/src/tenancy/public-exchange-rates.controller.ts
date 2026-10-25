import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { ExchangeRatesService } from './exchange-rates.service';
import { PublicRateLimitGuard } from './public-rate-limit.guard';
import { PUBLIC_READ_RATE_LIMIT, PublicRateLimit } from './public-rate-limit.decorator';
import { PublicTenantScoped } from './tenant-context.decorator';
import { TenantDatabaseService } from './tenant-database.service';

type TenantPropertyRequest = { tenantContext: { tenantId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/public')
export class PublicExchangeRatesController {
  constructor(
    @Inject(ExchangeRatesService) private readonly rates: ExchangeRatesService,
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
  ) {}

  /**
   * Approximate conversion rates from the hotel's own currency into the requested display
   * currencies. Display only: a booking is always priced and paid in the hotel's currency.
   */
  @Get('exchange-rates')
  @PublicTenantScoped({ propertyParam: 'propertyId' })
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(PUBLIC_READ_RATE_LIMIT)
  async getExchangeRates(@Query() query: unknown, @Req() request: TenantPropertyRequest) {
    const raw = (query as { currencies?: unknown } | null)?.currencies;
    const currencies = typeof raw === 'string' ? raw.split(',').map((code) => code.trim()) : [];
    if (
      currencies.length === 0 ||
      currencies.length > 20 ||
      currencies.some((c) => !/^[A-Za-z]{3}$/.test(c))
    )
      throw new BadRequestException(
        'currencies must be a comma-separated list of 1 to 20 currency codes.',
      );
    const rows = await this.db.withTenantTransaction(
      request.tenantContext,
      (tx) =>
        tx.$queryRaw<Array<{ currency: string | null }>>`
        SELECT default_currency AS currency FROM properties
        WHERE tenant_id = ${request.tenantContext.tenantId}::uuid
          AND id = ${request.tenantContext.propertyId}::uuid
      `,
    );
    const base = rows[0]?.currency ?? 'EUR';
    const result = await this.rates.ratesFor(base, currencies);
    return result
      ? { ...result, approximate: true }
      : { base, date: null, rates: {}, approximate: true };
  }
}
