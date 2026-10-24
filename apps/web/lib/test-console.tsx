import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { vi } from 'vitest';

import type { PlatformMe } from './platform-api';

type Handler = (request: { url: string; method: string; body: unknown }) => {
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
};

export type FetchCall = {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
};

/**
 * Replaces fetch with routes keyed by "METHOD /path-prefix" (query strings are ignored for the
 * match). Unmatched calls fail the test loudly, so a page cannot silently call an unknown route.
 */
export function mockConsoleFetch(routes: Record<string, Handler | unknown>) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url
      .replace(/^\/api\/platform-console/, '')
      .replace(/^\/api/, '')
      .split('?')[0]!;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const key = Object.keys(routes).find(
      (candidate) =>
        candidate === `${method} ${path}` ||
        (candidate.endsWith('*') && `${method} ${path}`.startsWith(candidate.slice(0, -1))),
    );
    if (!key) throw new Error(`Unexpected request: ${method} ${url}`);
    const route = routes[key];
    const result =
      typeof route === 'function' ? (route as Handler)({ url, method, body }) : { body: route };
    const status = result.status ?? 200;
    const payload = result.text ?? (result.body === undefined ? '' : JSON.stringify(result.body));
    return new Response(status === 204 ? null : payload, {
      status,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req-test-1',
        ...result.headers,
      },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export const superAdmin: PlatformMe = {
  id: 'acc-1',
  email: 'root@must.al',
  name: 'Rea Root',
  roleKey: 'super_admin',
  roleName: 'Super admin',
  capabilities: [
    'platform.hotels.view',
    'platform.hotels.create',
    'platform.hotels.lifecycle',
    'platform.hotels.dangerous',
    'platform.connections.view',
    'platform.integrations.manage',
    'platform.billing.view',
    'platform.billing.manage',
    'platform.support.view_as',
    'platform.support.act_as',
    'platform.support.approve',
    'platform.team.view',
    'platform.team.manage',
    'platform.audit.view',
    'platform.audit.export',
  ],
};

export const auditor: PlatformMe = {
  id: 'acc-4',
  email: 'audit@must.al',
  name: 'Ana Auditor',
  roleKey: 'auditor',
  roleName: 'Read-only auditor',
  capabilities: [
    'platform.hotels.view',
    'platform.connections.view',
    'platform.billing.view',
    'platform.team.view',
    'platform.audit.view',
  ],
};

export const finance: PlatformMe = {
  id: 'acc-3',
  email: 'fin@must.al',
  name: 'Fia Finance',
  roleKey: 'finance',
  roleName: 'Finance',
  capabilities: [
    'platform.hotels.view',
    'platform.connections.view',
    'platform.billing.view',
    'platform.billing.manage',
  ],
};

export function withQueries(element: ReactElement): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, element);
}
