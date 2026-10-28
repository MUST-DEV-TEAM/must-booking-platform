import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Money } from '@must/domain-contracts';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { AvailabilityService } from '../tenancy/availability.service';
import { IntegrationConnectionsService } from '../integrations/integration-connections.service';
import {
  ClockAvailabilityService,
  NO_CLOCK_CONNECTION_MESSAGE,
} from '../integrations/clock/clock-availability.service';
import { QuoteService, type DisplayPriceItem } from './quote.service';
type Offer = { ok: true; total: Money } | { ok: false; reason: string };
@Injectable()
export class StaffAvailabilityService {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(QuoteService) private readonly quotes: QuoteService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockAvailabilityService) private readonly clock: ClockAvailabilityService,
  ) {}
  /** The rates a Clock hotel offers for one room type and stay; empty for any other hotel. */
  async rateOffers(scope: { tenantId: string; propertyId: string }, body: Record<string, unknown>) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const roomTypeId = String(body.roomTypeId ?? '');
    if (!uuid.test(roomTypeId)) throw new BadRequestException('Invalid room type.');
    const result = await this.clock.listOffersForStay(scope.tenantId, scope.propertyId, {
      roomTypeId,
      startsOn: String(body.startsOn ?? ''),
      endsOn: String(body.endsOn ?? ''),
      adultCount: Number(body.adults ?? 1),
      childrenCount: Number(body.children ?? 0),
      childrenAges: Array.isArray(body.childrenAges) ? (body.childrenAges as number[]) : undefined,
    });
    if (result.ok) return { offers: result.value };
    if (result.error.message === NO_CLOCK_CONNECTION_MESSAGE) return { offers: [] };
    throw new BadRequestException(result.error.message);
  }
  async search(scope: { tenantId: string; propertyId: string }, body: Record<string, unknown>) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 250)
      throw new BadRequestException('Choose between 1 and 250 room selections.');
    const items = body.items as DisplayPriceItem[];
    if (
      items.some(
        (i) =>
          !i ||
          typeof i.key !== 'string' ||
          i.key.length > 100 ||
          !uuid.test(i.roomTypeId) ||
          (i.roomId !== undefined && !uuid.test(i.roomId)) ||
          (i.ratePlanId !== undefined && !uuid.test(i.ratePlanId)),
      )
    )
      throw new BadRequestException('Invalid room selection.');
    const input = {
      startsOn: String(body.startsOn ?? ''),
      endsOn: String(body.endsOn ?? ''),
      adults: Number(body.adults ?? 1),
      children: Number(body.children ?? 0),
      childrenAges: body.childrenAges as number[] | undefined,
    };
    const types = await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<
          Array<{ id: string; max: number; rooms: string[] }>
        >`SELECT t.id,t.max_occupancy AS max,ARRAY(SELECT r.id::text FROM rooms r WHERE r.tenant_id=t.tenant_id AND r.property_id=t.property_id AND r.room_type_id=t.id AND r.is_active=true) AS rooms FROM room_types t WHERE t.tenant_id=${scope.tenantId}::uuid AND t.property_id=${scope.propertyId}::uuid AND t.status='PUBLISHED' AND t.id=ANY(${items.map((i) => i.roomTypeId)}::uuid[])`,
    );
    const connection = await this.connections.activePmsConnectionCredentials(
      scope.tenantId,
      scope.propertyId,
    );
    // Clock has no room-type capacity; its rates enforce guest limits when priced.
    const clockManaged = connection?.provider === 'CLOCK_PMS';
    const eligible = items.filter((i) =>
      types.some(
        (t) =>
          t.id === i.roomTypeId &&
          (clockManaged || t.max >= input.adults + input.children) &&
          (!i.roomId || t.rooms.includes(i.roomId)),
      ),
    );
    const offers: Record<string, Offer> = Object.fromEntries(
      items.map((i) => [
        i.key,
        { ok: false, reason: 'This room does not match the selected guests or is not active.' },
      ]),
    );
    if (!eligible.length) return { offers };
    if (clockManaged) {
      const prices = await this.quotes.displayPrices(
        scope.tenantId,
        scope.propertyId,
        input,
        eligible,
        'staff',
      );
      const roomIds = eligible.flatMap((i) => (i.roomId ? [i.roomId] : []));
      const unavailable = roomIds.length
        ? await this.clock.unavailableRoomsForBooking(scope.tenantId, scope.propertyId, {
            ...input,
            roomIds,
          })
        : { ok: true as const, value: [] as string[] };
      if (!unavailable.ok) throw new BadRequestException(unavailable.error.message);
      for (const i of eligible) {
        const price = prices.find((p) => p.key === i.key);
        offers[i.key] =
          price?.available && price.total && (!i.roomId || !unavailable.value.includes(i.roomId))
            ? { ok: true, total: price.total }
            : { ok: false, reason: 'No bookable Clock offer for this room and stay.' };
      }
    } else {
      let next = 0;
      const worker = async () => {
        while (next < eligible.length) {
          const i = eligible[next++]!;
          try {
            const rules = await this.availability.evaluateRules(scope.tenantId, scope.propertyId, {
              ...input,
              roomTypeId: i.roomTypeId,
              roomId: i.roomId,
            });
            if (!rules.booking.valid) {
              offers[i.key] = {
                ok: false,
                reason: rules.booking.errors[0]?.message || 'Not available for this stay.',
              };
              continue;
            }
            const quote = await this.quotes.priceWithNightlyRates(
              scope.tenantId,
              scope.propertyId,
              { ...input, roomTypeId: i.roomTypeId, roomId: i.roomId, ratePlanId: i.ratePlanId },
              'staff',
            );
            offers[i.key] = { ok: true, total: quote.total };
          } catch (e) {
            offers[i.key] = {
              ok: false,
              reason: e instanceof Error ? e.message : 'Availability could not be checked.',
            };
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, eligible.length) }, worker));
    }
    return { offers };
  }
}
