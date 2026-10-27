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
import { AuditLogService } from '../../tenancy/audit-log.service';
import { RequiresCapability } from '../../tenancy/capabilities.decorator';
import { Role, Roles } from '../../tenancy/roles.decorator';
import { TenantScoped } from '../../tenancy/tenant-context.decorator';
import { ClockAvailabilityService, type ClockRateSummary } from './clock-availability.service';
import { ClockWebsiteRatesService } from './clock-website-rates.service';

type TenantRequest = { tenantContext: { tenantId: string; userId: string; propertyId: string } };

export type ClockWebsiteRateItem = ClockRateSummary & { onWebsite: boolean };

/**
 * Staff switch for each Clock rate: sold on the hotel's website or not. Every rate Clock publishes for online
 * booking is on by default. The rate, its price and its restrictions stay in Clock; this only decides what the
 * website offers. Staff booking screens always see every rate.
 */
@Controller('tenants/:tenantId/properties/:propertyId/clock-website-rates')
export class ClockWebsiteRatesController {
  constructor(
    @Inject(ClockAvailabilityService) private readonly availability: ClockAvailabilityService,
    @Inject(ClockWebsiteRatesService) private readonly websiteRates: ClockWebsiteRatesService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('rates.manage')
  async get(
    @Param('propertyId') propertyId: string,
    @Req() request: TenantRequest,
  ): Promise<{ roomTypes: Record<string, ClockWebsiteRateItem[]> }> {
    const tenantId = request.tenantContext.tenantId;
    const [ratesResult, hidden] = await Promise.all([
      this.availability.ratesForAllRoomTypesDetailed(tenantId, propertyId),
      this.websiteRates.hiddenRateIds(tenantId, propertyId),
    ]);
    if (!ratesResult.ok) throw new BadRequestException(ratesResult.error.message);
    const roomTypes: Record<string, ClockWebsiteRateItem[]> = {};
    for (const [roomTypeId, rates] of ratesResult.value) {
      roomTypes[roomTypeId] = rates
        .map((rate) => ({ ...rate, onWebsite: !hidden.has(rate.externalRateId) }))
        .sort((a, b) => a.label.localeCompare(b.label) || a.name.localeCompare(b.name));
    }
    return { roomTypes };
  }

  /** Just the rates switched off, from the database only: cheap enough to read next to a snapshot of the rates. */
  @Get('hidden')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('rates.manage')
  async hidden(
    @Param('propertyId') propertyId: string,
    @Req() request: TenantRequest,
  ): Promise<{ hiddenRateIds: string[] }> {
    const hidden = await this.websiteRates.hiddenRateIds(request.tenantContext.tenantId, propertyId);
    return { hiddenRateIds: [...hidden] };
  }

  @Put(':externalRateId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('rates.manage')
  @RequiresVerifiedEmail()
  async set(
    @Param('propertyId') propertyId: string,
    @Param('externalRateId') externalRateId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
  ): Promise<{ externalRateId: string; onWebsite: boolean }> {
    const { tenantId, userId } = request.tenantContext;
    const onWebsite = (body as { onWebsite?: unknown } | null)?.onWebsite;
    if (typeof onWebsite !== 'boolean')
      throw new BadRequestException('onWebsite must be true or false.');

    // Only a rate Clock currently publishes for online booking can be switched; anything else would leave a
    // stray row behind.
    const ratesResult = await this.availability.ratesForAllRoomTypesDetailed(tenantId, propertyId);
    if (!ratesResult.ok) throw new BadRequestException(ratesResult.error.message);
    const known = [...ratesResult.value.values()]
      .flat()
      .find((rate) => rate.externalRateId === externalRateId);
    if (!known)
      throw new BadRequestException(
        `Rate ${externalRateId} is not a current, published Clock rate.`,
      );

    const changed = await this.websiteRates.setOnWebsite(
      tenantId,
      propertyId,
      externalRateId,
      onWebsite,
      userId,
    );
    if (changed)
      await this.audit.record({
        actorUserId: userId,
        action: 'rates.website_visibility_changed',
        targetType: 'clock_rate',
        targetId: externalRateId,
        tenantId,
        propertyId,
        details: { rateName: known.label || known.name, onWebsite },
      });
    return { externalRateId, onWebsite };
  }
}
