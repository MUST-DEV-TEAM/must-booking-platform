// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardQueryProvider } from '../query-provider';
import { RestaurantSetupWizard } from './restaurant-setup-wizard';

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
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  );
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
    await settle();
  });
}
async function type(selector: string, value: string) {
  const el = document.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  });
}

const baseVenue = {
  id: 'v1',
  propertyId: 'p',
  name: 'Hotel Restaurant',
  slug: 'hotel-restaurant',
  timezone: 'Europe/Tirane',
  currency: 'ALL',
  address: null,
  phone: null,
  contactEmail: null,
  active: true,
  description: null,
  setupCompletedAt: null,
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
const dinner = {
  id: 's1',
  name: 'Dinner',
  days: [1, 2, 3, 4, 5],
  opensAt: '19:00',
  closesAt: '23:00',
  slotMinutes: 30,
};
const table = {
  id: 't1',
  areaId: 'a1',
  label: 'T1',
  minSeats: 2,
  maxSeats: 4,
  mapX: 20,
  mapY: 20,
  mapWidth: 80,
  mapHeight: 80,
  shape: 'square',
  active: true,
};
const withTable = {
  areas: [
    {
      id: 'a1',
      name: 'Terrace',
      sortOrder: 0,
      mapWidth: 1000,
      mapHeight: 700,
      active: true,
      tables: [table],
    },
  ],
  combinations: [],
};
const noTables = { areas: [], combinations: [] };

type Options = {
  venue?: Partial<typeof baseVenue>;
  services?: unknown[];
  layout?: unknown;
  /** The answer to "finish setup". */
  finish?: { status: number; body: unknown };
};

async function mount(options: Options = {}) {
  const venue = { ...baseVenue, ...options.venue };
  const services = options.services ?? [];
  const layout = options.layout ?? noTables;
  const calls: Array<[string, RequestInit | undefined]> = [];
  const finished: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      const method = init?.method ?? 'GET';
      if (url === '/api/tenants/t/venues/v1' && method === 'PATCH')
        return Response.json({ ...venue, ...JSON.parse(init!.body as string) });
      if (url === '/api/tenants/t/venues/v1/complete-setup') {
        const answer = options.finish ?? {
          status: 201,
          body: { ...venue, setupCompletedAt: '2026-11-04T10:00:00Z' },
        };
        return Response.json(answer.body, { status: answer.status });
      }
      if (url === '/api/tenants/t/venues/v1/deposit-rules')
        return Response.json({
          version: 0,
          currency: 'ALL',
          requiresLegacyConversion: false,
          rules: method === 'PUT' ? JSON.parse(init!.body as string).rules : [],
        });
      if (url === '/api/tenants/t/venues/v1/services' && method === 'PUT')
        return Response.json(JSON.parse(init!.body as string).services);
      if (url === '/api/tenants/t/venues/v1/services') return Response.json(services);
      if (url === '/api/tenants/t/venues/v1/layout') return Response.json(layout);
      if (url === '/api/tenants/t/venues/v1') return Response.json(venue);
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
        createElement(RestaurantSetupWizard, {
          tenantId: 't',
          venueId: 'v1',
          onFinished: () => finished.push('done'),
        }),
      ),
    );
    await settle();
  });
  await act(settle);
  await act(settle);
  return { calls, finished };
}
const sent = (calls: Array<[string, RequestInit | undefined]>, method: string, url: string) =>
  calls.filter(([u, init]) => u === url && (init?.method ?? 'GET') === method);
const body = (call: [string, RequestInit | undefined]) => JSON.parse(call[1]!.body as string);

describe('RestaurantSetupWizard', () => {
  it('opens at the basics when the time zone or currency is missing', async () => {
    await mount({ venue: { currency: null } as never });
    expect(text()).toContain('Step 1 of 5: Basics');
  });

  it('opens at the first step that is not done yet', async () => {
    await mount();
    expect(text()).toContain('Step 2 of 5: Opening hours');
    await mount({ services: [dinner] });
    expect(text()).toContain('Step 3 of 5: Tables');
  });

  it('opens at the booking rules when the essentials are already in place', async () => {
    await mount({ services: [dinner], layout: withTable });
    expect(text()).toContain('Step 4 of 5: Booking rules');
  });

  it('will not save the basics without a name, and saves them tidied up', async () => {
    const { calls } = await mount({ venue: { timezone: null } as never });
    await type('#setup-name', '  ');
    await click(button('Save and continue')!);
    expect(text()).toContain('Enter a name for the restaurant.');
    expect(sent(calls, 'PATCH', '/api/tenants/t/venues/v1')).toHaveLength(0);

    await type('#setup-name', ' Terrace Grill ');
    expect(document.querySelector('#setup-timezone')).toBeNull();
    expect(document.querySelector('[aria-label="Country prefix"]')).not.toBeNull();
    await click(button('Save and continue')!);
    expect(body(sent(calls, 'PATCH', '/api/tenants/t/venues/v1')[0]!)).toMatchObject({
      name: 'Terrace Grill',
      timezone: 'UTC',
      currency: 'ALL',
    });
    expect(text()).toContain('Step 2 of 5: Opening hours');
  });

  it('starts the opening hours with a dinner to change, and saves them', async () => {
    const { calls } = await mount();
    expect((document.querySelector('#hours-name-0') as HTMLInputElement).value).toBe('Dinner');
    await click(button('Save and continue')!);
    expect(body(sent(calls, 'PUT', '/api/tenants/t/venues/v1/services')[0]!).services).toEqual([
      {
        name: 'Dinner',
        days: [1, 2, 3, 4, 5, 6, 7],
        opensAt: '19:00',
        closesAt: '23:00',
        slotMinutes: 30,
      },
    ]);
    expect(text()).toContain('Step 3 of 5: Tables');
  });

  it('asks for at least one opening time', async () => {
    const { calls } = await mount();
    await click(document.querySelector<HTMLElement>('[aria-label="Remove Dinner"]')!);
    await click(button('Save and continue')!);
    expect(text()).toContain('Add at least one opening time.');
    expect(sent(calls, 'PUT', '/api/tenants/t/venues/v1/services')).toHaveLength(0);
  });

  it('keeps Continue off until there is at least one table', async () => {
    await mount({ services: [dinner] });
    expect(text()).toContain('Add at least one table to continue.');
    expect(button('Continue')!.disabled).toBe(true);
  });

  it('saves the booking rules and moves on to the deposit', async () => {
    const { calls } = await mount({ services: [dinner], layout: withTable });
    await click(
      document.querySelector<HTMLElement>(
        '[aria-label="More largest group that can book online"]',
      )!,
    );
    await click(
      document.querySelector<HTMLElement>(
        '[aria-label="More largest group that can book online"]',
      )!,
    );
    await click(button('Save and continue')!);
    expect(body(sent(calls, 'PATCH', '/api/tenants/t/venues/v1')[0]!)).toMatchObject({
      maxOnlinePartySize: 10,
      advanceBookingDays: 60,
    });
    expect(text()).toContain('Step 5 of 5: Deposits');
  });

  it('keeps rule steppers within the saved API limits', async () => {
    await mount({ services: [dinner], layout: withTable, venue: { holdMinutes: 5 } });
    expect(
      document.querySelector<HTMLButtonElement>(
        '[aria-label="Fewer how long is a table held while a guest pays? (minutes)"]',
      )!.disabled,
    ).toBe(true);
  });

  it('opens the existing map editor in the tables setup step', async () => {
    await mount({ services: [dinner], layout: withTable });
    await click(button('Back')!);
    expect(document.querySelector('[aria-label="Terrace floor map"]')).not.toBeNull();
    expect(button('Save layout')).toBeDefined();
  });

  it('saves fixed deposit rules through the shared matrix, then finishes setup', async () => {
    const { calls, finished } = await mount({ services: [dinner], layout: withTable });
    await click(button('Save and continue')!);
    expect(text()).toContain('Restaurant default');
    expect(text()).toContain('Service default');
    expect(text()).toContain('Terrace');
    await click(button('Save and finish setup')!);
    expect(body(sent(calls, 'PUT', '/api/tenants/t/venues/v1/deposit-rules')[0]!)).toEqual({
      version: 0,
      rules: [],
    });
    expect(sent(calls, 'POST', '/api/tenants/t/venues/v1/complete-setup')).toHaveLength(1);
    expect(finished).toEqual(['done']);
  });

  it('lets the deposit be skipped and still finishes', async () => {
    const { calls, finished } = await mount({ services: [dinner], layout: withTable });
    await click(button('Save and continue')!);
    const patchesBefore = sent(calls, 'PATCH', '/api/tenants/t/venues/v1').length;
    await click(button('Skip for now')!);
    expect(sent(calls, 'PATCH', '/api/tenants/t/venues/v1')).toHaveLength(patchesBefore);
    expect(sent(calls, 'POST', '/api/tenants/t/venues/v1/complete-setup')).toHaveLength(1);
    expect(finished).toEqual(['done']);
  });

  it('offers fixed rates instead of an unpriced percentage', async () => {
    await mount({ services: [dinner], layout: withTable });
    await click(button('Save and continue')!);
    expect(text()).not.toContain('A percentage');
    await click(button('Inherit: No deposit')!);
    expect(text()).toContain('Restaurant default');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(button('Apply rule')).toBeDefined();
  });

  it('goes back to the step that is missing when finishing is refused', async () => {
    await mount({
      services: [dinner],
      layout: withTable,
      finish: {
        status: 400,
        body: {
          message: 'Finish the required steps before completing the setup.',
          code: 'SETUP_INCOMPLETE',
          missing: ['hours'],
        },
      },
    });
    await click(button('Save and continue')!);
    await click(button('Skip for now')!);
    expect(text()).toContain('Please finish the opening hours first.');
    expect(text()).toContain('Step 2 of 5: Opening hours');
  });
});
