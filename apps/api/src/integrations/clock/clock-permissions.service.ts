import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';

import { IntegrationConnectionsService } from '../integration-connections.service';
import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { CLOCK_API_CATALOG, type ClockCatalogEntry } from './clock-api-catalog';
import { describeClockRequest, touchesMoney } from './clock-api-descriptions';
import { CLOCK_API_SAFETY } from './clock-api-safety';
import { parseClockCredentials } from './clock-credentials';
import { extractMissingRight } from './clock-error-classification';
import {
  ClockHttpClient,
  ClockHttpError,
  type ClockConnectionCredentials,
} from './clock-http-client';
import { ClockRateLimiterService } from './clock-rate-limiter';

/**
 * allowed   Clock accepted the request (or only complained about its content): the right is there.
 * missing   Clock answered "The User doesn't have <right>".
 * error     Clock could not be reached or rejected the credentials, so nothing is known yet.
 * untested  Not read on purpose (it would change data, or is a very large list).
 * pending   Not checked yet.
 */
export type ClockPermissionStatus = 'allowed' | 'missing' | 'error' | 'untested' | 'pending';

export interface ClockPermissionEntry {
  id: string;
  api: string;
  method: string;
  path: string;
  /** What Clock's documentation calls the request. */
  name: string;
  section: string;
  group: string;
  /** What MUST uses it for, when it does. */
  usedFor?: string;
  /** One plain sentence about what the request lets MUST do. */
  description: string;
  /** Moves money or fiscal data. */
  money: boolean;
  /** Whether the check can read it safely. */
  probeable: boolean;
  /**
   * A request that changes data and was not observed to be harmless in the sandbox. It is sent only
   * when the owner chooses to include change rights, and only aimed at a record that cannot exist.
   */
  confirmable: boolean;
  untestedReason?: string;
  /** 'use' when the right is proven by what this connection has already done, not by a test. */
  proof?: 'use';
  status: ClockPermissionStatus;
  /** The right Clock named in its refusal. */
  right?: string;
  /** The right by Clock's usual naming pattern; a guess, used only to help when asking Clock. */
  expectedRight?: string;
  message?: string;
  checkedAt?: string;
}

export interface ClockPermissionReport {
  checkedAt: string | null;
  entries: ClockPermissionEntry[];
  missingRights: string[];
}

type StoredResult = {
  id: string;
  status: 'allowed' | 'missing' | 'error';
  right?: string;
  message?: string;
  checkedAt: string;
};

const USED_BY_MUST: Record<string, string> = {
  'GET pms_api/room_types/': 'Importing room types',
  'GET pms_api/rooms/': 'Importing rooms',
  'GET pms_api/rates/': 'Prices and the rate choice',
  'GET pms_api/rates_availability/': 'Availability calendar and search',
  'GET pms_api/products': 'Prices for a stay',
  'GET pms_api/guests/search': 'Matching guests',
  'GET pms_api/bookings/': 'Reservations and sync',
  'GET pms_api/bookings/:id': 'Reading one reservation',
  'POST pms_api/bookings/': 'Creating reservations',
  'PUT pms_api/bookings/:id': 'Cancelling and changing reservations',
  'GET pms_api/rate_plans/': 'Real rate plans instead of hidden ones (planned)',
  'GET pms_api/rate_plans/:id': 'Real rate plans instead of hidden ones (planned)',
  'GET pms_api/rate_packages/': 'Package rates (planned)',
  'GET base_api/webhook_subscription': 'Live updates from Clock',
  'POST base_api/webhook_subscription': 'Live updates from Clock',
  'GET base_api/folios': 'Payments and folios',
  'POST base_api/folios/:id/credit_items': 'Recording payments',
};

/** Lists that would return far more than a status check needs. */
const LARGE_LISTS = new Set([
  'GET base_api/folios',
  'GET base_api/2020-08-05/charge_logs',
  'GET base_api/2021-03-31/credit_item_logs',
  'GET base_api/folio_ledger',
]);

const MAX_PER_CHECK = 12;

@Injectable()
export class ClockPermissionsService {
  private readonly logger = new Logger(ClockPermissionsService.name);

  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockHttpClient) private readonly client: ClockHttpClient,
    @Inject(ClockRateLimiterService) private readonly rateLimiter: ClockRateLimiterService,
  ) {}

  /** Every known Clock request with what the last check found for it. */
  async report(scope: { tenantId: string; propertyId: string }): Promise<ClockPermissionReport> {
    const rows = await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<Array<{ checkedAt: Date; results: StoredResult[] }>>`
          SELECT checked_at AS "checkedAt", results FROM clock_permission_checks
          WHERE tenant_id = ${scope.tenantId}::uuid AND property_id = ${scope.propertyId}::uuid
        `,
    );
    const row = rows[0];
    return build(
      row?.results ?? [],
      row?.checkedAt.toISOString() ?? null,
      await this.evidence(scope),
    );
  }

  /** What this connection has already done in Clock, which proves rights that cannot be tested safely. */
  private async evidence(scope: {
    tenantId: string;
    propertyId: string;
  }): Promise<Record<string, string>> {
    const rows = await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<Array<{ created: number; events: number }>>`
          SELECT
            (SELECT COUNT(*) FROM bookings WHERE tenant_id = ${scope.tenantId}::uuid
              AND property_id = ${scope.propertyId}::uuid AND external_booking_id IS NOT NULL)::int AS created,
            (SELECT COUNT(*) FROM provider_events WHERE tenant_id = ${scope.tenantId}::uuid
              AND property_id = ${scope.propertyId}::uuid)::int AS events
        `,
    );
    const { created = 0, events = 0 } = rows[0] ?? {};
    const proof: Record<string, string> = {};
    if (created > 0)
      proof['POST pms_api/bookings/'] =
        `Proven by use: ${created} reservation${created === 1 ? ' was' : 's were'} created in Clock through this connection.`;
    if (events > 0) {
      const text = `Proven by use: ${events} update${events === 1 ? ' was' : 's were'} received from Clock.`;
      proof['POST base_api/webhook_subscription'] = text;
    }
    return proof;
  }

  /**
   * Tests the given requests (at most 12 at a time) with harmless reads and stores what Clock said.
   * Anything that would change data is never sent.
   */
  async check(
    scope: { tenantId: string; propertyId: string },
    userId: string | null,
    ids: string[],
    includeChanges = false,
  ): Promise<ClockPermissionReport> {
    const wanted = new Set(ids);
    const entries = decorate(CLOCK_API_CATALOG).filter(
      (entry) => wanted.has(entry.id) && (entry.probeable || (entry.confirmable && includeChanges)),
    );
    if (entries.length === 0) throw new BadRequestException('Nothing to check.');
    if (entries.length > MAX_PER_CHECK)
      throw new BadRequestException(`Check at most ${MAX_PER_CHECK} requests at a time.`);

    const connection = await this.connections.activePmsConnectionCredentials(
      scope.tenantId,
      scope.propertyId,
    );
    if (!connection || connection.provider !== 'CLOCK_PMS')
      throw new BadRequestException('This property has no active Clock PMS connection.');
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) throw new BadRequestException(parsed.message);

    const fresh: StoredResult[] = [];
    for (const entry of entries) fresh.push(await this.probe(parsed.value, entry));

    const checkedAt = new Date();
    const merged = await this.db.withTenantTransaction(scope, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ results: StoredResult[] }>>`
        SELECT results FROM clock_permission_checks
        WHERE tenant_id = ${scope.tenantId}::uuid AND property_id = ${scope.propertyId}::uuid
        FOR UPDATE
      `;
      const byId = new Map<string, StoredResult>();
      for (const result of rows[0]?.results ?? []) if (result.id) byId.set(result.id, result);
      for (const result of fresh) byId.set(result.id, result);
      const all = Array.from(byId.values());
      await tx.$executeRaw`
        INSERT INTO clock_permission_checks (tenant_id, property_id, checked_at, checked_by, results)
        VALUES (${scope.tenantId}::uuid, ${scope.propertyId}::uuid, ${checkedAt}, ${userId}::uuid,
                ${JSON.stringify(all)}::jsonb)
        ON CONFLICT (tenant_id, property_id) DO UPDATE
        SET checked_at = EXCLUDED.checked_at, checked_by = EXCLUDED.checked_by, results = EXCLUDED.results
      `;
      return all;
    });
    const missing = fresh.filter((result) => result.status === 'missing');
    if (missing.length > 0)
      this.logger.warn(
        `Clock rights missing for property ${scope.propertyId}: ${missing
          .map((result) => result.right ?? result.id)
          .join(', ')}`,
      );
    return build(merged, checkedAt.toISOString(), await this.evidence(scope));
  }

  private async probe(
    credentials: ClockConnectionCredentials,
    entry: ClockPermissionEntry,
  ): Promise<StoredResult> {
    const checkedAt = new Date().toISOString();
    const path = entry.path.replace(/:id/g, '0').replace(/:date/g, '2030-01-01');
    let lastMessage = '';
    // A busy or briefly unavailable Clock is retried before giving up, so a result is a real answer.
    // A request that changes data is sent once and never repeated.
    const attempts = entry.method === 'GET' ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(600 * attempt);
      for (let wait = 0; ; wait++) {
        const limit = await this.rateLimiter.consume(credentials.apiUser);
        if (limit.allowed) break;
        if (wait >= 7)
          return { id: entry.id, status: 'error', message: 'Clock was busy.', checkedAt };
        await sleep(Math.min(1000, Math.max(100, limit.retryAfterSeconds * 1000)));
      }
      try {
        const response = await this.client.request(credentials, {
          api: entry.api as 'pms_api' | 'base_api',
          method: entry.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
          path,
          // A request that changes data is aimed at a record that cannot exist (id 0) with an empty
          // body, so Clock answers after checking the right and never changes anything.
          ...(entry.method === 'GET' ? {} : { body: {} }),
          ...(entry.method === 'GET' && LARGE_LISTS.has(entry.id) ? { query: { id: '0' } } : {}),
          timeoutMs: 15_000,
        });
        const status = response.status;
        const message = errorText(response.body);
        if (status === 403) {
          const right = extractMissingRight(message);
          return {
            id: entry.id,
            status: 'missing',
            ...(right ? { right } : {}),
            message,
            checkedAt,
          };
        }
        if (status === 401)
          return {
            id: entry.id,
            status: 'error',
            message: 'Clock rejected the credentials.',
            checkedAt,
          };
        if (status >= 200 && status < 300 && entry.method !== 'GET') {
          // The test record cannot exist, so a success means the request did something unexpected.
          this.logger.error(`Clock accepted a test request that should not succeed: ${entry.id}`);
          return {
            id: entry.id,
            status: 'error',
            message:
              'UNEXPECTED SUCCESS: Clock accepted a test request. Do not run write tests again; tell MUST support.',
            checkedAt,
          };
        }
        if (
          (status >= 200 && status < 300) ||
          [400, 404, 405, 422].includes(status) ||
          /param is missing|contract/i.test(message)
        )
          return { id: entry.id, status: 'allowed', checkedAt };
        lastMessage = message || `Clock answered ${status}.`;
      } catch (error) {
        if (!(error instanceof ClockHttpError)) throw error;
        lastMessage = error.message;
      }
    }
    return { id: entry.id, status: 'error', message: lastMessage, checkedAt };
  }
}

function build(
  results: StoredResult[],
  checkedAt: string | null,
  evidence: Record<string, string> = {},
): ClockPermissionReport {
  const byId = new Map(results.filter((result) => result.id).map((result) => [result.id, result]));
  const entries = decorate(CLOCK_API_CATALOG).map((entry): ClockPermissionEntry => {
    const stored = byId.get(entry.id);
    if (!entry.probeable && !(entry.confirmable && stored)) {
      const proof = evidence[entry.id];
      return proof
        ? { ...entry, status: 'allowed', proof: 'use', message: proof }
        : { ...entry, status: 'untested' };
    }
    if (!stored) return { ...entry, status: 'pending' };
    return {
      ...entry,
      status: stored.status,
      ...(stored.right ? { right: stored.right } : {}),
      ...(stored.message ? { message: stored.message } : {}),
      checkedAt: stored.checkedAt,
    };
  });
  const missingRights = Array.from(
    new Set(
      entries.flatMap((entry) => (entry.status === 'missing' && entry.right ? [entry.right] : [])),
    ),
  );
  return { checkedAt, entries, missingRights };
}

function decorate(catalog: ClockCatalogEntry[]): ClockPermissionEntry[] {
  return catalog.map((entry) => {
    const id = `${entry.method} ${entry.api}${entry.path}`;
    const readable = entry.api === 'pms_api' || entry.api === 'base_api';
    // A read is tested directly. Anything else (and the very large lists) is sent only when the
    // sandbox calibration showed that Clock rejects it for a record that cannot exist.
    const verdict = CLOCK_API_SAFETY[id]?.verdict;
    const isRead = entry.method === 'GET' && !LARGE_LISTS.has(id);
    const aimsAtRecord = entry.path.includes(':id');
    const confirmable =
      readable && !isRead && verdict === 'unverified' && (aimsAtRecord || entry.method === 'GET');
    const untestedReason = !readable
      ? 'Belongs to another Clock service that is not part of this connection.'
      : isRead || verdict === 'safe'
        ? undefined
        : confirmable
          ? entry.method === 'GET'
            ? 'A very large list: checked only if you include extra tests, asking for a record that cannot exist.'
            : 'Checked only if you include change rights: the test is aimed at a record that cannot exist.'
          : verdict === 'unverified'
            ? 'Clock gives no way to check creating a record without creating one.'
            : verdict === 'unsafe'
              ? 'Clock gives no way to check this without actually doing it.'
              : 'Not verified yet.';
    return {
      id,
      api: entry.api,
      method: entry.method,
      path: readable ? entry.path : entry.path.replace(`/${entry.api}`, ''),
      name: entry.name,
      section: entry.section,
      group: groupOf(entry),
      ...(USED_BY_MUST[id] ? { usedFor: USED_BY_MUST[id] } : {}),
      description: describeClockRequest(entry),
      money: touchesMoney(entry),
      probeable: !untestedReason,
      confirmable,
      ...(untestedReason ? { untestedReason } : {}),
      expectedRight: expectedRight(entry),
      status: 'pending',
    };
  });
}

/** Clock names rights `<api>_<resource>_<action>`, for example pms_api_rate_plans_index. */
function expectedRight(entry: ClockCatalogEntry): string | undefined {
  const segments = entry.path.split('/').filter(Boolean);
  const resourceSegments = segments.filter((segment) => !segment.startsWith(':'));
  const resource = resourceSegments[resourceSegments.length - 1];
  if (!resource || !readableApi(entry.api)) return undefined;
  const single = segments[segments.length - 1]?.startsWith(':') ?? false;
  const action =
    entry.method === 'GET'
      ? single
        ? 'show'
        : 'index'
      : entry.method === 'POST'
        ? 'create'
        : entry.method === 'DELETE'
          ? 'destroy'
          : 'update';
  return `${entry.api}_${resource.replace(/[^a-z0-9_]/gi, '_')}_${action}`;
}

function readableApi(api: string): boolean {
  return api === 'pms_api' || api === 'base_api';
}

function groupOf(entry: ClockCatalogEntry): string {
  const first = entry.path.split('/').filter(Boolean)[0] ?? '';
  if (entry.api === 'pos_api') return 'Point of sale';
  if (entry.api === 'adyen_psp') return 'Payments';
  if (first === 'bookings' || first === 'booking_offers') return 'Reservations';
  if (
    [
      'rates',
      'rate_plans',
      'rate_packages',
      'rates_availability',
      'products',
      'price_boundaries',
      'meals',
      'wbe_config',
      'exchange_rates',
    ].includes(first)
  )
    return 'Rates and prices';
  if (['rooms', 'room_types', 'room_statuses', 'door_keys'].includes(first)) return 'Rooms';
  if (first === 'guests') return 'Guests';
  if (
    [
      'events',
      'meeting_rooms',
      'meeting_room_bookings',
      'meeting_room_availability',
      'caterings',
      'blocks',
      'block_pickups',
      'block_prices',
      'activities',
    ].includes(first)
  )
    return 'Events and groups';
  if (
    [
      'folios',
      'charge_templates',
      'charge_template_availabilities',
      'credit_cards',
      'credit_card_transactions',
      'custom_payment_purchases',
      'payment_terminals',
      'payment_sub_types',
      'revenue_categories',
      'fiscalization',
      'folio_ledger',
      'elavon_token',
      'adyen_v2',
      'closures',
      'document_types',
    ].includes(first) ||
    first.endsWith('charge_logs') ||
    first.endsWith('credit_item_logs')
  )
    return 'Folios and payments';
  if (first === 'webhook_subscription') return 'Live updates';
  if (['users', 'companies'].includes(first)) return 'Users and companies';
  return 'Other';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(body: unknown): string {
  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string')
    return (body as { error: string }).error;
  return typeof body === 'string' ? body.slice(0, 300) : '';
}
