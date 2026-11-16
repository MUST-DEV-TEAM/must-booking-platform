import { Inject, Injectable, Logger } from '@nestjs/common';

import { reportOperationalFailure } from '../../observability/error-tracking';
import { AuditLogService } from '../../tenancy/audit-log.service';
import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { CredentialCipherService } from '../credential-cipher';
import { parseClockCredentials } from './clock-credentials';
import { ClockHttpClient, type ClockConnectionCredentials } from './clock-http-client';

/**
 * enabled               Clock's subscription exists, MUST's topic is pinned and Clock confirmed it.
 * pending_confirmation  Everything was set up and re-sent; Clock has not confirmed yet (it can take a moment).
 * not_allowed           The Clock API user lacks the right to read or create the subscription.
 * not_public            MUST's own address is not a public https address, so Clock could not reach it.
 * endpoint_differs      A subscription exists that points somewhere else. Nothing was changed.
 * failed                Anything else; nothing is half-saved (the credentials are only changed after a check).
 */
export type LiveUpdatesState =
  'enabled' | 'pending_confirmation' | 'not_allowed' | 'not_public' | 'endpoint_differs' | 'failed';
export type LiveUpdatesResult = { state: LiveUpdatesState; message: string };

type Subscription =
  | { kind: 'none' }
  | { kind: 'forbidden' }
  | { kind: 'error'; status: number }
  | { kind: 'found'; arn: string; endpoint: string | null; pending: boolean };

/**
 * MUST's public https origin, or null when Clock could not reach it (not set, plain http, localhost, a bare IP,
 * an internal name). Subscribing from a test run or a developer's machine would point Clock's shared demo
 * account at an address that does not exist, so nothing is created unless this is a real public address.
 */
export function liveUpdatesOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NODE_ENV === 'test') return null;
  const raw = env.WEB_APP_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    !host.includes('.') ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.includes(':')
  )
    return null;
  return url.origin;
}

/** The topic is the subscription ARN without its trailing subscription id: the first six `:` parts. */
export function topicOfSubscription(arn: string): string {
  return arn.split(':').slice(0, 6).join(':');
}

/**
 * Turns on Clock's live updates (webhook) for one Clock connection, the same steps that were done by hand for
 * Empire and Luxury: read the subscription list, create the subscription when there is none, pin the topic in the
 * connection's credentials (MUST rejects every delivery until it is pinned), re-send so AWS asks again, then verify.
 * It can be run again at any time and never deletes or replaces anything.
 */
@Injectable()
export class ClockLiveUpdatesService {
  private readonly logger = new Logger(ClockLiveUpdatesService.name);

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(CredentialCipherService) private readonly cipher: CredentialCipherService,
    @Inject(ClockHttpClient) private readonly client: ClockHttpClient,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  /** Never throws: a connection test must not fail because live updates could not be switched on. */
  async enableSafely(
    tenantId: string,
    connectionId: string,
    actorUserId: string | null,
  ): Promise<LiveUpdatesResult> {
    try {
      return await this.enable(tenantId, connectionId, actorUserId);
    } catch (error) {
      this.logger.error(
        `Live updates for connection ${connectionId} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      reportOperationalFailure(error, {
        component: 'clock',
        operation: 'enable-live-updates',
        tenantId,
      });
      return { state: 'failed', message: 'Live updates could not be switched on. Try again.' };
    }
  }

  async enable(
    tenantId: string,
    connectionId: string,
    actorUserId: string | null,
  ): Promise<LiveUpdatesResult> {
    const origin = liveUpdatesOrigin();
    if (!origin)
      return {
        state: 'not_public',
        message: 'MUST’s public web address is not set up for live updates on this server.',
      };
    const row = await this.load(tenantId, connectionId);
    if (!row || row.provider !== 'CLOCK_PMS')
      return { state: 'failed', message: 'This is not a Clock connection.' };
    const record = this.cipher.decrypt(row.encryptedCredentials);
    const parsed = parseClockCredentials(record);
    if (!parsed.ok) return { state: 'failed', message: parsed.message };
    const credentials = parsed.value;
    const endpoint = new URL(`/clock-webhooks/${row.webhookPublicId}`, origin).toString();

    let subscription = await this.read(credentials);
    if (subscription.kind === 'forbidden') return this.notAllowed();
    if (subscription.kind === 'error')
      return { state: 'failed', message: `Clock answered ${subscription.status}.` };
    if (subscription.kind === 'none') {
      const created = await this.create(credentials, endpoint);
      if (created === 'forbidden') return this.notAllowed();
      if (created !== 'ok')
        return { state: 'failed', message: 'Clock did not accept the new subscription.' };
      subscription = await this.read(credentials);
    }
    if (subscription.kind !== 'found')
      return { state: 'failed', message: 'Clock did not show the subscription after creating it.' };
    if (subscription.endpoint && subscription.endpoint !== endpoint)
      return {
        state: 'endpoint_differs',
        message:
          'Clock already has live updates for this account pointing at another address. Nothing was changed.',
      };

    const topic = topicOfSubscription(subscription.arn);
    const pinNow = record.snsTopicArn?.trim() !== topic;
    if (pinNow) {
      const saved = await this.pin(tenantId, connectionId, actorUserId, row.encryptedCredentials, {
        ...record,
        snsTopicArn: topic,
      });
      if (!saved)
        return {
          state: 'failed',
          message: 'The connection changed while live updates were set up. Try again.',
        };
    }
    // AWS asks for confirmation when the subscription is created, before the topic is pinned, and MUST had to
    // reject it. Sending the creation again makes AWS ask once more, now that the topic is pinned.
    if (pinNow || subscription.pending) await this.create(credentials, endpoint);

    const final = await this.read(credentials);
    const confirmed = final.kind === 'found' && !final.pending;
    return confirmed
      ? { state: 'enabled', message: 'Live updates from Clock are on.' }
      : {
          state: 'pending_confirmation',
          message:
            'Live updates are set up. Clock has not confirmed them yet; check again shortly.',
        };
  }

  private notAllowed(): LiveUpdatesResult {
    return {
      state: 'not_allowed',
      message:
        'The Clock API user may not manage live updates. Ask Clock to grant the webhook subscription right.',
    };
  }

  private async load(tenantId: string, connectionId: string) {
    const rows = await this.database.withTenantTransaction(
      { tenantId },
      (tx) =>
        tx.$queryRaw<
          Array<{ provider: string; encryptedCredentials: string; webhookPublicId: string }>
        >`SELECT provider::text AS provider, encrypted_credentials AS "encryptedCredentials",
          webhook_public_id::text AS "webhookPublicId"
        FROM integration_connections WHERE tenant_id = ${tenantId}::uuid AND id = ${connectionId}::uuid`,
    );
    return rows[0] ?? null;
  }

  private async read(credentials: ClockConnectionCredentials): Promise<Subscription> {
    const response = await this.client.request<Record<string, unknown>>(credentials, {
      api: 'base_api',
      method: 'GET',
      path: '/webhook_subscription',
      timeoutMs: 20_000,
    });
    if (response.status === 401 || response.status === 403) return { kind: 'forbidden' };
    if (response.status === 400 && JSON.stringify(response.body ?? '').includes('not_found'))
      return { kind: 'none' };
    const body = response.body;
    if (response.status >= 200 && response.status < 300 && body && typeof body === 'object') {
      const arn = body.subscription_arn;
      if (typeof arn !== 'string' || !arn) return { kind: 'none' };
      return {
        kind: 'found',
        arn,
        endpoint: typeof body.endpoint === 'string' ? body.endpoint : null,
        pending: body.pending_confirmation === true,
      };
    }
    return { kind: 'error', status: response.status };
  }

  private async create(
    credentials: ClockConnectionCredentials,
    endpoint: string,
  ): Promise<'ok' | 'forbidden' | 'failed'> {
    const response = await this.client.request(credentials, {
      api: 'base_api',
      method: 'POST',
      path: '/webhook_subscription',
      body: { endpoint },
      timeoutMs: 20_000,
    });
    if (response.status === 401 || response.status === 403) return 'forbidden';
    return response.status >= 200 && response.status < 300 ? 'ok' : 'failed';
  }

  /** Saves the pinned topic only if the new credentials decrypt to what was meant and nothing changed meanwhile. */
  private async pin(
    tenantId: string,
    connectionId: string,
    actorUserId: string | null,
    previous: string,
    next: Record<string, string>,
  ): Promise<boolean> {
    const encrypted = this.cipher.encrypt(next);
    const check = this.cipher.decrypt(encrypted);
    if (check.snsTopicArn !== next.snsTopicArn || check.apiKey !== next.apiKey)
      throw new Error('The new credentials did not pass their own check.');
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE integration_connections SET encrypted_credentials = ${encrypted}, updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND id = ${connectionId}::uuid
          AND encrypted_credentials = ${previous}
        RETURNING id`;
      if (!rows[0]) return false;
      await this.audit.recordInTransaction(tx, {
        tenantId,
        actorUserId,
        action: 'integration_connection.live_updates_pinned',
        targetType: 'integration_connection',
        targetId: connectionId,
        details: { topic: next.snsTopicArn },
      });
      return true;
    });
  }
}
