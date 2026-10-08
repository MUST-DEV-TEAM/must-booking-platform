import { describe, expect, it } from 'vitest';

import { missingMailConfiguration, validateEnvironment } from '../src/config/environment';

describe('environment validation', () => {
  it('rejects missing required variables with a clear error', () => {
    expect(() => validateEnvironment({})).toThrow(
      'Missing required environment variable(s): APP_PORT, DATABASE_URL, REDIS_URL, WEB_APP_URL, INTEGRATION_CREDENTIALS_KEY',
    );
  });

  it('normalizes a valid port', () => {
    const environment = validateEnvironment({
      APP_PORT: '3000',
      DATABASE_URL:
        'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking',
      REDIS_URL: 'redis://localhost:6379',
      WEB_APP_URL: 'http://localhost:3001',
      INTEGRATION_CREDENTIALS_KEY: 'LyggbMDKuGsn4YtAUETY7GfIDC0GQ4YSj8VgJ8ak6qU=',
    });

    expect(environment.APP_PORT).toBe(3000);
  });

  describe('mail settings', () => {
    const base = {
      APP_PORT: '3000',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      WEB_APP_URL: 'http://localhost:3001',
      INTEGRATION_CREDENTIALS_KEY: 'LyggbMDKuGsn4YtAUETY7GfIDC0GQ4YSj8VgJ8ak6qU=',
    };

    it('still boots when mail is not configured', () => {
      expect(() => validateEnvironment(base)).not.toThrow();
    });

    it('accepts plain and "Name <address>" sender formats', () => {
      expect(() =>
        validateEnvironment({ ...base, MAIL_FROM_EMAIL: 'noreply@mail.example.test' }),
      ).not.toThrow();
      expect(() =>
        validateEnvironment({
          ...base,
          MAIL_FROM_EMAIL: 'MUST Booking <noreply@mail.example.test>',
        }),
      ).not.toThrow();
    });

    it('rejects a malformed sender or base URL when set', () => {
      expect(() => validateEnvironment({ ...base, MAIL_FROM_EMAIL: 'not-an-address' })).toThrow(
        'MAIL_FROM_EMAIL must be an email address',
      );
      expect(() => validateEnvironment({ ...base, RESEND_API_BASE_URL: 'nope' })).toThrow(
        'RESEND_API_BASE_URL must be a valid',
      );
    });

    it('reports which mail settings are missing', () => {
      expect(missingMailConfiguration({})).toEqual(['RESEND_API_KEY', 'MAIL_FROM_EMAIL']);
      expect(missingMailConfiguration({ RESEND_API_KEY: 'k', MAIL_FROM_EMAIL: ' ' })).toEqual([
        'MAIL_FROM_EMAIL',
      ]);
      expect(
        missingMailConfiguration({ RESEND_API_KEY: 'k', MAIL_FROM_EMAIL: 'a@b.test' }),
      ).toEqual([]);
    });
  });
});
