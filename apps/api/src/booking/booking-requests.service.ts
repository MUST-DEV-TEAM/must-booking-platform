import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { CapabilitiesService } from '../tenancy/capabilities.service';
import { NotificationsService } from '../tenancy/notifications.service';
import { AuditLogService } from '../tenancy/audit-log.service';
import { LocalPmsProvider } from './local-pms.provider';
import { PaymentRefundService } from '../payments/payment-refund.service';
import { ManualReviewService } from '../integrations/manual-review.service';
import { NOTIFICATION_UUID } from '../tenancy/notification-registry';

export type RequestContext = { tenantId: string; propertyId: string; userId: string };
export const REQUEST_REASONS = [
  'guest_request',
  'travel_change',
  'medical',
  'hotel_issue',
  'other',
];
export type CancellationEvidence = {
  bookingId: string;
  reference: string;
  version: number;
  status: string;
  ratePlan: string;
  timezone: string;
  cutoffAt: string | null;
  isFree: boolean;
  currency: string;
  paid: string;
  alreadyRefunded: string;
  penalty: string;
  eligible: string;
  method: string;
  legacyPolicy: boolean;
  policySource?: 'MUST' | 'CLOCK_PMS';
  previewHash: string;
  orderReference?: string | null;
};
export type CancellationInput = {
  expectedVersion?: number;
  previewHash?: string;
  reasonCategory?: string;
  priority?: string;
  details?: string;
  refund?: 'eligible' | 'none' | 'custom';
  customAmount?: string;
  notifyGuest?: boolean;
  clockTermsConfirmed?: boolean;
};
type Snapshot = { evidence: CancellationEvidence; input: CancellationInput; refundAmount: string };
type RequestRow = {
  id: string;
  bookingId: string;
  requesterId: string | null;
  status: string;
  version: number;
  executionActorId?: string | null;
  executionNote?: string | null;
  selfApproved: boolean;
  decisionNote?: string | null;
  payload: Snapshot;
};
const money = (n: bigint) => `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`;
export function minor(value: string): bigint {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(value))
    throw new BadRequestException('Invalid money amount.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function withinFreeWindow(cutoff: string | null, now: Date): boolean {
  return cutoff !== null && now.getTime() <= new Date(cutoff).getTime();
}
export function refundPreview(paid: string, refunded: string, total: string, isFree: boolean) {
  const remaining = minor(paid) > minor(refunded) ? minor(paid) - minor(refunded) : 0n;
  const penalty = isFree ? 0n : minor(total);
  return {
    penalty: money(penalty),
    eligible: money(remaining > penalty ? remaining - penalty : 0n),
  };
}
export function needsApproval(
  caps: string[],
  evidence: Pick<CancellationEvidence, 'isFree' | 'policySource'>,
  choice: string,
) {
  if (evidence.policySource === 'CLOCK_PMS')
    return !caps.includes('bookings.cancel') || !caps.includes('payments.refund');
  return !caps.includes('bookings.cancel') || !evidence.isFree || choice === 'custom';
}

@Injectable()
export class BookingRequestsService {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(CapabilitiesService) private readonly caps: CapabilitiesService,
    @Inject(LocalPmsProvider) private readonly provider: LocalPmsProvider,
    @Inject(PaymentRefundService) private readonly refunds: PaymentRefundService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(ManualReviewService) private readonly manualReview: ManualReviewService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}
  private uuid(id: string) {
    if (!NOTIFICATION_UUID.test(id)) throw new BadRequestException('Invalid id.');
  }
  private async require(c: RequestContext, key: string) {
    const caps = await this.caps.effective(c);
    if (!caps.includes(key)) throw new ForbiddenException(`Requires ${key}.`);
    return caps;
  }
  async preview(c: RequestContext, bookingId: string): Promise<CancellationEvidence> {
    this.uuid(bookingId);
    await this.require(c, 'bookings.view');
    return this.db.withTenantTransaction(c, (tx) => this.evidence(tx, c, bookingId));
  }
  private async evidence(
    tx: TenantTransaction,
    c: Pick<RequestContext, 'tenantId' | 'propertyId'>,
    bookingId: string,
  ): Promise<CancellationEvidence> {
    const rows = await tx.$queryRaw<
      Array<
        Omit<
          CancellationEvidence,
          'previewHash' | 'legacyPolicy' | 'penalty' | 'eligible' | 'isFree'
        > & {
          total: string;
          orderReference: string | null;
          evaluatedAt: Date;
          frozenPolicy: boolean;
        }
      >
    >`
      SELECT b.id AS "bookingId", b.external_reference AS reference, b.version, b.status::text,
        CASE WHEN b.cancellation_terms->>'arrivalDate'=b.starts_on::text THEN 'MUST' WHEN b.external_booking_id IS NOT NULL OR EXISTS (
          SELECT 1 FROM property_integration_connections pc JOIN integration_connections c
          ON c.tenant_id=pc.tenant_id AND c.id=pc.connection_id
          WHERE pc.tenant_id=b.tenant_id AND pc.property_id=b.property_id
            AND pc.enabled AND pc.kind='PMS' AND c.provider='CLOCK_PMS'
        ) THEN 'CLOCK_PMS' ELSE 'MUST' END AS "policySource",
        b.order_reference AS "orderReference", rp.name AS "ratePlan", COALESCE(b.cancellation_terms->>'timezone',p.timezone) AS timezone, rp.currency,
        b.total_amount::text AS total,
        COALESCE((SELECT concat(provider,' / ',COALESCE(method,'')) FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='CHARGE' AND status IN ('PAID','LATE_AFTER_EXPIRY','succeeded') ORDER BY created_at DESC,id DESC LIMIT 1),b.payment_method::text) AS method,
        CASE WHEN b.cancellation_terms->>'arrivalDate'=b.starts_on::text THEN b.cancellation_terms->>'cutoffAt' ELSE ((b.starts_on::timestamp AT TIME ZONE p.timezone) - make_interval(hours =>
          COALESCE(cp.free_cancellation_days_before_arrival*24,rp.free_cancellation_until_hours)))::text END AS "cutoffAt",
        CURRENT_TIMESTAMP AS "evaluatedAt", (b.cancellation_terms IS NOT NULL) AS "frozenPolicy",
        COALESCE((SELECT sum(amount) FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='CHARGE' AND status IN ('PAID','LATE_AFTER_EXPIRY','succeeded')),0)::text AS paid,
        COALESCE((SELECT sum(amount) FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='REFUND' AND status='REFUNDED'),0)::text AS "alreadyRefunded"
      FROM bookings b JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id
      JOIN rate_plans rp ON rp.tenant_id=b.tenant_id AND rp.property_id=b.property_id AND rp.id=b.rate_plan_id
      LEFT JOIN cancellation_policies cp ON cp.tenant_id=rp.tenant_id AND cp.property_id=rp.property_id AND cp.id=rp.cancellation_policy_id
      WHERE b.tenant_id=${c.tenantId}::uuid AND b.property_id=${c.propertyId}::uuid AND b.id=${bookingId}::uuid`;
    const row = rows[0];
    if (!row) throw new NotFoundException('Booking not found.');
    const orderRemaining = row.orderReference
      ? await this.orderBalance(tx, c, row.orderReference)
      : null;
    const { total, evaluatedAt, frozenPolicy, ...base } = row;
    const clockTerms = row.policySource === 'CLOCK_PMS';
    const isFree = !clockTerms && withinFreeWindow(row.cutoffAt, evaluatedAt);
    const evidence = {
      ...base,
      isFree,
      cutoffAt: !clockTerms && row.cutoffAt ? new Date(row.cutoffAt).toISOString() : null,
      ...refundPreview(row.paid, row.alreadyRefunded, total, isFree),
      ...(clockTerms ? { penalty: '0.00', eligible: '0.00' } : {}),
      legacyPolicy: !clockTerms && !frozenPolicy,
    };
    if (orderRemaining !== null) {
      const share = isFree ? minor(total) : 0n;
      const eligible = minor(evidence.eligible);
      evidence.eligible = money(
        [share, eligible, orderRemaining].reduce((a, b) => (a < b ? a : b)),
      );
    }
    return {
      ...evidence,
      previewHash: createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),
    };
  }
  /** A booking-owned charge is an explicit split. Do not infer allocations for
   * pooled charges, mixed currencies, or multiple captures the refund path cannot select. */
  private async orderBalance(
    tx: TenantTransaction,
    c: Pick<RequestContext, 'tenantId' | 'propertyId'>,
    reference: string,
  ) {
    const rows = await tx.$queryRaw<
      Array<{
        total: string;
        paid: string;
        refunded: string;
        charges: bigint;
        currency: string;
        currencyMatches: boolean;
      }>
    >`
      SELECT b.total_amount::text AS total,rp.currency,
        COALESCE(sum(p.amount) FILTER(WHERE p.kind='CHARGE' AND p.status IN ('PAID','LATE_AFTER_EXPIRY','succeeded')),0)::text AS paid,
        COALESCE(sum(p.amount) FILTER(WHERE p.kind='REFUND' AND p.status='REFUNDED'),0)::text AS refunded,
        count(p.id) FILTER(WHERE p.kind='CHARGE' AND p.status IN ('PAID','LATE_AFTER_EXPIRY','succeeded')) AS charges,
        COALESCE(bool_and(p.currency=rp.currency),true) AS "currencyMatches"
      FROM bookings b JOIN rate_plans rp ON rp.tenant_id=b.tenant_id AND rp.property_id=b.property_id AND rp.id=b.rate_plan_id
      LEFT JOIN payments p ON p.tenant_id=b.tenant_id AND p.property_id=b.property_id AND p.booking_id=b.id
      WHERE b.tenant_id=${c.tenantId}::uuid AND b.property_id=${c.propertyId}::uuid AND b.order_reference=${reference}
      GROUP BY b.id,rp.currency`;
    if (
      (rows.filter((r) => minor(r.total) > 0n).length > 1 &&
        rows.reduce((n, r) => n + r.charges, 0n) === 1n) ||
      rows.some(
        (r) =>
          r.currency !== rows[0]?.currency ||
          r.charges > 1n ||
          !r.currencyMatches ||
          minor(r.paid) > minor(r.total) ||
          minor(r.refunded) > minor(r.paid),
      )
    )
      throw new ConflictException(
        'We cannot tell how the order payment is split between reservations. Ask finance to review it before cancelling this reservation.',
      );
    return rows.reduce((remaining, r) => remaining + minor(r.paid) - minor(r.refunded), 0n);
  }
  private async canSelfApprove(tx: TenantTransaction, c: RequestContext) {
    const rows = await tx.$queryRaw<{ allowed: boolean }[]>`
      SELECT m.role IN ('OWNER','ADMIN') AND NOT EXISTS (
        SELECT 1 FROM tenant_memberships other JOIN users u ON u.id=other.user_id
        WHERE other.tenant_id=${c.tenantId}::uuid AND other.user_id<>${c.userId}::uuid AND (
          other.role IN ('OWNER','ADMIN') OR (other.role='STAFF' AND EXISTS (
            SELECT 1 FROM property_staff_assignments a
            JOIN capabilities cap ON cap.tenant_id=a.tenant_id AND cap.key='requests.review'
            LEFT JOIN property_role_template_capabilities rtc ON rtc.tenant_id=a.tenant_id AND rtc.property_id=a.property_id AND rtc.role_template_id=a.role_template_id AND rtc.capability_id=cap.id
            LEFT JOIN property_staff_capability_overrides o ON o.tenant_id=a.tenant_id AND o.property_id=a.property_id AND o.user_id=a.user_id AND o.capability_id=cap.id
            WHERE a.tenant_id=${c.tenantId}::uuid AND a.property_id=${c.propertyId}::uuid AND a.user_id=other.user_id
              AND a.suspended_at IS NULL AND COALESCE(o.granted,rtc.capability_id IS NOT NULL)
          ))
        )
      ) AS allowed FROM tenant_memberships m
      WHERE m.tenant_id=${c.tenantId}::uuid AND m.user_id=${c.userId}::uuid`;
    return rows[0]?.allowed === true;
  }
  // Same scoped lock for direct cancellation, request creation, and review. It does not
  // lock booking rows: existing cancellation/refund transactions own those locks.
  private lock(tx: TenantTransaction, c: RequestContext, bookingId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${c.tenantId}:${c.propertyId}:cancel:${bookingId}`},0))`;
  }
  async submit(c: RequestContext, bookingId: string, raw: CancellationInput) {
    this.uuid(bookingId);
    const caps = await this.require(c, 'bookings.view');
    const input = this.input(raw);
    if (input.refund === 'custom' && !caps.includes('payments.refund'))
      throw new ForbiddenException('Requires payments.refund.');
    return this.db.withTenantTransaction(
      c,
      async (tx) => {
        await this.lock(tx, c, bookingId);
        const evidence = await this.evidence(tx, c, bookingId);
        if (
          evidence.version !== input.expectedVersion ||
          evidence.previewHash !== input.previewHash
        )
          throw new ConflictException(
            'Policy, payment or booking changed. Reload the cancellation preview.',
          );
        if (!['PAYMENT_PENDING', 'PMS_CONFIRMATION_PENDING', 'CONFIRMED'].includes(evidence.status))
          throw new ConflictException('This reservation cannot be cancelled.');
        const existing = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM booking_requests WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND booking_id=${bookingId}::uuid AND type='cancellation' AND status='Pending'`;
        if (existing[0]) throw new ConflictException('A cancellation request is already pending.');
        if (
          evidence.policySource === 'CLOCK_PMS' &&
          (input.clockTermsConfirmed !== true || !raw.refund || input.refund === 'eligible')
        )
          throw new BadRequestException(
            'Confirm Clock-managed cancellation terms and explicitly choose no refund or a custom amount.',
          );
        const refundAmount =
          input.refund === 'none'
            ? '0.00'
            : input.refund === 'custom'
              ? money(minor(input.customAmount!))
              : evidence.eligible;
        if (minor(refundAmount) > minor(evidence.paid) - minor(evidence.alreadyRefunded))
          throw new BadRequestException('Refund exceeds the remaining payment.');
        const snapshot: Snapshot = { evidence, input, refundAmount };
        if (!needsApproval(caps, evidence, input.refund!)) {
          return this.execute(c, snapshot, `b1-direct:${bookingId}:${evidence.version}`, c.userId);
        }
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`INSERT INTO booking_requests(tenant_id,property_id,booking_id,requester_id,reason_category,priority,details,payload)
        VALUES(${c.tenantId}::uuid,${c.propertyId}::uuid,${bookingId}::uuid,${c.userId}::uuid,${input.reasonCategory},${input.priority},${input.details},${JSON.stringify(snapshot)}::jsonb) RETURNING id`;
        await this.notifications.recordInTransaction(tx, {
          ...c,
          type: 'CANCELLATION_REQUESTED',
          payload: { bookingId, requestId: rows[0]!.id },
        });
        await this.audit.recordInTransaction(tx, {
          ...c,
          actorUserId: c.userId,
          action: 'request.created',
          targetType: 'booking',
          targetId: bookingId,
          details: { requestId: rows[0]!.id },
        });
        return { ok: true, request: { id: rows[0]!.id, status: 'Pending' } };
      },
      { timeoutMs: 90000 },
    );
  }
  private input(raw: CancellationInput): CancellationInput {
    if (!raw || typeof raw !== 'object') throw new BadRequestException('Invalid cancellation.');
    const input = { ...raw, refund: raw.refund ?? 'eligible', priority: raw.priority ?? 'normal' };
    if (
      !['eligible', 'none', 'custom'].includes(input.refund) ||
      !REQUEST_REASONS.includes(input.reasonCategory ?? '') ||
      !['normal', 'high', 'urgent'].includes(input.priority) ||
      typeof input.details !== 'string' ||
      input.details.trim().length < 3 ||
      input.details.length > 2000 ||
      (input.notifyGuest !== undefined && typeof input.notifyGuest !== 'boolean')
    )
      throw new BadRequestException(
        'Choose a reason, priority, refund and details (3-2000 characters).',
      );
    if (
      input.refund === 'custom' &&
      (typeof input.customAmount !== 'string' || minor(input.customAmount) <= 0n)
    )
      throw new BadRequestException('Enter a positive custom refund.');
    return {
      expectedVersion: input.expectedVersion,
      previewHash: input.previewHash,
      reasonCategory: input.reasonCategory,
      priority: input.priority,
      details: input.details.trim(),
      refund: input.refund,
      customAmount: input.customAmount,
      notifyGuest: input.notifyGuest ?? true,
      clockTermsConfirmed: input.clockTermsConfirmed === true,
    };
  }
  private async execute(c: RequestContext, snapshot: Snapshot, key: string, actorId: string) {
    const { evidence: e, input, refundAmount } = snapshot;
    const result = await this.provider.cancelBooking(c, {
      bookingId: e.bookingId,
      expectedVersion: e.version,
      idempotencyKey: key,
      staffActorId: actorId,
      reason: input.details!,
      skipAutomaticRefund: true,
      ...(e.orderReference ? { singleBooking: true } : {}),
      notifyGuest: input.notifyGuest,
    });
    if (!result.ok) {
      await this.manualReview.record({
        ...c,
        category: 'UNKNOWN_RESULT',
        referenceType: 'booking',
        referenceId: e.bookingId,
        message:
          'Cancellation could not be confirmed. Review the existing provider operation before retrying.',
        context: { cancellationRequest: key, errorCode: result.error.code },
      });
      return result;
    }
    if (minor(refundAmount) === 0n) return result;
    const refund = await this.refunds.manualRefund(c, {
      bookingId: e.bookingId,
      idempotencyKey: `${key}:refund`,
      amount: { amount: refundAmount, currency: e.currency },
      actorUserId: actorId,
      note: `Cancellation: ${input.details}`.slice(0, 500),
    });
    return {
      ...result,
      refundOutcome: refund.ok ? { ok: true } : { ok: false, message: refund.error.message },
    };
  }
  async guestRequest(
    scope: { tenantId: string; propertyId: string },
    bookingId: string,
    guestSessionId: string,
    details: string,
    requestRefund: boolean,
  ) {
    return this.db.withTenantTransaction(scope, async (tx) => {
      const owner = await tx.$queryRaw<
        Array<{ status: string }>
      >`SELECT status::text FROM bookings WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${bookingId}::uuid AND guest_session_id=${guestSessionId}::uuid FOR UPDATE`;
      if (!owner[0]) throw new NotFoundException('Booking not found.');
      if (owner[0].status !== 'CONFIRMED')
        throw new ConflictException(
          'Only an active confirmed booking can be requested for cancellation.',
        );
      const existing = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM booking_requests WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND booking_id=${bookingId}::uuid AND type='cancellation' AND status='Pending'`;
      if (existing[0]) return { requested: true, requestId: existing[0].id };
      const evidence = await this.evidence(tx, scope, bookingId);
      const refundAmount = requestRefund
        ? money(minor(evidence.paid) - minor(evidence.alreadyRefunded))
        : '0.00';
      const input = {
        expectedVersion: evidence.version,
        previewHash: evidence.previewHash,
        reasonCategory: 'guest_request',
        priority: 'normal',
        details,
        refund: requestRefund ? 'custom' : 'none',
        customAmount: refundAmount,
        notifyGuest: true,
        clockTermsConfirmed: false,
      };
      const payload = { evidence, input, refundAmount };
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`INSERT INTO booking_requests(tenant_id,property_id,booking_id,requester_id,guest_session_id,reason_category,priority,details,payload) VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${bookingId}::uuid,NULL,${guestSessionId}::uuid,'guest_request','normal',${details},${JSON.stringify(payload)}::jsonb) RETURNING id`;
      await this.notifications.recordInTransaction(tx, {
        ...scope,
        type: 'CANCELLATION_REQUESTED',
        payload: { bookingId, requestId: rows[0].id, guestRequest: true },
      });
      await this.audit.recordInTransaction(tx, {
        ...scope,
        actorUserId: null,
        action: 'request.guest_created',
        targetType: 'booking',
        targetId: bookingId,
        details: { requestId: rows[0].id, requestRefund },
      });
      return { requested: true, requestId: rows[0].id };
    });
  }
  async list(c: RequestContext) {
    await this.require(c, 'requests.review');
    return this.db.withTenantTransaction(c, async (tx) => {
      const items = await tx.$queryRaw<
        Array<
          RequestRow & {
            createdAt: string;
            requesterName: string;
            reasonCategory: string;
            priority: string;
            details: string;
          }
        >
      >`
        SELECT q.id,q.booking_id AS "bookingId",q.requester_id AS "requesterId",q.status,q.version,q.payload,q.self_approved AS "selfApproved",q.decision_note AS "decisionNote",q.execution_actor_id AS "executionActorId",q.execution_note AS "executionNote",
          q.created_at AS "createdAt",q.reason_category AS "reasonCategory",q.priority,q.details,
          COALESCE(NULLIF(trim(concat_ws(' ',u.first_name,u.last_name)),''),u.email,'Guest (email link)') AS "requesterName"
        FROM booking_requests q LEFT JOIN users u ON u.id=q.requester_id
        WHERE q.tenant_id=${c.tenantId}::uuid AND q.property_id=${c.propertyId}::uuid AND (q.status='Pending' OR q.id IN (SELECT d.id FROM booking_requests d WHERE d.tenant_id=${c.tenantId}::uuid AND d.property_id=${c.propertyId}::uuid AND d.status<>'Pending' ORDER BY d.decided_at DESC,d.id LIMIT 20))
        ORDER BY CASE q.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,q.created_at,q.id`;
      const pending = items.filter((q) => q.status === 'Pending');
      return {
        items: pending,
        count: pending.length,
        decisions: items.filter((q) => q.status !== 'Pending'),
      };
    });
  }
  async decide(
    c: RequestContext,
    id: string,
    body: { decision?: string; note?: string; version?: number; clockTermsConfirmed?: boolean },
  ) {
    this.uuid(id);
    const caps = await this.require(c, 'requests.review');
    if (!body || typeof body !== 'object') throw new BadRequestException('Invalid decision.');
    if (
      !['Approved', 'Rejected', 'Cancelled'].includes(body.decision ?? '') ||
      typeof body.note !== 'string' ||
      !body.note.trim() ||
      body.note.length > 1000
    )
      throw new BadRequestException('A decision and note (1-1000 characters) are required.');
    const note = body.note.trim();
    return this.db.withTenantTransaction(
      c,
      async (tx) => {
        const rows = await tx.$queryRaw<
          RequestRow[]
        >`SELECT id,booking_id AS "bookingId",requester_id AS "requesterId",status,version,payload FROM booking_requests WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND id=${id}::uuid`;
        const q = rows[0];
        if (!q) throw new NotFoundException('Request not found.');
        await this.lock(tx, c, q.bookingId);
        // Re-read after acquiring the shared booking lock (READ COMMITTED).
        const fresh = await tx.$queryRaw<
          RequestRow[]
        >`SELECT status,version,execution_actor_id AS "executionActorId",execution_note AS "executionNote" FROM booking_requests WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND id=${id}::uuid`;
        if (fresh[0]?.status !== 'Pending' || fresh[0]?.version !== body.version)
          throw new ConflictException('This request has already changed.');
        if (
          body.decision === 'Approved' &&
          q.requesterId === null &&
          q.payload.evidence.policySource === 'CLOCK_PMS' &&
          body.clockTermsConfirmed !== true
        )
          throw new ConflictException(
            'Confirm that you reviewed the original cancellation terms before approving this guest request.',
          );
        const selfApproved = body.decision === 'Approved' && q.requesterId === c.userId;
        if (selfApproved && !(await this.canSelfApprove(tx, c)))
          throw new ForbiddenException(
            'Another reviewer must approve this request. Self-approval is limited to the sole active Owner or Admin reviewer.',
          );
        if (
          body.decision === 'Approved' &&
          q.payload.input.refund === 'custom' &&
          !caps.includes('payments.refund')
        )
          throw new ForbiddenException('Custom refunds require payments.refund.');
        const execution = fresh[0];
        if (
          execution.executionActorId &&
          (body.decision !== 'Approved' ||
            execution.executionActorId !== c.userId ||
            execution.executionNote !== note)
        )
          throw new ConflictException(
            'Approval execution has started. The original reviewer must retry with the same note.',
          );
        if (body.decision === 'Approved' && !execution.executionActorId) {
          const current = await this.evidence(tx, c, q.bookingId);
          const frozen = q.payload.evidence;
          if (
            current.version !== frozen.version ||
            current.paid !== frozen.paid ||
            current.alreadyRefunded !== frozen.alreadyRefunded ||
            current.currency !== frozen.currency
          )
            throw new ConflictException(
              'The booking or payments changed since this request. Reject it and create a fresh request.',
            );
        }
        let outcome;
        if (body.decision === 'Approved') {
          // Commit the approval intent before any provider effect; a crashed execution
          // can be resumed but cannot subsequently be rejected or taken by a new reviewer.
          await this.db.withTenantTransaction(
            c,
            (intent) =>
              intent.$executeRaw`UPDATE booking_requests SET execution_actor_id=${c.userId}::uuid,execution_note=${note} WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND id=${id}::uuid AND status='Pending' AND execution_actor_id IS NULL`,
          );
          // Stable actor and command permit recovery if cancellation committed but this
          // decision transaction was interrupted. The actual reviewer is audited below.
          outcome = await this.execute(
            c,
            q.payload,
            `b1-request:${q.id}`,
            q.requesterId ?? c.userId,
          );
          if (!outcome.ok) {
            await this.notifications.recordInTransaction(tx, {
              ...c,
              type: 'BOOKING_NEEDS_ATTENTION',
              payload: { bookingId: q.bookingId, requestId: id, cancellationFailed: true },
            });
            return outcome; // Still Pending; no refund if Clock failed.
          }
        }
        await tx.$executeRaw`UPDATE booking_requests SET status=${body.decision},self_approved=${selfApproved},reviewer_id=${c.userId}::uuid,decision_note=${note},decided_at=now(),version=version+1 WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND id=${id}::uuid AND status='Pending'`;
        await tx.$executeRaw`INSERT INTO notification_resolutions(tenant_id,property_id,notification_id,resolved_by_user_id,note)
        SELECT tenant_id,property_id,id,${c.userId}::uuid,${note} FROM notifications
        WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND type='CANCELLATION_REQUESTED' AND payload->>'requestId'=${id}
        ON CONFLICT DO NOTHING`;
        await this.audit.recordInTransaction(tx, {
          ...c,
          actorUserId: c.userId,
          action: 'request.decided',
          targetType: 'booking',
          targetId: q.bookingId,
          details: { requestId: id, decision: body.decision, selfApproved, note: note, outcome },
        });
        return { ok: true, status: body.decision, selfApproved, outcome };
      },
      { timeoutMs: 90000 },
    );
  }
}
