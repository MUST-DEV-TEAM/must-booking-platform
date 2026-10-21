import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClockBookingConsistencyService } from './clock-booking-consistency.service';
import { ClockBookingHydrationService } from './clock-booking-hydration.service';

afterEach(() => vi.useRealTimers());
for (const Service of [ClockBookingConsistencyService, ClockBookingHydrationService]) {
  describe(`${Service.name} safe GET throttling`, () => {
    function setup(statuses: number[]) {
      const client = { request: vi.fn() };
      for (const status of statuses)
        client.request.mockResolvedValueOnce({ status, body: status === 200 ? [42] : {} });
      const breaker = { assertClosed: vi.fn(), recordSuccess: vi.fn(), recordFailure: vi.fn() };
      const limiter = { consume: vi.fn().mockResolvedValue({ allowed: true }) };
      const service = Object.assign(Object.create(Service.prototype), {
        client,
        circuitBreaker: breaker,
        rateLimiter: limiter,
      });
      return {
        client,
        breaker,
        limiter,
        read: () => service.fetchClock({ apiUser: 'test' }, '/bookings') as Promise<unknown>,
      };
    }
    it('backs off a real provider 429 and reacquires the limiter before returning data', async () => {
      vi.useFakeTimers();
      const { read, client, breaker, limiter } = setup([429, 429, 200]);
      const result = read();
      await vi.runAllTimersAsync();
      await expect(result).resolves.toEqual([42]);
      expect(client.request).toHaveBeenCalledTimes(3);
      expect(limiter.consume).toHaveBeenCalledTimes(3);
      expect(breaker.recordFailure).not.toHaveBeenCalled();
      for (const [, request] of client.request.mock.calls) expect(request.method).toBe('GET');
    });
    it('stops after three retries and never turns throttling into an empty result', async () => {
      vi.useFakeTimers();
      const { read, client, breaker } = setup([429, 429, 429, 429]);
      const result = expect(read()).rejects.toThrow();
      await vi.runAllTimersAsync();
      await result;
      expect(client.request).toHaveBeenCalledTimes(4);
      expect(breaker.recordFailure).toHaveBeenCalledTimes(1);
    });
    it('does not retry a non-throttling error', async () => {
      const { read, client } = setup([403]);
      await expect(read()).rejects.toThrow();
      expect(client.request).toHaveBeenCalledTimes(1);
    });
  });
}
