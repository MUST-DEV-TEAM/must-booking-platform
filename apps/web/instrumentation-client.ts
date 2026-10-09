import * as Sentry from '@sentry/nextjs';

import { webSentryDsn } from './sentry.dsn';

const apiUrl = process.env.API_URL ?? 'http://localhost:3000';

Sentry.init({
  dsn: webSentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN),

  environment: process.env.NODE_ENV,

  // 100% in dev, 10% in production
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,

  // Session Replay: 10% of all sessions, 100% of sessions with an error
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  enableLogs: true,

  tracePropagationTargets: ['localhost', new URL(apiUrl).host, /^\//],

  integrations: [Sentry.replayIntegration()],
});

// Hooks into App Router navigation transitions (App Router only)
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
