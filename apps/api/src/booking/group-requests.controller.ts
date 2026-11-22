import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';

import { PublicRateLimitGuard } from '../tenancy/public-rate-limit.guard';
import { PublicTenantScoped } from '../tenancy/tenant-context.decorator';
import { GroupRequestsService } from './group-requests.service';
import {
  PUBLIC_BOOKING_MUTATION_RATE_LIMIT,
  PublicRateLimit,
} from '../tenancy/public-rate-limit.decorator';

@Controller('tenants/:tenantId/properties/:propertyId/group-requests')
export class GroupRequestsController {
  constructor(@Inject(GroupRequestsService) private readonly requests: GroupRequestsService) {}

  /** A guest asks the hotel for a group quote. Only hotels that switched the group request form on take them. */
  @Post()
  @HttpCode(201)
  @PublicTenantScoped({ propertyParam: 'propertyId' })
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(PUBLIC_BOOKING_MUTATION_RATE_LIMIT)
  async create(
    @Body() body: unknown,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string } },
  ) {
    const { id } = await this.requests.submit(request.tenantContext, body);
    return { ok: true, id };
  }
}
