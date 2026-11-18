import { describe, expect, it, vi } from 'vitest';

import { TenantDatabaseService } from './tenant-database.service';

describe('TenantDatabaseService shutdown', () => {
  it('disconnects in onApplicationShutdown, not in onModuleDestroy', async () => {
    const service = new TenantDatabaseService();
    const disconnect = vi.spyOn(service, '$disconnect').mockResolvedValue();
    expect((service as unknown as Record<string, unknown>).onModuleDestroy).toBeUndefined();
    await service.onApplicationShutdown();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
