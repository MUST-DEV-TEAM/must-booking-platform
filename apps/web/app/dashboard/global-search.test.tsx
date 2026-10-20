// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlobalSearch, searchItemHref } from './global-search';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const wait = async (ms: number) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};
async function mount() {
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(GlobalSearch, { tenantId: 't', propertyId: 'p' }),
      ),
    );
  });
}
async function type(value: string) {
  const el = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wait(350);
}
async function settled() {
  for (let i = 0; i < 40; i++) {
    if (!(document.body.textContent ?? '').includes('Searching…')) return;
    await wait(50);
  }
}

describe('global search', () => {
  it('builds links to the right pages', () => {
    expect(searchItemHref('t', 'p', { type: 'booking', id: 'b1', title: '', subtitle: '' })).toBe(
      '/dashboard/t?propertyId=p&section=reservations&reservation=b1',
    );
    expect(searchItemHref('t', 'p', { type: 'guest', id: 'g1', title: '', subtitle: '' })).toBe(
      '/dashboard/t?propertyId=p&section=guests&guest=g1',
    );
    expect(searchItemHref('t', 'p', { type: 'room', id: 'r1', title: '', subtitle: '' })).toBe(
      '/dashboard/t?propertyId=p&section=accommodations',
    );
  });

  it('waits for two letters, then shows grouped results with links', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        query: 'zelda',
        groups: [
          {
            key: 'bookings',
            label: 'Reservations',
            items: [
              {
                type: 'booking',
                id: 'b1',
                title: 'SRCH-1001 · Zelda',
                subtitle: '2027-05-01 – 2027-05-03 · confirmed',
              },
            ],
          },
          {
            key: 'guests',
            label: 'Guests',
            items: [
              {
                type: 'guest',
                id: 'g1',
                title: 'Zelda Searchable',
                subtitle: 'zelda@example.test',
              },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    await mount();
    await type('z');
    expect(fetch).not.toHaveBeenCalled();
    await type('ze');
    await settled();
    expect(String(fetch.mock.calls.at(-1)![0])).toContain('/search?q=ze');
    const text = document.body.textContent ?? '';
    expect(text).toContain('Reservations');
    expect(text).toContain('Guests');
    expect(text).toContain('SRCH-1001 · Zelda');
    const links = [...document.querySelectorAll<HTMLAnchorElement>('[role="option"]')].map((a) =>
      a.getAttribute('href'),
    );
    expect(links).toEqual([
      '/dashboard/t?propertyId=p&section=reservations&reservation=b1',
      '/dashboard/t?propertyId=p&section=guests&guest=g1',
    ]);
  });

  it('says so when nothing matches and when search fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ query: 'nomatch', groups: [] })),
    );
    await mount();
    await type('nomatch');
    await settled();
    expect(document.body.textContent).toContain('No results for “nomatch”.');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    await type('another');
    await settled();
    expect(document.body.textContent).toContain('Search is unavailable.');
  });

  it('closes on Escape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ query: 'ab', groups: [] })),
    );
    await mount();
    await type('ab');
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    await act(async () => {
      document
        .querySelector('input[type="search"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });
});
