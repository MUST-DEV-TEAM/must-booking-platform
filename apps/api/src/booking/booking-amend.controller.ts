import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { BookingAmendService } from './booking-amend.service';
type Request = { tenantContext: { tenantId: string; propertyId: string; userId: string } };
@Controller('tenants/:tenantId/properties/:propertyId/bookings')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
@RequiresCapability('bookings.edit')
export class BookingAmendController {
  constructor(@Inject(BookingAmendService) private readonly service: BookingAmendService) {}
  @Get(':bookingId/amend-preview')
  @TenantScoped({ propertyParam: 'propertyId' })
  preview(@Req() r: Request, @Param('bookingId') id: string, @Query() query: unknown) {
    return this.service.preview(r.tenantContext, id, query);
  }
  @Get(':bookingId/amend-calendar')
  @TenantScoped({ propertyParam: 'propertyId' })
  calendar(@Req() r: Request, @Param('bookingId') id: string, @Query() query: unknown) {
    return this.service.calendar(r.tenantContext, id, query);
  }
  @Get(':bookingId/amend-status')
  @TenantScoped({ propertyParam: 'propertyId' })
  status(@Req() r: Request, @Param('bookingId') id: string) {
    return this.service.amendmentStatus(r.tenantContext, id);
  }
  @Post(':bookingId/amend-check')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresVerifiedEmail()
  check(@Req() r: Request, @Param('bookingId') id: string) {
    return this.service.checkAmendment(r.tenantContext, id);
  }
  @Patch(':bookingId/amend')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresVerifiedEmail()
  amend(
    @Req() r: Request,
    @Param('bookingId') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.service.amend(r.tenantContext, id, body, key);
  }
}
