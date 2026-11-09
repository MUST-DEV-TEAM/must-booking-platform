import { describe, expect, it } from 'vitest';

import { IntegrationConnectionsService } from './integration-connections.service';

// Going live from PokPay staging is allowed even with payment history; production history keeps
// the reviewed-migration rule.
function serviceWith(linked: Array<Record<string, string>>) {
  const tx = { $queryRaw: async () => linked.map((_, i) => ({ encrypted: String(i) })) };
  const cipher = { decrypt: (value: string) => linked[Number(value)] };
  const service = new IntegrationConnectionsService(
    {} as never,
    {} as never,
    cipher as never,
    {} as never,
  );
  return (provider: 'POKPAY' | 'CLOCK_PMS' | 'STRIPE') =>
    (
      service as unknown as {
        replacesOnlyStagingPokpay: (...args: unknown[]) => Promise<boolean>;
      }
    ).replacesOnlyStagingPokpay(tx, 't', 'p', provider, 'new');
}

describe('replacesOnlyStagingPokpay', () => {
  it('allows replacing a staging connection (explicit staging host)', async () => {
    expect(await serviceWith([{ baseUrl: 'https://api-staging.pokpay.io' }])('POKPAY')).toBe(true);
  });

  it('allows replacing a connection with no host set (defaults to staging)', async () => {
    expect(await serviceWith([{ environment: 'staging' }])('POKPAY')).toBe(true);
  });

  it('blocks replacing a production connection', async () => {
    expect(await serviceWith([{ baseUrl: 'https://api.pokpay.io' }])('POKPAY')).toBe(false);
  });

  it('blocks when any linked connection is production', async () => {
    expect(
      await serviceWith([
        { baseUrl: 'https://api-staging.pokpay.io' },
        { environment: 'production' },
      ])('POKPAY'),
    ).toBe(false);
  });

  it('never applies to other providers', async () => {
    expect(await serviceWith([{ baseUrl: 'https://api-staging.pokpay.io' }])('CLOCK_PMS')).toBe(
      false,
    );
  });
});
