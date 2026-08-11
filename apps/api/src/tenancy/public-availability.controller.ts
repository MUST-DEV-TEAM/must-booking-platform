import { BadRequestException, Controller, Get, Inject, Query, Req } from '@nestjs/common';
import type { AvailabilityQuery } from '@must/domain-contracts';

import { PmsProviderRegistry } from '../booking/pms-provider-registry';
import { AvailabilityService } from './availability.service';
import { PublicTenantScoped } from './tenant-context.decorator';

type TenantPropertyRequest = { tenantContext: { tenantId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/public')
export class PublicAvailabilityController {
  constructor(
    @Inject(PmsProviderRegistry) private readonly providers: PmsProviderRegistry,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
  ) {}

  // Milestone 11.5 (post-Task-9 scoping): dispatched through the registry so
  // a Clock-connected property gets live Clock availability
  // (ClockAvailabilityService, real sandbox-tested) instead of the local
  // mirror — "correct straight from Clock" without needing Task 9's blocked
  // webhook sync. Non-Clock properties are unaffected (LocalPmsProvider
  // still reads the local mirror exactly as before).
  @Get('availability')
  @PublicTenantScoped({ propertyParam: 'propertyId' })
  async getAvailability(@Query() query: unknown, @Req() request: TenantPropertyRequest) {
    const provider = await this.providers.forProperty(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
    );
    const result = await provider.getAvailability(
      request.tenantContext,
      parseAvailabilityQuery(query),
    );
    if (!result.ok) throw new BadRequestException(result.error.message);
    return result.value;
  }

  /** A guest who has already selected a physical room needs month-level
   * availability for that exact room to disable unavailable calendar dates.
   * `AvailabilityService` deliberately keeps this per-room branch local, so
   * its answer remains correct even when the property also has a Clock PMS
   * connection. */
  @Get('availability-calendar')
  @PublicTenantScoped({ propertyParam: 'propertyId' })
  getCalendar(@Query() query: unknown, @Req() request: TenantPropertyRequest) {
    return this.availability.getCalendar(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      parseAvailabilityCalendarQuery(query),
    );
  }
}

function parseAvailabilityQuery(query: unknown): AvailabilityQuery {
  const value = (query ?? {}) as Record<string, unknown>;
  const roomTypeId = typeof value.roomTypeId === 'string' ? value.roomTypeId : '';
  if (!roomTypeId) throw new BadRequestException('roomTypeId is required.');
  const startsOn = isoDate(value.startsOn, 'startsOn');
  const endsOn = isoDate(value.endsOn, 'endsOn');
  if (endsOn <= startsOn) throw new BadRequestException('endsOn must be after startsOn.');
  return { roomTypeId, startsOn, endsOn };
}

function isoDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new BadRequestException(`${field} must be an ISO date (YYYY-MM-DD).`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value)
    throw new BadRequestException(`${field} must be an ISO date (YYYY-MM-DD).`);
  return value;
}

function parseAvailabilityCalendarQuery(query: unknown): {
  roomTypeId: string;
  roomId: string;
  month: string;
} {
  const value = (query ?? {}) as Record<string, unknown>;
  const roomTypeId = typeof value.roomTypeId === 'string' ? value.roomTypeId : '';
  const roomId = typeof value.roomId === 'string' ? value.roomId : '';
  const month = typeof value.month === 'string' ? value.month : '';
  if (!roomTypeId) throw new BadRequestException('roomTypeId is required.');
  if (!roomId) throw new BadRequestException('roomId is required.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new BadRequestException('month must be YYYY-MM.');
  return { roomTypeId, roomId, month };
}
