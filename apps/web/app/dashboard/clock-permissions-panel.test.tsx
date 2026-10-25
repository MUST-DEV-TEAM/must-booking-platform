// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ClockPermissionsPanel,
  clockSupportText,
  type ClockPermissionReport,
} from './clock-permissions-panel';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 15));
};

const checked: ClockPermissionReport = {
  checkedAt: '2026-10-26T10:00:00.000Z',
  missingRights: ['pms_api_rate_packages_index'],
  results: [
    { endpoint: 'pms_api/rates/', label: 'Rates', usedFor: 'Prices', status: 'allowed' },
    {
      endpoint: 'pms_api/rate_packages/',
      label: 'Rate packages',
      usedFor: 'Package rates',
      status: 'missing',
      right: 'pms_api_rate_packages_index',
    },
  ],
};

function mockApi(provider: string, latest: () => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/pms-connection-status')) return Response.json({ provider });
    if (url.endsWith('/clock-permissions/check') && init?.method === 'POST')
      return Response.json(checked);
    if (url.endsWith('/clock-permissions')) return latest();
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function mount() {
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(ClockPermissionsPanel, { tenantId: 't1', propertyId: 'p1' }),
      ),
    );
    await settle();
  });
  await act(settle);
}

describe('ClockPermissionsPanel', () => {
  it('shows each right, names the missing one and offers a message for Clock support', async () => {
    mockApi('CLOCK_PMS', () => Response.json(checked));
    await mount();

    expect(document.body.textContent).toContain('Clock permissions');
    expect(document.body.textContent).toContain('Rate packages');
    expect(document.body.textContent).toContain('Missing right: pms_api_rate_packages_index');
    expect(
      document.querySelector('button[aria-label="Copy message for Clock support"]'),
    ).not.toBeNull();
  });

  it('runs a check on request and shows the new result', async () => {
    mockApi('CLOCK_PMS', () => Response.json({ checkedAt: null, results: [], missingRights: [] }));
    await mount();
    expect(document.body.textContent).toContain('Not checked yet');

    const button = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Check now'),
    );
    await act(async () => {
      button?.click();
      await settle();
    });

    expect(document.body.textContent).toContain('Missing right: pms_api_rate_packages_index');
  });

  it('is not shown for a hotel without Clock', async () => {
    const fetchMock = mockApi('LOCAL', () => Response.json(checked));
    await mount();

    expect(fetchMock).toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('Clock permissions');
  });

  it('is not shown to staff without access', async () => {
    mockApi('CLOCK_PMS', () => new Response('forbidden', { status: 403 }));
    await mount();

    expect(document.body.textContent).not.toContain('Clock permissions');
  });
});

describe('clockSupportText', () => {
  it('lists every missing right and is empty when nothing is missing', () => {
    expect(clockSupportText(checked)).toContain('- pms_api_rate_packages_index');
    expect(clockSupportText({ ...checked, missingRights: [] })).toBe('');
  });
});
