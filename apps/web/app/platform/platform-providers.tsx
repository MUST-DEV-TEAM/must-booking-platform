'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

import { ConsoleApiError } from '../../lib/platform-api';

export function PlatformProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Permission and not-found answers will not change by asking again.
            retry: (count, error) =>
              !(error instanceof ConsoleApiError && [400, 401, 403, 404].includes(error.status)) &&
              count < 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
