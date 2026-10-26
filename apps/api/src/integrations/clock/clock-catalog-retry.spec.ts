import { describe, it, expect, vi } from 'vitest';
import { ClockCatalogSyncService } from './clock-catalog-sync.service';
import { ClockHttpError } from './clock-http-client';
import { CircuitOpenError } from './clock-circuit-breaker';

function fixture(status: number | Error) {
  const database = { withTenantTransaction: vi.fn() };
  const breaker = { assertClosed: vi.fn(), recordSuccess: vi.fn(), recordFailure: vi.fn() };
  const client = {
    request:
      status instanceof Error
        ? vi.fn().mockRejectedValue(status)
        : vi.fn().mockResolvedValue({ status, body: null }),
  };
  const connections = {
    activePmsConnectionCredentials: vi.fn().mockResolvedValue({
      provider: 'CLOCK_PMS',
      connectionId: 'connection',
      credentials: {
        host: 'example.test',
        accountId: '1',
        subscriptionId: '2',
        apiUser: 'test',
        apiKey: 'test',
      },
    }),
  };
  const service = new ClockCatalogSyncService(
    database as never,
    connections as never,
    {} as never,
    client as never,
    { consume: vi.fn().mockResolvedValue({ allowed: true }) } as never,
    breaker as never,
  );
  return { service, database, breaker, client };
}
describe('catalogue read failure classification', () => {
  it('keeps provider throttling retryable without tripping the circuit or changing mappings', async () => {
    const f = fixture(429);
    await expect(f.service.sync('tenant', 'property', null)).rejects.toMatchObject({
      classified: { category: 'rate_limited', retryable: true },
    });
    expect(f.breaker.recordFailure).not.toHaveBeenCalled();
    expect(f.database.withTenantTransaction).not.toHaveBeenCalled();
  });
  it.each([401, 403])(
    'keeps credential and permission failures non-retryable (%s)',
    async (status) => {
      const f = fixture(status);
      await expect(f.service.sync('tenant', 'property', null)).rejects.toMatchObject({
        classified: { retryable: false },
      });
      expect(f.database.withTenantTransaction).not.toHaveBeenCalled();
    },
  );
  it('keeps transport timeouts retryable and preserves mappings', async () => {
    const f = fixture(
      new ClockHttpError('timeout', undefined, { code: 'UND_ERR_HEADERS_TIMEOUT' }),
    );
    await expect(f.service.sync('tenant', 'property', null)).rejects.toMatchObject({
      classified: { category: 'timeout', retryable: true },
    });
    expect(f.database.withTenantTransaction).not.toHaveBeenCalled();
  });
  it('waits for circuit recovery through scheduled retry instead of parking as configuration', async () => {
    const f = fixture(200);
    f.breaker.assertClosed.mockImplementation(() => {
      throw new CircuitOpenError(30000);
    });
    await expect(f.service.sync('tenant', 'property', null)).rejects.toMatchObject({
      classified: { retryable: true },
    });
    expect(f.client.request).not.toHaveBeenCalled();
  });
});
