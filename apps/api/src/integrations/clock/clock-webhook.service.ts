import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { CredentialCipherService } from '../credential-cipher';
import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { ClockQueueService } from './clock-queue.service';
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

@Injectable()
export class ClockWebhookService {
  private readonly logger = new Logger(ClockWebhookService.name);

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(CredentialCipherService) private readonly cipher: CredentialCipherService,
    @Inject(ClockWebhookVerificationService)
    private readonly verification: ClockWebhookVerificationService,
    @Inject(ClockQueueService) private readonly queues: ClockQueueService,
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

    const inserted = await this.storeEvent(connection, propertyId, envelope);
    if (inserted)
      await this.queues.enqueue('clock.webhooks', 'hydrate-event', {
        tenantId: connection.tenantId,
        propertyId,
        connectionId: connection.connectionId,
        eventId: envelope.MessageId,
      });

    return { status: 200 };
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
  ): Promise<boolean> {
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
        return inserted.length > 0;
      },
    );
  }

  /** Clock's own event payload (inside SNS's Message field) is expected to carry a `type`
   * once real payload shapes are confirmed against a live subscription (Task 14/16) — until
   * then this falls back to the SNS envelope's own Type so nothing is silently unlabeled. */
  private eventTypeOf(envelope: SnsEnvelope): string {
    try {
      const parsed = JSON.parse(envelope.Message) as { type?: unknown };
      if (typeof parsed.type === 'string') return parsed.type;
    } catch {
      // Message wasn't JSON — fall through.
    }
    return envelope.Type;
  }

  private objectIdOf(envelope: SnsEnvelope): string | null {
    try {
      const parsed = JSON.parse(envelope.Message) as { id?: unknown; object_id?: unknown };
      const id = parsed.id ?? parsed.object_id;
      return id === undefined || id === null ? null : String(id);
    } catch {
      return null;
    }
  }
}
