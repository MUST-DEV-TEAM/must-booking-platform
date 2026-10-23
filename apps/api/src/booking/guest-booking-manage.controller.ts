import { Prisma } from '@prisma/client';
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Param,
  Req,
  Headers,
  Header,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { PublicTenantScoped } from '../tenancy/tenant-context.decorator';
import { PublicRateLimitGuard } from '../tenancy/public-rate-limit.guard';
import {
  PublicRateLimit,
  PUBLIC_BOOKING_MUTATION_RATE_LIMIT,
} from '../tenancy/public-rate-limit.decorator';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { CancellationLinkService } from './cancellation-link.service';
import { LocalPmsProvider } from './local-pms.provider';
import { BookingRequestsService } from './booking-requests.service';
import { ClockFinancialService } from '../integrations/clock/clock-financial.service';
type Scope = { tenantId: string; propertyId: string };
type Terms = {
  arrivalDate: string;
  timezone: string;
  cutoffAt: string;
  autoRefund: boolean;
  freeCancellationUntilHours: number;
};
type Row = {
  id: string;
  reference: string;
  status: string;
  version: number;
  startsOn: string;
  endsOn: string;
  room: string;
  currency: string;
  paid: string;
  refunded: string;
  external: string | null;
  terms: Terms | null;
  orderReference: string | null;
  onlineRefundable: boolean;
};
@Controller('tenants/:tenantId/properties/:propertyId/bookings/:bookingId/manage')
@UseGuards(PublicRateLimitGuard)
export class GuestBookingManageController {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(CancellationLinkService) private readonly links: CancellationLinkService,
    @Inject(LocalPmsProvider) private readonly provider: LocalPmsProvider,
    @Inject(BookingRequestsService) private readonly requests: BookingRequestsService,
    @Inject(ClockFinancialService) private readonly financial: ClockFinancialService,
  ) {}
  private identity(scope: Scope, id: string, token: string) {
    return this.links.verify(token, { ...scope, bookingId: id });
  }
  private async booking(scope: Scope, id: string, session: string) {
    const rows = await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<
          Row[]
        >`SELECT b.id,b.external_reference AS reference,b.status::text,b.version,b.starts_on::text AS "startsOn",b.ends_on::text AS "endsOn",rt.name AS room,rp.currency,b.external_booking_id AS external,b.cancellation_terms AS terms,b.order_reference AS "orderReference",((SELECT count(*) FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='CHARGE' AND status IN ('PAID','succeeded'))<=1 AND NOT EXISTS(SELECT 1 FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='CHARGE' AND status IN ('PAID','succeeded') AND provider NOT IN ('pokpay','stripe'))) AS "onlineRefundable",COALESCE((SELECT sum(amount) FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='CHARGE' AND status IN ('PAID','succeeded')),0)::text AS paid,COALESCE((SELECT sum(amount) FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='REFUND' AND status='REFUNDED'),0)::text AS refunded FROM bookings b JOIN room_types rt ON rt.tenant_id=b.tenant_id AND rt.property_id=b.property_id AND rt.id=b.room_type_id JOIN rate_plans rp ON rp.tenant_id=b.tenant_id AND rp.property_id=b.property_id AND rp.id=b.rate_plan_id WHERE b.tenant_id=${scope.tenantId}::uuid AND b.property_id=${scope.propertyId}::uuid AND b.id=${id}::uuid AND b.guest_session_id=${session}::uuid`,
    );
    if (!rows[0]) throw new NotFoundException('Booking not found.');
    return rows[0];
  }
  private policyAllows(row: Row) {
    return (
      row.status === 'CONFIRMED' &&
      !row.orderReference &&
      !!row.terms &&
      row.terms.arrivalDate === row.startsOn &&
      Date.now() <= Date.parse(row.terms.cutoffAt)
    );
  }
  private async moneyAllows(scope: Scope, row: Row, fresh = false) {
    if (new Prisma.Decimal(row.paid).gt(0) && !row.onlineRefundable) return false;
    if (!row.external) return true;
    const saved = await this.financial.read(scope, row.id);
    if (saved.status === 'NOT_CONNECTED') return true;
    const data = fresh ? await this.financial.refresh(scope, row.id) : saved.data;
    return (
      !!data &&
      Date.now() - Date.parse(data.fetchedAt) <= 60000 &&
      data.bookingVersion === row.version &&
      data.balance.currency === row.currency &&
      new Prisma.Decimal(data.paid.amount).eq(row.paid) &&
      new Prisma.Decimal(data.refunded.amount).eq(row.refunded) &&
      new Prisma.Decimal(data.balance.amount).gte(0)
    );
  }
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @PublicRateLimit(PUBLIC_BOOKING_MUTATION_RATE_LIMIT)
  @PublicTenantScoped({ propertyParam: 'propertyId' })
  async preview(
    @Req() req: { tenantContext: Scope },
    @Param('bookingId') id: string,
    @Query('token') token: string,
  ) {
    const scope = req.tenantContext,
      identity = this.identity(scope, id, token),
      row = await this.booking(scope, id, identity.guestSessionId);
    const automaticAllowed = this.policyAllows(row) && (await this.moneyAllows(scope, row));
    const position =
      this.policyAllows(row) && !automaticAllowed && row.external && row.onlineRefundable
        ? await this.financial.read(scope, row.id)
        : null;
    const checkingMoney =
      !!position &&
      !('lastError' in position && position.lastError) &&
      position.status !== 'FAILED' &&
      (!position.data || Date.now() - Date.parse(position.data.fetchedAt) > 60000);
    return {
      checkingMoney,
      reference: row.reference,
      status: row.status,
      version: row.version,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      room: row.room,
      currency: row.currency,
      cutoffAt: row.terms?.cutoffAt ?? null,
      timezone: row.terms?.timezone ?? null,
      automaticAllowed,
      policyKnown: !!row.terms && row.terms.arrivalDate === row.startsOn,
      refundAmount:
        automaticAllowed && row.terms?.autoRefund
          ? Prisma.Decimal.max(0, new Prisma.Decimal(row.paid).minus(row.refunded)).toFixed(2)
          : null,
    };
  }
  @Post()
  @PublicRateLimit(PUBLIC_BOOKING_MUTATION_RATE_LIMIT)
  @PublicTenantScoped({ propertyParam: 'propertyId' })
  async confirm(
    @Req() req: { tenantContext: Scope },
    @Param('bookingId') id: string,
    @Body()
    body: {
      token?: string;
      version?: number;
      details?: string;
      requestRefund?: boolean;
      action?: 'cancel' | 'request';
    },
    @Headers('idempotency-key') key: string,
  ) {
    if (!body || typeof body !== 'object')
      throw new BadRequestException('A cancellation request is required.');
    if (!key?.trim() || key.length > 200)
      throw new BadRequestException('A request key is required.');
    if (
      typeof body.details !== 'string' ||
      body.details.trim().length < 3 ||
      body.details.length > 2000
    )
      throw new BadRequestException('Enter a reason between 3 and 2000 characters.');
    const scope = req.tenantContext,
      identity = this.identity(scope, id, body.token ?? ''),
      row = await this.booking(scope, id, identity.guestSessionId);
    if (row.status === 'CANCELLED')
      return {
        cancelled: true,
        message: 'Your booking is already cancelled. Any refund has a separate confirmation.',
      };
    if (body.version !== row.version)
      throw new ConflictException('Your booking changed. Reload its details before confirming.');
    if (!['cancel', 'request'].includes(body.action ?? ''))
      throw new BadRequestException('Choose cancellation or a staff review request.');
    if (body.action === 'request')
      return this.requests.guestRequest(
        scope,
        id,
        identity.guestSessionId,
        body.details.trim(),
        body.requestRefund === true,
      );
    let automaticAllowed = false;
    if (this.policyAllows(row)) {
      try {
        automaticAllowed = await this.moneyAllows(scope, row, true);
      } catch {
        /* An uncertain financial position requires staff review. */
      }
    }
    if (!automaticAllowed)
      return this.requests.guestRequest(
        scope,
        id,
        identity.guestSessionId,
        body.details.trim(),
        body.requestRefund === true,
      );
    const result = await this.provider.cancelBooking(scope, {
      bookingId: id,
      guestSessionId: identity.guestSessionId,
      expectedVersion: row.version,
      idempotencyKey: 'guest-manage:' + key,
      reason: body.details.trim(),
    });
    if (!result.ok) {
      if (
        ['CANCELLATION_WINDOW_CLOSED', 'CANCELLATION_REQUIRES_REVIEW'].includes(result.error.code)
      )
        return this.requests.guestRequest(
          scope,
          id,
          identity.guestSessionId,
          body.details.trim(),
          body.requestRefund === true,
        );
      throw new ConflictException(result.error.message);
    }
    return {
      cancelled: true,
      message: 'Your booking is cancelled. Any refund will be confirmed separately.',
    };
  }
}
