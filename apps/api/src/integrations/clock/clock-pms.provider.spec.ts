import { describe, expect, it, vi } from 'vitest';

import { ClockPmsProvider } from './clock-pms.provider';

const context = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  propertyId: '22222222-2222-4222-8222-222222222222',
};

describe('ClockPmsProvider.testConnection', () => {
  it('reports a clear configuration error when the property has no active PMS connection', async () => {
    const connections = { activePmsConnectionCredentials: vi.fn().mockResolvedValue(null) };
    const ping = { ping: vi.fn() };
    const provider = new ClockPmsProvider(
      connections as never,
      ping as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await provider.testConnection(context);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'clock_configuration',
        message: 'This property has no active Clock PMS connection.',
        retryable: false,
      },
    });
    expect(ping.ping).not.toHaveBeenCalled();
  });

  it('reports the same configuration error if the active connection is a different provider', async () => {
    const connections = {
      activePmsConnectionCredentials: vi
        .fn()
        .mockResolvedValue({ connectionId: 'c1', provider: 'STRIPE', credentials: {} }),
    };
    const ping = { ping: vi.fn() };
    const provider = new ClockPmsProvider(
      connections as never,
      ping as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await provider.testConnection(context);

    expect(result.ok).toBe(false);
    expect(ping.ping).not.toHaveBeenCalled();
  });

  it('delegates to the ping service and returns ok on success', async () => {
    const credentials = {
      host: 'h',
      accountId: '1',
      subscriptionId: '2',
      apiUser: 'u',
      apiKey: 'k',
    };
    const connections = {
      activePmsConnectionCredentials: vi
        .fn()
        .mockResolvedValue({ connectionId: 'c1', provider: 'CLOCK_PMS', credentials }),
    };
    const ping = {
      ping: vi.fn().mockResolvedValue({ ok: true, message: 'Connected to Clock successfully.' }),
    };
    const provider = new ClockPmsProvider(
      connections as never,
      ping as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await provider.testConnection(context);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(ping.ping).toHaveBeenCalledWith(credentials);
  });

  it('translates a ping failure into a Result error', async () => {
    const connections = {
      activePmsConnectionCredentials: vi
        .fn()
        .mockResolvedValue({ connectionId: 'c1', provider: 'CLOCK_PMS', credentials: {} }),
    };
    const ping = {
      ping: vi.fn().mockResolvedValue({ ok: false, message: 'Clock rejected the credentials.' }),
    };
    const provider = new ClockPmsProvider(
      connections as never,
      ping as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await provider.testConnection(context);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'clock_connection_failed',
        message: 'Clock rejected the credentials.',
        retryable: false,
      },
    });
  });
});

describe('ClockPmsProvider.syncCatalog', () => {
  it('syncs proposals then returns the confirmed local room types', async () => {
    const connections = { activePmsConnectionCredentials: vi.fn() };
    const ping = { ping: vi.fn() };
    const catalogSync = {
      sync: vi.fn().mockResolvedValue({ connectionId: 'c1', proposed: 2, updated: 0 }),
    };
    const roomTypeRows = [{ id: 'rt-1', name: 'Standard', maxOccupancy: 2 }];
    const database = {
      withTenantTransaction: vi.fn((_ctx, callback) =>
        callback({ $queryRaw: vi.fn().mockResolvedValue(roomTypeRows) }),
      ),
    };
    const provider = new ClockPmsProvider(
      connections as never,
      ping as never,
      catalogSync as never,
      database as never,
      {} as never,
    );

    const result = await provider.syncCatalog(context);

    expect(catalogSync.sync).toHaveBeenCalledWith(context.tenantId, context.propertyId, null);
    expect(result).toEqual({
      items: [{ kind: 'room_type', id: 'rt-1', name: 'Standard', maxOccupancy: 2 }],
      nextCursor: null,
    });
  });
});

describe('ClockPmsProvider.getAvailability', () => {
  it('delegates to ClockAvailabilityService with the tenant/property ids split out of context', async () => {
    const availabilityResult = {
      ok: true as const,
      value: {
        roomTypeId: 'rt-1',
        startsOn: '2026-08-10',
        endsOn: '2026-08-12',
        isAvailable: true,
        availableUnits: 3,
      },
    };
    const availability = { getAvailability: vi.fn().mockResolvedValue(availabilityResult) };
    const provider = new ClockPmsProvider(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      availability as never,
    );
    const query = { roomTypeId: 'rt-1', startsOn: '2026-08-10', endsOn: '2026-08-12' };

    const result = await provider.getAvailability(context, query);

    expect(availability.getAvailability).toHaveBeenCalledWith(
      context.tenantId,
      context.propertyId,
      query,
    );
    expect(result).toEqual(availabilityResult);
  });
});

describe('ClockPmsProvider unimplemented methods', () => {
  const provider = new ClockPmsProvider(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it.each([
    ['getBooking', () => provider.getBooking(context, 'ext-1')],
    [
      'findBookingByExternalReference',
      () => provider.findBookingByExternalReference(context, 'ref-1'),
    ],
  ])(
    '%s throws a clear not-implemented error rather than silently returning nothing',
    (_name, call) => {
      expect(call).toThrow(/not implemented yet/);
    },
  );
});
