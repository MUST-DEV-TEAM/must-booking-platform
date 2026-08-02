import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Money } from '@must/domain-contracts';

import { TenantDatabaseService } from '../tenancy/tenant-database.service';

export type QuoteInput = {
  roomTypeId: string;
  ratePlanId: string;
  startsOn: string;
  endsOn: string;
};

type QuotePayload = QuoteInput & {
  version: 1;
  tenantId: string;
  propertyId: string;
  total: { amount: string; currency: string };
  expiresAt: string;
  sessionBinding: string;
};

type QuoteValidationError = { code: string; message: string };

@Injectable()
export class QuoteService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  async create(
    tenantId: string,
    propertyId: string,
    sessionId: string,
    input: QuoteInput,
    ttlSeconds = 15 * 60,
  ): Promise<QuotePayload & { quoteToken: string }> {
    if (!sessionId) throw new BadRequestException('A valid session is required to create a quote.');
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1)
      throw new BadRequestException('Quote expiry must be a positive number of seconds.');

    const quote = await this.price(tenantId, propertyId, input);

    const payload: QuotePayload = {
      version: 1,
      tenantId,
      propertyId,
      ...input,
      total: quote,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      sessionBinding: this.sessionBinding(sessionId),
    };
    return { ...payload, quoteToken: this.sign(payload) };
  }

  async price(tenantId: string, propertyId: string, input: QuoteInput): Promise<Money> {
    this.validInput(input);
    await this.enforceBookingRules(tenantId, propertyId, input);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ currency: string; amount: string; pricedNights: bigint }>
      >`
        SELECT rp.currency, COALESCE(SUM(resolved.amount), 0)::text AS amount,
          COUNT(resolved.amount)::bigint AS "pricedNights"
        FROM rate_plans rp
        CROSS JOIN generate_series(
          ${input.startsOn}::date,
          (${input.endsOn}::date - INTERVAL '1 day'),
          INTERVAL '1 day'
        ) AS stay(stays_on)
        LEFT JOIN LATERAL (
          SELECT rr.amount
          FROM rate_rules rr
          WHERE rr.tenant_id = ${tenantId}::uuid
            AND rr.property_id = ${propertyId}::uuid
            AND rr.rate_plan_id = rp.id
            AND rr.room_type_id = ${input.roomTypeId}::uuid
            AND EXTRACT(DOW FROM stay.stays_on)::smallint = ANY(rr.weekdays)
            AND (
              (rr.starts_on IS NOT NULL AND rr.starts_on <= stay.stays_on::date AND rr.ends_on >= stay.stays_on::date)
              OR rr.starts_on IS NULL
            )
          ORDER BY (rr.starts_on IS NULL), rr.created_at DESC
          LIMIT 1
        ) resolved ON TRUE
        WHERE rp.id = ${input.ratePlanId}::uuid
          AND rp.tenant_id = ${tenantId}::uuid
          AND rp.property_id = ${propertyId}::uuid
          AND rp.is_active = true
        GROUP BY rp.currency
      `;
      const row = rows[0];
      if (!row) throw new NotFoundException('Active rate plan was not found.');
      const nightCount = this.nightCount(input.startsOn, input.endsOn);
      if (Number(row.pricedNights) !== nightCount)
        throw new BadRequestException('The requested stay does not have a rate for every night.');
      return { amount: row.amount, currency: row.currency };
    });
  }

  async enforceBookingRules(
    tenantId: string,
    propertyId: string,
    input: QuoteInput,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const properties = await tx.$queryRaw<
        Array<{
          minStayNights: number | null;
          maxStayNights: number | null;
          advanceBookingDays: number | null;
        }>
      >`
        SELECT min_stay_nights AS "minStayNights", max_stay_nights AS "maxStayNights",
          advance_booking_days AS "advanceBookingDays"
        FROM properties WHERE id = ${propertyId}::uuid
      `;
      if (!properties[0]) throw new NotFoundException('Property was not found.');
      this.validateBookingRules(input, properties[0]);
    });
  }

  validate(
    token: string | undefined,
    sessionId: string | undefined,
    expected: Omit<QuotePayload, 'version' | 'expiresAt' | 'sessionBinding'>,
  ): QuoteValidationError | null {
    if (!token)
      return { code: 'QUOTE_REQUIRED', message: 'A valid quote is required to create a booking.' };
    const payload = this.read(token);
    if (!payload) return { code: 'QUOTE_INVALID', message: 'The quote signature is invalid.' };
    if (new Date(payload.expiresAt).valueOf() <= Date.now())
      return { code: 'QUOTE_EXPIRED', message: 'The quote has expired; request a new quote.' };
    if (!sessionId || !this.equals(payload.sessionBinding, this.sessionBinding(sessionId)))
      return {
        code: 'QUOTE_SESSION_INVALID',
        message: 'The quote belongs to a different session.',
      };
    if (
      payload.tenantId !== expected.tenantId ||
      payload.propertyId !== expected.propertyId ||
      payload.roomTypeId !== expected.roomTypeId ||
      payload.ratePlanId !== expected.ratePlanId ||
      payload.startsOn !== expected.startsOn ||
      payload.endsOn !== expected.endsOn ||
      payload.total.amount !== expected.total.amount ||
      payload.total.currency !== expected.total.currency
    ) {
      return {
        code: 'QUOTE_MISMATCH',
        message: 'The booking does not match the quoted stay or price.',
      };
    }
    return null;
  }

  private sign(payload: QuotePayload): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.secret()).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
  }

  private read(token: string): QuotePayload | null {
    const [encoded, signature, extra] = token.split('.');
    if (!encoded || !signature || extra) return null;
    const expected = createHmac('sha256', this.secret()).update(encoded).digest('base64url');
    if (!this.equals(signature, expected)) return null;
    try {
      const value = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      ) as Partial<QuotePayload>;
      if (
        value.version !== 1 ||
        typeof value.tenantId !== 'string' ||
        typeof value.propertyId !== 'string' ||
        typeof value.roomTypeId !== 'string' ||
        typeof value.ratePlanId !== 'string' ||
        typeof value.startsOn !== 'string' ||
        typeof value.endsOn !== 'string' ||
        typeof value.expiresAt !== 'string' ||
        typeof value.sessionBinding !== 'string' ||
        !value.total ||
        typeof value.total.amount !== 'string' ||
        typeof value.total.currency !== 'string'
      )
        return null;
      return value as QuotePayload;
    } catch {
      return null;
    }
  }

  private sessionBinding(sessionId: string): string {
    return createHash('sha256').update(sessionId).digest('base64url');
  }

  private equals(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }

  private secret(): string {
    const configured = process.env.QUOTE_SIGNING_SECRET;
    if (configured) return configured;
    if (process.env.NODE_ENV === 'production')
      throw new Error('QUOTE_SIGNING_SECRET must be configured in production.');
    return 'must-booking-local-quote-signing-secret';
  }

  private validInput(input: QuoteInput): void {
    if (!input.roomTypeId) throw new BadRequestException('roomTypeId is required.');
    if (!input.ratePlanId) throw new BadRequestException('ratePlanId is required.');
    if (!this.date(input.startsOn) || !this.date(input.endsOn) || input.endsOn <= input.startsOn)
      throw new BadRequestException(
        'startsOn and endsOn must be a valid, non-empty ISO date range.',
      );
  }

  private date(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }

  private nightCount(startsOn: string, endsOn: string): number {
    return (Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / 86_400_000;
  }

  private validateBookingRules(
    input: QuoteInput,
    rules: {
      minStayNights: number | null;
      maxStayNights: number | null;
      advanceBookingDays: number | null;
    },
  ): void {
    const nights = this.nightCount(input.startsOn, input.endsOn);
    if (rules.minStayNights !== null && nights < rules.minStayNights)
      throw new BadRequestException(`A minimum stay of ${rules.minStayNights} nights is required.`);
    if (rules.maxStayNights !== null && nights > rules.maxStayNights)
      throw new BadRequestException(`A maximum stay of ${rules.maxStayNights} nights is allowed.`);
    if (rules.advanceBookingDays !== null) {
      const today = new Date().toISOString().slice(0, 10);
      const daysAhead = this.nightCount(today, input.startsOn);
      if (daysAhead > rules.advanceBookingDays)
        throw new BadRequestException(
          `Bookings can be made at most ${rules.advanceBookingDays} days in advance.`,
        );
    }
  }
}
