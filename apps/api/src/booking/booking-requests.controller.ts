import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import {
  BookingRequestsService,
  type CancellationInput,
  type RequestContext,
} from './booking-requests.service';
@Controller('tenants/:tenantId/properties/:propertyId')
export class BookingRequestsController {
  constructor(@Inject(BookingRequestsService) private readonly requests: BookingRequestsService) {}
  @Get('bookings/:bookingId/cancellation-preview')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.view')
  preview(@Req() r: { tenantContext: RequestContext }, @Param('bookingId') id: string) {
    return this.requests.preview(r.tenantContext, id);
  }
  @Post('bookings/:bookingId/cancellation')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.view')
  @RequiresVerifiedEmail()
  submit(
    @Req() r: { tenantContext: RequestContext },
    @Param('bookingId') id: string,
    @Body() input: CancellationInput,
  ) {
    return this.requests.submit(r.tenantContext, id, input);
  }
  @Get('requests')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('requests.review')
  list(@Req() r: { tenantContext: RequestContext }) {
    return this.requests.list(r.tenantContext);
  }
  @Post('requests/:id/decision')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('requests.review')
  @RequiresVerifiedEmail()
  decide(
    @Req() r: { tenantContext: RequestContext },
    @Param('id') id: string,
    @Body() body: { decision?: string; note?: string; version?: number },
  ) {
    return this.requests.decide(r.tenantContext, id, body);
  }
}
