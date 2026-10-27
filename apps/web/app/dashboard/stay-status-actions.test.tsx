// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StayStatusActions } from './stay-status-actions';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const booking = {
  id: 'b1',
  status: 'CONFIRMED',
  startsOn: '2027-07-12',
  pmsStayStatus: null as string | null,
  externalBookingId: null as string | null,
};

async function mount(overrides: Partial<typeof booking> = {}, today = '2027-07-12') {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(StayStatusActions, {
          tenantId: 't',
          propertyId: 'p',
          booking: { ...booking, ...overrides },
          today,
        }),
      ),
    );
  });
  return host;
}

function button(host: HTMLElement, label: RegExp) {
  return [...host.querySelectorAll('button')].find((b) => label.test(b.textContent ?? ''));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('StayStatusActions', () => {
  it('shows nothing for a stay a PMS manages', async () => {
    const host = await mount({ externalBookingId: '123' });
    expect(host.querySelectorAll('button')).toHaveLength(0);
  });

  it('keeps Check in off until the arrival day', async () => {
    const host = await mount({}, '2027-07-01');
    expect(button(host, /check in/i)?.disabled).toBe(true);
  });

  it('checks the guest in and asks the server for that change', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const host = await mount();
    await act(async () => {
      button(host, /check in/i)!.click();
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/tenants/t/properties/p/bookings/b1/stay-status');
    expect(JSON.parse(init.body)).toEqual({ status: 'checked_in', expectedFrom: 'expected' });
  });

  it('offers check-out and an undo once the guest is in', async () => {
    const host = await mount({ pmsStayStatus: 'checked_in' });
    expect(button(host, /check out/i)?.disabled).toBe(false);
    expect(button(host, /undo check-in/i)?.disabled).toBe(false);
  });
});
