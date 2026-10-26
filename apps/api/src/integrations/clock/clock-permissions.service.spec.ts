import { describe, expect, it, vi } from 'vitest';

import { CLOCK_API_CATALOG } from './clock-api-catalog';
import { ClockPermissionsService } from './clock-permissions.service';

const credentials = {
  host: 'clock.example.test',
  accountId: '1',
  subscriptionId: '2',
  apiUser: 'api-user',
  apiKey: 'key',
};

function make(respond: (path: string) => { status: number; body: unknown }) {
  let stored: unknown[] = [];
  const db = {
    withTenantTransaction: vi.fn(async (_scope: unknown, work: (tx: unknown) => unknown) =>
      work({
        $queryRaw: vi.fn(async () =>
          stored.length > 0
            ? [{ checkedAt: new Date('2026-10-26T10:00:00Z'), results: stored }]
            : [],
        ),
        $executeRaw: vi.fn(async (_strings: unknown, ...values: unknown[]) => {
          const json = values.find((value) => typeof value === 'string' && value.startsWith('['));
          if (typeof json === 'string') stored = JSON.parse(json) as unknown[];
          return 1;
        }),
      }),
    ),
  };
  const connections = {
    activePmsConnectionCredentials: vi
      .fn()
      .mockResolvedValue({ connectionId: 'c1', provider: 'CLOCK_PMS', credentials }),
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
  return { service, client, connections };
}

const scope = { tenantId: 't1', propertyId: 'p1' };

describe('ClockPermissionsService', () => {
  it('lists every request Clock documents, with what is and is not checked', async () => {
    const { service } = make(() => ({ status: 200, body: [] }));

    const report = await service.report(scope);

    expect(report.entries.length).toBe(CLOCK_API_CATALOG.length);
    const rates = report.entries.find((entry) => entry.id === 'GET pms_api/rates/');
    expect(rates).toMatchObject({
      probeable: true,
      status: 'pending',
      usedFor: expect.any(String),
    });
    const create = report.entries.find((entry) => entry.id === 'POST pms_api/bookings/');
    expect(create).toMatchObject({ probeable: false, status: 'untested' });
    expect(create?.untestedReason).toContain('never tested');
  });

  it('marks a request allowed or missing and names the missing right', async () => {
    const { service } = make((path) =>
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

    const report = await service.check(scope, 'u1', [
      'GET pms_api/rate_plans/',
      'GET pms_api/products',
      'GET pms_api/guests/search',
      'GET pms_api/rates/',
    ]);

    const byId = (id: string) => report.entries.find((entry) => entry.id === id);
    expect(byId('GET pms_api/rate_plans/')).toMatchObject({
      status: 'missing',
      right: 'pms_api_rate_plans_index',
    });
    // Clock objecting to the content of a request still proves the right is granted.
    expect(byId('GET pms_api/products')?.status).toBe('allowed');
    expect(byId('GET pms_api/guests/search')?.status).toBe('allowed');
    expect(byId('GET pms_api/rates/')?.status).toBe('allowed');
    expect(report.missingRights).toEqual(['pms_api_rate_plans_index']);
  });

  it('keeps earlier results when checking more requests', async () => {
    const { service } = make(() => ({ status: 200, body: [] }));

    await service.check(scope, null, ['GET pms_api/rates/']);
    const report = await service.check(scope, null, ['GET pms_api/rooms/']);

    expect(report.entries.find((entry) => entry.id === 'GET pms_api/rates/')?.status).toBe(
      'allowed',
    );
    expect(report.entries.find((entry) => entry.id === 'GET pms_api/rooms/')?.status).toBe(
      'allowed',
    );
  });

  it('only ever reads from Clock and refuses to test a request that changes data', async () => {
    const { service, client } = make(() => ({ status: 200, body: [] }));

    await expect(service.check(scope, null, ['POST pms_api/bookings/'])).rejects.toThrow(
      'Nothing to check',
    );
    await service.check(scope, null, ['GET pms_api/rates/', 'GET pms_api/rooms/']);

    const methods = client.request.mock.calls.map(
      ([, options]) => (options as { method: string }).method,
    );
    expect(new Set(methods)).toEqual(new Set(['GET']));
  });

  it('tries again when Clock is briefly unavailable and reports an error only if it stays down', async () => {
    let calls = 0;
    const flaky = make(() =>
      ++calls < 2 ? { status: 503, body: 'down' } : { status: 200, body: [] },
    );
    const recovered = await flaky.service.check(scope, null, ['GET pms_api/rates/']);
    expect(recovered.entries.find((entry) => entry.id === 'GET pms_api/rates/')?.status).toBe(
      'allowed',
    );

    const down = make(() => ({ status: 503, body: 'down' }));
    const failed = await down.service.check(scope, null, ['GET pms_api/rooms/']);
    expect(failed.entries.find((entry) => entry.id === 'GET pms_api/rooms/')?.status).toBe('error');
    expect(failed.missingRights).toEqual([]);
  });

  it('refuses a property without a Clock connection and more than twelve requests at once', async () => {
    const { service, connections } = make(() => ({ status: 200, body: [] }));
    const many = CLOCK_API_CATALOG.filter(
      (entry) =>
        entry.method === 'GET' && entry.api === 'pms_api' && !entry.path.includes('/folios'),
    )
      .slice(0, 13)
      .map((entry) => `GET pms_api${entry.path}`);
    await expect(service.check(scope, null, many)).rejects.toThrow('at most 12');

    connections.activePmsConnectionCredentials.mockResolvedValue(null);
    await expect(service.check(scope, null, ['GET pms_api/rates/'])).rejects.toThrow(
      'no active Clock PMS connection',
    );
  });
});
