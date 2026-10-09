import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { CredentialCipherService } from '../credential-cipher';
import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { ManualReviewService } from '../manual-review.service';
import {
  ClockQueueService,
  HYDRATE_EVENT_JOB_OPTIONS,
  type JobReconciliationState,
} from './clock-queue.service';
import { clockHydrateEventJobId } from './clock-queue-names';
import {
  guardedTransitionSql,
  processingSnapshotSql,
  resetForJobRecreationSql,
  type ProcessingSnapshot,
  type ProviderEventStatus,
} from './clock-provider-event-status';
import { ClockWebhookVerificationService } from './clock-webhook-verification.service';
import type { SnsEnvelope } from './clock-webhook-signature';

interface ConnectionLookup {
  tenantId: string;
  connectionId: string;
  provider: string;
  encryptedCredentials: string;
}

export type WebhookOutcome = { status: number };

const MAX_BODY_BYTES = 256 * 1024; // Source brief section 27: body size limits.

// ADR-0031: every automatic (non-operator) transition out of RECEIVED/QUEUED
// is explicit about which prior states it may fire from — FAILED never
// appears here, so nothing automatic can resurrect it.
const NON_TERMINAL: ProviderEventStatus[] = ['RECEIVED', 'QUEUED'];

@Injectable()
export class ClockWebhookService {
  private readonly logger = new Logger(ClockWebhookService.name);

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(CredentialCipherService) private readonly cipher: CredentialCipherService,
    @Inject(ClockWebhookVerificationService)
    private readonly verification: ClockWebhookVerificationService,
    @Inject(ClockQueueService) private readonly queues: ClockQueueService,
    @Inject(ManualReviewService) private readonly manualReview: ManualReviewService,
  ) {}

  async handle(
    webhookPublicId: string,
    rawBody: unknown,
    contentLength: number | undefined,
  ): Promise<WebhookOutcome> {
    if (contentLength !== undefined && contentLength > MAX_BODY_BYTES)
      throw new BadRequestException('Webhook payload is too large.');

    const envelope = this.parseEnvelope(rawBody);
    if (!envelope) throw new BadRequestException('Malformed SNS envelope.');

    const connection = await this.findConnection(webhookPublicId);
    if (!connection) throw new NotFoundException();

    // An AWS SNS signature proves only that *some* SNS topic sent the message.
    // Pin the tenant's configured topic before fetching a signing certificate,
    // otherwise another valid AWS topic could inject provider events if this
    // opaque callback URL were exposed.
    if (!this.isExpectedTopic(connection, envelope.TopicArn)) {
      this.logger.warn(
        `Rejected Clock webhook for connection ${connection.connectionId}: topic mismatch.`,
      );
      throw new BadRequestException('Clock SNS topic is not authorized.');
    }

    const verified = await this.verification.verify(envelope);
    if (!verified.ok) {
      this.logger.warn(
        `Rejected Clock webhook for connection ${connection.connectionId}: ${verified.reason}`,
      );
      throw new BadRequestException(verified.reason);
    }

    // Proves the Message Channels connection is genuinely alive, regardless
    // of envelope Type or what happens downstream — a rejected message never
    // reaches here. Missing-webhook alerting (ClockWebhookHealthService,
    // docs/CLOCK_CERTIFICATION_GAPS_PLAN.md Task B) reads this.
    await this.markConnectionSeen(connection.tenantId, connection.connectionId);

    if (
      envelope.Type === 'SubscriptionConfirmation' ||
      envelope.Type === 'UnsubscribeConfirmation'
    ) {
      if (envelope.SubscribeURL) await this.verification.confirmSubscription(envelope.SubscribeURL);
      return { status: 200 };
    }
    if (envelope.Type !== 'Notification') {
      // Unrecognized SNS envelope type — not an error, just nothing to store or queue.
      return { status: 200 };
    }

    const propertyId = await this.propertyForConnection(
      connection.tenantId,
      connection.connectionId,
    );
    if (!propertyId) {
      this.logger.warn(
        `Clock webhook for connection ${connection.connectionId} has no single enabled property — dropped.`,
      );
      return { status: 200 }; // still ack — Clock must not retry a config problem forever
    }

    const event = await this.storeEvent(connection, propertyId, envelope);

    if (event.status === 'HYDRATED' || event.status === 'IGNORED') {
      // Already fully applied or deliberately not applicable — nothing to do.
      return { status: 200 };
    }
    if (event.status === 'FAILED' || event.status === 'NEEDS_RECONCILIATION') {
      // FAILED: exhausted every BullMQ attempt already. Operator-controlled
      // policy — a flood of duplicate SNS deliveries must not silently turn
      // a deliberate 3-attempts-then-stop exhaustion into unlimited retries
      // through a side channel (ADR-0031). NEEDS_RECONCILIATION: parked for
      // a human to resolve after a completed job's status write never
      // landed; redelivery must not silently reprocess it either. Both are
      // discoverable via a provider_events status query; an explicit
      // operator action is the only way out, not redelivery alone.
      this.logger.warn(
        `Duplicate Clock webhook delivery for event ${envelope.MessageId} (connection ${connection.connectionId}) whose earlier row is ${event.status} — not auto-retried.`,
      );
      return { status: 200 };
    }

    // RECEIVED or QUEUED: reconcile against BullMQ's real job state before
    // deciding what to do. `Queue.add()` with an existing job id does not
    // restart a failed/completed job and can silently no-op — blindly
    // calling enqueue() and then marking QUEUED (the previous bug) could
    // mark a row QUEUED with no live job behind it, stuck forever.
    await this.reconcileAndEnqueue(connection, propertyId, event.id, envelope.MessageId);
    return { status: 200 };
  }

  private async reconcileAndEnqueue(
    connection: ConnectionLookup,
    propertyId: string,
    eventRowId: string,
    eventId: string,
  ): Promise<void> {
    const jobId = clockHydrateEventJobId(connection.connectionId, eventId);
    let state: JobReconciliationState;
    try {
      state = await this.queues.reconcileJob('clock.webhooks', jobId);
    } catch (error) {
      this.logger.error(
        `Failed to inspect hydrate-event job state for provider_events row ${eventRowId} (event ${eventId}): ${(error as Error).message}. Recovery sweep will retry.`,
      );
      return;
    }

    switch (state) {
      case 'missing':
        await this.recreateMissingJob(connection, propertyId, eventRowId, eventId, jobId);
        return;
      case 'in-flight':
        // A real job already exists and hasn't reached a terminal BullMQ
        // state — nothing to do, it's already on track to update the row.
        return;
      case 'completed':
        // The job ran to completion, but this duplicate delivery landed
        // before that outcome's status write reached provider_events (or
        // that write never happened at all). ADR-0031: under the
        // fencing-token design this is now confined to legacy rows / a
        // residual race, not a routine outcome — re-deriving HYDRATED vs
        // IGNORED here without redoing the real classification would be
        // exactly the "idempotent upsert alone proves nothing" shortcut
        // this design avoids. Park it durably instead of guessing or
        // logging forever.
        await this.parkNeedsReconciliation(connection, propertyId, eventRowId, eventId);
        return;
      case 'failed':
        // BullMQ already exhausted every attempt for this job, independent
        // of whether the in-process 'failed' listener ever got to record
        // it (e.g. the process died first). Reconcile the DB to match.
        await this.transitionEventStatus(connection.tenantId, propertyId, eventRowId, 'FAILED');
        return;
    }
  }

  /** Atomic parking (ADR-0031, third correction): the guarded status write
   * and the ManualReviewItem it exists to justify commit together in one
   * tenant-scoped transaction, or not at all — see
   * ClockWorkerService.parkNeedsReconciliation for the full rationale
   * (identical here). Only the actor whose guarded UPDATE actually affects
   * the row creates the item. */
  private async parkNeedsReconciliation(
    connection: ConnectionLookup,
    propertyId: string,
    eventRowId: string,
    eventId: string,
  ): Promise<void> {
    const [sql, params] = guardedTransitionSql({
      tenantId: connection.tenantId,
      eventRowId,
      status: 'NEEDS_RECONCILIATION',
      allowedFrom: NON_TERMINAL,
    });
    const parked = await this.database.withTenantTransaction(
      { tenantId: connection.tenantId, propertyId },
      async (tx) => {
        const affected = await tx.$executeRawUnsafe(sql, ...params);
        if (affected === 0) return false; // another actor already moved it past this guard
        await this.manualReview.recordInTransaction(tx, {
          tenantId: connection.tenantId,
          propertyId,
          connectionId: connection.connectionId,
          category: 'UNKNOWN_RESULT',
          referenceType: 'provider_event',
          referenceId: eventId,
          message: `Clock webhook event ${eventId}'s BullMQ job completed, but its outcome was never recorded on provider_events (row ${eventRowId}). Verify directly against Clock whether the referenced resource was actually applied, then either mark this row HYDRATED (if confirmed applied) or reset it to RECEIVED (if not) so the next recovery sweep reprocesses it.`,
        });
        return true;
      },
    );
    if (parked)
      this.logger.warn(
        `Clock webhook event ${eventId} (row ${eventRowId}) parked NEEDS_RECONCILIATION — completed BullMQ job with no terminal status recorded.`,
      );
  }

  private async transitionEventStatus(
    tenantId: string,
    propertyId: string,
    eventRowId: string,
    status: ProviderEventStatus,
  ): Promise<void> {
    const [sql, params] = guardedTransitionSql({
      tenantId,
      eventRowId,
      status,
      allowedFrom: NON_TERMINAL,
    });
    await this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$executeRawUnsafe(sql, ...params),
    );
  }

  /**
   * Recreates a BullMQ job for a row whose previous job's lineage has
   * disappeared (ADR-0031, fifth corrective round). Recreation is racy — a
   * concurrent sweep tick can be reacting to the same "missing" state at
   * the same time, and the freshly created job's own worker can claim the
   * row before this call finishes — so the ownership reset is a real
   * compare-and-swap against a snapshot taken right before `queue.add()`,
   * never a blind write. See `resetForJobRecreationSql`'s doc comment for
   * the full race analysis (identical rationale to
   * ClockWorkerService.recreateMissingJob).
   */
  private async recreateMissingJob(
    connection: ConnectionLookup,
    propertyId: string,
    eventRowId: string,
    eventId: string,
    jobId: string,
  ): Promise<void> {
    try {
      const snapshot = await this.readProcessingSnapshot(
        connection.tenantId,
        propertyId,
        eventRowId,
      );
      if (!snapshot || (snapshot.status !== 'RECEIVED' && snapshot.status !== 'QUEUED')) {
        // Another actor already finalized, parked, or otherwise moved this
        // row past recreation eligibility since it was read for this
        // request.
        return;
      }
      await this.queues.enqueue(
        'clock.webhooks',
        'hydrate-event',
        {
          tenantId: connection.tenantId,
          propertyId,
          connectionId: connection.connectionId,
          eventId,
        },
        { ...HYDRATE_EVENT_JOB_OPTIONS, jobId },
      );
      const reset = await this.resetForJobRecreation(
        connection.tenantId,
        propertyId,
        eventRowId,
        snapshot,
      );
      if (!reset)
        this.logger.debug(
          `provider_events row ${eventRowId}'s ownership changed concurrently with job recreation — leaving the newer state in place.`,
        );
    } catch (error) {
      // The event already committed durably to provider_events before this
      // call — a failure anywhere in this sequence (the snapshot read, the
      // enqueue call, or the reset write) does not lose it. The row stays
      // RECEIVED/QUEUED and the periodic recovery sweep re-attempts once
      // the underlying issue clears, independent of whether Clock ever
      // redelivers this event again. Acknowledging 200 to Clock is still
      // correct: the durability guarantee is the committed row, not a live
      // queue entry.
      this.logger.error(
        `Failed to recreate hydrate-event job for provider_events row ${eventRowId} (event ${eventId}): ${(error as Error).message}. Recovery sweep will retry.`,
      );
    }
  }

  private async readProcessingSnapshot(
    tenantId: string,
    propertyId: string,
    eventRowId: string,
  ): Promise<ProcessingSnapshot | undefined> {
    const [sql, params] = processingSnapshotSql(tenantId, eventRowId);
    const rows = await this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<ProcessingSnapshot[]>(sql, ...params),
    );
    return rows[0];
  }

  /** Compare-and-swap reset — see `resetForJobRecreationSql`. Returns
   * whether the reset actually landed; false means ownership changed
   * concurrently and this call correctly did nothing. */
  private async resetForJobRecreation(
    tenantId: string,
    propertyId: string,
    eventRowId: string,
    snapshot: ProcessingSnapshot,
  ): Promise<boolean> {
    const [sql, params] = resetForJobRecreationSql({
      tenantId,
      eventRowId,
      allowedFrom: NON_TERMINAL,
      expectedToken: snapshot.processingToken,
      expectedAttempt: snapshot.processingAttempt,
    });
    const affected = await this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$executeRawUnsafe(sql, ...params),
    );
    return affected > 0;
  }

  private parseEnvelope(body: unknown): SnsEnvelope | null {
    if (!body || typeof body !== 'object') return null;
    const candidate = body as Partial<SnsEnvelope>;
    if (
      typeof candidate.Type !== 'string' ||
      typeof candidate.MessageId !== 'string' ||
      typeof candidate.TopicArn !== 'string' ||
      typeof candidate.Message !== 'string' ||
      typeof candidate.Timestamp !== 'string' ||
      typeof candidate.SignatureVersion !== 'string' ||
      typeof candidate.Signature !== 'string' ||
      typeof candidate.SigningCertURL !== 'string'
    )
      return null;
    return candidate as SnsEnvelope;
  }

  private async markConnectionSeen(tenantId: string, connectionId: string): Promise<void> {
    await this.database.withTenantTransaction({ tenantId }, (tx) =>
      tx.$executeRawUnsafe(
        `UPDATE integration_connections SET last_webhook_received_at = CURRENT_TIMESTAMP
         WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        tenantId,
        connectionId,
      ),
    );
  }

  private async findConnection(webhookPublicId: string): Promise<ConnectionLookup | null> {
    const rows = await this.database.withWebhookGatewayLookup(
      (tx) =>
        tx.$queryRaw<ConnectionLookup[]>`
        SELECT tenant_id AS "tenantId", id AS "connectionId", provider::text AS "provider",
          encrypted_credentials AS "encryptedCredentials"
        FROM integration_connections
        WHERE webhook_public_id = ${webhookPublicId}::uuid AND kind = 'PMS'
      `,
    );
    return rows[0] ?? null;
  }

  private isExpectedTopic(connection: ConnectionLookup, receivedTopicArn: string): boolean {
    try {
      const configuredTopicArn = this.cipher
        .decrypt(connection.encryptedCredentials)
        .snsTopicArn?.trim();
      return !!configuredTopicArn && configuredTopicArn === receivedTopicArn;
    } catch {
      // Treat malformed or undecryptable stored credentials as untrusted input;
      // a webhook must never become accepted because its binding cannot be read.
      return false;
    }
  }

  private async propertyForConnection(
    tenantId: string,
    connectionId: string,
  ): Promise<string | null> {
    const rows = await this.database.withWebhookGatewayLookup(
      (tx) =>
        tx.$queryRaw<Array<{ propertyId: string }>>`
        SELECT property_id AS "propertyId" FROM property_integration_connections
        WHERE tenant_id = ${tenantId}::uuid AND connection_id = ${connectionId}::uuid AND enabled = true
        ORDER BY property_id
      `,
    );
    // Basic-milestone simplification: a Clock connection is expected to be
    // enabled on exactly one property. If it's enabled on none or several,
    // there's no unambiguous property to attribute the event to.
    return rows.length === 1 ? rows[0]!.propertyId : null;
  }

  private async storeEvent(
    connection: ConnectionLookup,
    propertyId: string,
    envelope: SnsEnvelope,
  ): Promise<{ id: string; status: ProviderEventStatus }> {
    const payloadHash = createHash('sha256').update(envelope.Message).digest('hex');
    const eventType = this.eventTypeOf(envelope);
    const objectId = this.objectIdOf(envelope);

    return this.database.withTenantTransaction(
      { tenantId: connection.tenantId, propertyId },
      async (tx) => {
        const inserted = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `INSERT INTO provider_events (
           tenant_id, property_id, connection_id, provider, event_id, event_type, object_id,
           payload_hash, raw_payload
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::"IntegrationProvider", $5, $6, $7, $8, $9::jsonb)
         ON CONFLICT (connection_id, event_id) DO NOTHING
         RETURNING id`,
          connection.tenantId,
          propertyId,
          connection.connectionId,
          connection.provider,
          envelope.MessageId,
          eventType,
          objectId,
          payloadHash,
          JSON.stringify(envelope),
        );
        if (inserted[0]) return { id: inserted[0].id, status: 'RECEIVED' as ProviderEventStatus };

        // Duplicate delivery of an event already persisted by an earlier
        // one. Read back its current status so the caller can decide
        // whether it still needs (re)enqueueing.
        const existing = await tx.$queryRawUnsafe<
          Array<{ id: string; status: ProviderEventStatus }>
        >(
          `SELECT id, status::text AS status FROM provider_events
           WHERE connection_id = $1::uuid AND event_id = $2`,
          connection.connectionId,
          envelope.MessageId,
        );
        const row = existing[0];
        if (!row)
          throw new Error(
            `provider_events row for connection ${connection.connectionId} event ${envelope.MessageId} disappeared between conflicting insert and read-back.`,
          );
        return row;
      },
    );
  }

  /** CONFIRMED_IN_SANDBOX 2026-09-03 against a real Empire Beach Resort Message
   * Channels subscription: Clock puts the event name in SNS's own `Subject`
   * field (e.g. `booking_new`, `booking_guests_update`, `folio_update`), not
   * inside `Message`. `Subject` is only present on real `Notification`
   * envelopes (never on SubscriptionConfirmation), so this can't misfire on
   * the confirmation path. Falls back to the old type-in-Message guess, then
   * the bare envelope Type, for anything that doesn't match — nothing is
   * silently unlabeled. */
  private eventTypeOf(envelope: SnsEnvelope): string {
    if (envelope.Subject) return envelope.Subject;
    try {
      const parsed = JSON.parse(envelope.Message) as { type?: unknown };
      if (typeof parsed.type === 'string') return parsed.type;
    } catch {
      // Message wasn't JSON — fall through.
    }
    return envelope.Type;
  }

  /** CONFIRMED_IN_SANDBOX 2026-09-03: `Message` is a single-key JSON object
   * whose key names the resource (`{"booking_id": 38144004}`,
   * `{"folio_id": 76073379}` — real captured examples, not every resource
   * key is known yet). Rather than hardcode every `<resource>_id` key name,
   * take the lone value when exactly one key is present. Falls back to the
   * old `id`/`object_id` guess for anything shaped differently. */
  private objectIdOf(envelope: SnsEnvelope): string | null {
    try {
      const parsed = JSON.parse(envelope.Message) as Record<string, unknown>;
      const values = Object.values(parsed).filter((value) => value !== undefined && value !== null);
      if (values.length === 1) return String(values[0]);
      const id = parsed.id ?? parsed.object_id;
      return id === undefined || id === null ? null : String(id);
    } catch {
      return null;
    }
  }
}
