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
import { BookingConfirmationNotificationService } from '../mail/booking-confirmation-notification.service';

type GuestBookingRequest = {
  tenantContext: { tenantId: string; propertyId: string };
  guestSessionId: string;
};

@Controller('tenants/:tenantId/properties/:propertyId/public/bookings')
export class PublicBookingController {
  constructor(
    @Inject(LocalPmsProvider) private readonly provider: LocalPmsProvider,
    @Inject(CancellationLinkService) private readonly cancellations: CancellationLinkService,
    @Inject(BookingConfirmationNotificationService)
    private readonly confirmations: BookingConfirmationNotificationService,
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
    // Where the booking's emails go, masked ("a***@icloud.com"), so the page can say "we sent it to ..." (G-96).
    return {
      ...booking,
      emailHint: await this.confirmations.emailHint(request.tenantContext, bookingId),
    };
  }
}
