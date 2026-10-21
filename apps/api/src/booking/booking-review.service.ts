import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { ClockBookingService } from '../integrations/clock/clock-booking.service';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { BOOKING_NEEDS_ATTENTION_STATUSES } from './booking-attention';

const CATEGORY_TEXT: Record<string, string> = {
  UNKNOWN_RESULT:
    'The property system did not confirm this booking, so we cannot be sure it exists there.',
  DUPLICATE: 'The property system may already have a booking that looks the same.',
  MISSING_MAPPING: 'A room or room type of this booking is not matched to the property system.',
  SIMULTANEOUS_CHANGE: 'The booking was changed in two places at once.',
  PAYMENT_BOOKING_MISMATCH: 'The payment and the booking do not agree.',
  UNKNOWN_STATUS: 'The property system reported a status we do not recognise.',
  SCHEMA_MISMATCH: 'The property system answered in a way we could not read.',
};

/** What hotel staff may see and do about a booking that needs review (technical evidence stays in platform admin). */
@Injectable()
export class BookingReviewService {
  private readonly lastCheck = new Map<string, number>();

  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(ClockBookingService) private readonly clock: ClockBookingService,
  ) {}

  async get(tenantId: string, propertyId: string, bookingId: string) {
    return this.db.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const booking = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status::text AS status FROM bookings
        WHERE id = ${bookingId}::uuid AND tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid`;
      if (!booking[0]) throw new NotFoundException('Booking not found.');
      const items = await tx.$queryRaw<
        Array<{ category: string; createdAt: Date; clockDepositAdjustment: boolean }>
      >`
        SELECT category::text AS category, created_at AS "createdAt",
          (category = 'PAYMENT_BOOKING_MISMATCH' AND context->>'message' =
            'Clock refund payment was posted. In Clock, issue the Deposit Adjustment to create the required correction document.') AS "clockDepositAdjustment"
          FROM manual_review_items
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND status = 'OPEN' AND reference_type = 'booking' AND reference_id = ${bookingId}
        ORDER BY created_at DESC LIMIT 5`;
      const pms = await tx.$queryRaw<Array<{ provider: string }>>`
        SELECT c.provider::text AS provider FROM property_integration_connections pc
        JOIN integration_connections c ON c.tenant_id = pc.tenant_id AND c.id = pc.connection_id
        WHERE pc.tenant_id = ${tenantId}::uuid AND pc.property_id = ${propertyId}::uuid
          AND pc.enabled AND pc.kind = 'PMS'`;
      const needsReview =
        items.length > 0 ||
        (BOOKING_NEEDS_ATTENTION_STATUSES as readonly string[]).includes(booking[0].status);
      return {
        needsReview,
        canCheck: pms[0]?.provider === 'CLOCK_PMS',
        reasons: items.map((item) => ({
          text: item.clockDepositAdjustment
            ? 'Refund posted to Clock. Complete the Deposit Adjustment document in Clock.'
            : (CATEGORY_TEXT[item.category] ?? 'The booking needs a manual review.'),
          openedAt: item.createdAt,
        })),
      };
    });
  }

  async check(tenantId: string, propertyId: string, bookingId: string) {
    const review = await this.get(tenantId, propertyId, bookingId);
    if (!review.canCheck)
      return {
        result: 'unavailable' as const,
        message: 'No external property system is connected.',
      };
    const key = `${tenantId}:${propertyId}:${bookingId}`;
    const now = Date.now();
    if (now - (this.lastCheck.get(key) ?? 0) < 15_000)
      throw new HttpException(
        'Please wait a few seconds before checking again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    this.lastCheck.set(key, now);
    return this.clock.checkRemoteBooking({ tenantId, propertyId }, bookingId);
  }
}

type Request = { tenantContext: { tenantId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/bookings/:bookingId/review')
export class BookingReviewController {
  constructor(@Inject(BookingReviewService) private readonly review: BookingReviewService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.view')
  get(@Param('bookingId') bookingId: string, @Req() r: Request) {
    return this.review.get(r.tenantContext.tenantId, r.tenantContext.propertyId, bookingId);
  }

  @Post('check')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.edit')
  @RequiresVerifiedEmail()
  check(@Param('bookingId') bookingId: string, @Req() r: Request) {
    return this.review.check(r.tenantContext.tenantId, r.tenantContext.propertyId, bookingId);
  }
}
