import { describe, expect, it, vi } from 'vitest';

import { ClockPermissionsService } from './clock-permissions.service';

const credentials = {
  host: 'clock.example.test',
  accountId: '1',
  subscriptionId: '2',
  apiUser: 'api-user',
  apiKey: 'key',
};

function make(respond: (path: string) => { status: number; body: unknown }) {
  const saved: { results?: unknown } = {};
  const db = {
    withTenantTransaction: vi.fn(async (_scope: unknown, work: (tx: unknown) => unknown) =>
      work({
        $executeRaw: vi.fn(async (_strings: unknown, ...values: unknown[]) => {
          saved.results = values.find(
            (value) => typeof value === 'string' && value.startsWith('['),
          );
          return 1;
        }),
        $queryRaw: vi.fn(async () => []),
      }),
    ),
  };
  const connections = {
    activePmsConnectionCredentials: vi.fn().mockResolvedValue({
      connectionId: 'c1',
      provider: 'CLOCK_PMS',
      credentials,
    }),
  };
  const client = {
    request: vi.fn(async (_credentials: unknown, options: { path: string; method: string }) =>
      respond(options.path),
    ),
  };
  const rateLimiter = {
    consume: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
  };
  const service = new ClockPermissionsService(
    db as never,
    connections as never,
    client as never,
    rateLimiter as never,
  );
  return { service, client, saved, connections };
}

describe('ClockPermissionsService', () => {
  it('reports each endpoint as allowed or missing and names the missing right', async () => {
    const { service, saved } = make((path) =>
      path === '/rate_plans/'
        ? { status: 403, body: { error: "The User doesn't have pms_api_rate_plans_index right" } }
        : path === '/products'
          ? { status: 400, body: { error: 'Contract: arrival is missing' } }
          : path === '/guests/search'
            ? {
                status: 500,
                body: { error: 'param is missing or the value is empty: free_text_search' },
              }
            : { status: 200, body: [] },
    );

    const report = await service.check({ tenantId: 't1', propertyId: 'p1' }, 'u1');

    const plans = report.results.find((result) => result.label === 'Rate plans');
    expect(plans).toMatchObject({ status: 'missing', right: 'pms_api_rate_plans_index' });
    // Clock refusing the content of a request still proves the right exists.
    expect(report.results.find((result) => result.label === 'Live prices')?.status).toBe('allowed');
    expect(report.results.find((result) => result.label === 'Rates')?.status).toBe('allowed');
    expect(report.results.find((result) => result.label === 'Guests')?.status).toBe('allowed');
    expect(report.missingRights).toEqual(['pms_api_rate_plans_index']);
    expect(typeof saved.results).toBe('string');
  });

  it('only ever reads from Clock', async () => {
    const { service, client } = make(() => ({ status: 200, body: [] }));

    await service.check({ tenantId: 't1', propertyId: 'p1' }, null);

    const methods = client.request.mock.calls.map(([, options]) => options.method);
    expect(new Set(methods)).toEqual(new Set(['GET']));
  });

  it('marks an endpoint unknown, not missing, when Clock is unavailable', async () => {
    const { service } = make(() => ({ status: 503, body: 'Service Unavailable' }));

    const report = await service.check({ tenantId: 't1', propertyId: 'p1' }, null);

    expect(report.results.every((result) => result.status === 'unknown')).toBe(true);
    expect(report.missingRights).toEqual([]);
  });

  it('refuses a property without a Clock connection', async () => {
    const { service, connections } = make(() => ({ status: 200, body: [] }));
    connections.activePmsConnectionCredentials.mockResolvedValue(null);

    await expect(service.check({ tenantId: 't1', propertyId: 'p1' }, null)).rejects.toThrow(
      'no active Clock PMS connection',
    );
  });
});
