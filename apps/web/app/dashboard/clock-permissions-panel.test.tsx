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

const entry = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  api: 'pms_api',
  method: 'GET',
  path: `/${name.toLowerCase()}/`,
  name,
  section: 'Docs',
  group: 'Rates and prices',
  probeable: true,
  status: 'pending',
  ...extra,
});

const before = {
  checkedAt: null,
  missingRights: [],
  entries: [
    entry('GET pms_api/rates/', 'Rates', { usedFor: 'Prices and the rate choice' }),
    entry('GET pms_api/rate_packages/', 'Packages'),
    entry('POST pms_api/bookings/', 'Create booking', {
      method: 'POST',
      probeable: false,
      status: 'untested',
      untestedReason: 'Changes data in Clock, so it is never tested.',
      expectedRight: 'pms_api_bookings_create',
    }),
  ],
} as unknown as ClockPermissionReport;

const after = {
  checkedAt: '2026-10-26T10:00:00.000Z',
  missingRights: ['pms_api_rate_packages_index'],
  entries: [
    { ...before.entries[0], status: 'allowed' },
    { ...before.entries[1], status: 'missing', right: 'pms_api_rate_packages_index' },
    before.entries[2],
  ],
} as unknown as ClockPermissionReport;

function mockApi(provider: string, latest: () => Response, check?: () => Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/pms-connection-status')) return Response.json({ provider });
    if (url.endsWith('/clock-permissions/check') && init?.method === 'POST')
      return check ? check() : Response.json(after);
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

const checkButton = () =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Check'));

describe('ClockPermissionsPanel', () => {
  it('lists every request, including the ones that are never tested, and why', async () => {
    mockApi('CLOCK_PMS', () => Response.json(before));
    await mount();

    expect(document.body.textContent).toContain('Clock permissions');
    expect(document.body.textContent).toContain('Rates');
    expect(document.body.textContent).toContain('Used by MUST');
    expect(document.body.textContent).toContain('Changes data in Clock, so it is never tested.');
    expect(document.body.textContent).toContain('Usual right name: pms_api_bookings_create');
    expect(document.body.textContent).toContain('2 not checked yet');
  });

  it('shows each request as checking while it runs, then its real result', async () => {
    let release: (response: Response) => void = () => undefined;
    mockApi(
      'CLOCK_PMS',
      () => Response.json(before),
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    await mount();

    await act(async () => {
      checkButton()?.click();
      await settle();
    });
    expect(document.body.textContent).toContain('Checking…');
    expect(document.body.textContent).toContain('Checking 0 of 2');

    await act(async () => {
      release(Response.json(after));
      await settle();
    });
    expect(document.body.textContent).not.toContain('Checking…');
    expect(document.body.textContent).toContain('Missing right: pms_api_rate_packages_index');
    expect(document.body.textContent).toContain('1 allowed');
    expect(document.body.textContent).toContain('1 missing');
    expect(
      document.querySelector('button[aria-label="Copy message for Clock support"]'),
    ).not.toBeNull();
  });

  it('never leaves a request in a vague state after a successful check', async () => {
    mockApi('CLOCK_PMS', () => Response.json(after));
    await mount();

    expect(document.body.textContent).not.toContain('Not confirmed');
    expect(document.body.textContent).not.toContain('Not checked yet');
  });

  it('says in plain words which MUST features work and which are blocked', async () => {
    mockApi('CLOCK_PMS', () =>
      Response.json({
        ...after,
        features: [
          {
            key: 'prices',
            label: 'Rates, availability and live prices',
            required: true,
            planned: false,
            status: 'ready',
            message: 'Works: every right it needs is confirmed.',
            missingRights: [],
          },
          {
            key: 'rate-packages',
            label: 'Rate packages',
            required: false,
            planned: true,
            status: 'blocked',
            message:
              'Package rates cannot be read. Ask Clock to enable: pms_api_rate_packages_index.',
            missingRights: ['pms_api_rate_packages_index'],
          },
        ],
      }),
    );
    await mount();

    expect(document.body.textContent).toContain('What works with these permissions');
    expect(document.body.textContent).toContain('Rates, availability and live prices');
    expect(document.body.textContent).toContain('Works');
    expect(document.body.textContent).toContain('Blocked');
    expect(document.body.textContent).toContain('Planned');
    expect(document.body.textContent).toContain(
      'Ask Clock to enable: pms_api_rate_packages_index.',
    );
  });

  it('is not shown for a hotel without Clock', async () => {
    const fetchMock = mockApi('LOCAL', () => Response.json(before));
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
    expect(clockSupportText(after)).toContain('- pms_api_rate_packages_index');
    expect(clockSupportText({ ...after, missingRights: [] })).toBe('');
  });
});
