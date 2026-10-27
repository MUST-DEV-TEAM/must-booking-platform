import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Query,
  Req,
} from '@nestjs/common';

import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { NOTIFICATION_UUID } from '../tenancy/notification-registry';
import { Role, Roles } from '../tenancy/roles.decorator';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { GuestReviewService } from './guest-review.service';

type Request = { tenantContext: { tenantId: string; propertyId: string; userId: string } };

/** What staff see of the reviews guests left: the report, and the review on one reservation. */
@Controller('tenants/:tenantId/properties/:propertyId/guest-reviews')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
export class GuestReviewReportController {
  constructor(@Inject(GuestReviewService) private readonly reviews: GuestReviewService) {}

  /** `days` limits it to reviews left in the last N days; leave it out for all time. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @RequiresCapability('reports.view')
  @TenantScoped({ propertyParam: 'propertyId' })
  report(@Req() req: Request, @Query('days') days?: string) {
    const period = days === undefined || days === 'all' ? null : Number(days);
    if (period !== null && (!Number.isInteger(period) || period < 1 || period > 3650))
      throw new BadRequestException('Choose a number of days, or all.');
    return this.reviews.report(req.tenantContext, period);
  }

  @Get('booking/:bookingId')
  @Header('Cache-Control', 'private, no-store')
  @RequiresCapability('bookings.view')
  @TenantScoped({ propertyParam: 'propertyId' })
  async forBooking(@Req() req: Request, @Param('bookingId') bookingId: string) {
    if (!NOTIFICATION_UUID.test(bookingId))
      throw new BadRequestException('Choose a valid reservation.');
    return { review: await this.reviews.forBooking(req.tenantContext, bookingId) };
  }
}
