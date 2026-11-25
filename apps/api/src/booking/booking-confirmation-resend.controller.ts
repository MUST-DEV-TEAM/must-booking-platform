import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { BookingConfirmationNotificationService } from '../mail/booking-confirmation-notification.service';
import { AuditLogService } from '../tenancy/audit-log.service';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { TenantScoped } from '../tenancy/tenant-context.decorator';

/** Staff send a booking's confirmation to the guest again, optionally to another address (G-96). */
@Controller('tenants/:tenantId/properties/:propertyId/bookings')
export class BookingConfirmationResendController {
  constructor(
    @Inject(BookingConfirmationNotificationService)
    private readonly confirmations: BookingConfirmationNotificationService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  @Post(':bookingId/resend-confirmation')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.edit')
  @RequiresVerifiedEmail()
  async resend(
    @Req() r: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
    @Param('bookingId') bookingId: string,
    @Body() body: { email?: string } | undefined,
  ) {
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    if (
      email &&
      (email.length > 254 || !/^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(email))
    )
      throw new BadRequestException('Enter a valid email address.');
    const result = await this.confirmations.resendToGuest(
      r.tenantContext,
      bookingId,
      email || undefined,
    );
    if (!result.ok) {
      if (result.code === 'RESEND_LIMIT') throw new HttpException(result.message, 429);
      throw new ConflictException(result.message);
    }
    await this.audit.record({
      tenantId: r.tenantContext.tenantId,
      propertyId: r.tenantContext.propertyId,
      actorUserId: r.tenantContext.userId,
      action: 'booking.confirmation_resent',
      targetType: 'booking',
      targetId: bookingId,
      details: { toAnotherAddress: Boolean(email), sentTo: result.sentTo },
    });
    return { sent: true, sentTo: result.sentTo };
  }
}
