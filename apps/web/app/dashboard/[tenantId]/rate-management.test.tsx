// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { RateManagement } from './rate-management';
import { DashboardQueryProvider } from '../query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

describe('RateManagement', () => {
  it('renders the tenant-scoped rate-plan entry point', () => {
    const markup = renderToStaticMarkup(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(RateManagement, { tenantId: 'tenant-1' }),
      ),
    );

    expect(markup).toContain('Rate plans and calendar overrides');
    expect(markup).toContain('Select a property');
  });
});

describe('RateManagement — Clock-connected property (Task 13)', () => {
  const base = '/api/tenants/tenant-1/properties/property-1';

  function response(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('shows the local rate-plan CRUD read+map priority list instead, and saves a reordered priority', async () => {
    const ranking = {
      rates: [
        { externalRateId: 'r0', name: 'DBL - Summer', maxAdults: 6, maxChildren: 6, rank: 0 },
        { externalRateId: 'r1', name: 'DBL - Summer 2', maxAdults: 7, maxChildren: 7, rank: null },
      ],
    };
    const savedRanking = {
      rates: [
        { externalRateId: 'r1', name: 'DBL - Summer 2', maxAdults: 7, maxChildren: 7, rank: 0 },
        { externalRateId: 'r0', name: 'DBL - Summer', maxAdults: 6, maxChildren: 6, rank: 1 },
      ],
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === `${base}/room-types`)
        return Promise.resolve(response([{ id: 'room-type-1', name: 'DBL' }]));
      if (url === `${base}/rate-plans`) return Promise.resolve(response([]));
      if (url === `${base}/pms-connection-status`)
        return Promise.resolve(response({ provider: 'CLOCK_PMS' }));
      if (url === `${base}/room-types/room-type-1/clock-rate-ranking` && (!init || init.method === undefined))
        return Promise.resolve(response(ranking));
      if (url === `${base}/room-types/room-type-1/clock-rate-ranking` && init?.method === 'PUT')
        return Promise.resolve(response(savedRanking));
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(RateManagement, { tenantId: 'tenant-1', propertyId: 'property-1' }),
        ),
      );
    });
    await settle();

    expect(container.textContent).toContain('This property is connected to Clock PMS');
    expect(container.textContent).not.toContain('Add rate plan');
    expect(container.textContent).toContain('DBL - Summer 2');
    expect(container.textContent).toContain('not yet ranked');

    // Move the second row ("DBL - Summer 2") up, ahead of the ranked "DBL - Summer".
    const moveUpButtons = Array.from(container.querySelectorAll('button')).filter(
      (button) => button.textContent === 'Move up',
    );
    expect(moveUpButtons).toHaveLength(2);
    await act(async () => {
      moveUpButtons[1]!.click();
    });
    await settle();

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save rate priority',
    )!;
    expect(saveButton.hasAttribute('disabled')).toBe(false);
    await act(async () => {
      saveButton.click();
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(
      `${base}/room-types/room-type-1/clock-rate-ranking`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ externalRateIds: ['r1', 'r0'] }),
      }),
    );
    expect(toast.success).toHaveBeenCalledWith('DBL: rate priority saved.');

    root.unmount();
    container.remove();
  });
});

async function settle() {
  await act(async () => {
    for (let iteration = 0; iteration < 6; iteration += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      await Promise.resolve();
    }
  });
}
