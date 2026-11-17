import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BookingStatus } from '@must/domain-contracts';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';

import { ManualReviewService } from '../integrations/manual-review.service';
import { PaymentNotificationService } from '../mail/payment-notification.service';
import { reportOperationalFailure } from '../observability/error-tracking';
import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { PaymentRefundService, type RefundConfirmation } from './payment-refund.service';
import { POKPAY_RECONCILIATION_SOURCE } from './pokpay-reconciliation.service';

/**
 * ADR-0043 (saved steps), first flow: a PokPay payment that arrives after its booking stopped awaiting payment.
 *
 * Steps (definition version 1):
 *   PAYMENT_RECORDED  the payment row exists (written by the webhook, slice 40-3a) and the flow is saved with it
 *   REFUNDED          the payment went back to the guest through the existing refund path; the guest gets the
 *                     refund email and staff the "Payment refunded" notice (both from that path)
 *
 * Which bookings are refunded automatically: one whose hold expired, one whose unpaid hold was cancelled, and a
 * second paid order on a booking that is already confirmed. Anything else, or a booking that already has refunds,
 * goes to a person (one review item). Re-confirming an expired booking when the room is still free is the next
 * slice; until then such a booking is refunded.
 */
export const LATE_PAYMENT = 'LATE_PAYMENT';
const DEFINITION_VERSION = 1;
const LEASE_SECONDS = 120;
/** Retry waits after an unexpected error, in minutes: then hourly. */
const RETRY_MINUTES = [1, 2, 5, 15, 30];
/** A money flow still unfinished after this is shown to a person (retries continue). */
const TELL_PERSON_AFTER_MS = 60 * 60_000;
/** Automatic retries stop after this; the flow then waits for a person. */
const STOP_RETRYING_AFTER_MS = 72 * 60 * 60_000;
const QUEUE = 'booking-flows';
const SCHEDULER = 'booking-flows-every-minute';
const NEEDS_PERSON_MESSAGE =
  'A PokPay payment arrived after this booking stopped awaiting payment. The money is recorded; the booking was not confirmed and it was not refunded automatically. Refund the payment or rebook the guest.';

type Scope = { tenantId: string; propertyId: string };
type FlowContext = {
  orderId: string;
  amount: string;
  currency: string;
  bookingStatusAtPayment: string;
};
type ClaimedFlow = {
  id: string;
  bookingId: string;
  state: string;
  attempts: number;
  createdAt: Date;
  personToldAt: Date | null;
  context: FlowContext;
  leaseToken: string;
};
export type FlowRunOutcome = 'REFUNDED' | 'NEEDS_PERSON' | 'RETRY' | 'NOT_CLAIMED';

@Injectable()
export class LatePaymentFlowService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LatePaymentFlowService.name);
  private connection: ConnectionOptions | undefined;
  private queue: Queue | undefined;
  private worker: Worker | undefined;

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(PaymentRefundService) private readonly refunds: PaymentRefundService,
    @Inject(PaymentNotificationService) private readonly notifications: PaymentNotificationService,
    @Inject(ManualReviewService) private readonly manualReview: ManualReviewService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = this.bullConnection(process.env.REDIS_URL!);
    this.queue = new Queue(QUEUE, { connection: this.connection });
    this.worker = new Worker(QUEUE, () => this.runDue(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('error', (error) =>
      this.logger.error('Booking flow worker error.', error.stack),
    );
    await this.queue.upsertJobScheduler(
      SCHEDULER,
      { every: 60_000 },
      { name: 'run-due-flows', data: {}, opts: { removeOnComplete: true, removeOnFail: 50 } },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /**
   * Saves the flow in the caller's transaction, together with the payment row the caller just wrote. Starting it
   * twice for the same order is impossible (unique on the order id). Returns the flow id when this call saved it.
   */
  async start(
    tx: TenantTransaction,
    scope: Scope,
    input: { bookingId: string } & FlowContext,
  ): Promise<string | null> {
    const context: FlowContext = {
      orderId: input.orderId,
      amount: input.amount,
      currency: input.currency,
      bookingStatusAtPayment: input.bookingStatusAtPayment,
    };
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO booking_flows (tenant_id, property_id, booking_id, kind, definition_version, trigger_key, state, context)
      VALUES (${scope.tenantId}::uuid, ${scope.propertyId}::uuid, ${input.bookingId}::uuid, ${LATE_PAYMENT},
        ${DEFINITION_VERSION}, ${input.orderId}, 'PAYMENT_RECORDED', ${JSON.stringify(context)}::jsonb)
      ON CONFLICT (tenant_id, kind, trigger_key) DO NOTHING
      RETURNING id`;
    const flowId = rows[0]?.id ?? null;
    if (flowId)
      await this.event(
        tx,
        scope,
        flowId,
        'PAYMENT_RECORDED',
        0,
        'DONE',
        { ...context },
        input.orderId,
      );
    return flowId;
  }

  /** The worker: every due flow across hotels, one at a time. */
  async runDue(): Promise<number> {
    const due = await this.database.$queryRaw<Array<Scope & { flowId: string }>>`
      SELECT "tenantId", "propertyId", "flowId" FROM booking_flows_due(50::integer)`;
    for (const flow of due) {
      try {
        await this.run({ tenantId: flow.tenantId, propertyId: flow.propertyId }, flow.flowId);
      } catch (error) {
        reportOperationalFailure(error instanceof Error ? error : new Error(String(error)), {
          component: 'payments',
          operation: 'booking-flow',
          tenantId: flow.tenantId,
          propertyId: flow.propertyId,
        });
      }
    }
    return due.length;
  }

  /** Runs the next step of one flow, if no other runner holds it. Safe to call from the webhook and the worker. */
  async run(scope: Scope, flowId: string): Promise<FlowRunOutcome> {
    const flow = await this.claim(scope, flowId);
    if (!flow) return 'NOT_CLAIMED';
    try {
      return await this.step(scope, flow);
    } catch (error) {
      await this.scheduleRetry(scope, flow, error);
      return 'RETRY';
    }
  }

  private async claim(scope: Scope, flowId: string): Promise<ClaimedFlow | null> {
    const token = randomUUID();
    const rows = await this.database.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<Array<Omit<ClaimedFlow, 'leaseToken'>>>`
        UPDATE booking_flows SET lease_token = ${token}::uuid,
          lease_until = now() + make_interval(secs => ${LEASE_SECONDS}::int), attempts = attempts + 1, updated_at = now()
        WHERE id = ${flowId}::uuid AND tenant_id = ${scope.tenantId}::uuid AND property_id = ${scope.propertyId}::uuid
          AND status = 'RUNNING' AND next_run_at <= now() AND (lease_until IS NULL OR lease_until < now())
        RETURNING id, booking_id::text AS "bookingId", state, attempts, created_at AS "createdAt",
          person_told_at AS "personToldAt", context`,
    );
    return rows[0] ? { ...rows[0], leaseToken: token } : null;
  }

  private async step(scope: Scope, flow: ClaimedFlow): Promise<FlowRunOutcome> {
    if (flow.state !== 'PAYMENT_RECORDED') {
      // A state this version does not know: never guess with money.
      return this.needsPerson(scope, flow, `Unknown flow state ${flow.state}.`);
    }
    let confirmation: RefundConfirmation | null = null;
    const outcome = await this.database.withTenantTransaction(
      scope,
      async (tx): Promise<FlowRunOutcome> => {
        const booking = await tx.$queryRaw<
          Array<{ status: string; otherRefunds: number; firstCharge: string | null }>
        >`
          SELECT b.status::text AS status,
            (SELECT count(*)::int FROM payments r WHERE r.tenant_id = b.tenant_id AND r.property_id = b.property_id
               AND r.booking_id = b.id AND r.kind = 'REFUND') AS "otherRefunds",
            (SELECT c.external_payment_id FROM payments c WHERE c.tenant_id = b.tenant_id AND c.property_id = b.property_id
               AND c.booking_id = b.id AND c.kind = 'CHARGE' AND c.status = 'PAID'
             ORDER BY c.created_at, c.id LIMIT 1) AS "firstCharge"
          FROM bookings b
          WHERE b.tenant_id = ${scope.tenantId}::uuid AND b.property_id = ${scope.propertyId}::uuid
            AND b.id = ${flow.bookingId}::uuid
          FOR UPDATE OF b`;
        const row = booking[0];
        if (!row) return this.needsPersonIn(tx, scope, flow, 'The booking was not found.');
        const secondOrder =
          row.status === BookingStatus.CONFIRMED && row.firstCharge !== flow.context.orderId;
        const refundable =
          row.status === BookingStatus.EXPIRED ||
          row.status === BookingStatus.CANCELLED ||
          secondOrder;
        if (!refundable)
          return this.needsPersonIn(
            tx,
            scope,
            flow,
            `The booking is ${row.status}; a late payment is refunded automatically only for an expired or cancelled booking, or a second payment on a confirmed one.`,
          );
        if (row.otherRefunds > 0)
          return this.needsPersonIn(
            tx,
            scope,
            flow,
            'The booking already has refunds, so the late payment is not refunded automatically.',
          );

        await this.event(tx, scope, flow.id, 'REFUND', flow.attempts, 'STARTED', {});
        const amount = { amount: flow.context.amount, currency: flow.context.currency };
        const refunded = await this.refunds.refundCharge(
          tx,
          scope,
          flow.bookingId,
          {
            provider: 'pokpay',
            externalPaymentId: flow.context.orderId,
            amount: flow.context.amount,
            currency: flow.context.currency,
            chargeCount: 1,
          },
          {
            amount,
            idempotencyKey: `flow:${flow.id}:refund`,
            note: secondOrder
              ? 'A second payment for a booking that was already paid; refunded automatically.'
              : 'Paid after the booking stopped awaiting payment; refunded automatically.',
            reasonCode: secondOrder ? 'duplicate_payment' : 'other',
          },
        );
        if (!refunded.result.ok) {
          // The refund path raises its own review item when the provider's answer is unknown; raise one only if
          // it did not, so a person sees exactly one item.
          const raised = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM manual_review_items
            WHERE tenant_id = ${scope.tenantId}::uuid AND property_id = ${scope.propertyId}::uuid
              AND reference_type = 'booking' AND reference_id = ${flow.bookingId}
              AND status = 'OPEN' AND created_at >= transaction_timestamp() LIMIT 1`;
          return this.needsPersonIn(
            tx,
            scope,
            flow,
            `The automatic refund failed: ${refunded.result.error.message}`,
            !raised[0],
          );
        }
        confirmation = refunded.confirmation;
        const finished = await tx.$executeRaw`
          UPDATE booking_flows SET state = 'REFUNDED', status = 'DONE', finished_at = now(), updated_at = now(),
            last_error = NULL, lease_token = NULL, lease_until = NULL
          WHERE id = ${flow.id}::uuid AND lease_token = ${flow.leaseToken}::uuid`;
        if (finished !== 1)
          throw new Error('The flow lease was lost before the refund could be recorded.');
        // The money is back: the nightly PokPay check's note about this same order ("PokPay shows a completed
        // payment ... but") is no longer true. That check closes its notes only when it can read the order again,
        // which PokPay may refuse for an old order, so the flow closes them here (gap G-31).
        await tx.$executeRaw`
          UPDATE manual_review_items SET status = 'RESOLVED', resolved_at = now(), updated_at = now()
          WHERE tenant_id = ${scope.tenantId}::uuid AND property_id = ${scope.propertyId}::uuid
            AND category = 'PAYMENT_BOOKING_MISMATCH' AND status = 'OPEN'
            AND reference_type = 'booking' AND reference_id = ${flow.bookingId}
            AND context->>'source' = ${POKPAY_RECONCILIATION_SOURCE}
            AND context->>'orderId' = ${flow.context.orderId}`;
        await this.event(
          tx,
          scope,
          flow.id,
          'REFUND',
          flow.attempts,
          'DONE',
          { amount },
          refunded.result.value.id,
        );
        return 'REFUNDED';
      },
      { timeoutMs: 60_000 },
    );
    if (confirmation)
      await this.notifications.sendRefundConfirmationEmailSafely(confirmation, scope);
    return outcome;
  }

  private needsPerson(scope: Scope, flow: ClaimedFlow, reason: string): Promise<FlowRunOutcome> {
    return this.database.withTenantTransaction(scope, (tx) =>
      this.needsPersonIn(tx, scope, flow, reason),
    );
  }

  private async needsPersonIn(
    tx: TenantTransaction,
    scope: Scope,
    flow: ClaimedFlow,
    reason: string,
    raiseItem = true,
  ): Promise<FlowRunOutcome> {
    await tx.$executeRaw`
      UPDATE booking_flows SET status = 'NEEDS_PERSON', last_error = ${reason}, person_told_at = COALESCE(person_told_at, now()),
        updated_at = now(), lease_token = NULL, lease_until = NULL
      WHERE id = ${flow.id}::uuid AND lease_token = ${flow.leaseToken}::uuid`;
    await this.event(tx, scope, flow.id, flow.state, flow.attempts, 'NEEDS_PERSON', { reason });
    if (raiseItem)
      await this.manualReview.recordInTransaction(tx, {
        ...scope,
        category: 'PAYMENT_BOOKING_MISMATCH',
        referenceType: 'booking',
        referenceId: flow.bookingId,
        message: NEEDS_PERSON_MESSAGE,
        context: {
          kind: 'LATE_PAYMENT',
          staffMessage: `${NEEDS_PERSON_MESSAGE} ${reason}`,
          orderId: flow.context.orderId,
          amount: flow.context.amount,
          currency: flow.context.currency,
          bookingStatus: flow.context.bookingStatusAtPayment,
        },
      });
    return 'NEEDS_PERSON';
  }

  /** An unexpected error: try again later with growing waits, tell a person after an hour, stop after 72 hours. */
  private async scheduleRetry(scope: Scope, flow: ClaimedFlow, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const age = Date.now() - new Date(flow.createdAt).getTime();
    if (age >= STOP_RETRYING_AFTER_MS) {
      await this.needsPerson(scope, flow, `Automatic retries stopped after 72 hours: ${message}`);
      return;
    }
    const waitMinutes = RETRY_MINUTES[flow.attempts - 1] ?? 60;
    const jitterSeconds = Math.floor(Math.random() * 20);
    const tellPerson = !flow.personToldAt && age >= TELL_PERSON_AFTER_MS;
    await this.database.withTenantTransaction(scope, async (tx) => {
      await tx.$executeRaw`
        UPDATE booking_flows SET last_error = ${message.slice(0, 500)},
          next_run_at = now() + make_interval(mins => ${waitMinutes}::int, secs => ${jitterSeconds}::int),
          person_told_at = CASE WHEN ${tellPerson} THEN now() ELSE person_told_at END,
          lease_token = NULL, lease_until = NULL, updated_at = now()
        WHERE id = ${flow.id}::uuid AND lease_token = ${flow.leaseToken}::uuid`;
      await this.event(tx, scope, flow.id, flow.state, flow.attempts, 'RETRY', {
        error: message.slice(0, 500),
        waitMinutes,
      });
      if (tellPerson)
        await this.manualReview.recordInTransaction(tx, {
          ...scope,
          category: 'PAYMENT_BOOKING_MISMATCH',
          referenceType: 'booking',
          referenceId: flow.bookingId,
          message: `${NEEDS_PERSON_MESSAGE} The automatic refund has been retrying for over an hour and keeps trying.`,
          context: {
            kind: 'LATE_PAYMENT',
            orderId: flow.context.orderId,
            lastError: message.slice(0, 500),
          },
        });
    });
  }

  private async event(
    tx: TenantTransaction,
    scope: Scope,
    flowId: string,
    step: string,
    attempt: number,
    outcome: 'STARTED' | 'DONE' | 'RETRY' | 'NEEDS_PERSON',
    detail: Record<string, unknown>,
    externalReference: string | null = null,
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO booking_flow_events (tenant_id, property_id, flow_id, step, attempt, outcome, detail, external_reference)
      VALUES (${scope.tenantId}::uuid, ${scope.propertyId}::uuid, ${flowId}::uuid, ${step}, ${attempt}, ${outcome},
        ${JSON.stringify(detail)}::jsonb, ${externalReference})`;
  }

  private bullConnection(redisUrl: string): ConnectionOptions {
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password || undefined,
      tls: url.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null,
    };
  }
}
