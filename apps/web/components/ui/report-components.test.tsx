// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { ReportTable } from './report-table';
import { ReportBreakdown } from './report-breakdown';
import { ReportChart } from './report-chart';
import { ReportPrint, type PrintReport } from './report-print';
import { ReportViewEditor } from './report-view-editor';
import { RecordDirectory } from './record-directory';
import type { ReportColumn } from '../../lib/report-types';
const { chart } = vi.hoisted(() => ({ chart: vi.fn() }));
vi.mock('./echart', () => ({
  EChart: (props: unknown) => {
    chart(props);
    return createElement('div');
  },
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  chart.mockClear();
});
async function mount(component: ReturnType<typeof createElement>) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(component));
  return host;
}
async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}
const columns: ReportColumn[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'value', label: 'Value', type: 'money', money: true },
];
const rows = [
  { id: 'a', name: 'One', currency: 'EUR', value: '1.01' },
  { id: 'b', name: 'Two', currency: 'USD', value: '2.02' },
];
describe('Shared report components', () => {
  it('selects server page rows, calls audited exports, sorts, pages and opens quick peek', async () => {
    const onExport = vi.fn(async () => {}),
      onSort = vi.fn(),
      onPage = vi.fn();
    await mount(
      createElement(ReportTable, {
        rows,
        columns,
        storageKey: 'test',
        page: 1,
        pageSize: 2,
        total: 4,
        sort: 'name',
        direction: 'asc',
        onSort,
        onPage,
        onPageSize: vi.fn(),
        onExport,
      }),
    );
    await click(document.querySelector('[aria-label="Select current page"]')!);
    await click(
      [...document.querySelectorAll('button')].find((b) => b.textContent === 'Export selected')!,
    );
    expect(onExport).toHaveBeenCalledWith(['name', 'value'], ['a', 'b'], undefined);
    await click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Name')!);
    expect(onSort).toHaveBeenCalledWith('name');
    await click(document.querySelector('[aria-label="Next page"]')!);
    expect(onPage).toHaveBeenCalledWith(2);
    await click([...document.querySelectorAll('button')].find((b) => b.textContent === 'One')!);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('EUR 1.01');
  });
  it('shows export errors and keeps the table available', async () => {
    await mount(
      createElement(ReportTable, {
        rows,
        columns,
        storageKey: 'test',
        page: 1,
        pageSize: 2,
        total: 2,
        sort: 'name',
        direction: 'asc',
        onSort: vi.fn(),
        onPage: vi.fn(),
        onPageSize: vi.fn(),
        onExport: vi.fn(async () => {
          throw new Error('Refresh before export');
        }),
      }),
    );
    await click(
      [...document.querySelectorAll('button')].find(
        (b) => b.textContent === 'Export current page',
      )!,
    );
    expect(document.body.textContent).toContain('Refresh before export');
    expect(document.body.textContent).toContain('One');
  });
  it('renders aggregate labels and Unknown without raw JSON or executable markup', async () => {
    await mount(
      createElement(ReportBreakdown, {
        title: 'Currency evidence',
        value: [
          { currency: 'EUR', roomRevenue: '1.01', missing: null, label: '<script>bad</script>' },
        ],
      }),
    );
    expect(document.body.textContent).toContain('Unknown');
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('table')?.textContent).toContain('EUR');
  });
  it('charts integer cents separately and leaves unsafe monetary points unknown', async () => {
    await mount(
      createElement(ReportChart, {
        rows: [
          { id: '1', date: '2026-10-01', currency: 'EUR', value: '1.01' },
          { id: '2', date: '2026-10-01', currency: 'USD', value: '9007199254740993.99' },
        ],
        column: columns[1],
      }),
    );
    const option = chart.mock.calls[0][0].option;
    expect(option.series.map((s: { data: unknown }) => s.data)).toEqual([[101], [null]]);
    expect(option.yAxis.minInterval).toBe(1);
    expect(option.tooltip.valueFormatter(101)).toBe('1.01');
    expect(option.tooltip.valueFormatter(0.2)).toBe('Unknown');
  });
  it('prints only the provided audited snapshot and closes accessibly', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const model = {
      meta: {
        basis: 'Stored evidence',
        timezone: 'Europe/Tirane',
        asOf: '2026-10-19',
        definitions: [],
      },
      query: { report: 'revenue', from: '2026-10-01', to: '2026-10-19' },
      summary: { bookings: 2 },
      columns,
      rows,
    } as unknown as PrintReport;
    await mount(createElement(ReportPrint, { model, onClose: vi.fn() }));
    expect(document.querySelector('[data-report-print]')?.textContent).toContain('EUR 1.01');
    await click(
      [...document.querySelectorAll('button')].find(
        (b) => b.textContent === 'Print / Save as PDF',
      )!,
    );
    expect(print).toHaveBeenCalledOnce();
  });
  it('saves a named known-report configuration with its fixed reviewed query', async () => {
    const onSave = vi.fn(async () => {});
    await mount(
      createElement(ReportViewEditor, {
        configuration: {
          query: { report: 'overview', from: '2026-10-01', to: '2026-10-19' },
          columns: ['name'],
          metrics: ['bookings'],
          display: 'table',
          chartMetric: 'bookings',
        },
        columns,
        metricColumns: [{ key: 'bookings', label: 'Bookings', type: 'number' }],
        onClose: vi.fn(),
        onSave,
      }),
    );
    const input = document.querySelector('#report-view-name') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'My review',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(
      [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save view')!,
    );
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My review',
        visibility: 'private',
        configuration: expect.objectContaining({
          query: { report: 'overview', from: '2026-10-01', to: '2026-10-19' },
        }),
      }),
    );
  });
  it('can disable local directory exports where a dedicated audited flow is required', async () => {
    await mount(
      createElement(RecordDirectory<{ id: string; name: string }>, {
        rows: [{ id: 'a', name: 'Saved view' }],
        columns: [{ id: 'name', label: 'Name', value: (r) => r.name }],
        storageKey: 'views',
        onRow: vi.fn(),
        exportable: false,
      }),
    );
    expect(document.body.textContent).not.toContain('Export CSV');
    expect(document.querySelector('[aria-label="Select all visible records"]')).toBeNull();
  });
});
