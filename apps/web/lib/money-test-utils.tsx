import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, vi } from 'vitest';
import { HotelMoneyProvider } from './hotel-money-scope';
import { formatMoney } from './money';
import { DashboardQueryProvider } from '../app/dashboard/query-provider';

export async function mountMoneyScreen(element: ReactElement, respond: (url: string) => unknown) {
  const fetch = vi.fn(async (url: string) =>
    Response.json(
      url.includes('/public/exchange-rates')
        ? { base: 'EUR', date: '2026-10-28', rates: { ALL: 100 } }
        : respond(url),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(
        DashboardQueryProvider,
        null,
        createElement(HotelMoneyProvider, {
          tenantId: 't',
          propertyId: 'p',
          currency: 'EUR',
          children: element,
        }),
      ),
    ),
  );
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
  return { host, fetch, root, settle };
}
export async function expectHotelAmount(
  view: Awaited<ReturnType<typeof mountMoneyScreen>>,
  currency: string,
  amount: string,
) {
  await vi.waitFor(async () => {
    await view.settle();
    expect(view.host.textContent).toContain(formatMoney(amount, currency));
    if (currency === 'ALL')
      expect(view.host.textContent).toContain(
        '(\u2248 ' + formatMoney(String(Number(amount) / 100), 'EUR') + ', estimate)',
      );
  });
  const rateCalls = view.fetch.mock.calls.filter(([url]) => url.includes('/public/exchange-rates'));
  expect(rateCalls).toHaveLength(currency === 'EUR' ? 0 : 1);
  if (currency === 'EUR') expect(view.host.textContent).not.toContain('\u2248');
}
