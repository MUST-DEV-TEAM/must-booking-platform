import * as Sentry from '@sentry/node';

export type OperationalFailure = {
  component: string;
  operation: string;
  tenantId?: string;
  propertyId?: string;
  queue?: string;
  jobId?: string | number;
};

/**
 * Keeps error reporting optional for local development while making a configured
 * Sentry DSN the single production alert channel for API and deploy failures.
 */
export function initializeErrorTracking(): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV || 'production',
    release: process.env.GIT_SHA?.trim() || undefined,
    sendDefaultPii: false,
  });
}

export function reportOperationalFailure(error: unknown, failure: OperationalFailure): void {
  if (!Sentry.isEnabled()) return;

  Sentry.withScope((scope) => {
    scope.setTag('component', failure.component);
    scope.setTag('operation', failure.operation);
    if (failure.queue) scope.setTag('queue', failure.queue);
    if (failure.tenantId) scope.setTag('tenant_id', failure.tenantId);
    if (failure.propertyId) scope.setTag('property_id', failure.propertyId);
    if (failure.jobId !== undefined) scope.setExtra('job_id', String(failure.jobId));
    Sentry.captureException(error);
  });
}
