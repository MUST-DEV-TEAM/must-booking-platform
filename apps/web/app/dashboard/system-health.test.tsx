// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardQueryProvider } from './query-provider';
import { SystemHealthTab } from './system-health';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 15));
};
async function mount(canOpen?: (section: string) => boolean) {
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(SystemHealthTab, { tenantId: 't', propertyId: 'p', canOpen }),
      ),
    );
    await settle();
  });
  await act(settle);
}

describe('System health tab', () => {
  it.each([true, false])('filters attention links by section access (%s)', async (allowed) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          checkedAt: '2026-10-20T12:00:00Z',
          overall: 'attention',
          signals: [
            {
              key: 'reservations',
              label: 'Reservations',
              status: 'healthy',
              headline: 'No reservation needs attention',
              details: [],
              action: null,
            },
            {
              key: 'pms',
              label: 'Property system',
              status: 'attention',
              headline: 'The connection test failed.',
              details: ['Last check: Bad key'],
              action: { label: 'Open settings', section: 'settings' },
            },
            {
              key: 'payments',
              label: 'Payments',
              status: 'healthy',
              headline: 'Payment methods are working',
              details: [],
              action: null,
            },
            {
              key: 'emails',
              label: 'Emails',
              status: 'healthy',
              headline: 'Emails are going out',
              details: [],
              action: null,
            },
          ],
        }),
      ),
    );
    await mount(() => allowed);
    const text = document.body.textContent ?? '';
    for (const label of ['Reservations', 'Property system', 'Payments', 'Emails'])
      expect(text).toContain(label);
    expect(text).toContain('The connection test failed.');
    expect(text).toContain('Needs attention');
    const links = [...document.querySelectorAll<HTMLAnchorElement>('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(links).toEqual(allowed ? ['/dashboard/t?propertyId=p&section=settings'] : []);
  });

  it('shows a clear error when the signals cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 403 })),
    );
    await mount();
    expect(document.body.textContent).toContain('You do not have access to the system health');
  });
});
