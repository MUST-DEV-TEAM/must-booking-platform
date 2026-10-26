import { describe, expect, it, vi } from 'vitest';
import { AvailabilityController } from './availability.controller';
describe('shared source information', () => {
  it('allows a guest-view role without granting Calendar access', async () => {
    const connections = {
      activePmsConnectionCredentials: vi.fn().mockResolvedValue({ provider: 'CLOCK_PMS' }),
    };
    const controller = new AvailabilityController(
      {} as never,
      {} as never,
      connections as never,
      { effective: vi.fn().mockResolvedValue(['guests.view']) } as never,
    );
    await expect(
      controller.getPmsConnectionStatus({
        tenantContext: { tenantId: 't', propertyId: 'p', userId: 'u' },
      }),
    ).resolves.toEqual({ provider: 'CLOCK_PMS' });
  });
  it('refuses roles with no relevant section access before reading a connection', async () => {
    const connections = { activePmsConnectionCredentials: vi.fn() };
    const controller = new AvailabilityController(
      {} as never,
      {} as never,
      connections as never,
      { effective: vi.fn().mockResolvedValue([]) } as never,
    );
    await expect(
      controller.getPmsConnectionStatus({
        tenantContext: { tenantId: 't', propertyId: 'p', userId: 'u' },
      }),
    ).rejects.toThrow('not available');
    expect(connections.activePmsConnectionCredentials).not.toHaveBeenCalled();
  });
});
