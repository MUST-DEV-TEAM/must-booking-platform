// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

import { TaxesFeesSettings } from './taxes-fees';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const workspace = (readOnly: boolean) => ({
  source: readOnly ? 'CLOCK_PMS' : 'LOCAL',
  readOnly,
  today: '2026-11-23',
  timezone: 'Europe/Tirane',
  bookingMode: 'LOCAL',
  pricingVersion: 1,
  roomTypes: [],
  rooms: [],
  plans: [],
  rules: [],
  charges: [
    {
      id: 'c1',
      name: 'City tax',
      lifecycle: 'Active',
      version: 2,
      roomTypeIds: [],
      category: 'tourist_tax',
      basis: 'per_person_night',
      value: '2.00',
      display: 'added',
      confirmed: true,
    },
  ],
  base: [],
  roomOverrides: [],
  issues: [],
  coverage: null,
});

async function mount(readOnly = false, canWrite = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(workspace(readOnly))),
  );
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () =>
    root!.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(TaxesFeesSettings, { tenantId: 't', propertyId: 'p', canWrite }),
      ),
    ),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  return host;
}

it('lists the taxes and fees with how they are calculated and shown, and explains the price rules', async () => {
  const host = await mount();
  const text = host.textContent ?? '';
  expect(text).toContain('How you enter prices');
  expect(text).toContain('before taxes and fees');
  expect(text).toContain('one total with every mandatory tax and fee included');
  expect(text).toContain('City tax');
  expect(text).toContain('Tourist tax');
  expect(text).toContain('Per person per night');
  expect(text).toContain('Added as a separate line');
  expect(text).toContain('Example price');
});
it('offers Create tax or fee only to someone who can change prices', async () => {
  const writer = await mount();
  expect(
    [...writer.querySelectorAll('button')].some((b) => b.textContent === 'Create tax or fee'),
  ).toBe(true);
  await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  const viewer = await mount(false, false);
  expect(
    [...viewer.querySelectorAll('button')].some((b) => b.textContent === 'Create tax or fee'),
  ).toBe(false);
});
it('says taxes are calculated in Clock for a Clock hotel', async () => {
  const host = await mount(true);
  expect(host.textContent).toContain('Taxes are calculated in Clock');
  expect(host.textContent).not.toContain('Create tax or fee');
});
