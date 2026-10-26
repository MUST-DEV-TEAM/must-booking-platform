// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { RateManagement } from './rate-management';
import { DashboardQueryProvider } from '../query-provider';
import type { PricingWorkspace } from '../pricing-types';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const plan = {
  id: 'p',
  name: 'Flexible',
  currency: 'EUR',
  lifecycle: 'Active',
  version: 1,
  code: 'RP-TEST',
  roomTypeIds: [],
  channels: ['website', 'staff'],
  pricingBasis: 'independent',
  isFallback: true,
};
const workspace: PricingWorkspace = {
  source: 'LOCAL',
  readOnly: false,
  today: '2035-03-01',
  timezone: 'Europe/Tirane',
  bookingMode: 'ROOM_TYPE_ONLY',
  pricingVersion: 1,
  roomTypes: [{ id: 't', name: 'King', status: 'Active' }],
  rooms: [],
  plans: [plan],
  rules: [],
  charges: [],
  base: [],
  roomOverrides: [],
  issues: [],
  coverage: {
    startsOn: '2035-03-01',
    endsOn: '2036-03-01',
    horizonComplete: false,
    pricedCells: 365,
    totalCells: 365,
    percentage: 100,
    example: 'One adult, no children.',
  },
};
function fixture(clock = false, caps = ['rates.manage', 'settings.manage']) {
  const data = clock
    ? { ...workspace, source: 'CLOCK_PMS', readOnly: true, plans: [], coverage: null }
    : workspace;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/clock-sync/rates'))
      return Response.json({
        data: {
          roomTypes: {
            t: [
              { externalRateId: 'a', name: 'Room only', rank: 0 },
              { externalRateId: 'b', name: 'Breakfast', rank: null },
            ],
          },
        },
        status: 'SYNCED',
        lastSyncedAt: '2035-03-01',
      });
    if (url.includes('/clock-sync/availability'))
      return Response.json({
        data: {
          roomTypes: [
            {
              id: 't',
              name: 'King',
              days: [
                {
                  date: '2035-03-01',
                  status: 'available',
                  availableUnits: 2,
                  referencePrice: { amount: '100.00', currency: 'EUR' },
                },
              ],
            },
          ],
        },
        status: 'SYNCED',
        lastSyncedAt: '2035-03-01',
      });
    if (url.endsWith('/clock-sync/status')) return Response.json({ enabled: true, jobs: [] });
    if (url.endsWith('/pms-connection-status'))
      return Response.json({ provider: clock ? 'CLOCK_PMS' : 'LOCAL' });
    if (url.endsWith('/capabilities/mine')) return Response.json(caps);
    if (url.endsWith('/pricing')) return Response.json(data);
    if (url.includes('/pricing/history/')) return Response.json([]);
    if (url.includes('/pricing/calendar'))
      return Response.json({
        rows: [
          {
            id: 't',
            label: 'King',
            days: [
              {
                date: '2035-03-01',
                amount: clock ? null : '100.01',
                currency: clock ? null : 'EUR',
                status: clock ? 'Managed in Clock' : 'Base',
              },
            ],
          },
        ],
      });
    if (url.endsWith('/clock-rate-ranking'))
      return Response.json(
        init?.method === 'PUT'
          ? {
              rates: [
                { externalRateId: 'b', name: 'Breakfast', rank: 0 },
                { externalRateId: 'a', name: 'Room only', rank: 1 },
              ],
            }
          : {
              roomTypes: {
                t: [
                  { externalRateId: 'a', name: 'Room only', rank: 0 },
                  { externalRateId: 'b', name: 'Breakfast', rank: null },
                ],
              },
            },
      );
    if (init?.method === 'POST' && url.endsWith('/pricing/plans'))
      return Response.json(
        { ...plan, id: 'new', name: 'New plan', lifecycle: 'Draft' },
        { status: 201 },
      );
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  return fetch;
}
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 25));
  });
}
async function mount(verified = true) {
  const c = document.createElement('div');
  document.body.append(c);
  root = createRoot(c);
  await act(async () =>
    root!.render(
      createElement(
        DashboardQueryProvider,
        {},
        createElement(RateManagement, {
          tenantId: 'tenant',
          propertyId: 'property',
          emailVerified: verified,
        }),
      ),
    ),
  );
  await settle();
  await settle();
  return c;
}
async function click(text: string) {
  const b = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  expect(b, `button ${text}`).toBeTruthy();
  await act(async () => b!.click());
  await settle();
}
describe('Rates workspace', () => {
  it('fails closed without rates capability and never fetches prices', async () => {
    const f = fixture(false, []);
    const c = await mount();
    expect(c.textContent).toContain('Rates access required');
    expect(f.mock.calls.every(([u]) => u.endsWith('/capabilities/mine'))).toBe(true);
  });
  it('renders six tabs, a complete directory, quick peek and rich detail', async () => {
    fixture();
    const c = await mount();
    expect(c.querySelectorAll('[role="tab"]')).toHaveLength(7);
    expect(c.textContent).toContain('100%');
    await click('Rate plans1');
    expect(c.textContent).toContain('Export CSV');
    await click('Flexible');
    expect(document.body.textContent).toContain('Open detail');
    await click('Open detail');
    expect(c.textContent).toContain('Configuration');
    expect(c.textContent).toContain('Property payment settings apply');
    expect(c.textContent).toContain('Activity');
  });
  it('hides writers for unverified email', async () => {
    fixture();
    const c = await mount(false);
    await click('Rate plans1');
    expect(c.textContent).toContain('Verify your email');
    expect(c.textContent).not.toContain('Create rate plan');
  });
  it('shows provider unknowns, hides all local editors and preserves the MUST priority action', async () => {
    const f = fixture(true);
    const c = await mount();
    expect(c.textContent).toContain('Managed in Clock');
    expect(c.textContent).not.toContain('100%');
    expect(f.mock.calls.some(([u]) => u.endsWith('/clock-rate-ranking'))).toBe(false);
    expect(c.textContent).toContain('Room only');
    expect(c.textContent).not.toContain('Load Clock rate list');
    const up = Array.from(c.querySelectorAll('button')).filter((b) => b.textContent === 'Move up');
    await act(async () => up[1]!.click());
    await click('Save rate priority');
    const call = f.mock.calls.find(([, i]) => i?.method === 'PUT');
    expect(JSON.parse(call![1]!.body as string)).toEqual({ externalRateIds: ['b', 'a'] });
    await click('Rate plans');
    expect(c.textContent).toContain('Clock rates by room type');
    expect(c.textContent).not.toContain('Create rate plan');
    await click('Base prices');
    expect(c.textContent).toContain('Reference price');
    expect(c.querySelector('[aria-label^="Edit King"]')).toBeNull();
  });
  it('opens a new draft editor without writing until save', async () => {
    const f = fixture();
    await mount();
    await click('Rate plans1');
    await click('Create rate plan');
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(document.body.textContent).toContain('Identity');
    expect(f.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
  });
});
