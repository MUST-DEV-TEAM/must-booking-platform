import { resolve } from 'node:path';

import type { NextConfig } from 'next';

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

export default nextConfig;
