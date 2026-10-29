import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantDatabaseService } from './tenant-database.service';

export type HotelRate = {
  currency: string;
  rate: string;
  updatedAt: Date;
  updatedBy: string;
  updatedByName: string;
};
export type RateChange = {
  id: string;
  currency: string;
  oldRate: string | null;
  newRate: string | null;
  changedAt: Date;
  changedBy: string;
  changedByName: string;
};
export type HotelRates = {
  base: string;
  version: string;
  displayCurrencies: string[] | null;
  rates: HotelRate[];
};

export function displayCurrency(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value))
    throw new BadRequestException('Enter a three-letter currency code.');
  const code = value.toUpperCase();
  if (
    !(Intl as unknown as { supportedValuesOf(key: string): string[] })
      .supportedValuesOf('currency')
      .includes(code)
  )
    throw new BadRequestException('Choose a supported currency code.');
  return code;
}
export function displayRate(value: unknown): string {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  if (!/^\d{1,10}(?:\.\d{1,8})?$/.test(text))
    throw new BadRequestException('Enter a positive rate with at most eight decimal places.');
  const rate = new Prisma.Decimal(text);
  if (!rate.isPositive() || rate.isZero() || rate.greaterThan('1000000000'))
    throw new BadRequestException('Rate must be greater than zero and at most 1,000,000,000.');
  return rate.toFixed(8);
}

@Injectable()
export class PropertyExchangeRatesService {
  constructor(@Inject(TenantDatabaseService) private readonly db: TenantDatabaseService) {}

  /**
   * One statement, no row lock: a public read must never queue behind a staff write, and the version
   * and the rates it describes come from the same snapshot.
   */
  async snapshot(tenantId: string, propertyId: string): Promise<HotelRates> {
    return this.db.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          base: string;
          version: string;
          displayCurrencies: string[] | null;
          rates: Array<Omit<HotelRate, 'updatedAt'> & { updatedAt: string }>;
        }>
      >`
        SELECT COALESCE(p.default_currency,'EUR') AS base, p.rates_version::text AS version,
          CASE WHEN p.display_currencies_configured THEN p.display_currencies ELSE NULL END AS "displayCurrencies",
          COALESCE((
            SELECT json_agg(json_build_object(
              'currency', r.quote_currency, 'rate', r.rate::text, 'updatedAt', r.updated_at,
              'updatedBy', r.updated_by,
              'updatedByName', COALESCE(NULLIF(CONCAT_WS(' ',u.first_name,u.last_name),''),u.email,r.updated_by::text)
            ) ORDER BY r.quote_currency)
            FROM property_exchange_rates r LEFT JOIN users u ON u.id=r.updated_by
            WHERE r.tenant_id=p.tenant_id AND r.property_id=p.id
          ), '[]'::json) AS rates
        FROM properties p WHERE p.tenant_id=${tenantId}::uuid AND p.id=${propertyId}::uuid
      `;
      if (!rows[0]) throw new NotFoundException('Hotel not found.');
      return {
        ...rows[0],
        rates: rows[0].rates.map((rate) => ({ ...rate, updatedAt: new Date(rate.updatedAt) })),
      };
    });
  }

  /** The most recent rate changes, newest first, for the staff history view. */
  async history(tenantId: string, propertyId: string, limit = 50): Promise<RateChange[]> {
    const take = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
    return this.db.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<RateChange[]>`
        SELECT c.id, c.quote_currency AS currency, c.old_rate::text AS "oldRate", c.new_rate::text AS "newRate",
          c.updated_at AS "changedAt", c.updated_by AS "changedBy",
          COALESCE(NULLIF(CONCAT_WS(' ',u.first_name,u.last_name),''),u.email,c.updated_by::text) AS "changedByName"
        FROM property_exchange_rate_changes c LEFT JOIN users u ON u.id=c.updated_by
        WHERE c.tenant_id=${tenantId}::uuid AND c.property_id=${propertyId}::uuid
        ORDER BY c.updated_at DESC, c.id DESC LIMIT ${take}
      `,
    );
  }

  async set(
    tenantId: string,
    propertyId: string,
    userId: string,
    currencyInput: unknown,
    rateInput: unknown | null,
  ) {
    const currency = displayCurrency(currencyInput);
    const rate = rateInput === null ? null : displayRate(rateInput);
    await this.db.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const properties = await tx.$queryRaw<Array<{ currency: string | null }>>`
        SELECT default_currency AS currency FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid FOR UPDATE
      `;
      if (!properties[0]) throw new NotFoundException('Hotel not found.');
      if (rate !== null && !properties[0].currency)
        throw new BadRequestException(
          'Choose the hotel default currency before setting exchange rates.',
        );
      if (currency === (properties[0].currency ?? 'EUR'))
        throw new BadRequestException(
          'The hotel default currency always has rate 1. Choose another currency.',
        );
      const previous = await tx.$queryRaw<Array<{ rate: string }>>`
        SELECT rate::text FROM property_exchange_rates WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND quote_currency=${currency}
      `;
      const oldRate = previous[0]?.rate ?? null;
      if (oldRate === rate || (oldRate && rate && new Prisma.Decimal(oldRate).equals(rate))) return;
      if (rate === null)
        await tx.$executeRaw`DELETE FROM property_exchange_rates WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND quote_currency=${currency}`;
      else
        await tx.$executeRaw`
        INSERT INTO property_exchange_rates(tenant_id,property_id,quote_currency,rate,updated_by)
        VALUES(${tenantId}::uuid,${propertyId}::uuid,${currency},${rate}::numeric,${userId}::uuid)
        ON CONFLICT(tenant_id,property_id,quote_currency) DO UPDATE SET rate=EXCLUDED.rate,updated_at=NOW(),updated_by=EXCLUDED.updated_by
      `;
      await tx.$executeRaw`
        INSERT INTO property_exchange_rate_changes(tenant_id,property_id,quote_currency,old_rate,new_rate,updated_by)
        VALUES(${tenantId}::uuid,${propertyId}::uuid,${currency},${oldRate}::numeric,${rate}::numeric,${userId}::uuid)
      `;
      await tx.$executeRaw`UPDATE properties SET rates_version=rates_version+1 WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
    });
    return this.snapshot(tenantId, propertyId);
  }

  async select(tenantId: string, propertyId: string, input: unknown) {
    if (!Array.isArray(input) || input.length > 30)
      throw new BadRequestException('Choose up to 30 display currencies.');
    const currencies = [...new Set(input.map(displayCurrency))].sort();
    await this.db.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const properties = await tx.$queryRaw<
        Array<{ currency: string }>
      >`SELECT COALESCE(default_currency,'EUR') AS currency FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid FOR UPDATE`;
      if (!properties[0]) throw new NotFoundException('Hotel not found.');
      const extras = currencies.filter((code) => code !== properties[0].currency);
      await tx.$executeRaw`UPDATE properties SET display_currencies=${extras}::text[],display_currencies_configured=TRUE,rates_version=rates_version+1 WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid AND (NOT display_currencies_configured OR display_currencies IS DISTINCT FROM ${extras}::text[])`;
    });
    return this.snapshot(tenantId, propertyId);
  }
}
