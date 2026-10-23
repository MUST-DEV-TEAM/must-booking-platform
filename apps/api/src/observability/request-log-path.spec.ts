import { describe, expect, it } from 'vitest';
import { requestLogPath } from './request-log-path';
describe('request log path', () => {
  it('removes signed guest tokens and search terms while retaining the route', () => {
    expect(requestLogPath('/bookings/id/manage?token=private-capability')).toBe(
      '/bookings/id/manage',
    );
    expect(requestLogPath('/search?q=private-guest')).toBe('/search');
  });
  it('keeps upload capabilities redacted and handles absent URLs', () => {
    expect(requestLogPath('/media/upload/private-capability?x=1')).toBe('/media/upload/[redacted]');
    expect(requestLogPath(undefined)).toBeUndefined();
    expect(requestLogPath('/health')).toBe('/health');
  });
});
