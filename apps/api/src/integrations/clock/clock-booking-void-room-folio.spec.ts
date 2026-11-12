import { describe, expect, it, vi } from 'vitest';

import { ClockBookingService } from './clock-booking.service';
import type { ClockConnectionCredentials } from './clock-http-client';

type Outcome =
  | { ok: true; value: unknown }
  | {
      ok: false;
      error: { code: string; message: string; retryable: boolean; missingRight?: string };
    };

type FetchOptions = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  api?: 'pms_api' | 'base_api';
  body?: unknown;
};

const credentials: ClockConnectionCredentials = {
  host: 'clock.example.test',
  accountId: 'account-1',
  subscriptionId: 'subscription-1',
  apiUser: 'api-user',
  apiKey: 'api-key',
};
const context = { tenantId: 'tenant-1', propertyId: 'property-1' };

/** Clock stand-in: a booking with a main (room) folio, a deposit folio, and whatever else a test adds. */
function serviceWithFolios(
  folios: Record<number, Record<string, unknown>>,
  failDelete?: { missingRight?: string; code?: string },
) {
  const service = Object.create(ClockBookingService.prototype) as ClockBookingService;
  const fetch = vi.fn(async (_credentials: ClockConnectionCredentials, options: FetchOptions) => {
    if (options.method === 'GET' && options.path === '/bookings/500/folios/')
      return { ok: true, value: Object.keys(folios).map(Number) } as Outcome;
    const folioMatch = /^\/folios\/(\d+)$/.exec(options.path);
    if (folioMatch && options.method === 'GET')
      return { ok: true, value: { id: Number(folioMatch[1]), ...folios[Number(folioMatch[1])] } };
    if (folioMatch && options.method === 'DELETE') {
      if (failDelete)
        return {
          ok: false,
          error: {
            code: failDelete.code ?? 'clock_forbidden',
            message: 'refused',
            retryable: false,
            ...(failDelete.missingRight ? { missingRight: failDelete.missingRight } : {}),
          },
        } as Outcome;
      return { ok: true, value: undefined } as Outcome;
    }
    throw new Error(`unexpected Clock request ${options.method} ${options.path}`);
  });
  const internals = service as unknown as Record<string, unknown>;
  internals.fetch = fetch;
  internals.credentials = vi.fn().mockResolvedValue({ ok: true, value: credentials });
  return { service, fetch };
}

const deletes = (fetch: ReturnType<typeof serviceWithFolios>['fetch']) =>
  fetch.mock.calls.filter(([, options]) => options.method === 'DELETE').map(([, o]) => o.path);

describe('ClockBookingService.voidRoomChargeFolios', () => {
  // Clock's advice (2026-11-10) and the live proof on Empire #15938: void the room folio, keep the deposit folio.
  it('voids the open room folio and never touches the deposit folio', async () => {
    const { service, fetch } = serviceWithFolios({
      10: { deposit: false, closed_at: null, voided_at: null },
      11: { deposit: true, closed_at: null, voided_at: null },
    });

    const result = await service.voidRoomChargeFolios(context, '500');

    expect(result).toEqual({ ok: true, value: { voidedFolioIds: [10] } });
    expect(deletes(fetch)).toEqual(['/folios/10']);
    const call = fetch.mock.calls.find(([, options]) => options.method === 'DELETE');
    expect(call?.[1]).toMatchObject({
      api: 'base_api',
      body: { void_reason: expect.any(String) },
    });
  });

  it('skips closed and already voided room folios, so repeating the call is safe', async () => {
    const { service, fetch } = serviceWithFolios({
      10: { deposit: false, closed_at: '2026-11-10T10:00:00Z', voided_at: null },
      12: { deposit: false, closed_at: null, voided_at: '2026-11-10T11:00:00Z' },
      11: { deposit: true, closed_at: '2026-11-10T10:00:00Z', voided_at: null },
    });

    const result = await service.voidRoomChargeFolios(context, '500');

    expect(result).toEqual({ ok: true, value: { voidedFolioIds: [] } });
    expect(deletes(fetch)).toEqual([]);
  });

  it('reports a missing Clock right with its own code so the cancellation is not treated as failed', async () => {
    const { service } = serviceWithFolios(
      { 10: { deposit: false, closed_at: null, voided_at: null } },
      { missingRight: 'base_api_folios_destroy' },
    );

    const result = await service.voidRoomChargeFolios(context, '500');

    expect(result).toMatchObject({ ok: false, error: { code: 'CLOCK_RIGHT_MISSING' } });
    expect((result as { error: { message: string } }).error.message).toContain(
      'base_api_folios_destroy',
    );
  });

  it('passes any other Clock failure through with its own code', async () => {
    const { service } = serviceWithFolios(
      { 10: { deposit: false, closed_at: null, voided_at: null } },
      { code: 'clock_provider_unavailable' },
    );

    const result = await service.voidRoomChargeFolios(context, '500');

    expect(result).toMatchObject({ ok: false, error: { code: 'clock_provider_unavailable' } });
  });
});
