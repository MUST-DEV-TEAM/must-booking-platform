import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { PublicTenantScoped } from '../tenancy/tenant-context.decorator';
import { PublicRateLimitGuard } from '../tenancy/public-rate-limit.guard';
import { PUBLIC_READ_RATE_LIMIT, PublicRateLimit } from '../tenancy/public-rate-limit.decorator';
import { CancellationLinkService } from './cancellation-link.service';
import { LocalPmsProvider } from './local-pms.provider';

type GuestBookingRequest = {
  tenantContext: { tenantId: string; propertyId: string };
  guestSessionId: string;
};

@Controller('tenants/:tenantId/properties/:propertyId/public/bookings')
export class PublicBookingController {
  constructor(
    @Inject(LocalPmsProvider) private readonly provider: LocalPmsProvider,
    @Inject(CancellationLinkService) private readonly cancellations: CancellationLinkService,
  ) {}

  @Get(':bookingId')
  @PublicTenantScoped({ propertyParam: 'propertyId' })
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(PUBLIC_READ_RATE_LIMIT)
  async get(
    @Param('bookingId') bookingId: string,
    @Query('cancellationToken') cancellationToken: string | undefined,
    @Req() request: GuestBookingRequest,
  ) {
    // A guest opening their emailed cancellation link has no must_guest_session
    // cookie matching the booking (new browser/device) — the signed token proves
    // ownership instead, the same way DELETE /bookings/:id already does it.
    const guestSessionId = cancellationToken
      ? this.cancellations.verify(cancellationToken, {
          tenantId: request.tenantContext.tenantId,
          propertyId: request.tenantContext.propertyId,
          bookingId,
        }).guestSessionId
      : request.guestSessionId;
    const booking = await this.provider.getGuestBooking(
      request.tenantContext,
      bookingId,
      guestSessionId,
    );
    if (!booking) throw new NotFoundException('Booking was not found.');
    return booking;
  }
}
