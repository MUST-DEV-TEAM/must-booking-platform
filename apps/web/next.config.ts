import { resolve } from 'node:path';

import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const apiUrl = process.env.API_URL ?? 'http://localhost:3000';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: resolve(process.cwd(), '../..'),
  transpilePackages: ['@must/ui'],
  turbopack: {
    root: resolve(process.cwd(), '../..'),
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Source map upload auth token — build-time secret, not the DSN
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload a wider set of client source files for better stack trace resolution
  widenClientFileUpload: true,

  // Proxy Sentry requests through the app's own origin to dodge ad-blockers
  tunnelRoute: '/monitoring',

  // Only print plugin output in CI
  silent: !process.env.CI,

  // NOTE: webpack.treeshake.* options are intentionally omitted — this app
  // builds with Turbopack (see `turbopack.root` above), where they're a no-op.
});
