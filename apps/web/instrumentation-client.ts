import * as Sentry from '@sentry/nextjs';

const apiUrl = process.env.API_URL ?? 'http://localhost:3000';

Sentry.init({
  dsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN ??
    'https://a1f1e0e31446cbf5a6a13f44b99ec9c4@o4511925476917248.ingest.de.sentry.io/4511925529608272',

  environment: process.env.NODE_ENV,

  // 100% in dev, 10% in production
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,

  // Session Replay: 10% of all sessions, 100% of sessions with an error
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  enableLogs: true,

  tracePropagationTargets: ['localhost', 'must.dejvis.dev', new URL(apiUrl).host, /^\//],

  integrations: [Sentry.replayIntegration()],
});

// Hooks into App Router navigation transitions (App Router only)
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
