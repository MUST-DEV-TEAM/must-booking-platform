// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardQueryProvider } from '../query-provider';
import { RestaurantIntegrationCard } from './restaurant-integration-card';

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

type State = {
  available: boolean;
  venue: null | { id: string; name: string; active: boolean; setupCompletedAt: string | null };
};

async function mount(initial: State, canWrite = true) {
  const state = { ...initial };
  const calls: Array<[string, RequestInit | undefined]> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (init?.method === 'POST' && url.endsWith('/restaurant/activate')) {
        state.venue = { id: 'v1', name: 'Hotel Restaurant', active: true, setupCompletedAt: null };
        return Response.json(state, { status: 201 });
      }
      if (init?.method === 'POST' && url.endsWith('/restaurant/deactivate')) {
        state.venue = { ...state.venue!, active: false };
        return Response.json(state, { status: 201 });
      }
      if (url === '/api/tenants/t/properties/p/restaurant') return Response.json(state);
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
        createElement(RestaurantIntegrationCard, { tenantId: 't', propertyId: 'p', canWrite }),
      ),
    );
    await settle();
  });
  await act(settle);
  return calls;
}
const posted = (calls: Array<[string, RequestInit | undefined]>, suffix: string) =>
  calls.some(([url, init]) => url.endsWith(suffix) && init?.method === 'POST');

describe('RestaurantIntegrationCard', () => {
  it('starts off and offers to activate it', async () => {
    await mount({ available: true, venue: null });
    expect(text()).toContain('Restaurant');
    expect(text()).toContain('Off');
    expect(button('Activate')).toBeDefined();
    expect(button('Deactivate')).toBeUndefined();
  });

  it('switches on when Activate is pressed and then offers Deactivate', async () => {
    const calls = await mount({ available: true, venue: null });
    await click(button('Activate')!);
    expect(posted(calls, '/restaurant/activate')).toBe(true);
    expect(text()).toContain('On');
    expect(button('Deactivate')).toBeDefined();
  });

  it('tells the owner when the setup guide still has to be finished', async () => {
    await mount({
      available: true,
      venue: { id: 'v1', name: 'Hotel Restaurant', active: true, setupCompletedAt: null },
    });
    expect(text()).toContain('Open Restaurants in the menu to finish the setup');
  });

  it('asks before switching it off, and says nothing is lost', async () => {
    const calls = await mount({
      available: true,
      venue: {
        id: 'v1',
        name: 'Hotel Restaurant',
        active: true,
        setupCompletedAt: '2026-11-04T10:00:00Z',
      },
    });
    await click(button('Deactivate')!);
    expect(text()).toContain('Everything you set up is kept');
    expect(posted(calls, '/restaurant/deactivate')).toBe(false);
    await click(button('Switch off')!);
    expect(posted(calls, '/restaurant/deactivate')).toBe(true);
  });

  it('offers activation without plan upgrade messaging', async () => {
    await mount({ available: true, venue: null });
    expect(text()).not.toContain('Not included');
    expect(button('Activate')).toBeDefined();
  });

  it('shows the state but no buttons to someone who cannot change settings', async () => {
    await mount({ available: true, venue: null }, false);
    expect(text()).toContain('Off');
    expect(button('Activate')).toBeUndefined();
  });
});
