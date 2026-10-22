import { localPricing } from '../tenancy/pricing.repository';
import { applicableRestrictions } from '../tenancy/inventory-restrictions.repository';
import type { BookingRulePolicy, BookingRestriction } from './booking-rules';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Money, NightlyRate } from '@must/domain-contracts';

import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { IntegrationConnectionsService } from '../integrations/integration-connections.service';
import {
  ClockAvailabilityService,
  type ClockStayQuoteQuery,
} from '../integrations/clock/clock-availability.service';
import { resolveBookingOccupancy, validBookingOccupancy } from './booking-occupancy';
import { evaluateBookingRules, sameDayBookingViolation, rangeViolation } from './booking-rules';
export { propertyClock, isSameDayBookingClosed } from './booking-rules';

export type QuoteInput = {
  roomTypeId: string;
  roomId?: string;
  // Optional: required only for a non-Clock-connected property's local
  // pricing path. A Clock-connected property derives its rate from the
  // room type's confirmed Clock mapping instead — see price() below.
  ratePlanId?: string;
  startsOn: string;
  endsOn: string;
  adults?: number;
  children?: number;
  childrenAges?: number[];
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

export type DisplayPriceItem = {
  key: string;
  roomTypeId: string;
  roomId?: string;
  ratePlanId?: string;
  currency?: string;
};

export type DisplayPrice = {
  key: string;
  roomTypeId: string;
  available: boolean;
  total?: Money;
};

export type DisplayPriceInput = Omit<QuoteInput, 'roomTypeId' | 'roomId' | 'ratePlanId'> & {
  roomCount?: number;
};

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

    const normalizedInput = this.normalizeOccupancy(input);
    // Public quotes also preflight the property-local cutoff; shared validation covers staff too.
    await this.enforceGuestSameDayRule(tenantId, propertyId, normalizedInput.startsOn);
    const quote = await this.priceWithNightlyRates(
      tenantId,
      propertyId,
      normalizedInput,
      'website',
    );

    const payload: QuotePayload = {
      version: 1,
      tenantId,
      propertyId,
      ...normalizedInput,
      total: quote.total,
      nightlyRates: quote.nightlyRates,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      sessionBinding: this.sessionBinding(sessionId),
    };
    return { ...payload, quoteToken: this.sign(payload) };
  }

  async price(tenantId: string, propertyId: string, input: QuoteInput): Promise<Money> {
    const normalizedInput = this.normalizeOccupancy(input);
    this.validStayInput(normalizedInput);
    await this.enforceBookingRules(tenantId, propertyId, normalizedInput);
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (connection?.provider === 'CLOCK_PMS') {
      const quote = await this.clockAvailability.getQuote(tenantId, propertyId, {
        roomTypeId: normalizedInput.roomTypeId,
        startsOn: normalizedInput.startsOn,
        endsOn: normalizedInput.endsOn,
        adultCount: normalizedInput.adults,
        childrenCount: normalizedInput.children,
        childrenAges: normalizedInput.childrenAges,
      });
      if (!quote.ok) throw new BadRequestException(quote.error.message);
      return quote.value;
    }
    return (await this.priceWithNightlyRates(tenantId, propertyId, normalizedInput)).total;
  }

  async priceWithNightlyRates(
    tenantId: string,
    propertyId: string,
    input: QuoteInput,
    pricingChannel: 'website' | 'staff' = 'staff',
  ): Promise<PricedQuote> {
    const normalizedInput = this.normalizeOccupancy(input);
    this.validStayInput(normalizedInput);
    await this.enforceBookingRules(tenantId, propertyId, normalizedInput);

    // Clock-connected properties are always quoted live against Clock's own
    // /products endpoint (owner's call — no local rate_plan mirror). Rate is
    // derived from the room type's confirmed Clock mapping, so ratePlanId is
    // irrelevant on this path.
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (connection?.provider === 'CLOCK_PMS') {
      const quote = await this.clockAvailability.getQuoteWithNightlyRates(tenantId, propertyId, {
        roomTypeId: normalizedInput.roomTypeId,
        startsOn: normalizedInput.startsOn,
        endsOn: normalizedInput.endsOn,
        adultCount: normalizedInput.adults,
        childrenCount: normalizedInput.children,
        childrenAges: normalizedInput.childrenAges,
      });
      if (!quote.ok) throw new BadRequestException(quote.error.message);
      return quote.value;
    }

    if (!normalizedInput.ratePlanId) throw new BadRequestException('ratePlanId is required.');
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      if (normalizedInput.roomId)
        await this.requireRoomForType(
          tx,
          tenantId,
          propertyId,
          normalizedInput.roomId,
          normalizedInput.roomTypeId,
        );
      const result = await localPricing(tx, tenantId, propertyId, {
        roomTypeId: normalizedInput.roomTypeId,
        roomId: normalizedInput.roomId,
        ratePlanId: normalizedInput.ratePlanId!,
        startsOn: normalizedInput.startsOn,
        endsOn: normalizedInput.endsOn,
        adults: normalizedInput.adults,
        children: normalizedInput.children,
        channel: pricingChannel,
      });
      if (!result.valid || !result.total)
        throw new BadRequestException({
          code: result.errors[0]?.code ?? 'PRICING_UNAVAILABLE',
          message: result.errors.map((e) => e.message).join(' '),
          errors: result.errors,
        });
      return { total: result.total, nightlyRates: result.nightlyRates };
    });
  }

  /**
   * Returns bounded, guest-session-scoped display prices for visible room
   * cards. Clock-connected properties use one bounded provider request for the
   * cache misses; the final room-selection quote remains authoritative and
   * uncached.
   */
  async displayPrices(
    tenantId: string,
    propertyId: string,
    input: DisplayPriceInput,
    items: DisplayPriceItem[],
  ): Promise<DisplayPrice[]> {
    if (items.length === 0) return [];
    const { roomCount: requestedRoomCount, ...quoteInput } = input;
    const roomCount =
      Number.isInteger(requestedRoomCount) && (requestedRoomCount ?? 0) > 0
        ? requestedRoomCount!
        : 1;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (
      items.some((item) => !uuid.test(item.roomTypeId) || (item.roomId && !uuid.test(item.roomId)))
    )
      throw new BadRequestException('Invalid room selection.');
    const normalized = this.normalizeOccupancy({ roomTypeId: items[0].roomTypeId, ...quoteInput });
    this.validStayInput(normalized);
    const eligibility = new Map<string, boolean>();
    for (const item of items) {
      const key = item.roomTypeId + ':' + (item.roomId ?? '');
      if (eligibility.has(key)) continue;
      try {
        await this.enforceBookingRules(tenantId, propertyId, {
          ...normalized,
          roomTypeId: item.roomTypeId,
          roomId: item.roomId,
        });
        eligibility.set(key, true);
      } catch (error) {
        if (!(error instanceof BadRequestException || error instanceof NotFoundException))
          throw error;
        eligibility.set(key, false);
      }
    }
    const eligible = items.filter((item) =>
      eligibility.get(item.roomTypeId + ':' + (item.roomId ?? '')),
    );
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (connection?.provider === 'CLOCK_PMS') {
      const queries: ClockStayQuoteQuery[] = eligible.map((item) => ({
        roomTypeId: item.roomTypeId,
        startsOn: normalized.startsOn,
        endsOn: normalized.endsOn,
        adultCount: normalized.adults,
        childrenCount: normalized.children,
        childrenAges: normalized.childrenAges,
        roomCount,
        currency: item.currency,
      }));
      const quotes = queries.length
        ? await this.clockAvailability.getQuotesForStay(tenantId, propertyId, queries)
        : {};
      return items.map((item) => {
        const quote = quotes[item.roomTypeId];
        return {
          key: item.key,
          roomTypeId: item.roomTypeId,
          available:
            eligibility.get(item.roomTypeId + ':' + (item.roomId ?? '')) === true &&
            Boolean(quote?.ok),
          ...(quote?.ok ? { total: quote.value } : {}),
        };
      });
    }

    const prices = await Promise.all(
      items.map(async (item) => {
        try {
          const quote = await this.priceWithNightlyRates(
            tenantId,
            propertyId,
            {
              roomTypeId: item.roomTypeId,
              roomId: item.roomId,
              ratePlanId: item.ratePlanId,
              startsOn: normalized.startsOn,
              endsOn: normalized.endsOn,
              adults: normalized.adults,
              children: normalized.children,
              guestCount: normalized.guestCount,
            },
            'website',
          );
          return {
            key: item.key,
            roomTypeId: item.roomTypeId,
            available: true,
            total: quote.total,
          };
        } catch {
          return { key: item.key, roomTypeId: item.roomTypeId, available: false };
        }
      }),
    );
    return prices;
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
      const catalog = await tx.$queryRaw<
        Array<{ id: string; maxOccupancy: number; status: string }>
      >`
        SELECT id, max_occupancy AS "maxOccupancy", status::text AS status FROM room_types
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND id = ${input.roomTypeId}::uuid
      `;
      if (!catalog[0]) throw new NotFoundException('Room type not found.');
      const room = input.roomId
        ? await this.requireRoomForType(tx, tenantId, propertyId, input.roomId, input.roomTypeId)
        : undefined;
      const properties = await tx.$queryRaw<
        Array<{
          minStayNights: number | null;
          maxStayNights: number | null;
          advanceBookingDays: number | null;
          timezone: string | null;
          sameDayBookingAllowed: boolean;
          sameDayCutoffTime: string | null;
          maxGuestsPerBooking: number | null;
          maxRoomsPerBooking: number | null;
        }>
      >`
        SELECT min_stay_nights AS "minStayNights", max_stay_nights AS "maxStayNights",
          advance_booking_days AS "advanceBookingDays", timezone,same_day_booking_allowed AS "sameDayBookingAllowed",same_day_cutoff_time AS "sameDayCutoffTime",max_guests_per_booking AS "maxGuestsPerBooking",max_rooms_per_booking AS "maxRoomsPerBooking"
        FROM properties WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid
      `;
      if (!properties[0]) throw new NotFoundException('Property was not found.');
      const restrictions = await applicableRestrictions(tx, tenantId, propertyId, input.roomTypeId);
      this.validateBookingRules(input, {
        restrictions,
        ...properties[0],
        maxOccupancy: catalog[0].maxOccupancy,
        roomTypeStatus: catalog[0].status,
        roomActive: room?.isActive,
      });
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
    const expectedOccupancy = resolveBookingOccupancy(expected);
    const quotedOccupancy = resolveBookingOccupancy(payload);
    if (
      payload.tenantId !== expected.tenantId ||
      payload.propertyId !== expected.propertyId ||
      payload.roomTypeId !== expected.roomTypeId ||
      payload.roomId !== expected.roomId ||
      payload.ratePlanId !== expected.ratePlanId ||
      payload.startsOn !== expected.startsOn ||
      payload.endsOn !== expected.endsOn ||
      quotedOccupancy.adults !== expectedOccupancy.adults ||
      quotedOccupancy.children !== expectedOccupancy.children ||
      JSON.stringify(payload.childrenAges ?? null) !==
        JSON.stringify(expected.childrenAges ?? null) ||
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
        (value.adults !== undefined && (!Number.isInteger(value.adults) || value.adults < 1)) ||
        (value.children !== undefined &&
          (!Number.isInteger(value.children) || value.children < 0)) ||
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

  private normalizeOccupancy(input: QuoteInput): QuoteInput {
    const occupancy = resolveBookingOccupancy(input);
    return {
      ...input,
      adults: occupancy.adults,
      children: occupancy.children,
      guestCount: occupancy.guestCount,
    };
  }

  private validStayInput(input: QuoteInput): void {
    if (!input.roomTypeId) throw new BadRequestException('roomTypeId is required.');
    if (!validBookingOccupancy(input))
      throw new BadRequestException(
        'adults must be a positive integer and children must be a non-negative integer.',
      );
    if (rangeViolation(input.startsOn, input.endsOn))
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
  ): Promise<{ isActive: boolean }> {
    const rooms = await tx.$queryRaw<Array<{ id: string; isActive: boolean }>>`
      SELECT id, is_active AS "isActive" FROM rooms
      WHERE tenant_id = ${tenantId}::uuid
        AND property_id = ${propertyId}::uuid
        AND id = ${roomId}::uuid
        AND room_type_id = ${roomTypeId}::uuid
    `;
    if (!rooms[0]) throw new NotFoundException('Room not found for this room type.');
    return rooms[0];
  }

  private date(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }

  private nightCount(startsOn: string, endsOn: string): number {
    return (Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / 86_400_000;
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

  /**
   * The website's same-day rule: a stay that starts today is refused when the
   * property turned same-day booking off, or once its local cutoff time has
   * passed. Staff pricing and creation enforce the same property policy.
   */
  async enforceGuestSameDayRule(
    tenantId: string,
    propertyId: string,
    startsOn: string,
  ): Promise<void> {
    const rule = await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          timezone: string | null;
          sameDayBookingAllowed: boolean;
          sameDayCutoffTime: string | null;
        }>
      >`
        SELECT timezone, same_day_booking_allowed AS "sameDayBookingAllowed",
          same_day_cutoff_time AS "sameDayCutoffTime"
        FROM properties WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid
      `;
      return rows[0];
    });
    if (!rule) throw new NotFoundException('Property was not found.');
    const violation = sameDayBookingViolation(startsOn, rule);
    if (violation) throw new BadRequestException(violation);
  }

  private validateBookingRules(
    input: QuoteInput,
    rules: BookingRulePolicy & {
      minStayNights: number | null;
      maxStayNights: number | null;
      advanceBookingDays: number | null;
      timezone?: string | null;
      maxOccupancy?: number;
      roomTypeStatus?: string;
      roomActive?: boolean;
      restrictions?: BookingRestriction[];
    },
  ): void {
    const occupancy = resolveBookingOccupancy(input);
    const result = evaluateBookingRules({
      channel: 'staff',
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      policy: rules,
      restrictions: rules.restrictions,
      adults: occupancy.adults,
      children: occupancy.children,
      maxOccupancy: rules.maxOccupancy,
      roomTypeStatus: rules.roomTypeStatus,
      roomActive: rules.roomActive,
    });
    const unavailable = result.errors.find(
      (error) => error.code === 'ROOM_TYPE_NOT_AVAILABLE' || error.code === 'ROOM_NOT_AVAILABLE',
    );
    if (unavailable)
      throw new NotFoundException(
        unavailable.code === 'ROOM_TYPE_NOT_AVAILABLE'
          ? 'Room type not found.'
          : 'Room not found for this room type.',
      );
    if (!result.valid) throw new BadRequestException(result.errors[0]);
  }
}
