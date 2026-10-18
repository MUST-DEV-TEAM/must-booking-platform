// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryStock, type StockGrid } from './inventory-stock';
import { DashboardQueryProvider } from './query-provider';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
const onCreate = vi.fn();
const data: StockGrid = {
  source: 'LOCAL',
  readOnly: false,
  bookingMode: 'ROOM_TYPE_ONLY',
  today: '2035-03-30',
  timezone: 'Europe/Tirane',
  startsOn: '2035-03-30',
  endsOn: '2035-04-29',
  explanation: 'Pool stock',
  rows: [
    {
      id: 't',
      label: 'King',
      days: [
        { date: '2035-03-30', stock: 5, soldHeld: 2, remaining: 3, blocked: false, markers: [] },
      ],
    },
  ],
};
beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 35));
  });
}
async function render(grid = data, write = true, valid = true, failWrite = false) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/stock/preview'))
        return {
          ok: true,
          json: async () => ({
            valid,
            previewToken: 'a'.repeat(64),
            changes: [
              {
                roomTypeId: 't',
                date: data.today,
                before: 5,
                after: 0,
                soldHeld: 2,
                remaining: -2,
                error: valid ? null : 'Stock 0 is below 2 sold/held rooms.',
              },
            ],
          }),
        };
      if (init?.method === 'PUT')
        return {
          ok: !failWrite,
          json: async () => (failWrite ? { message: 'Stock changed. Preview again.' } : null),
        };
      return { ok: true, json: async () => grid };
    }),
  );
  const div = document.createElement('div');
  document.body.append(div);
  root = createRoot(div);
  await act(async () =>
    root!.render(
      createElement(
        DashboardQueryProvider,
        null,
        createElement(InventoryStock, {
          base: '/api/tenants/a/properties/b/inventory',
          canWrite: write,
          onCreate,
        }),
      ),
    ),
  );
  await settle();
  return calls;
}
async function click(text: string) {
  const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  );
  expect(b, `Button ${text}`).toBeTruthy();
  await act(async () => b!.click());
  await settle();
}
async function select() {
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-pressed]')!.click());
  await settle();
}
describe('Inventory Stock', () => {
  it('loads stock then previews and confirms a keyed write to the existing path', async () => {
    const calls = await render();
    expect(document.body.textContent).toContain('2 sold/held');
    await select();
    await click('Preview changes');
    const p = calls.find((c) => c.url.endsWith('/stock/preview'));
    expect(p?.init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(p?.init?.body))).toMatchObject({
      operation: 'set',
      value: 0,
      cells: [{ roomTypeId: 't', date: data.today }],
    });
    await click('Save stock changes');
    expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false);
    await click('Confirm stock change');
    const w = calls.find((c) => c.init?.method === 'PUT');
    expect(w?.url).toBe('/api/tenants/a/properties/b/inventory-units');
    expect(w?.init?.headers).toHaveProperty('Idempotency-Key');
    expect(JSON.parse(String(w?.init?.body)).previewToken).toBe('a'.repeat(64));
    expect(document.body.textContent).toContain('Stock saved');
  });
  it('shows dated validation errors and cannot save below sold/held', async () => {
    const calls = await render(data, true, false);
    await select();
    await click('Preview changes');
    expect(document.body.textContent).toContain('2035-03-30: Stock 0 is below 2 sold/held');
    expect(
      [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save stock changes')
        ?.disabled,
    ).toBe(true);
    expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false);
  });
  it('retains the operation key when retrying an uncertain write', async () => {
    const calls = await render(data, true, true, true);
    await select();
    await click('Preview changes');
    await click('Save stock changes');
    await click('Confirm stock change');
    await click('Confirm stock change');
    const writes = calls.filter((c) => c.init?.method === 'PUT');
    expect(writes).toHaveLength(2);
    expect(writes[0]?.init?.headers).toEqual(writes[1]?.init?.headers);
    expect(document.body.textContent).toContain('Stock changed. Preview again.');
  });
  it.each([
    {
      ...data,
      readOnly: true,
      bookingMode: 'INDIVIDUAL_ROOM_ONLY',
      explanation: 'Stock comes from active individual rooms.',
    },
    {
      ...data,
      source: 'CLOCK_PMS' as const,
      readOnly: true,
      explanation: 'Unknown stock: managed in Clock.',
      rows: data.rows.map((r) => ({
        ...r,
        days: r.days.map((d) => ({
          ...d,
          stock: null,
          soldHeld: null,
          remaining: null,
          markers: ['Managed in Clock'],
        })),
      })),
    },
  ])('keeps non-editable modes read-only', async (grid) => {
    await render(grid);
    expect(document.querySelector('button[aria-pressed]')).toBeNull();
    expect(document.body.textContent).toContain(grid.explanation);
    expect(document.body.textContent).not.toContain('Block these dates');
    expect(document.body.textContent).not.toContain('Close dates / set a rule');
    if (grid.source === 'CLOCK_PMS') expect(document.body.textContent).not.toContain('Restricted');
  });
  it('fails closed without calendar.block and handles empty catalog', async () => {
    await render({ ...data, rows: [] }, false);
    expect(document.body.textContent).toContain('No room types yet');
    expect(document.body.textContent).not.toContain('Preview changes');
  });
  it('pages 30 dates and clears selection when changing the window', async () => {
    const calls = await render();
    await select();
    await click('Next 30 days');
    expect(calls.at(-1)?.url).toContain('startsOn=2035-04-29');
    expect(document.body.textContent).not.toContain('cells selected');
  });
  it('changes operations and sends weekday-filtered row-date requests', async () => {
    const calls = await render();
    await select();
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Stock operation"]')!.click(),
    );
    await settle();
    await click('Reset stock to 0');
    await click('Preview changes');
    expect(
      JSON.parse(String(calls.find((c) => c.url.endsWith('/stock/preview'))?.init?.body)),
    ).toMatchObject({ operation: 'reset', weekdays: [1, 2, 3, 4, 5, 6, 7] });
  });
  it('filters selected weekdays before requesting the preview', async () => {
    const calls = await render();
    await select();
    const remove = document.querySelector<HTMLButtonElement>('[aria-label="Remove Monday"]');
    expect(remove).toBeTruthy();
    await act(async () => remove!.click());
    await click('Preview changes');
    expect(
      JSON.parse(String(calls.find((c) => c.url.endsWith('/stock/preview'))?.init?.body)).weekdays,
    ).toEqual([2, 3, 4, 5, 6, 7]);
  });
  it('discards a preview response when selection changes while it is loading', async () => {
    await render();
    await select();
    const original = globalThis.fetch;
    let resolve!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        url.endsWith('/stock/preview')
          ? new Promise((r) => {
              resolve = r;
            })
          : original(url, init),
      ),
    );
    await click('Preview changes');
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Remove Monday"]')!.click(),
    );
    await act(async () =>
      resolve({
        ok: true,
        json: async () => ({ valid: true, previewToken: 'a'.repeat(64), changes: [] }),
      }),
    );
    await settle();
    expect(document.body.textContent).not.toContain('Save stock changes');
  });
  it('opens both existing create flows from the selected cells', async () => {
    onCreate.mockClear();
    await render();
    await select();
    await click('Close dates / set a rule');
    expect(onCreate).toHaveBeenLastCalledWith(
      'restrictions',
      expect.objectContaining({
        scope: 'room_type',
        targetIds: ['t'],
        startsOn: '2035-03-30',
        endsOn: '2035-03-30',
      }),
    );
    await click('Block these dates');
    expect(onCreate).toHaveBeenLastCalledWith(
      'blocks',
      expect.objectContaining({ roomTypeIds: ['t'], startsOn: '2035-03-30', endsOn: '2035-03-31' }),
    );
  });
});
