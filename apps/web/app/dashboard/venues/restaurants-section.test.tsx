// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardQueryProvider } from '../query-provider';
import { RestaurantsSection } from './restaurants-section';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 15));
};
const text = () => document.body.textContent ?? '';
const tab = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) =>
    t.textContent?.includes(label),
  );
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
    await settle();
  });
}

const settings = {
  propertyId: 'p',
  timezone: 'Europe/Tirane',
  currency: 'ALL',
  address: null,
  phone: null,
  contactEmail: null,
  description: null,
  advanceBookingDays: 60,
  maxOnlinePartySize: 8,
  holdMinutes: 10,
  lastBookingMinutesBeforeClose: 60,
  diningMinutes: 90,
  depositMode: 'none',
  depositValue: '0.00',
  depositMinParty: 1,
  freeCancelHours: 24,
};
const finished = '2026-11-04T10:00:00Z';
const grill = {
  ...settings,
  id: 'v1',
  name: 'Terrace Grill',
  slug: 'terrace-grill',
  active: true,
  setupCompletedAt: finished,
};
const bar = {
  ...settings,
  id: 'v2',
  name: 'Rooftop Bar',
  slug: 'rooftop-bar',
  active: true,
  setupCompletedAt: finished,
};
const unfinished = { ...grill, setupCompletedAt: null };

type Options = {
  dining?: boolean;
  venues?: Array<{ id: string; name: string }>;
  role?: 'OWNER' | 'ADMIN' | 'STAFF';
  venueId?: string | null;
  /** Whether the staff list (the "may manage this restaurant" probe) is allowed. */
  canManage?: boolean;
};

async function mount(options: Options = {}) {
  const calls: string[] = [];
  const selected: string[] = [];
  const venues = options.venues ?? [grill];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url === '/api/tenants/t/plan-usage')
        return Response.json({
          plan: {
            name: 'Pro',
            readOnly: false,
            diningEnabled: options.dining !== false,
            maxVenues: 3,
          },
        });
      if (url === '/api/tenants/t/venues') return Response.json(venues);
      const venue = venues.find((v) => url.startsWith(`/api/tenants/t/venues/${v.id}`));
      if (venue && url.endsWith('/layout')) return Response.json({ areas: [], combinations: [] });
      if (venue && url.endsWith('/services')) return Response.json([]);
      if (venue && url.includes('/reservations'))
        return Response.json({ timezone: 'UTC', reservations: [] });
      if (venue && url.endsWith('/staff'))
        return options.canManage
          ? Response.json([])
          : Response.json({ message: 'no' }, { status: 403 });
      if (venue) return Response.json(venue);
      return Response.json({});
    }),
  );
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(RestaurantsSection, {
          tenantId: 't',
          role: options.role ?? 'OWNER',
          venueId: options.venueId ?? null,
          onSelectVenue: (id: string) => selected.push(id),
        }),
      ),
    );
    await settle();
  });
  for (let i = 0; i < 4; i++) await act(settle);
  return { calls, selected };
}

describe('RestaurantsSection', () => {
  it('loads restaurants regardless of legacy plan dining metadata', async () => {
    const { calls } = await mount({ dining: false });
    expect(text()).toContain('Terrace Grill');
    expect(calls).toContain('/api/tenants/t/venues');
    expect(text()).not.toContain('does not include restaurants');
  });

  it('opens the only finished restaurant straight away, with no list in between', async () => {
    await mount();
    expect(text()).toContain('Terrace Grill');
    expect(text()).toContain('Table bookings');
    expect(tab('Today')).toBeDefined();
    expect(tab('Terrace Grill')).toBeUndefined();
  });

  it('shows a tab per restaurant when there are several, with the requested one open', async () => {
    await mount({ venues: [grill, bar], venueId: 'v2' });
    expect(tab('Terrace Grill')).toBeDefined();
    expect(tab('Rooftop Bar')!.getAttribute('aria-selected')).toBe('true');
  });

  it('reports the restaurant that was picked', async () => {
    const { selected } = await mount({ venues: [grill, bar] });
    await click(tab('Rooftop Bar')!);
    expect(selected).toEqual(['v2']);
  });

  it('shows the setup guide to an owner until the first-time setup is finished', async () => {
    await mount({ venues: [unfinished] });
    expect(text()).toContain('Set up Terrace Grill');
    // The basics are already filled in from the hotel, so it opens at the opening hours.
    expect(text()).toContain('Step 2 of 5: Opening hours');
  });

  it('shows the setup guide to the restaurant manager too', async () => {
    await mount({ venues: [unfinished], role: 'STAFF', canManage: true });
    expect(text()).toContain('Set up Terrace Grill');
  });

  it('tells a waiter the restaurant is not ready yet, without the setup guide', async () => {
    await mount({ venues: [unfinished], role: 'STAFF', canManage: false });
    expect(text()).toContain('Terrace Grill is not ready yet');
    expect(text()).not.toContain('Set up Terrace Grill');
  });

  it('says it is switched off, and where to switch it on, when nothing is active', async () => {
    await mount({ venues: [{ ...grill, active: false }] });
    expect(text()).toContain('The restaurant is switched off');
    expect(text()).toContain('Settings → Integrations');
  });

  it('asks staff to contact an administrator when the restaurant is switched off', async () => {
    await mount({ venues: [], role: 'STAFF' });
    expect(text()).toContain('Ask an owner or administrator');
  });
});
