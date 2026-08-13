import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  init: vi.fn(),
  isEnabled: vi.fn(),
  withScope: vi.fn(),
}));

vi.mock('@sentry/node', () => sentry);

import { initializeErrorTracking, reportOperationalFailure } from './error-tracking';

describe('error tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sentry.withScope.mockImplementation((callback) =>
      callback({ setExtra: vi.fn(), setTag: vi.fn() }),
    );
  });

  it('does not initialize Sentry without a production DSN', () => {
    const original = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;

    initializeErrorTracking();

    expect(sentry.init).not.toHaveBeenCalled();
    if (original === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = original;
  });

  it('captures an exhausted Clock job with bounded operational context', () => {
    const tags = new Map<string, string>();
    const extras = new Map<string, string>();
    sentry.isEnabled.mockReturnValue(true);
    sentry.withScope.mockImplementation((callback) =>
      callback({
        setExtra: (key: string, value: string) => extras.set(key, value),
        setTag: (key: string, value: string) => tags.set(key, value),
      }),
    );
    const error = new Error('Clock sync failed');

    reportOperationalFailure(error, {
      component: 'clock',
      operation: 'sync-catalog',
      queue: 'clock.catalog.sync',
      jobId: 'job-42',
      tenantId: 'tenant-1',
      propertyId: 'property-1',
    });

    expect(sentry.captureException).toHaveBeenCalledWith(error);
    expect(Object.fromEntries(tags)).toEqual({
      component: 'clock',
      operation: 'sync-catalog',
      property_id: 'property-1',
      queue: 'clock.catalog.sync',
      tenant_id: 'tenant-1',
    });
    expect(Object.fromEntries(extras)).toEqual({ job_id: 'job-42' });
  });
});
