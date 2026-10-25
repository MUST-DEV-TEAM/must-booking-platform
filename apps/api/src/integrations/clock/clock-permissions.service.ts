import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';

import { IntegrationConnectionsService } from '../integration-connections.service';
import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { parseClockCredentials } from './clock-credentials';
import { extractMissingRight } from './clock-error-classification';
import {
  ClockHttpClient,
  ClockHttpError,
  type ClockApiFamily,
  type ClockConnectionCredentials,
} from './clock-http-client';
import { ClockRateLimiterService } from './clock-rate-limiter';

export type ClockPermissionStatus = 'allowed' | 'missing' | 'unknown';

export interface ClockPermissionResult {
  endpoint: string;
  label: string;
  usedFor: string;
  status: ClockPermissionStatus;
  /** The Clock right the API user lacks, when Clock names it. */
  right?: string;
  message?: string;
}

export interface ClockPermissionReport {
  checkedAt: string | null;
  results: ClockPermissionResult[];
  missingRights: string[];
}

/** Read-only requests only: nothing here creates, changes or cancels anything in Clock. */
const PROBES: Array<{ api: ClockApiFamily; path: string; label: string; usedFor: string }> = [
  { api: 'pms_api', path: '/room_types', label: 'Room types', usedFor: 'Importing room types' },
  { api: 'pms_api', path: '/rooms', label: 'Rooms', usedFor: 'Importing rooms' },
  { api: 'pms_api', path: '/rates/', label: 'Rates', usedFor: 'Prices and the rate choice' },
  {
    api: 'pms_api',
    path: '/rates_availability',
    label: 'Availability',
    usedFor: 'Availability calendar and search',
  },
  { api: 'pms_api', path: '/products', label: 'Live prices', usedFor: 'Prices for a stay' },
  {
    api: 'pms_api',
    path: '/rate_plans/',
    label: 'Rate plans',
    usedFor: 'Real rate plans instead of hidden ones (planned)',
  },
  {
    api: 'pms_api',
    path: '/rate_packages/',
    label: 'Rate packages',
    usedFor: 'Package rates (planned)',
  },
  { api: 'pms_api', path: '/bookings/', label: 'Reservations', usedFor: 'Reservations and sync' },
  { api: 'pms_api', path: '/guests/search', label: 'Guests', usedFor: 'Matching guests' },
  {
    api: 'base_api',
    path: '/webhook_subscription',
    label: 'Webhook subscription',
    usedFor: 'Live updates from Clock',
  },
];

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

  /** The result of the last check, or an empty report when none has been run. */
  async latest(scope: { tenantId: string; propertyId: string }): Promise<ClockPermissionReport> {
    const rows = await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<Array<{ checkedAt: Date; results: ClockPermissionResult[] }>>`
          SELECT checked_at AS "checkedAt", results FROM clock_permission_checks
          WHERE tenant_id = ${scope.tenantId}::uuid AND property_id = ${scope.propertyId}::uuid
        `,
    );
    const row = rows[0];
    return row ? report(row.results, row.checkedAt.toISOString()) : report([], null);
  }

  /** Tests each endpoint the integration uses with a harmless read and stores what Clock said. */
  async check(
    scope: { tenantId: string; propertyId: string },
    userId: string | null,
  ): Promise<ClockPermissionReport> {
    const connection = await this.connections.activePmsConnectionCredentials(
      scope.tenantId,
      scope.propertyId,
    );
    if (!connection || connection.provider !== 'CLOCK_PMS')
      throw new BadRequestException('This property has no active Clock PMS connection.');
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) throw new BadRequestException(parsed.message);

    const results: ClockPermissionResult[] = [];
    for (const probe of PROBES) results.push(await this.probe(parsed.value, probe));

    const checkedAt = new Date();
    await this.db.withTenantTransaction(
      scope,
      (tx) => tx.$executeRaw`
        INSERT INTO clock_permission_checks (tenant_id, property_id, checked_at, checked_by, results)
        VALUES (${scope.tenantId}::uuid, ${scope.propertyId}::uuid, ${checkedAt}, ${userId}::uuid,
                ${JSON.stringify(results)}::jsonb)
        ON CONFLICT (tenant_id, property_id) DO UPDATE
        SET checked_at = EXCLUDED.checked_at, checked_by = EXCLUDED.checked_by, results = EXCLUDED.results
      `,
    );
    const summary = report(results, checkedAt.toISOString());
    if (summary.missingRights.length > 0)
      this.logger.warn(
        `Clock rights missing for property ${scope.propertyId}: ${summary.missingRights.join(', ')}`,
      );
    return summary;
  }

  private async probe(
    credentials: ClockConnectionCredentials,
    probe: (typeof PROBES)[number],
  ): Promise<ClockPermissionResult> {
    const base = {
      endpoint: `${probe.api}${probe.path}`,
      label: probe.label,
      usedFor: probe.usedFor,
    };
    for (let attempt = 0; ; attempt++) {
      const limit = await this.rateLimiter.consume(credentials.apiUser);
      if (limit.allowed) break;
      if (attempt >= 7)
        return { ...base, status: 'unknown', message: 'Clock was busy; check again in a moment.' };
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(1000, Math.max(100, limit.retryAfterSeconds * 1000))),
      );
    }
    try {
      const response = await this.client.request(credentials, {
        api: probe.api,
        method: 'GET',
        path: probe.path,
        timeoutMs: 15_000,
      });
      const status = response.status;
      // A request Clock rejects for its content (400, 404, 405, 422) still proves the right is there.
      if ((status >= 200 && status < 300) || [400, 404, 405, 422].includes(status))
        return { ...base, status: 'allowed' };
      const message = errorText(response.body);
      // Clock complaining that a required parameter is missing also shows the right is granted.
      if (status !== 403 && /param is missing|contract/i.test(message))
        return { ...base, status: 'allowed' };
      if (status === 403) {
        const right = extractMissingRight(message);
        return { ...base, status: 'missing', ...(right ? { right } : {}), message };
      }
      return { ...base, status: 'unknown', message: message || `Clock answered ${status}.` };
    } catch (error) {
      if (error instanceof ClockHttpError)
        return { ...base, status: 'unknown', message: error.message };
      throw error;
    }
  }
}

function errorText(body: unknown): string {
  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string')
    return (body as { error: string }).error;
  return typeof body === 'string' ? body.slice(0, 300) : '';
}

function report(results: ClockPermissionResult[], checkedAt: string | null): ClockPermissionReport {
  const missingRights = Array.from(
    new Set(
      results.flatMap((result) =>
        result.status === 'missing' && result.right ? [result.right] : [],
      ),
    ),
  );
  return { checkedAt, results, missingRights };
}
