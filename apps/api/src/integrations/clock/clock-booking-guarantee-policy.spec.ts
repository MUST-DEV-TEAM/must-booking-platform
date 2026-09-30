import { describe, expect, it, vi } from 'vitest';

import { ClockBookingService, guaranteePolicyIdFromRate } from './clock-booking.service';
import type { ClockConnectionCredentials } from './clock-http-client';

type ClockOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

type ClockFetch = (
  credentials: ClockConnectionCredentials,
  options: { method: 'GET' | 'POST' | 'PUT'; path: string; body?: unknown },
) => Promise<ClockOutcome<unknown>>;

const credentials: ClockConnectionCredentials = {
  host: 'clock.example.test',
  accountId: 'account-1',
  subscriptionId: 'subscription-1',
  apiUser: 'api-user',
  apiKey: 'api-key',
};

const created = { id: 38619743, lock_version: 0, status: 'expected' };
const failure = { ok: false as const, error: { code: 'x', message: 'boom', retryable: false } };

function service(...responses: ClockOutcome<unknown>[]) {
  const instance = Object.create(ClockBookingService.prototype) as ClockBookingService;
  const fetch = vi.fn<ClockFetch>(async () => responses.shift()!);
  const warn = vi.fn();
  Object.assign(instance, { fetch, logger: { warn } });
  const apply = (
    instance as unknown as {
      applyRateGuaranteePolicy: (
        c: ClockConnectionCredentials,
        rateId: number,
        booking: typeof created,
      ) => Promise<void>;
    }
  ).applyRateGuaranteePolicy.bind(instance);
  return { apply, fetch, warn };
}

describe('guaranteePolicyIdFromRate', () => {
  it('reads the policy from the rate restriction', () => {
    expect(guaranteePolicyIdFromRate({ rate_restriction: { guarantee_policy_id: 17089 } })).toBe(
      17089,
    );
  });

  it.each([
    null,
    undefined,
    {},
    { rate_restriction: null },
    { rate_restriction: { guarantee_policy_id: null } },
    { rate_restriction: { guarantee_policy_id: '17089' } },
    { rate_restriction: { guarantee_policy_id: 0 } },
    { rate_restriction: { guarantee_policy_id: 1.5 } },
  ])('returns null for %j', (value) => {
    expect(guaranteePolicyIdFromRate(value)).toBeNull();
  });
});

describe('ClockBookingService.applyRateGuaranteePolicy', () => {
  it("copies the rate's policy onto the new booking with its lock_version", async () => {
    const { apply, fetch, warn } = service(
      { ok: true, value: { rate_restriction: { guarantee_policy_id: 17089 } } },
      { ok: true, value: {} },
    );

    await apply(credentials, 546556, created);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]).toEqual({ method: 'GET', path: '/rates/546556' });
    expect(fetch.mock.calls[1]?.[1]).toEqual({
      method: 'PUT',
      path: '/bookings/38619743',
      body: { booking: { guarantee_policy_id: 17089, lock_version: 0 } },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('sends nothing when the rate has no policy', async () => {
    const { apply, fetch } = service({
      ok: true,
      value: { rate_restriction: { guarantee_policy_id: null } },
    });

    await apply(credentials, 546556, created);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not throw or write when the rate cannot be read', async () => {
    const { apply, fetch, warn } = service(failure);

    await expect(apply(credentials, 546556, created)).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('does not throw when Clock rejects the policy update', async () => {
    const { apply, warn } = service(
      { ok: true, value: { rate_restriction: { guarantee_policy_id: 17089 } } },
      failure,
    );

    await expect(apply(credentials, 546556, created)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledOnce();
  });
});
