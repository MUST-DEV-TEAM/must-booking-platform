// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { DashboardQueryProvider } from './query-provider';
import { PaymentReportSummary } from './payment-report-summary';
import { ReportExportHistory } from './report-export-history';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
});
async function mount(element: ReturnType<typeof createElement>) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(DashboardQueryProvider, undefined, element)));
}
async function rendered(text: string) {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(document.body.textContent).toContain(text);
  });
}
async function input(label: string, value: string) {
  const el = [...document.querySelectorAll('label')].find((l) => l.textContent === label)!;
  const control = document.getElementById(el.htmlFor) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const summary = {
  query: { from: '2026-10-01', to: '2026-10-19' },
  meta: {
    source: 'LOCAL',
    timezone: 'Europe/Tirane',
    asOf: '2026-10-19T10:00:00Z',
    basis: 'MUST locally stored records',
  },
  financial: [
    {
      currency: 'EUR',
      collected: '1.01',
      refunded: '0.00',
      netCollected: '1.01',
      outstanding: '5.00',
    },
    {
      currency: 'USD',
      collected: '2.02',
      refunded: '0.00',
      netCollected: '2.02',
      outstanding: '0.00',
    },
  ],
};
describe('Shared report metrics on existing screens', () => {
  it('shows separate backend currencies and applies the reviewed totals dates', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(summary)));
    vi.stubGlobal('fetch', fetch);
    await mount(
      createElement(PaymentReportSummary, {
        tenantId: 't',
        propertyId: 'p',
        onOutstanding: vi.fn(),
      }),
    );
    await rendered('USD 2.02');
    expect(document.body.textContent).toContain('EUR 1.01');
    expect(document.body.textContent).not.toContain('3.03');
    await input('Payment totals from', '2026-09-01');
    await input('Payment totals to', '2026-09-30');
    await act(async () =>
      document
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    await vi.waitFor(() =>
      expect(
        fetch.mock.calls.some(([url]) => String(url).endsWith('?from=2026-09-01&to=2026-09-30')),
      ).toBe(true),
    );
  });
  it('does not invent totals when permission or the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{}', { status: 403, headers: { 'x-request-id': 'summary-denied' } }),
      ),
    );
    await mount(
      createElement(PaymentReportSummary, {
        tenantId: 't',
        propertyId: 'p',
        onOutstanding: vi.fn(),
      }),
    );
    await rendered('summary-denied');
    expect(document.body.textContent).not.toContain('EUR 1.01');
  });
  it('shows completed audit metadata and opens its exact filters without a fake file download', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              exports: [
                {
                  id: 'e1',
                  createdAt: '2026-10-19T10:00:00Z',
                  report: 'reservations',
                  format: 'csv',
                  rowCount: 2,
                  asOf: '2026-10-19T09:59:00Z',
                  timezone: 'Europe/Tirane',
                  basis: 'Stored evidence',
                  filters: { report: 'reservations', from: '2026-10-01', to: '2026-10-19' },
                },
              ],
            }),
          ),
      ),
    );
    await mount(createElement(ReportExportHistory, { tenantId: 't', propertyId: 'p' }));
    await rendered('Reservations');
    expect(document.body.textContent).not.toContain('Export CSV');
    await act(async () => document.querySelector<HTMLButtonElement>('tbody button')!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('2026-10-01');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Stored evidence');
  });
});
