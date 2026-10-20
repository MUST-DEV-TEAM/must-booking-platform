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
  legacyPolicy: true;
  previewHash: string;
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
};
type Snapshot = { evidence: CancellationEvidence; input: CancellationInput; refundAmount: string };
type RequestRow = {
  id: string;
  bookingId: string;
  requesterId: string;
  status: string;
  version: number;
  executionActorId?: string | null;
  executionNote?: string | null;
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
  evidence: Pick<CancellationEvidence, 'isFree'>,
  choice: string,
) {
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
    c: RequestContext,
    bookingId: string,
  ): Promise<CancellationEvidence> {
    const rows = await tx.$queryRaw<
      Array<
        Omit<
          CancellationEvidence,
          'previewHash' | 'legacyPolicy' | 'penalty' | 'eligible' | 'isFree'
        > & { total: string; orderReference: string | null; evaluatedAt: Date }
      >
    >`
      SELECT b.id AS "bookingId", b.external_reference AS reference, b.version, b.status::text,
        b.order_reference AS "orderReference", rp.name AS "ratePlan", p.timezone, rp.currency,
        b.total_amount::text AS total,
        COALESCE((SELECT concat(provider,' / ',COALESCE(method,'')) FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='CHARGE' AND status IN ('PAID','LATE_AFTER_EXPIRY','succeeded') ORDER BY created_at DESC,id DESC LIMIT 1),b.payment_method::text) AS method,
        ((b.starts_on::timestamp AT TIME ZONE p.timezone) - make_interval(hours =>
          COALESCE(cp.free_cancellation_days_before_arrival*24,rp.free_cancellation_until_hours)))::text AS "cutoffAt",
        CURRENT_TIMESTAMP AS "evaluatedAt",
        COALESCE((SELECT sum(amount) FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='CHARGE' AND status IN ('PAID','LATE_AFTER_EXPIRY','succeeded')),0)::text AS paid,
        COALESCE((SELECT sum(amount) FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='REFUND' AND status='REFUNDED'),0)::text AS "alreadyRefunded"
      FROM bookings b JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id
      JOIN rate_plans rp ON rp.tenant_id=b.tenant_id AND rp.property_id=b.property_id AND rp.id=b.rate_plan_id
      LEFT JOIN cancellation_policies cp ON cp.tenant_id=rp.tenant_id AND cp.property_id=rp.property_id AND cp.id=rp.cancellation_policy_id
      WHERE b.tenant_id=${c.tenantId}::uuid AND b.property_id=${c.propertyId}::uuid AND b.id=${bookingId}::uuid`;
    const row = rows[0];
    if (!row) throw new NotFoundException('Booking not found.');
    if (row.orderReference)
      throw new ConflictException(
        'Order cancellation requires the existing whole-order flow; B1 supports individual reservations.',
      );
    const { total, evaluatedAt, ...base } = row;
    const isFree = withinFreeWindow(row.cutoffAt, evaluatedAt);
    const evidence = {
      ...base,
      isFree,
      cutoffAt: row.cutoffAt ? new Date(row.cutoffAt).toISOString() : null,
      ...refundPreview(row.paid, row.alreadyRefunded, total, isFree),
      legacyPolicy: true as const,
    };
    return {
      ...evidence,
      previewHash: createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),
    };
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
        SELECT q.id,q.booking_id AS "bookingId",q.requester_id AS "requesterId",q.status,q.version,q.payload,q.execution_actor_id AS "executionActorId",q.execution_note AS "executionNote",
          q.created_at AS "createdAt",q.reason_category AS "reasonCategory",q.priority,q.details,
          COALESCE(NULLIF(trim(concat_ws(' ',u.first_name,u.last_name)),''),u.email) AS "requesterName"
        FROM booking_requests q JOIN users u ON u.id=q.requester_id
        WHERE q.tenant_id=${c.tenantId}::uuid AND q.property_id=${c.propertyId}::uuid AND q.status='Pending'
        ORDER BY CASE q.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,q.created_at,q.id`;
      return { items, count: items.length };
    });
  }
  async decide(
    c: RequestContext,
    id: string,
    body: { decision?: string; note?: string; version?: number },
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
        if (body.decision === 'Approved' && q.requesterId === c.userId)
          throw new ForbiddenException('Another reviewer must approve this request.');
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
          outcome = await this.execute(c, q.payload, `b1-request:${q.id}`, q.requesterId);
          if (!outcome.ok) {
            await this.notifications.recordInTransaction(tx, {
              ...c,
              type: 'BOOKING_NEEDS_ATTENTION',
              payload: { bookingId: q.bookingId, requestId: id, cancellationFailed: true },
            });
            return outcome; // Still Pending; no refund if Clock failed.
          }
        }
        await tx.$executeRaw`UPDATE booking_requests SET status=${body.decision},reviewer_id=${c.userId}::uuid,decision_note=${note},decided_at=now(),version=version+1 WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND id=${id}::uuid AND status='Pending'`;
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
          details: { requestId: id, decision: body.decision, note: note, outcome },
        });
        return { ok: true, status: body.decision, outcome };
      },
      { timeoutMs: 90000 },
    );
  }
}
