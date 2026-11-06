import { describe, expect, it, vi } from 'vitest';

import { TenantDatabaseService } from './tenant-database.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

function serviceWithSpy() {
  const service = new TenantDatabaseService();
  const spy = vi
    .spyOn(service, '$transaction')
    .mockImplementation((async () => 'done') as unknown as typeof service.$transaction);
  return { service, spy };
}

describe('withTenantTransaction waiting for a free database connection', () => {
  it('passes maxWait to Prisma when maxWaitMs is given', async () => {
    const { service, spy } = serviceWithSpy();
    await service.withTenantTransaction({ tenantId }, async () => 1, { maxWaitMs: 15_000 });
    expect(spy.mock.calls[0]?.[1]).toMatchObject({ maxWait: 15_000 });
  });

  it('leaves Prisma defaults alone when no options are given', async () => {
    const { service, spy } = serviceWithSpy();
    await service.withTenantTransaction({ tenantId }, async () => 1);
    expect(spy.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('keeps timeoutMs working and does not invent a maxWait', async () => {
    const { service, spy } = serviceWithSpy();
    await service.withTenantTransaction({ tenantId }, async () => 1, { timeoutMs: 90_000 });
    const options = spy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(options.timeout).toBe(90_000);
    expect(options.maxWait).toBeUndefined();
  });
});
