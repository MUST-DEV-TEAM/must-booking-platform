import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Money, NightlyRate } from '@must/domain-contracts';

import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { IntegrationConnectionsService } from '../integrations/integration-connections.service';
import { ClockAvailabilityService } from '../integrations/clock/clock-availability.service';

export type QuoteInput = {
  roomTypeId: string;
  roomId?: string;
  // Optional: required only for a non-Clock-connected property's local
  // pricing path. A Clock-connected property derives its rate from the
  // room type's confirmed Clock mapping instead — see price() below.
  ratePlanId?: string;
  startsOn: string;
  endsOn: string;
  guestCount?: number;
};

type QuotePayload = QuoteInput & {
  version: 1;
  tenantId: string;
  propertyId: string;
  total: { amount: string; currency: string };
  nightlyRates: NightlyRate[];
  expiresAt: string;
  sessionBinding: string;
};

export type PricedQuote = { total: Money; nightlyRates: NightlyRate[] };

type QuoteValidationError = { code: string; message: string };

@Injectable()
export class QuoteService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockAvailabilityService) private readonly clockAvailability: ClockAvailabilityService,
  ) {}

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

    const quote = await this.priceWithNightlyRates(tenantId, propertyId, input);

    const payload: QuotePayload = {
      version: 1,
      tenantId,
      propertyId,
      ...input,
      total: quote.total,
      nightlyRates: quote.nightlyRates,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      sessionBinding: this.sessionBinding(sessionId),
    };
    return { ...payload, quoteToken: this.sign(payload) };
  }

  async price(tenantId: string, propertyId: string, input: QuoteInput): Promise<Money> {
    this.validStayInput(input);
    await this.enforceBookingRules(tenantId, propertyId, input);
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (connection?.provider === 'CLOCK_PMS') {
      const quote = await this.clockAvailability.getQuote(tenantId, propertyId, {
        roomTypeId: input.roomTypeId,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
      });
      if (!quote.ok) throw new BadRequestException(quote.error.message);
      return quote.value;
    }
    return (await this.priceWithNightlyRates(tenantId, propertyId, input)).total;
  }

  async priceWithNightlyRates(
    tenantId: string,
    propertyId: string,
    input: QuoteInput,
  ): Promise<PricedQuote> {
    this.validStayInput(input);
    await this.enforceBookingRules(tenantId, propertyId, input);

    // Clock-connected properties are always quoted live against Clock's own
    // /products endpoint (owner's call — no local rate_plan mirror). Rate is
    // derived from the room type's confirmed Clock mapping, so ratePlanId is
    // irrelevant on this path.
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (connection?.provider === 'CLOCK_PMS') {
      const quote = await this.clockAvailability.getQuoteWithNightlyRates(tenantId, propertyId, {
        roomTypeId: input.roomTypeId,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
      });
      if (!quote.ok) throw new BadRequestException(quote.error.message);
      return quote.value;
    }

    if (!input.ratePlanId) throw new BadRequestException('ratePlanId is required.');
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      if (input.roomId)
        await this.requireRoomForType(tx, tenantId, propertyId, input.roomId, input.roomTypeId);
      const rows = await tx.$queryRaw<
        Array<{ currency: string; amount: string; pricedNights: bigint; nightlyRates: unknown }>
      >`
        SELECT rp.currency, COALESCE(SUM(COALESCE(room_override.amount, resolved.amount)), 0)::text AS amount,
          COUNT(COALESCE(room_override.amount, resolved.amount))::bigint AS "pricedNights",
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'date', to_char(stay.stays_on::date, 'YYYY-MM-DD'),
                'amount', COALESCE(room_override.amount, resolved.amount)::text
              ) ORDER BY stay.stays_on
            ) FILTER (WHERE COALESCE(room_override.amount, resolved.amount) IS NOT NULL),
            '[]'::jsonb
          ) AS "nightlyRates"
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
        LEFT JOIN room_price_overrides room_override
          ON room_override.tenant_id = ${tenantId}::uuid
          AND room_override.property_id = ${propertyId}::uuid
          AND room_override.rate_plan_id = rp.id
          AND room_override.room_id = ${input.roomId ?? null}::uuid
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
      return {
        total: { amount: row.amount, currency: row.currency },
        nightlyRates: this.normalizeNightlyRates(row.nightlyRates, input.startsOn, input.endsOn),
      };
    });
  }

  /** Read only after validate() succeeds; the quote token is the source of truth for booking snapshots. */
  nightlyRates(token: string | undefined): NightlyRate[] | null {
    const payload = token ? this.read(token) : null;
    return payload?.nightlyRates ?? null;
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
    expected: Omit<QuotePayload, 'version' | 'expiresAt' | 'sessionBinding' | 'nightlyRates'>,
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
      payload.roomId !== expected.roomId ||
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
        (value.roomId !== undefined && typeof value.roomId !== 'string') ||
        typeof value.ratePlanId !== 'string' ||
        typeof value.startsOn !== 'string' ||
        typeof value.endsOn !== 'string' ||
        (value.guestCount !== undefined &&
          (!Number.isInteger(value.guestCount) || value.guestCount < 1)) ||
        typeof value.expiresAt !== 'string' ||
        typeof value.sessionBinding !== 'string' ||
        !value.total ||
        typeof value.total.amount !== 'string' ||
        typeof value.total.currency !== 'string' ||
        !Array.isArray(value.nightlyRates) ||
        !this.isNightlyRates(value.nightlyRates, value.startsOn, value.endsOn)
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

  private validStayInput(input: QuoteInput): void {
    if (!input.roomTypeId) throw new BadRequestException('roomTypeId is required.');
    if (
      input.guestCount !== undefined &&
      (!Number.isInteger(input.guestCount) || input.guestCount < 1)
    )
      throw new BadRequestException('guestCount must be a positive integer.');
    if (!this.date(input.startsOn) || !this.date(input.endsOn) || input.endsOn <= input.startsOn)
      throw new BadRequestException(
        'startsOn and endsOn must be a valid, non-empty ISO date range.',
      );
  }

  private async requireRoomForType(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roomId: string,
    roomTypeId: string,
  ): Promise<void> {
    const rooms = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM rooms
      WHERE tenant_id = ${tenantId}::uuid
        AND property_id = ${propertyId}::uuid
        AND id = ${roomId}::uuid
        AND room_type_id = ${roomTypeId}::uuid
    `;
    if (!rooms[0]) throw new NotFoundException('Room not found for this room type.');
  }

  private date(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }

  private nightCount(startsOn: string, endsOn: string): number {
    return (Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / 86_400_000;
  }

  private normalizeNightlyRates(value: unknown, startsOn: string, endsOn: string): NightlyRate[] {
    if (!this.isNightlyRates(value, startsOn, endsOn))
      throw new BadRequestException('The requested stay does not have a price for every night.');
    return value.map((rate) => ({ date: rate.date, amount: rate.amount }));
  }

  private isNightlyRates(value: unknown, startsOn: string, endsOn: string): value is NightlyRate[] {
    if (!Array.isArray(value) || value.length !== this.nightCount(startsOn, endsOn)) return false;
    return value.every(
      (rate, index) =>
        !!rate &&
        typeof rate === 'object' &&
        typeof (rate as NightlyRate).date === 'string' &&
        typeof (rate as NightlyRate).amount === 'string' &&
        /^\d+(?:\.\d{1,2})?$/.test((rate as NightlyRate).amount) &&
        (rate as NightlyRate).date ===
          new Date(Date.parse(`${startsOn}T00:00:00Z`) + index * 86_400_000)
            .toISOString()
            .slice(0, 10),
    );
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
