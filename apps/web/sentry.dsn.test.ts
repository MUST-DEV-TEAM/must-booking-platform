import { afterEach, describe, expect, it, vi } from 'vitest';

import { webSentryDsn } from './sentry.dsn';

describe('webSentryDsn', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses a configured DSN', () => {
    expect(webSentryDsn(' https://key@example.ingest.sentry.io/1 ')).toBe(
      'https://key@example.ingest.sentry.io/1',
    );
  });

  it('falls back to the production project when the build secret is empty', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(webSentryDsn('')).toMatch(/\/4512225778466896$/);
  });

  it('reports nothing outside production without a DSN', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(webSentryDsn(undefined)).toBeUndefined();
  });
});
