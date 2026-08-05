import { describe, expect, it, vi } from 'vitest';

import { PmsProviderRegistry } from './pms-provider-registry';

function makeRegistry(
  connection: {
    connectionId: string;
    provider: string;
    credentials: Record<string, string>;
  } | null,
) {
  const connections = {
    activePmsConnectionCredentials: vi.fn().mockResolvedValue(connection),
  };
  const local = { name: 'local' };
  const clock = { name: 'clock' };
  const registry = new PmsProviderRegistry(connections as never, local as never, clock as never);
  return { registry, local, clock, connections };
}

describe('PmsProviderRegistry.forProperty', () => {
  it('resolves ClockPmsProvider when the property has an active Clock connection', async () => {
    const { registry, clock } = makeRegistry({
      connectionId: 'c1',
      provider: 'CLOCK_PMS',
      credentials: {},
    });

    await expect(registry.forProperty('t1', 'p1')).resolves.toBe(clock);
  });

  it('resolves LocalPmsProvider when the property has no active PMS connection', async () => {
    const { registry, local } = makeRegistry(null);

    await expect(registry.forProperty('t1', 'p1')).resolves.toBe(local);
  });

  it('resolves LocalPmsProvider for a non-Clock PMS provider', async () => {
    const { registry, local } = makeRegistry({
      connectionId: 'c1',
      provider: 'SOME_OTHER_PMS',
      credentials: {},
    });

    await expect(registry.forProperty('t1', 'p1')).resolves.toBe(local);
  });
});
