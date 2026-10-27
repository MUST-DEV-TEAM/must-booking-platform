// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClockRatesOverview } from './clock-rates-overview';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const root = '/api/tenants/t/properties/p';
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));

function mount(hiddenRateIds: string[]) {
  const puts: Array<{ url: string; body: unknown }> = [];
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/clock-sync/rates'))
      return Promise.resolve(
        Response.json({
          status: 'READY',
          lastSyncedAt: '2026-10-27T10:00:00Z',
          data: {
            roomTypes: {
              rt: [
                {
                  externalRateId: '1',
                  name: 'BB',
                  label: 'Bed & breakfast',
                  mealNames: ['Breakfast'],
                },
                {
                  externalRateId: '2',
                  name: 'FB',
                  label: 'Full board',
                  mealNames: ['Breakfast', 'Lunch', 'Dinner'],
                },
              ],
            },
          },
        }),
      );
    if (url.endsWith('/clock-website-rates/hidden'))
      return Promise.resolve(Response.json({ hiddenRateIds }));
    if (init?.method === 'PUT') {
      puts.push({ url, body: JSON.parse(String(init.body)) });
      return Promise.resolve(Response.json({ onWebsite: false }));
    }
    return Promise.resolve(Response.json({}));
  });
  vi.stubGlobal('fetch', fetch);
  const container = document.createElement('div');
  document.body.append(container);
  const reactRoot = createRoot(container);
  return { container, puts, reactRoot };
}

describe('Rates by room type: sold on the website', () => {
  it('shows every rate on by default and asks before switching one off', async () => {
    const { container, puts, reactRoot } = mount([]);
    await act(async () => {
      reactRoot.render(
        createElement(
          DashboardQueryProvider,
          null,
          createElement(ClockRatesOverview, { root, types: [{ id: 'rt', name: 'Double' }] }),
        ),
      );
    });
    await settle();
    const switches = [...container.querySelectorAll<HTMLButtonElement>('button[role="switch"]')];
    expect(switches.map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'true']);

    await act(async () => switches[1]!.click());
    expect(document.body.textContent).toContain('Stop selling Full board on the website?');
    expect(puts).toEqual([]);

    const confirm = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Switch off',
    )!;
    await act(async () => confirm.click());
    await settle();
    expect(puts).toEqual([{ url: `${root}/clock-website-rates/2`, body: { onWebsite: false } }]);
    reactRoot.unmount();
  });

  it('shows a rate that staff switched off as off, and turns it back on without asking', async () => {
    const { container, puts, reactRoot } = mount(['2']);
    await act(async () => {
      reactRoot.render(
        createElement(
          DashboardQueryProvider,
          null,
          createElement(ClockRatesOverview, { root, types: [{ id: 'rt', name: 'Double' }] }),
        ),
      );
    });
    await settle();
    const switches = [...container.querySelectorAll<HTMLButtonElement>('button[role="switch"]')];
    expect(switches.map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    await act(async () => switches[1]!.click());
    await settle();
    expect(puts).toEqual([{ url: `${root}/clock-website-rates/2`, body: { onWebsite: true } }]);
    reactRoot.unmount();
  });
});
