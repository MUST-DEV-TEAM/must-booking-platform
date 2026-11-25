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
  total: string;
  /** For a room of an order: whether the order's one payment (on its first room) can be refunded online. */
  orderOnlineRefundable: boolean | null;
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
        >`SELECT b.id,b.external_reference AS reference,b.status::text,b.version,b.starts_on::text AS "startsOn",b.ends_on::text AS "endsOn",rt.name AS room,rp.currency,b.external_booking_id AS external,b.cancellation_terms AS terms,b.order_reference AS "orderReference",b.total_amount::text AS total,(CASE WHEN b.order_reference IS NULL THEN NULL ELSE (SELECT count(*) FILTER (WHERE kind='CHARGE' AND status IN ('PAID','succeeded'))<=1 AND NOT COALESCE(bool_or(kind='CHARGE' AND status IN ('PAID','succeeded') AND provider NOT IN ('pokpay','stripe')),false) FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=(SELECT a.id FROM bookings a WHERE a.tenant_id=b.tenant_id AND a.property_id=b.property_id AND a.order_reference=b.order_reference ORDER BY a.order_room_number, a.id LIMIT 1)) END) AS "orderOnlineRefundable",((SELECT count(*) FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='CHARGE' AND status IN ('PAID','succeeded'))<=1 AND NOT EXISTS(SELECT 1 FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='CHARGE' AND status IN ('PAID','succeeded') AND provider NOT IN ('pokpay','stripe'))) AS "onlineRefundable",COALESCE((SELECT sum(amount) FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='CHARGE' AND status IN ('PAID','succeeded')),0)::text AS paid,COALESCE((SELECT sum(amount) FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='REFUND' AND status='REFUNDED'),0)::text AS refunded FROM bookings b JOIN room_types rt ON rt.tenant_id=b.tenant_id AND rt.property_id=b.property_id AND rt.id=b.room_type_id JOIN rate_plans rp ON rp.tenant_id=b.tenant_id AND rp.property_id=b.property_id AND rp.id=b.rate_plan_id WHERE b.tenant_id=${scope.tenantId}::uuid AND b.property_id=${scope.propertyId}::uuid AND b.id=${id}::uuid AND b.guest_session_id=${session}::uuid`,
    );
    if (!rows[0]) throw new NotFoundException('Booking not found.');
    return rows[0];
  }
  /** `room`: the guest cancels only this room of a multi-room order (own policy, own share of the payment). */
  private policyAllows(row: Row, room = false) {
    return (
      row.status === 'CONFIRMED' &&
      (!row.orderReference || (room && !row.external && row.orderOnlineRefundable === true)) &&
      !!row.terms &&
      row.terms.arrivalDate === row.startsOn &&
      Date.now() <= Date.parse(row.terms.cutoffAt)
    );
  }
  private async moneyAllows(scope: Scope, row: Row) {
    if (new Prisma.Decimal(row.paid).gt(0) && !row.onlineRefundable) return false;
    if (!row.external) return true;
    const saved = await this.financial.read(scope, row.id);
    if (saved.status === 'NOT_CONNECTED') return true;
    // Retry only financial reads, never cancellation or refund commands. A concurrent
    // booking update can invalidate an otherwise healthy financial snapshot.
    let data;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        data = await this.financial.refresh(scope, row.id);
        if (
          data &&
          (data.bookingVersion !== row.version || Date.now() - Date.parse(data.fetchedAt) > 60000)
        )
          throw new ConflictException(
            'Your booking changed. Reload its details before confirming.',
          );
        break;
      } catch (error) {
        if (!(error instanceof ConflictException) || attempt === 1) throw error;
      }
    }
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
      identity = this.identity(scope, id, token);
    let row = await this.booking(scope, id, identity.guestSessionId);
    // Read the money position fresh, as the cancel action does, so the preview never says "not automatic"
    // only because the saved Clock snapshot is older than a minute.
    let automaticAllowed = false;
    let financialChanged = false;
    for (let attempt = 0; attempt < 2 && this.policyAllows(row); attempt++) {
      try {
        automaticAllowed = await this.moneyAllows(scope, row);
        break;
      } catch (error) {
        financialChanged = error instanceof ConflictException;
        if (!financialChanged || attempt === 1) break;
        row = await this.booking(scope, id, identity.guestSessionId);
      }
    }
    const position =
      this.policyAllows(row) && !automaticAllowed && row.external && row.onlineRefundable
        ? await this.financial.read(scope, row.id)
        : null;
    const checkingMoney =
      !!position &&
      !('lastError' in position && position.lastError) &&
      position.status !== 'FAILED' &&
      (financialChanged ||
        !position.data ||
        position.data.bookingVersion !== row.version ||
        Date.now() - Date.parse(position.data.fetchedAt) > 60000);
    // What the guest would get back; when the hotel keeps the payment fee back from a refund the guest
    // asks for, that fee is shown separately and is not part of the refund.
    const gross =
      automaticAllowed && row.terms?.autoRefund
        ? Prisma.Decimal.max(0, new Prisma.Decimal(row.paid).minus(row.refunded))
        : null;
    const fee =
      gross && gross.gt(0)
        ? await this.requests
            .guestRefundFee(scope, id, { amount: gross.toFixed(2), currency: row.currency })
            .catch(() => null)
        : null;
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
      // For a room of a multi-room order: the guest can cancel just this room (not on Clock hotels, which need
      // staff review) and gets back this room's share, never more than the order paid.
      inOrder: !!row.orderReference,
      roomCancellation: row.orderReference
        ? {
            automaticAllowed: this.policyAllows(row, true) && !row.external,
            refundAmount:
              this.policyAllows(row, true) && !row.external && row.terms?.autoRefund
                ? row.total
                : null,
          }
        : null,
      policyKnown: !!row.terms && row.terms.arrivalDate === row.startsOn,
      refundAmount: gross ? Prisma.Decimal.max(0, gross.minus(fee?.amount ?? 0)).toFixed(2) : null,
      providerFee: fee?.amount ?? null,
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
      /** 'room' cancels only this room of a multi-room order; the default cancels the whole order. */
      scope?: 'room' | 'order';
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
    const roomOnly = body.scope === 'room' && !!row.orderReference;
    let automaticAllowed = false;
    if (this.policyAllows(row, roomOnly)) {
      try {
        automaticAllowed = await this.moneyAllows(scope, row);
      } catch (error) {
        if (error instanceof ConflictException)
          throw new ConflictException(
            'Your booking changed. Reload its details before confirming.',
          );
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
      ...(roomOnly ? { singleBooking: true } : {}),
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
