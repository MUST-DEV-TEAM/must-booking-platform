// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { AvailabilityGrid, type AvailabilityGridCell } from './availability-grid';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  document.body.replaceChildren();
});
const rows = ['King', 'Twin'].map((label, i) => ({
  id: String(i),
  label,
  days: ['2035-03-30', '2035-03-31', '2035-04-01'].map((date, j) => ({
    date,
    capacity: 5,
    available: 3,
    soldHeld: 2,
    disabled: j === 0,
    marked: j === 1,
    note: j === 1 ? 'Blocked: Maintenance' : undefined,
  })),
}));
function Harness() {
  const [selected, setSelected] = useState<AvailabilityGridCell[]>([]);
  return <AvailabilityGrid rows={rows} stock selected={selected} onSelectionChange={setSelected} />;
}
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')];
describe('AvailabilityGrid', () => {
  it('shows real coverage and rejection notes without editing controls', () => {
    const html = renderToStaticMarkup(
      <AvailabilityGrid
        rows={[
          {
            id: 't',
            label: 'King',
            days: [{ date: '2035-03-30', capacity: 3, available: 0, note: 'Stop sell' }],
          },
        ]}
      />,
    );
    expect(html).toContain('0/3');
    expect(html).toContain('title="Stop sell"');
    expect(html).not.toContain('<button');
  });
  it('selects rectangles, rows and dates, omitting disabled past cells', async () => {
    const div = document.createElement('div');
    document.body.append(div);
    root = createRoot(div);
    await act(async () => root!.render(createElement(Harness)));
    expect(buttons()[0]?.disabled).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>('[aria-label="Select date 2035-03-30"]')?.disabled,
    ).toBe(true);
    await act(async () => buttons()[1]!.click());
    await act(async () =>
      buttons()[5]!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })),
    );
    expect(buttons().filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(4);
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Select row King"]')!.click(),
    );
    expect(buttons().filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(2);
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Select date 2035-03-31"]')!.click(),
    );
    expect(buttons().filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(3);
    expect(document.body.textContent).toContain('2 sold/held');
    expect(document.body.textContent).toContain('Blocked');
  });
  it('shows Unknown for unmanaged provider facts', () => {
    const html = renderToStaticMarkup(
      <AvailabilityGrid
        stock
        rows={[
          {
            id: 't',
            label: 'King',
            days: [{ date: '2035-03-30', capacity: null, available: null, soldHeld: null }],
          },
        ]}
      />,
    );
    expect(html).toContain('Unknown');
    expect(html).toContain('Managed in Clock');
    expect(html).not.toContain('0 stock');
  });
});
