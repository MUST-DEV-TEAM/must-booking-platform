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

  async snapshot(tenantId: string, propertyId: string): Promise<HotelRates> {
    return this.db.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const properties = await tx.$queryRaw<
        Array<{ base: string; version: string; displayCurrencies: string[] | null }>
      >`
        SELECT COALESCE(default_currency,'EUR') AS base, rates_version::text AS version,
          CASE WHEN display_currencies_configured THEN display_currencies ELSE NULL END AS "displayCurrencies"
        FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid
        FOR SHARE
      `;
      if (!properties[0]) throw new NotFoundException('Hotel not found.');
      const rates = await tx.$queryRaw<HotelRate[]>`
        SELECT r.quote_currency AS currency,r.rate::text AS rate,r.updated_at AS "updatedAt",r.updated_by AS "updatedBy",
          COALESCE(NULLIF(CONCAT_WS(' ',u.first_name,u.last_name),''),u.email,r.updated_by::text) AS "updatedByName"
        FROM property_exchange_rates r LEFT JOIN users u ON u.id=r.updated_by
        WHERE r.tenant_id=${tenantId}::uuid AND r.property_id=${propertyId}::uuid ORDER BY r.quote_currency
      `;
      return { ...properties[0], rates };
    });
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
