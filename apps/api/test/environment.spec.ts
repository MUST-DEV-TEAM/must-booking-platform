import { describe, expect, it } from 'vitest';

import { validateEnvironment } from '../src/config/environment';

describe('environment validation', () => {
  it('rejects missing required variables with a clear error', () => {
    expect(() => validateEnvironment({})).toThrow(
      'Missing required environment variable(s): APP_PORT, DATABASE_URL, REDIS_URL, WEB_APP_URL',
    );
  });

  it('normalizes a valid port', () => {
    const environment = validateEnvironment({
      APP_PORT: '3000',
      DATABASE_URL:
        'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking',
      REDIS_URL: 'redis://localhost:6379',
      WEB_APP_URL: 'http://localhost:3001',
    });

    expect(environment.APP_PORT).toBe(3000);
  });
});
