import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { VenueStaffService } from './venue-staff.service';

type StaffRequest = { tenantContext: { tenantId: string; userId: string } };

@Controller('tenants/:tenantId/venues/:venueId/staff')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.VenueStaff)
@RequiresCapability('venue.staff')
export class VenueStaffController {
  constructor(@Inject(VenueStaffService) private readonly staff: VenueStaffService) {}

  @Get()
  @TenantScoped({ venueParam: 'venueId' })
  list(@Param('venueId') venueId: string, @Req() request: StaffRequest) {
    return this.staff.list(request.tenantContext.tenantId, venueId);
  }

  @Post('invitations')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresVerifiedEmail()
  invite(@Param('venueId') venueId: string, @Body() body: unknown, @Req() request: StaffRequest) {
    return this.staff.invite(
      request.tenantContext.tenantId,
      venueId,
      body,
      request.tenantContext.userId,
    );
  }

  @Delete(':userId')
  @HttpCode(204)
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresVerifiedEmail()
  remove(
    @Param('venueId') venueId: string,
    @Param('userId') userId: string,
    @Req() request: StaffRequest,
  ) {
    return this.staff.remove(
      request.tenantContext.tenantId,
      venueId,
      userId,
      request.tenantContext.userId,
    );
  }

  @Post()
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresVerifiedEmail()
  createAccount(
    @Param('venueId') venueId: string,
    @Body() body: unknown,
    @Req() request: StaffRequest,
  ) {
    return this.staff.createAccount(
      request.tenantContext.tenantId,
      venueId,
      body,
      request.tenantContext.userId,
    );
  }

  @Put(':userId')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresVerifiedEmail()
  assign(
    @Param('venueId') venueId: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Req() request: StaffRequest,
  ) {
    return this.staff.assign(
      request.tenantContext.tenantId,
      venueId,
      userId,
      body,
      request.tenantContext.userId,
    );
  }

  @Post(':userId/suspend')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresVerifiedEmail()
  suspend(
    @Param('venueId') venueId: string,
    @Param('userId') userId: string,
    @Req() request: StaffRequest,
  ) {
    return this.staff.setSuspended(
      request.tenantContext.tenantId,
      venueId,
      userId,
      true,
      request.tenantContext.userId,
    );
  }

  @Post(':userId/resume')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresVerifiedEmail()
  resume(
    @Param('venueId') venueId: string,
    @Param('userId') userId: string,
    @Req() request: StaffRequest,
  ) {
    return this.staff.setSuspended(
      request.tenantContext.tenantId,
      venueId,
      userId,
      false,
      request.tenantContext.userId,
    );
  }
}
