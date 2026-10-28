// @vitest-environment jsdom
import { mountMoneyScreen, expectHotelAmount } from '../../lib/money-test-utils';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClockOverviewTiles, ClockRatesOverview } from './clock-rates-overview';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const root = '/api/tenants/t/properties/p';
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));

function mount(
  hiddenRateIds: string[],
  options: {
    pairs?: Record<string, string>;
    sampleCompare?: boolean;
    noCapability?: boolean;
    failSave?: boolean;
  } = {},
) {
  let pairMap = options.pairs ?? {};
  const puts: Array<{ url: string; body: unknown }> = [];
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/capabilities/mine'))
      return Promise.resolve(Response.json(options.noCapability ? [] : ['rates.manage']));
    if (url.endsWith('/clock-rate-pairs'))
      return Promise.resolve(Response.json({ pairs: pairMap }));
    if (url.includes('/clock-rate-pairs/') && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      puts.push({ url, body });
      if (options.failSave)
        return Promise.resolve(
          Response.json({ message: 'Comparison could not be saved.' }, { status: 400 }),
        );
      const id = url.split('/').at(-1)!;
      pairMap = { ...pairMap };
      if (body.compareRateId === null) delete pairMap[id];
      else pairMap[id] = body.compareRateId;
      return Promise.resolve(Response.json(body));
    }
    if (url.endsWith('/clock-website-rates'))
      return Promise.resolve(
        Response.json({
          roomTypes: {
            rt: [
              { externalRateId: '1', name: 'BB', onWebsite: true },
              { externalRateId: '2', name: 'FB', onWebsite: !hiddenRateIds.includes('2') },
              { externalRateId: '3', name: 'Code only', onWebsite: true, requiresCode: true },
              { externalRateId: '4', name: 'Switched off', onWebsite: false },
            ],
          },
        }),
      );
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
    if (url.endsWith('/clock-sample-prices'))
      return Promise.resolve(
        Response.json({
          startsOn: '2026-11-04',
          endsOn: '2026-11-06',
          adults: 2,
          nights: 2,
          roomTypes: {
            rt: [
              { rateId: '1', total: { amount: '210.00', currency: 'EUR' } },
              ...(options.sampleCompare
                ? [{ rateId: '2', total: { amount: '300.00', currency: 'EUR' } }]
                : []),
            ],
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
    await act(async () => reactRoot.unmount());
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
    await act(async () => reactRoot.unmount());
  });

  it('shows what each rate costs for the sample stay, and says when a rate cannot be booked then', async () => {
    const { container, reactRoot } = mount([]);
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
    expect(container.textContent).toContain('Sample stay for the prices below: 2 adults, 2 nights');
    const rows = [...container.querySelectorAll('tbody tr')].map((row) => row.textContent ?? '');
    expect(rows[0]).toContain('Bed & breakfast');
    expect(rows[0]).toMatch(/210/);
    expect(rows[1]).toContain('Full board');
    expect(rows[1]).toContain('Not bookable then');
    await act(async () => reactRoot.unmount());
  });

  it('shows real numbers at the top: rates sold online, room types bookable, rates switched off', async () => {
    const { container, reactRoot } = mount(['2']);
    await act(async () => {
      reactRoot.render(
        createElement(
          DashboardQueryProvider,
          null,
          createElement(ClockOverviewTiles, {
            root,
            types: [
              { id: 'rt', name: 'Double' },
              { id: 'rt-closed', name: 'Suite' },
            ],
          }),
        ),
      );
    });
    await settle();
    const text = container.textContent ?? '';
    expect(text).toContain('1 of 2');
    expect(text).toContain('Rates switched off');
    expect(text).toContain('Last synced with Clock');
    await act(async () => reactRoot.unmount());
  });
});

describe('Clock rate compare-with control', () => {
  const render = async (options: Parameters<typeof mount>[1] = {}) => {
    const mounted = mount([], options);
    await act(async () =>
      mounted.reactRoot.render(
        createElement(
          DashboardQueryProvider,
          null,
          createElement(ClockRatesOverview, { root, types: [{ id: 'rt', name: 'Double' }] }),
        ),
      ),
    );
    await settle();
    return mounted;
  };
  const open = async (button: HTMLButtonElement) => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    await act(async () =>
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
    );
  };
  const choose = async (text: string) => {
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent === text,
    )!;
    await act(async () => option.click());
    await settle();
  };

  it('offers None and only another public rate, saves on change, previews exact sample prices, and clears', async () => {
    const { container, puts, reactRoot } = await render({ sampleCompare: true });
    const select = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Compare BB (Double) with"]',
    )!;
    await open(select);
    expect([...document.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual([
      'None',
      'FB',
    ]);
    await choose('FB');
    expect(puts).toEqual([{ url: `${root}/clock-rate-pairs/1`, body: { compareRateId: '2' } }]);
    expect(container.textContent).toMatch(/Guests will see .*300.* crossed out next to .*210/);
    expect(container.textContent).toContain('Comparison saved.');
    await open(select);
    await choose('None');
    expect(puts.at(-1)).toEqual({
      url: `${root}/clock-rate-pairs/1`,
      body: { compareRateId: null },
    });
    await act(async () => reactRoot.unmount());
  });

  it('says when the paired sample rate is not bookable', async () => {
    const { container, reactRoot } = await render({ pairs: { '1': '2' } });
    expect(container.textContent).toContain('No crossed-out price for the sample stay');
    await act(async () => reactRoot.unmount());
  });

  it('disables pairing without rates.manage', async () => {
    const { container, puts, reactRoot } = await render({ noCapability: true });
    const selects = [...container.querySelectorAll<HTMLButtonElement>('button[role="combobox"]')];
    expect(selects).toHaveLength(2);
    expect(selects.every((select) => select.disabled)).toBe(true);
    expect(puts).toEqual([]);
    await act(async () => reactRoot.unmount());
  });

  it('shows a failed save and keeps the prior pair', async () => {
    const { container, reactRoot } = await render({ failSave: true });
    await open(
      container.querySelector<HTMLButtonElement>('button[aria-label="Compare BB (Double) with"]')!,
    );
    await choose('FB');
    expect(container.textContent).toContain('Comparison could not be saved.');
    expect(
      container.querySelector('button[aria-label="Compare BB (Double) with"]')?.textContent,
    ).toContain('None');
    await act(async () => reactRoot.unmount());
  });
});

it.each(['EUR', 'ALL'])(
  'Clock sample prices keep %s and share one rates query',
  async (currency) => {
    const view = await mountMoneyScreen(
      createElement(ClockRatesOverview, {
        root: '/api/tenants/t/properties/p',
        types: [{ id: 'rt', name: 'Double' }],
      }),
      (url) =>
        url.endsWith('/clock-website-rates/hidden')
          ? { hiddenRateIds: [] }
          : url.endsWith('/clock-sample-prices')
            ? {
                startsOn: '2026-11-04',
                endsOn: '2026-11-06',
                adults: 2,
                nights: 2,
                roomTypes: { rt: [{ rateId: '1', total: { amount: '5000.00', currency } }] },
              }
            : {
                status: 'READY',
                data: {
                  roomTypes: {
                    rt: [
                      { externalRateId: '1', name: 'BB' },
                      { externalRateId: '2', name: 'FB' },
                    ],
                  },
                },
              },
    );
    await expectHotelAmount(view, currency, '5000.00');
    await act(async () => view.root.unmount());
  },
);
