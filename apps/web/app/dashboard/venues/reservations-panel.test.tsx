// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardQueryProvider } from '../query-provider';
import { ReservationsPanel } from './reservations-panel';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
it('uses server search for the directory while the calendar always fetches all occupied tables', async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/reservations?'))
        return Response.json({ timezone: 'UTC', reservations: [], total: 0 });
      if (url.endsWith('/services')) return Response.json([]);
      return Response.json({ areas: [] });
    }),
  );
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(ReservationsPanel, {
          tenantId: 'tenant',
          venueId: 'venue',
          timezone: 'UTC',
          canManage: true,
        }),
      ),
    );
    await settle();
  });
  await act(settle);
  await act(settle);
  await act(async () => {
    const search = document.querySelector<HTMLInputElement>('[aria-label="Search all records"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'Ari');
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  });
  expect(calls.some((url) => url.includes('q=Ari'))).toBe(true);
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.trim() === 'Calendar')!
      .click();
    await settle();
  });
  await act(settle);
  const query = new URL(
    calls.filter((url) => url.includes('/reservations?')).at(-1)!,
    'http://localhost',
  ).searchParams;
  expect(query.has('q')).toBe(false);
  expect(query.has('status')).toBe(false);
  expect(document.querySelector('[aria-label="Previous day"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Search all records"]')).toBeNull();
  expect(document.querySelector('[aria-label="Status"]')).toBeNull();
});
