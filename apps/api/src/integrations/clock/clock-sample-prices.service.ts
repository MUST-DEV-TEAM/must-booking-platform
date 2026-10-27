import { Inject, Injectable } from '@nestjs/common';

import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { ClockAvailabilityService, type ClockStayOffer } from './clock-availability.service';

/** How long a sample is reused before Clock is asked again. */
const SAMPLE_TTL_MS = 5 * 60_000;
/** Days from today on which the sample stay may start, nearest first. The first one with a free room is used. */
const SAMPLE_START_OFFSETS = [1, 8, 15, 31, 61];
const SAMPLE_NIGHTS = 2;
const SAMPLE_ADULTS = 2;
const DAY_MS = 86_400_000;

export type ClockSamplePrices = {
  /** Null when none of the sample stays has a free room. */
  startsOn: string | null;
  endsOn: string | null;
  adults: number;
  nights: number;
  /** What each published rate costs for the sample stay, by room type. A rate that is missing cannot be booked then. */
  roomTypes: Record<string, Array<{ rateId: string; total: ClockStayOffer['total'] }>>;
};

/**
 * One fixed, easy-to-explain stay (two adults, two nights) used to show what each Clock rate costs, so staff can
 * compare rates at a glance. The stay is the nearest one that has a free room, because a stay that is sold out
 * would show nothing. Prices come from Clock and are only a sample, never a quote.
 */
@Injectable()
export class ClockSamplePricesService {
  private readonly remembered = new Map<string, { value: ClockSamplePrices; expiresAt: number }>();

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(ClockAvailabilityService) private readonly clock: ClockAvailabilityService,
  ) {}

  async sample(tenantId: string, propertyId: string): Promise<ClockSamplePrices> {
    const key = `${tenantId}:${propertyId}`;
    const known = this.remembered.get(key);
    if (known && known.expiresAt > Date.now()) return known.value;

    const roomTypes = await this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM room_types
         WHERE tenant_id = $1::uuid AND property_id = $2::uuid AND status = 'PUBLISHED' AND max_occupancy >= $3`,
        tenantId,
        propertyId,
        SAMPLE_ADULTS,
      ),
    );
    const empty: ClockSamplePrices = {
      startsOn: null,
      endsOn: null,
      adults: SAMPLE_ADULTS,
      nights: SAMPLE_NIGHTS,
      roomTypes: {},
    };
    if (roomTypes.length === 0) return this.keep(key, empty);

    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    for (const offset of SAMPLE_START_OFFSETS) {
      const startsOn = new Date(today + offset * DAY_MS).toISOString().slice(0, 10);
      const endsOn = new Date(today + (offset + SAMPLE_NIGHTS) * DAY_MS).toISOString().slice(0, 10);
      const search = await this.clock.getStaySearch(
        tenantId,
        propertyId,
        roomTypes.map(({ id }) => ({
          roomTypeId: id,
          startsOn,
          endsOn,
          adultCount: SAMPLE_ADULTS,
          childrenCount: 0,
          channel: 'staff' as const,
        })),
      );
      if (!roomTypes.some(({ id }) => search.details[id]?.available)) continue;

      const priced: ClockSamplePrices['roomTypes'] = {};
      for (const { id } of roomTypes) {
        const offers = await this.clock.listOffersForStay(tenantId, propertyId, {
          roomTypeId: id,
          startsOn,
          endsOn,
          adultCount: SAMPLE_ADULTS,
          childrenCount: 0,
          channel: 'staff',
        });
        priced[id] = offers.ok
          ? offers.value.map((offer) => ({ rateId: offer.rateId, total: offer.total }))
          : [];
      }
      return this.keep(key, { ...empty, startsOn, endsOn, roomTypes: priced });
    }
    return this.keep(key, empty);
  }

  private keep(key: string, value: ClockSamplePrices): ClockSamplePrices {
    this.remembered.set(key, { value, expiresAt: Date.now() + SAMPLE_TTL_MS });
    return value;
  }
}
