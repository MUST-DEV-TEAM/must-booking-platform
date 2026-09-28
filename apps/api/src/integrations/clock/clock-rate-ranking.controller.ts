import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Req,
} from '@nestjs/common';

import { RequiresVerifiedEmail } from '../../auth/requires-verified-email.decorator';
import { RequiresCapability } from '../../tenancy/capabilities.decorator';
import { Role, Roles } from '../../tenancy/roles.decorator';
import { TenantScoped } from '../../tenancy/tenant-context.decorator';
import { ClockAvailabilityService } from './clock-availability.service';
import { ClockRateRankingService } from './clock-rate-ranking.service';

type TenantPropertyRequest = { tenantContext: { tenantId: string } };

export type ClockRateRankingItem = {
  externalRateId: string;
  name: string;
  maxAdults: number | null;
  maxChildren: number | null;
  rank: number | null;
};

/**
 * Milestone 21 Task 13. Read+map only, matching the `clock_catalog_mappings`
 * spirit: staff can view Clock's real rates and set a priority order among
 * them, never create/edit/delete a rate — Clock stays the source of truth
 * for the rates themselves, MUST only stores which one should win a
 * conflict. See `ClockRateRankingService` for the storage side and
 * `ClockAvailabilityService.selectBestOffer` (Task 12) for where the
 * ranking is actually consulted at quote time.
 */
@Controller('tenants/:tenantId/properties/:propertyId/room-types/:roomTypeId/clock-rate-ranking')
export class ClockRateRankingController {
  constructor(
    @Inject(ClockAvailabilityService) private readonly availability: ClockAvailabilityService,
    @Inject(ClockRateRankingService) private readonly rankings: ClockRateRankingService,
  ) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  async get(
    @Param('propertyId') propertyId: string,
    @Param('roomTypeId') roomTypeId: string,
    @Req() request: TenantPropertyRequest,
  ): Promise<{ rates: ClockRateRankingItem[] }> {
    const tenantId = request.tenantContext.tenantId;
    const [ratesResult, ranking] = await Promise.all([
      this.availability.ratesForRoomTypeDetailed(tenantId, propertyId, roomTypeId),
      this.rankings.getRanking(tenantId, propertyId, roomTypeId),
    ]);
    if (!ratesResult.ok) throw new BadRequestException(ratesResult.error.message);

    const rankByRateId = new Map(ranking.map((row) => [row.externalRateId, row.rank]));
    const rates: ClockRateRankingItem[] = ratesResult.value.map((rate) => ({
      ...rate,
      rank: rankByRateId.get(rate.externalRateId) ?? null,
    }));
    // Ranked rates first (in rank order); any rate Clock has that staff
    // hasn't ranked yet sorts after every ranked one (so it can never win
    // over a deliberate ranking by accident) and by name for a stable
    // display order among themselves.
    rates.sort((a, b) => {
      if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
      if (a.rank !== null) return -1;
      if (b.rank !== null) return 1;
      return a.name.localeCompare(b.name);
    });
    return { rates };
  }

  @Put()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  async set(
    @Param('propertyId') propertyId: string,
    @Param('roomTypeId') roomTypeId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest,
  ): Promise<{ rates: ClockRateRankingItem[] }> {
    const tenantId = request.tenantContext.tenantId;
    const externalRateIds = this.parseRankedIds(body);

    const ratesResult = await this.availability.ratesForRoomTypeDetailed(
      tenantId,
      propertyId,
      roomTypeId,
    );
    if (!ratesResult.ok) throw new BadRequestException(ratesResult.error.message);

    const validRateIds = new Set(ratesResult.value.map((rate) => rate.externalRateId));
    for (const externalRateId of externalRateIds) {
      if (!validRateIds.has(externalRateId))
        throw new BadRequestException(
          `Rate ${externalRateId} is not a current, published Clock rate for this room type.`,
        );
    }

    await this.rankings.setRanking(tenantId, propertyId, roomTypeId, externalRateIds);
    return this.get(propertyId, roomTypeId, request);
  }

  private parseRankedIds(body: unknown): string[] {
    const value = (body ?? {}) as { externalRateIds?: unknown };
    if (
      !Array.isArray(value.externalRateIds) ||
      value.externalRateIds.some((id) => typeof id !== 'string')
    )
      throw new BadRequestException('externalRateIds must be an array of strings.');
    const externalRateIds = value.externalRateIds as string[];
    if (new Set(externalRateIds).size !== externalRateIds.length)
      throw new BadRequestException('externalRateIds must not contain duplicates.');
    return externalRateIds;
  }
}

/**
 * Batched sibling of ClockRateRankingController's GET: the rate-priority UI
 * shows every room type on one page, and calling the per-room-type route
 * once per room type meant re-fetching Clock's full property-wide /rates/
 * response over and over — tripping the shared 4 req/s Clock rate limiter
 * on properties with many room types. This fetches it once for the whole
 * property and returns each room type's slice keyed by local room type id.
 */
@Controller('tenants/:tenantId/properties/:propertyId/clock-rate-ranking')
export class ClockRateRankingBatchController {
  constructor(
    @Inject(ClockAvailabilityService) private readonly availability: ClockAvailabilityService,
    @Inject(ClockRateRankingService) private readonly rankings: ClockRateRankingService,
  ) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  async get(
    @Param('propertyId') propertyId: string,
    @Req() request: TenantPropertyRequest,
  ): Promise<{ roomTypes: Record<string, ClockRateRankingItem[]> }> {
    const tenantId = request.tenantContext.tenantId;
    const ratesResult = await this.availability.ratesForAllRoomTypesDetailed(tenantId, propertyId);
    if (!ratesResult.ok) throw new BadRequestException(ratesResult.error.message);

    const roomTypes: Record<string, ClockRateRankingItem[]> = {};
    for (const [roomTypeId, rates] of ratesResult.value) {
      const ranking = await this.rankings.getRanking(tenantId, propertyId, roomTypeId);
      const rankByRateId = new Map(ranking.map((row) => [row.externalRateId, row.rank]));
      const items: ClockRateRankingItem[] = rates.map((rate) => ({
        ...rate,
        rank: rankByRateId.get(rate.externalRateId) ?? null,
      }));
      items.sort((a, b) => {
        if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
        if (a.rank !== null) return -1;
        if (b.rank !== null) return 1;
        return a.name.localeCompare(b.name);
      });
      roomTypes[roomTypeId] = items;
    }
    return { roomTypes };
  }
}
