// @vitest-environment jsdom
import { pickDate } from '../../components/ui/date-field-test-utils';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { DashboardReports } from './reports';
import { DashboardQueryProvider } from './query-provider';
import type { ReportWorkspace } from '../../lib/report-types';
vi.mock('../../components/ui/echart', () => ({
  EChart: () => createElement('div', { 'data-testid': 'chart' }),
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
});
const fixture = (): ReportWorkspace => ({
  meta: {
    tenantId: 't',
    propertyId: 'p',
    source: 'LOCAL',
    timezone: 'Europe/Tirane',
    today: '2026-10-19',
    asOf: '2026-10-19T12:00:00Z',
    fingerprint: 'f'.repeat(64),
    basis: 'MUST locally stored records',
    moneyVisible: true,
    staffActivityVisible: false,
    hasData: true,
    warnings: ['Current on-the-books state'],
    dateBases: {},
    coverage: { supplyKnown: true, unknownNightlyBookings: 0, invalidStays: 0 },
    definitions: [],
    drilldowns: { bookings: { report: 'reservations', rowBasis: 'created' } },
  },
  query: { report: 'overview', from: '2026-10-01', to: '2026-10-19', page: 1, pageSize: 25 },
  summary: {
    bookings: 3,
    cancelled: 1,
    occupancy: 75.1,
    soldNights: 3,
    arrivals: 1,
    departures: 0,
    financial: [
      {
        currency: 'EUR',
        roomRevenue: '125.50',
        collected: '100.00',
        refunded: '0.00',
        netCollected: '100.00',
        adr: '41.83',
        revpar: '31.38',
        outstanding: '25.50',
        collectionRate: 80,
      },
    ],
  },
  series: [{ id: 'day', date: '2026-10-01', bookings: 3, currency: 'EUR', roomRevenue: '125.50' }],
  seriesColumns: [
    { key: 'date', label: 'Period', type: 'date' },
    { key: 'bookings', label: 'Bookings created', type: 'number' },
    { key: 'roomRevenue', label: 'Room revenue', type: 'money', money: true },
  ],
  columns: [
    { key: 'reference', label: 'Reservation', type: 'text' },
    { key: 'status', label: 'Status', type: 'text' },
  ],
  rows: [{ id: 'b1', reference: 'Test reservation', status: 'CONFIRMED' }],
  pagination: { page: 1, pageSize: 25, total: 1, pages: 1 },
  comparison: null,
  facets: {
    roomTypes: [],
    rooms: [],
    ratePlans: [],
    currencies: ['EUR'],
    sources: ['DIRECT', 'WEBSITE', 'UNKNOWN'],
    bookingMode: 'ROOM_TYPE_ONLY',
  },
});
async function mount(data = fixture(), status = 200) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/exports') && init?.method !== 'POST') return new Response('{"exports":[]}');
    if (url.endsWith('/views')) return new Response('{"views":[]}');
    if (url.endsWith('/exports'))
      return new Response(JSON.stringify({ content: '{}', rowCount: 0 }), { status: 409 });
    const u = new URL(url, 'http://test');
    const next = structuredClone(data);
    Object.assign(next.query, Object.fromEntries(u.searchParams));
    return new Response(JSON.stringify(status === 200 ? next : { message: 'Unavailable' }), {
      status,
      headers: { 'x-request-id': 'test-report-ref' },
    });
  });
  vi.stubGlobal('fetch', fetch);
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardReports, { tenantId: 't', propertyId: 'p' }),
      ),
    ),
  );
  return { host, fetch };
}
async function rendered(text: string) {
  await vi.waitFor(
    async () => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
      expect(document.body.textContent).toContain(text);
    },
    // The default 1 s is too tight when the whole web suite runs in parallel.
    { timeout: 10_000 },
  );
}
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent === text)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
async function value(label: string, value: string) {
  await pickDate(document.querySelector<HTMLElement>(`[aria-label="${label}"]`), value);
}
describe('Reports workspace', () => {
  it('renders exact currencies, date basis, last-updated and tab-specific queries', async () => {
    const { fetch } = await mount();
    await rendered('EUR 125.50');
    expect(document.body.textContent).toContain('75.1%');
    expect(document.body.textContent).toContain('Europe/Tirane');
    expect(document.body.textContent).toContain('Last updated');
    await click('Reservations');
    await rendered('Reservation date basis');
    expect(fetch.mock.calls.some(([url]) => url.includes('report=reservations'))).toBe(true);
    expect(document.body.textContent).not.toContain('Staff activity');
  });
  it('validates the date range then refetches the exact selected dates', async () => {
    const { fetch } = await mount();
    await rendered('EUR 125.50');
    await value('Report start date', '2026-11-01');
    await value('Report end date', '2026-10-01');
    await click('Apply range');
    await rendered('Choose a valid range');
    await value('Report start date', '2026-09-01');
    await value('Report end date', '2026-09-30');
    await click('Apply range');
    await vi.waitFor(() =>
      expect(fetch.mock.calls.some(([url]) => url.includes('from=2026-09-01&to=2026-09-30'))).toBe(
        true,
      ),
    );
  });
  it('hides unavailable Clock KPIs, explains missing evidence and offers concrete actions', async () => {
    const data = fixture();
    data.meta.source = 'CLOCK';
    data.meta.basis = 'Synced from Clock';
    data.meta.moneyVisible = false;
    data.meta.coverage = { supplyKnown: false, unknownNightlyBookings: 2, invalidStays: 0 };
    delete data.summary.financial;
    data.summary.occupancy = null;
    data.comparison = {
      from: '2025-10-01',
      to: '2025-10-19',
      hasData: false,
      summary: null,
      series: [],
    };
    await mount(data);
    await rendered('Incomplete stored evidence');
    expect(document.body.textContent).toContain('Stock and occupancy are managed in Clock.');
    expect(document.body.textContent).not.toContain('Unknown');
    expect(document.body.textContent).not.toContain('Data basis & limits');
    expect(
      [...document.querySelectorAll('button')].some((b) => b.textContent === 'Review data quality'),
    ).toBe(true);
    expect(document.body.textContent).toContain('No matching activity for comparison');
    await click('Review data quality');
    await rendered('Data quality');
    expect(document.body.textContent).not.toContain('EUR 125.50');
  });
  it('uses full-width shared filter grids and keeps known zero metrics', async () => {
    const data = fixture();
    data.summary.cancelled = 0;
    data.summary.onTheBooksHistory = {
      pickup: [{ status: 'No history yet' }],
      pace: { status: 'No history yet' },
    };
    await mount(data);
    await rendered('EUR 125.50');
    expect(document.querySelectorAll('[data-slot=filter-grid]').length).toBe(2);
    expect(document.body.textContent).toContain('Daily history is still accumulating');
    expect(document.body.textContent).not.toContain('Data basis & limits');
    expect(document.body.textContent).not.toContain('Current on-the-books state');
  });
  it('uses shared empty, denied and error-with-reference states', async () => {
    await mount(fixture(), 403);
    await rendered('Report access unavailable');
    expect(document.body.textContent).toContain('test-report-ref');
    expect(document.body.textContent).not.toContain('EUR 125.50');
  });
  it('shows genuine empty reports and an empty saved-view directory', async () => {
    const data = fixture();
    data.meta.hasData = false;
    data.rows = [];
    data.pagination.total = 0;
    await mount(data);
    await rendered('No recorded activity for this report');
    await click('Custom views');
    await rendered('No saved views yet');
    expect(document.body.textContent).not.toContain('Export CSV');
  });
  it('retains the report when an audited print request fails', async () => {
    await mount();
    await rendered('EUR 125.50');
    await click('Print report');
    await rendered('Action unavailable');
    expect(document.querySelector('[data-report-print]')).toBeNull();
    expect(document.body.textContent).toContain('EUR 125.50');
  });
});
