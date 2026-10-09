import * as Sentry from '@sentry/nextjs';

import { webSentryDsn } from './sentry.dsn';

Sentry.init({
  dsn: webSentryDsn(process.env.SENTRY_DSN),

  environment: process.env.NODE_ENV,

  // 100% in dev, 10% in production
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,

  // Local variables can hold guest names, emails and payment details, so stack
  // frames are sent without them.
  includeLocalVariables: false,

  enableLogs: true,
});
