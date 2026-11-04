// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardQueryProvider } from '../query-provider';
import { FloorMapEditor } from './floor-map-editor';
import type { VenueArea } from './venue-api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 15));
};
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  );
const tableEl = (label: string) =>
  document.querySelector<HTMLElement>(`[aria-label^="${label},"]`)!;
async function press(el: HTMLElement, key: string) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await settle();
  });
}
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
    await settle();
  });
}

const table = (id: string, label: string, mapX: number) => ({
  id,
  areaId: 'a1',
  label,
  minSeats: 2,
  maxSeats: 4,
  mapX,
  mapY: 100,
  mapWidth: 80,
  mapHeight: 80,
  shape: 'square' as const,
  active: true,
});
const area: VenueArea = {
  id: 'a1',
  name: 'Terrace',
  sortOrder: 0,
  mapWidth: 1000,
  mapHeight: 700,
  active: true,
  tables: [table('t1', 'T1', 100), table('t2', 'T2', 300)],
};

async function mount(
  options: { combinations?: Array<{ tableAId: string; tableBId: string }> } = {},
) {
  const calls: Array<[string, RequestInit | undefined]> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return Response.json({ moved: 1, tableIds: [] });
    }),
  );
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(FloorMapEditor, {
          tenantId: 't',
          venueId: 'v1',
          area,
          combinations: options.combinations ?? [],
        }),
      ),
    );
    await settle();
  });
  return calls;
}
const put = (calls: Array<[string, RequestInit | undefined]>, suffix: string) =>
  calls.filter(([url, init]) => url.endsWith(suffix) && init?.method === 'PUT');

describe('FloorMapEditor', () => {
  it('has nothing to save until a table is moved', async () => {
    await mount();
    expect(button('Save layout')!.disabled).toBe(true);
    expect(document.body.textContent).toContain('No unsaved changes');
  });

  it('saves only the tables that were moved, in one request', async () => {
    const calls = await mount();
    await press(tableEl('T1'), 'ArrowRight');
    expect(document.body.textContent).toContain('1 unsaved change');
    await click(button('Save layout')!);
    const saves = put(calls, '/layout/positions');
    expect(saves).toHaveLength(1);
    expect(JSON.parse(saves[0]![1]!.body as string)).toEqual({
      positions: [{ tableId: 't1', mapX: 110, mapY: 100 }],
    });
  });

  it('puts a table back when the changes are discarded', async () => {
    const calls = await mount();
    await press(tableEl('T1'), 'ArrowRight');
    await click(button('Discard changes')!);
    expect(button('Save layout')!.disabled).toBe(true);
    expect(put(calls, '/layout/positions')).toHaveLength(0);
  });

  it('lets a selected table be combined with another table of the area', async () => {
    const calls = await mount();
    await click(tableEl('T1'));
    expect(document.body.textContent).toContain('Can be pushed together with');
    const box = document.querySelector<HTMLElement>('[aria-label="Combine T1 with T2"]')!;
    await click(box);
    const sets = put(calls, '/tables/t1/combinable');
    expect(sets).toHaveLength(1);
    expect(JSON.parse(sets[0]![1]!.body as string)).toEqual({ tableIds: ['t2'] });
  });

  it('shows an existing combination as ticked', async () => {
    await mount({ combinations: [{ tableAId: 't1', tableBId: 't2' }] });
    await click(tableEl('T2'));
    const box = document.querySelector<HTMLElement>('[aria-label="Combine T2 with T1"]')!;
    expect(box.getAttribute('aria-checked')).toBe('true');
  });
});

it('saves a proportional resize and position together', async () => {
  const calls = await mount();
  await click(tableEl('T1'));
  const input = document.querySelector<HTMLInputElement>('[aria-label="Map width"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '120');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  });
  await click(button('Save layout')!);
  const write = calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(write[1]!.body as string).positions).toEqual([
    { tableId: 't1', mapX: 100, mapY: 100, mapWidth: 120, mapHeight: 120 },
  ]);
});
