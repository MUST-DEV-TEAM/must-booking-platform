import { ClockBookingHydrationService } from '../integrations/clock/clock-booking-hydration.service';
import { IntegrationConnectionsService } from '../integrations/integration-connections.service';
import { CapabilitiesService } from '../tenancy/capabilities.service';
import { BookingStateMachine } from './booking-state-machine';
import { BookingStatus } from '@must/domain-contracts';
import { Prisma } from '@prisma/client';
import {
  Controller,
  Body,
  BadRequestException,
  ConflictException,
  ForbiddenException,
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

import { AuditLogService } from '../tenancy/audit-log.service';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { ClockBookingService } from '../integrations/clock/clock-booking.service';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
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
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(CapabilitiesService) private readonly capabilities: CapabilitiesService,
    @Inject(ClockBookingHydrationService) private readonly hydration: ClockBookingHydrationService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(BookingStateMachine) private readonly states: BookingStateMachine,
  ) {}

  async get(tenantId: string, propertyId: string, bookingId: string, userId?: string) {
    const grants = userId
      ? await this.capabilities.effective({ tenantId, propertyId, userId })
      : [];
    const canResolve = grants.includes('bookings.edit') && grants.includes('payments.refund');
    return this.db.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const booking = await tx.$queryRaw<Array<{ status: string; dismissed: boolean }>>`
        SELECT b.status::text AS status,EXISTS(SELECT 1 FROM audit_logs a WHERE a.tenant_id=b.tenant_id AND a.property_id=b.property_id AND a.target_type='booking' AND a.target_id=b.id::text AND a.action='booking.attention_dismissed' AND a.details->>'version'=b.version::text AND a.details->>'status'=b.status::text) AS dismissed FROM bookings b
        WHERE id = ${bookingId}::uuid AND tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid`;
      if (!booking[0]) throw new NotFoundException('Booking not found.');
      const items = await tx.$queryRaw<
        Array<{
          category: string;
          createdAt: Date;
          clockDepositAdjustment: boolean;
          operationKey: string | null;
        }>
      >`
        SELECT category::text AS category, created_at AS "createdAt",context->>'operationKey' AS "operationKey",
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
      const pending = await tx.$queryRaw<
        Array<{ key: string }>
      >`SELECT idempotency_key AS key FROM integration_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND aggregate_id=${bookingId}::uuid AND status='PENDING' AND (idempotency_key LIKE 'clock-stay-amend:%' OR idempotency_key LIKE 'clock-room-move:%') ORDER BY created_at LIMIT 1`;
      const pendingChange = pending[0]?.key.startsWith('clock-stay-amend:')
        ? 'stay'
        : pending[0]?.key.startsWith('clock-room-move:')
          ? 'room'
          : null;
      const needsReview =
        !!pendingChange ||
        items.length > 0 ||
        (!booking[0].dismissed &&
          (BOOKING_NEEDS_ATTENTION_STATUSES as readonly string[]).includes(booking[0].status));
      return {
        needsReview,
        canResolve: canResolve && booking[0].status === 'PMS_UNKNOWN_RESULT' && !pendingChange,
        pendingChange,
        canCheck: pms[0]?.provider === 'CLOCK_PMS',
        reasons: items.map((item) => ({
          text: item.operationKey?.startsWith('clock-stay-amend:')
            ? 'The stay change is awaiting confirmation from Clock. Verify the saved change; do not submit it again.'
            : item.operationKey?.startsWith('clock-room-move:')
              ? 'The room move is awaiting confirmation from Clock. Verify the saved move; do not submit it again.'
              : item.clockDepositAdjustment
                ? 'Refund posted to Clock. Complete the Deposit Adjustment document in Clock.'
                : (CATEGORY_TEXT[item.category] ?? 'The booking needs a manual review.'),
          openedAt: item.createdAt,
        })),
      };
    });
  }

  async dismiss(
    scope: { tenantId: string; propertyId: string; userId: string },
    bookingId: string,
    body: Record<string, unknown>,
  ) {
    if (
      typeof body.note !== 'string' ||
      body.note.trim().length < 3 ||
      body.note.trim().length > 300
    )
      throw new BadRequestException('Add a review note of 3-300 characters.');
    const note = body.note.trim();
    return this.db.withTenantTransaction(scope, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ status: string; version: number; paid: string; refunded: string }>
      >`
        SELECT b.status::text AS status,b.version,
          COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.tenant_id=b.tenant_id AND p.property_id=b.property_id AND p.booking_id=b.id AND p.kind='CHARGE' AND p.status IN ('PAID','succeeded')),0)::text AS paid,
          COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.tenant_id=b.tenant_id AND p.property_id=b.property_id AND p.booking_id=b.id AND p.kind='REFUND' AND p.status IN ('REFUNDED','succeeded')),0)::text AS refunded
        FROM bookings b WHERE b.tenant_id=${scope.tenantId}::uuid AND b.property_id=${scope.propertyId}::uuid AND b.id=${bookingId}::uuid FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new NotFoundException('Booking not found.');
      if (
        !['AVAILABILITY_FAILED', 'PMS_REJECTED', 'PAYMENT_FAILED'].includes(row.status) ||
        new Prisma.Decimal(row.paid).gt(row.refunded)
      )
        throw new ConflictException(
          'Check uncertain bookings and settle any money held before closing this issue.',
        );
      await this.audit.recordInTransaction(tx, {
        ...scope,
        actorUserId: scope.userId,
        action: 'booking.attention_dismissed',
        targetType: 'booking',
        targetId: bookingId,
        details: { version: row.version, status: row.status, note },
      });
      return { ok: true };
    });
  }

  async resolve(
    scope: { tenantId: string; propertyId: string; userId: string },
    bookingId: string,
    body: Record<string, unknown>,
  ) {
    const grants = await this.capabilities.effective(scope);
    if (!grants.includes('bookings.edit') || !grants.includes('payments.refund'))
      throw new ForbiddenException(
        'A booking reviewer with refund permission must resolve this issue.',
      );
    if (
      !['link', 'not_created'].includes(String(body.action)) ||
      typeof body.note !== 'string' ||
      body.note.trim().length < 3 ||
      body.note.trim().length > 500
    )
      throw new BadRequestException(
        'Choose a resolution and add a review note of 3-500 characters.',
      );
    const load = (tx: TenantTransaction, lock = false) =>
      tx.$queryRaw(Prisma.sql`SELECT b.status::text AS status,b.version,b.external_booking_id AS "clockId",b.created_at < now()-interval '5 minutes' AS aged,
      EXISTS(SELECT 1 FROM payments p WHERE p.tenant_id=b.tenant_id AND p.property_id=b.property_id AND p.booking_id=b.id) OR EXISTS(SELECT 1 FROM payment_provider_sessions p WHERE p.tenant_id=b.tenant_id AND p.property_id=b.property_id AND p.booking_id=b.id) AS financial,
      EXISTS(SELECT 1 FROM integration_operations o WHERE o.tenant_id=b.tenant_id AND o.property_id=b.property_id AND o.aggregate_id=b.id AND o.status='PENDING' AND o.updated_at>now()-interval '10 minutes') AS active
      FROM bookings b WHERE b.tenant_id=${scope.tenantId}::uuid AND b.property_id=${scope.propertyId}::uuid AND b.id=${bookingId}::uuid ${lock ? Prisma.sql`FOR UPDATE OF b` : Prisma.empty}`) as Promise<
        Array<{
          status: string;
          version: number;
          clockId: string | null;
          aged: boolean;
          financial: boolean;
          active: boolean;
        }>
      >;
    const before = (await this.db.withTenantTransaction(scope, (tx) => load(tx)))[0];
    if (!before) throw new NotFoundException('Booking not found.');
    if (before.status !== 'PMS_UNKNOWN_RESULT' || before.active)
      throw new ConflictException(
        'The booking must have an uncertain result and no active booking operation.',
      );
    const pinned = await this.connections.activePmsConnectionCredentials(
      scope.tenantId,
      scope.propertyId,
    );
    if (pinned?.provider !== 'CLOCK_PMS') throw new ConflictException('Clock is not connected.');
    const check = await this.clock.checkRemoteBooking(scope, bookingId);
    if (check.result === 'unavailable') throw new ConflictException(check.message);
    if (
      body.action === 'not_created' &&
      (check.result !== 'not_found' || !before.aged || before.financial || before.clockId)
    )
      throw new ConflictException(
        'Closing requires a fresh Clock absence check, no payment or checkout, no linked Clock booking and a five-minute safety window.',
      );
    if (body.action === 'link' && check.result !== 'found')
      throw new ConflictException(
        'Clock must identify one exact matching reservation before it can be linked.',
      );
    const connection = await this.connections.activePmsConnectionCredentials(
      scope.tenantId,
      scope.propertyId,
    );
    if (connection?.provider !== 'CLOCK_PMS' || connection.connectionId !== pinned.connectionId)
      throw new ConflictException('This resolution is only available for a connected Clock hotel.');
    await this.db.withTenantTransaction(scope, async (tx) => {
      const binding = await tx.$queryRaw<
        Array<{ connectionId: string }>
      >`SELECT pc.connection_id AS "connectionId" FROM property_integration_connections pc JOIN integration_connections c ON c.tenant_id=pc.tenant_id AND c.id=pc.connection_id WHERE pc.tenant_id=${scope.tenantId}::uuid AND pc.property_id=${scope.propertyId}::uuid AND pc.kind='PMS' AND pc.enabled AND c.status='CONNECTED' AND c.provider='CLOCK_PMS' FOR SHARE OF pc,c`;
      if (binding[0]?.connectionId !== pinned.connectionId)
        throw new ConflictException('The Clock connection changed. Run the check again.');
      const current = (await load(tx, true))[0];
      if (
        !current ||
        current.version !== before.version ||
        current.status !== before.status ||
        current.active ||
        current.clockId !== before.clockId
      )
        throw new ConflictException('The booking changed during review. Run the check again.');
      if (body.action === 'not_created') {
        if (current.financial)
          throw new ConflictException('Payment activity now requires finance review.');
        const status = this.states.transition(
          BookingStatus.PMS_UNKNOWN_RESULT,
          BookingStatus.PMS_REJECTED,
        );
        await tx.$executeRaw`UPDATE bookings SET status=${status}::"BookingStatus",version=version+1,updated_at=now() WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${bookingId}::uuid`;
        await this.audit.recordInTransaction(tx, {
          ...scope,
          actorUserId: scope.userId,
          action: 'booking.attention_dismissed',
          targetType: 'booking',
          targetId: bookingId,
          details: {
            version: current.version + 1,
            status,
            note: body.note,
            resolution: 'CLOCK_ABSENT',
          },
        });
      } else if (check.result === 'found') {
        const other = await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT id FROM bookings WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND external_booking_id=${check.clockBookingId} AND id<>${bookingId}::uuid`;
        if (other.length)
          throw new ConflictException(
            'That Clock reservation is already linked to another local record. Review the duplicate records before proceeding.',
          );
        await tx.$executeRaw`UPDATE bookings SET external_booking_id=${check.clockBookingId},version=version+1,updated_at=now() WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${bookingId}::uuid`;
      }
      await this.audit.recordInTransaction(tx, {
        ...scope,
        actorUserId: scope.userId,
        action:
          body.action === 'not_created'
            ? 'booking.clock_absence_confirmed'
            : 'booking.clock_reference_linked',
        targetType: 'booking',
        targetId: bookingId,
        details: { note: body.note, check },
      });
      if (body.action === 'not_created')
        await tx.$executeRaw`UPDATE manual_review_items SET status='RESOLVED',resolved_at=now(),resolved_by_user_id=${scope.userId}::uuid,updated_at=now() WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND reference_type='booking' AND reference_id=${bookingId} AND category='UNKNOWN_RESULT' AND status='OPEN'`;
    });
    if (check.result === 'found') {
      const hydrated = await this.hydration.hydrateBooking(
        scope.tenantId,
        scope.propertyId,
        connection.connectionId,
        check.clockBookingId,
        undefined,
        { notify: false },
      );
      if (!['created', 'updated'].includes(hydrated.outcome))
        throw new ConflictException(
          'The Clock reference is linked, but synchronization needs attention before this review can close.',
        );
      await this.db.withTenantTransaction(
        scope,
        (tx) =>
          tx.$executeRaw`UPDATE manual_review_items SET status='RESOLVED',resolved_at=now(),resolved_by_user_id=${scope.userId}::uuid,updated_at=now() WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND reference_type='booking' AND reference_id=${bookingId} AND category='UNKNOWN_RESULT' AND status='OPEN'`,
      );
    }
    return { ok: true, resolution: body.action };
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

type Request = { tenantContext: { tenantId: string; propertyId: string; userId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/bookings/:bookingId/review')
export class BookingReviewController {
  constructor(@Inject(BookingReviewService) private readonly review: BookingReviewService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.view')
  get(@Param('bookingId') bookingId: string, @Req() r: Request) {
    return this.review.get(
      r.tenantContext.tenantId,
      r.tenantContext.propertyId,
      bookingId,
      r.tenantContext.userId,
    );
  }

  @Post('resolve')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.edit')
  @RequiresVerifiedEmail()
  resolve(
    @Param('bookingId') id: string,
    @Req() r: Request,
    @Body() body: Record<string, unknown>,
  ) {
    return this.review.resolve(r.tenantContext, id, body ?? {});
  }

  @Post('dismiss')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.edit')
  @RequiresVerifiedEmail()
  dismiss(
    @Param('bookingId') id: string,
    @Req() r: Request,
    @Body() body: Record<string, unknown>,
  ) {
    return this.review.dismiss(r.tenantContext, id, body ?? {});
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
