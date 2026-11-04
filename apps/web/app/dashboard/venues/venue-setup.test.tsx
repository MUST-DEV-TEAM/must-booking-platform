// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardQueryProvider } from '../query-provider';
import { VenueSetup } from './venue-setup';

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
const tab = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) =>
    t.textContent?.includes(label),
  );

async function mount(openLayout = true) {
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(VenueSetup, { tenantId: 't', venueId: 'v1' }),
      ),
    );
    await settle();
  });
  await act(settle);
  await act(settle);
  if (openLayout) {
    await act(async () => {
      tab('Layout')!.click();
      await settle();
    });
    await act(settle);
  }
}
async function type(selector: string, value: string) {
  const el = document.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  });
}
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
    await settle();
  });
}

const table = (id: string, label: string, minSeats: number, maxSeats: number) => ({
  id,
  areaId: 'a1',
  label,
  minSeats,
  maxSeats,
  mapX: 10,
  mapY: 10,
  mapWidth: 80,
  mapHeight: 80,
  shape: 'square',
  active: true,
});
const layoutWithAreas = {
  areas: [
    {
      id: 'a1',
      name: 'Terrace',
      sortOrder: 0,
      mapWidth: 1000,
      mapHeight: 700,
      active: true,
      tables: [table('t1', 'T1', 2, 4), table('t2', 'T2', 4, 4)],
    },
    {
      id: 'a2',
      name: 'Indoor',
      sortOrder: 1,
      mapWidth: 1000,
      mapHeight: 700,
      active: true,
      tables: [],
    },
  ],
  combinations: [],
};

function stubFetch(layout: unknown, options: { staffStatus?: number } = {}) {
  const calls: Array<[string, RequestInit | undefined]> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (init?.method === 'POST') return Response.json({ id: 'new' }, { status: 201 });
      if (url === '/api/tenants/t/venues/v1')
        return Response.json({ id: 'v1', name: 'Terrace Grill', active: true });
      if (url === '/api/tenants/t/venues/v1/layout') return Response.json(layout);
      if (url.startsWith('/api/tenants/t/venues/v1/reservations'))
        return Response.json({ timezone: 'UTC', reservations: [] });
      if (url === '/api/tenants/t/venues/v1/staff')
        return options.staffStatus === 403
          ? Response.json({ message: 'Missing required capability.' }, { status: 403 })
          : Response.json([]);
      return Response.json({});
    }),
  );
  return calls;
}
const posted = (calls: Array<[string, RequestInit | undefined]>, url: string) =>
  calls.find(([u, init]) => u === url && init?.method === 'POST');

describe('VenueSetup', () => {
  it('shows the restaurant, its areas and the tables of the first area', async () => {
    stubFetch(layoutWithAreas);
    await mount();
    expect(text()).toContain('Terrace Grill');
    expect(tab('Terrace')).toBeDefined();
    expect(tab('Indoor')).toBeDefined();
    expect(text()).toContain('T1');
    expect(text()).toContain('2 to 4 seats');
    expect(text()).toContain('4 seats');
  });

  it('switches to another area and says when it has no tables', async () => {
    stubFetch(layoutWithAreas);
    await mount();
    await click(tab('Indoor')!);
    expect(text()).toContain('No tables in this area yet.');
  });

  it('switches from the table list to the floor map of the selected area', async () => {
    stubFetch(layoutWithAreas);
    await mount();
    expect(document.querySelector('[aria-label="Terrace floor map"]')).toBeNull();
    await click(tab('Map')!);
    expect(document.querySelector('[aria-label="Terrace floor map"]')).not.toBeNull();
    await click(tab('Tables')!);
    expect(document.querySelector('[aria-label="Terrace floor map"]')).toBeNull();
  });

  it('keeps staff management on the main Staff page, even for managers', async () => {
    stubFetch(layoutWithAreas);
    await mount();
    expect(tab('Staff')).toBeUndefined();
    expect(text()).not.toContain('Create account');
  });

  it('hides the Staff section from people who may not manage restaurant staff', async () => {
    stubFetch(layoutWithAreas, { staffStatus: 403 });
    await mount();
    expect(tab('Staff')).toBeUndefined();
    expect(tab('Terrace')).toBeDefined();
  });

  it('adds a table to the selected area', async () => {
    const calls = stubFetch(layoutWithAreas);
    await mount();
    await click(button('Add table')!);
    await type('#table-label', 'T3');
    await type('#table-min', '2');
    await type('#table-max', '4');
    await click(button('Save table')!);
    const call = posted(calls, '/api/tenants/t/venues/v1/areas/a1/tables');
    expect(call).toBeDefined();
    expect(JSON.parse(call![1]!.body as string)).toEqual({
      label: 'T3',
      minSeats: 2,
      maxSeats: 4,
      shape: 'square',
      notes: '',
      features: [],
      onlineBookable: true,
      priority: 0,
    });
  });

  it('saves notes, features, online eligibility and priority from the table form', async () => {
    const calls = stubFetch(layoutWithAreas);
    await mount();
    await click(button('Add table')!);
    await type('#table-label', 'Window');
    await type('#table-min', '1');
    await type('#table-max', '4');
    await type('#table-priority', '20');
    const notes = document.querySelector<HTMLTextAreaElement>('#table-notes')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        notes,
        'Quiet corner',
      );
      notes.dispatchEvent(new Event('input', { bubbles: true }));
      await settle();
    });
    const labels = [...document.querySelectorAll<HTMLLabelElement>('label')];
    await click(
      labels
        .find((label) => label.textContent === 'Window')!
        .querySelector<HTMLElement>('[role="checkbox"]')!,
    );
    await click(
      labels
        .find((label) => label.textContent === 'Can be booked online')!
        .querySelector<HTMLElement>('[role="checkbox"]')!,
    );
    await click(button('Save table')!);
    expect(
      JSON.parse(posted(calls, '/api/tenants/t/venues/v1/areas/a1/tables')![1]!.body as string),
    ).toMatchObject({
      notes: 'Quiet corner',
      features: ['window'],
      onlineBookable: false,
      priority: 20,
    });
  });

  it('will not save a table whose maximum seats are below its minimum', async () => {
    const calls = stubFetch(layoutWithAreas);
    await mount();
    await click(button('Add table')!);
    await type('#table-label', 'T3');
    await type('#table-min', '4');
    await type('#table-max', '2');
    await click(button('Save table')!);
    expect(text()).toContain('Maximum seats cannot be less than minimum seats.');
    expect(posted(calls, '/api/tenants/t/venues/v1/areas/a1/tables')).toBeUndefined();
  });

  it('invites the first area when there are none, and creates it', async () => {
    const calls = stubFetch({ areas: [], combinations: [] });
    await mount();
    expect(text()).toContain('No areas yet');
    await click(button('Add area')!);
    await type('#area-name', 'Terrace');
    await click(button('Save area')!);
    const call = posted(calls, '/api/tenants/t/venues/v1/areas');
    expect(JSON.parse(call![1]!.body as string)).toEqual({ name: 'Terrace' });
  });
});
