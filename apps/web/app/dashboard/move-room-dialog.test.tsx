// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { MoveRoomDialog } from './move-room-dialog';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, client: QueryClient | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  client?.clear();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const settle = async () => {
  await new Promise((r) => setTimeout(r, 50));
};
async function mount(data: object) {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
    Response.json(init?.method === 'POST' ? { ok: true } : data),
  );
  vi.stubGlobal('fetch', fetcher);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(MoveRoomDialog, {
          tenantId: 't',
          propertyId: 'p',
          bookingId: 'b',
          onClose: vi.fn(),
          onSaved: async () => {},
        }),
      ),
    );
    await settle();
  });
  await act(settle);
  return fetcher;
}
it('shows saved synchronization freshness without a foreground provider search', async () => {
  const fetcher = await mount({
    version: 2,
    roomId: 'old',
    eligible: true,
    pending: false,
    managedInClock: true,
    rooms: [{ id: 'free', name: '102' }],
    availability: {
      source: 'CLOCK_SNAPSHOT',
      lastSyncedAt: '2026-10-24T12:00:00Z',
      complete: true,
      stale: true,
    },
  });
  expect(document.body.textContent).toContain('Saved bookings last synchronized');
  expect(document.body.textContent).toContain('incomplete or out of date');
  expect(document.body.textContent).toContain('Clock checks availability again when you confirm');
  expect(fetcher.mock.calls).toHaveLength(1);
  expect(fetcher.mock.calls[0][0]).toBe('/api/tenants/t/properties/p/bookings/b/room-move');
});
it('verifies an earlier stay change instead of submitting a room move', async () => {
  const fetcher = await mount({
    version: 2,
    roomId: 'old',
    eligible: true,
    pending: true,
    pendingChange: 'stay',
    rooms: [],
  });
  await act(async () => {
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent === 'Verify stay change')!
      .click();
    await settle();
  });
  expect(
    fetcher.mock.calls.some(
      ([url, init]) => url.endsWith('/amend-check') && init?.method === 'POST',
    ),
  ).toBe(true);
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
});
