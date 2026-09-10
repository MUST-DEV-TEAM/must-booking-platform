import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { GuestsService } from './guests.service';
import { RequiresCapability } from './capabilities.decorator';

@Controller('tenants/:tenantId/properties/:propertyId/guests')
export class GuestsController {
  constructor(@Inject(GuestsService) private readonly guests: GuestsService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('guests.manage')
  list(
    @Query('search') search: string | undefined,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string } },
  ) {
    return this.guests.list(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      search,
    );
  }

  @Get('suspected-duplicates')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('guests.manage')
  listSuspectedDuplicates(
    @Req() request: { tenantContext: { tenantId: string; propertyId: string } },
  ) {
    return this.guests.listSuspectedDuplicates(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
    );
  }

  @Post(':guestId/dismiss-duplicate')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('guests.manage')
  @RequiresVerifiedEmail()
  @HttpCode(204)
  async dismissSuspectedDuplicate(
    @Param('guestId') guestId: string,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
  ): Promise<void> {
    await this.guests.dismissSuspectedDuplicate(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      guestId,
      request.tenantContext.userId,
    );
  }

  @Post(':guestId/merge')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('guests.manage')
  @RequiresVerifiedEmail()
  mergeSuspectedDuplicate(
    @Param('guestId') guestId: string,
    @Body() body: { canonicalGuestId?: string } | undefined,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
  ) {
    return this.guests.mergeSuspectedDuplicate(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      guestId,
      body?.canonicalGuestId ?? '',
      request.tenantContext.userId,
    );
  }
}
