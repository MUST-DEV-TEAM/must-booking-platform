import { Inject, Injectable } from '@nestjs/common';

import { ClockAvailabilityService } from '../integrations/clock/clock-availability.service';
import { TenantDatabaseService } from './tenant-database.service';

export type PropertyCurrency = {
  /** The money currency of the hotel: bookings, payments and refunds use it. */
  currency: string;
  /** Where it comes from: the owner's setting, the hotel's published Clock rates, or the platform default. */
  source: 'setting' | 'clock' | 'default';
  setting: string | null;
  clock: string | null;
  /** The owner's setting and Clock disagree, so prices from Clock would not match the setting. */
  mismatch: boolean;
};

export const FALLBACK_CURRENCY = 'EUR';

@Injectable()
export class PropertyCurrencyService {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(ClockAvailabilityService) private readonly clock: ClockAvailabilityService,
  ) {}

  /** The owner's setting wins; otherwise a Clock hotel uses the currency of its Clock rates. */
  async resolve(tenantId: string, propertyId: string): Promise<PropertyCurrency> {
    const rows = await this.db.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<Array<{ currency: string | null }>>`
          SELECT default_currency AS currency FROM properties
          WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid
        `,
    );
    const setting = rows[0]?.currency?.toUpperCase() || null;
    const clock = await this.clock.publishedRateCurrency(tenantId, propertyId).catch(() => null);
    const currency = setting ?? clock ?? FALLBACK_CURRENCY;
    return {
      currency,
      source: setting ? 'setting' : clock ? 'clock' : 'default',
      setting,
      clock,
      mismatch: Boolean(setting && clock && setting !== clock),
    };
  }
}
