import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Put,
  Query,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { ExchangeRatesService } from './exchange-rates.service';
import {
  PropertyExchangeRatesService,
  displayCurrency,
  displayRate,
} from './property-exchange-rates.service';

/** A hotel rate this far from the daily feed is almost always a typo or a reversed direction. */
export const OUTLIER_DEVIATION = 0.5;

/** How far `rate` is from `reference`, as a fraction (0.1 = 10% away). */
export function rateDeviation(rate: string, reference: number): number {
  return Math.abs(Number(rate) / reference - 1);
}

type Request = { tenantContext: { tenantId: string; propertyId: string; userId: string } };
@Controller('tenants/:tenantId/properties/:propertyId/exchange-rates')
@Roles(Role.TenantOwner, Role.TenantAdmin)
@RequiresCapability('settings.manage')
export class PropertyExchangeRatesController {
  constructor(
    @Inject(PropertyExchangeRatesService) private readonly rates: PropertyExchangeRatesService,
    @Inject(ExchangeRatesService) private readonly feed: ExchangeRatesService,
  ) {}
  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  async list(@Req() request: Request) {
    const { tenantId, propertyId } = request.tenantContext;
    const snapshot = await this.rates.snapshot(tenantId, propertyId);
    const codes = [...(snapshot.displayCurrencies ?? []), ...snapshot.rates.map((r) => r.currency)];
    // The feed is a reference only; a feed outage must never stop staff from reading their own rates.
    const reference = await this.feed
      .feedReference(snapshot.base, codes)
      .catch(() => ({ date: null, perUnit: {} }));
    return { ...snapshot, feed: reference };
  }
  @Get('changes')
  @TenantScoped({ propertyParam: 'propertyId' })
  changes(@Query('limit') limit: string | undefined, @Req() request: Request) {
    const { tenantId, propertyId } = request.tenantContext;
    return this.rates.history(tenantId, propertyId, limit ? Number(limit) : 50);
  }
  @Put(':currency')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresVerifiedEmail()
  async set(@Param('currency') currency: string, @Body() body: unknown, @Req() request: Request) {
    const { tenantId, propertyId, userId } = request.tenantContext;
    const { rate, confirmOutlier } =
      (body as { rate?: unknown; confirmOutlier?: unknown } | null) ?? {};
    if (confirmOutlier !== true) await this.refuseOutlier(tenantId, propertyId, currency, rate);
    return this.rates.set(tenantId, propertyId, userId, currency, rate ?? undefined);
  }

  /**
   * Rejects a rate more than 50% away from the daily feed unless the caller confirms it on purpose.
   * Invalid input falls through so the service reports its usual validation message.
   */
  private async refuseOutlier(
    tenantId: string,
    propertyId: string,
    currencyInput: string,
    rateInput: unknown,
  ) {
    let code: string;
    let rate: string;
    try {
      code = displayCurrency(currencyInput);
      rate = displayRate(rateInput);
    } catch {
      return;
    }
    const { base } = await this.rates.snapshot(tenantId, propertyId);
    const { perUnit } = await this.feed
      .feedReference(base, [code])
      .catch(() => ({ perUnit: {} as Record<string, number> }));
    const reference = perUnit[code];
    if (reference && rateDeviation(rate, reference) > OUTLIER_DEVIATION)
      throw new UnprocessableEntityException({
        code: 'RATE_FAR_FROM_MARKET',
        message: `1 ${code} = ${rate} ${base} is more than 50% away from today's market rate (about ${reference} ${base}). Check the direction, or confirm to save it anyway.`,
        reference,
      });
  }
  @Delete(':currency')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresVerifiedEmail()
  remove(@Param('currency') currency: string, @Req() request: Request) {
    const { tenantId, propertyId, userId } = request.tenantContext;
    return this.rates.set(tenantId, propertyId, userId, currency, null);
  }
  @Patch()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresVerifiedEmail()
  select(@Body() body: unknown, @Req() request: Request) {
    const { tenantId, propertyId } = request.tenantContext;
    return this.rates.select(
      tenantId,
      propertyId,
      (body as { currencies?: unknown } | null)?.currencies,
    );
  }
}
