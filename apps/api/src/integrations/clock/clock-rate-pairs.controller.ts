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
import { ClockWebsiteRatesService } from './clock-website-rates.service';
import { ClockRatePairsService } from './clock-rate-pairs.service';

type TenantRequest = { tenantContext: { tenantId: string; userId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/clock-rate-pairs')
export class ClockRatePairsController {
  constructor(
    @Inject(ClockAvailabilityService) private readonly availability: ClockAvailabilityService,
    @Inject(ClockWebsiteRatesService) private readonly websiteRates: ClockWebsiteRatesService,
    @Inject(ClockRatePairsService) private readonly ratePairs: ClockRatePairsService,
  ) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('rates.manage')
  async get(@Param('propertyId') propertyId: string, @Req() request: TenantRequest) {
    return { pairs: await this.ratePairs.pairs(request.tenantContext.tenantId, propertyId) };
  }

  @Put(':promoRateId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('rates.manage')
  @RequiresVerifiedEmail()
  async set(
    @Param('propertyId') propertyId: string,
    @Param('promoRateId') promoRateId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
  ) {
    const compareRateId = (body as { compareRateId?: unknown } | null)?.compareRateId;
    if (compareRateId !== null && (typeof compareRateId !== 'string' || !compareRateId.trim()))
      throw new BadRequestException('Choose a comparison rate or None.');
    const { tenantId, userId } = request.tenantContext;
    const rates = await this.availability.ratesForAllRoomTypesDetailed(tenantId, propertyId);
    if (!rates.ok) throw new BadRequestException(rates.error.message);
    if (compareRateId !== null) {
      const sameRoom = [...rates.value.values()].find((roomRates) =>
        roomRates.some((r) => r.externalRateId === promoRateId),
      );
      const compared = sameRoom?.find((r) => r.externalRateId === compareRateId);
      if (!compared || promoRateId === compareRateId)
        throw new BadRequestException(
          'Choose a different published Clock rate of the same room type.',
        );
      const hidden = await this.websiteRates.hiddenRateIds(tenantId, propertyId);
      if (hidden.has(compareRateId) || compared.requiresCode)
        throw new BadRequestException(
          'The comparison rate must be sold on the website without a promo code.',
        );
    }
    await this.ratePairs.setPair(tenantId, propertyId, promoRateId, compareRateId, userId);
    return { promoRateId, compareRateId };
  }
}
