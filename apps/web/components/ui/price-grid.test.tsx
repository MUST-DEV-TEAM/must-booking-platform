// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { PriceGrid } from './price-grid';
import { PriceBreakdown } from './price-breakdown';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
describe('PriceGrid', () => {
  it('preserves decimal strings, labels unknown values and edits the exact cell', async () => {
    const container = document.createElement('div'),
      root = createRoot(container),
      onCell = vi.fn();
    await act(async () =>
      root.render(
        createElement(PriceGrid, {
          rows: [
            {
              id: 't',
              label: 'King',
              days: [
                { date: '2036-02-29', amount: '100.01', currency: 'EUR', status: 'Base' },
                { date: '2036-03-01', amount: null, status: 'Managed in Clock' },
              ],
            },
          ],
          onCell,
        }),
      ),
    );
    expect(container.textContent).toContain('EUR 100.01');
    expect(container.textContent).toContain('Unknown');
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    expect(onCell).toHaveBeenCalledWith('t', '2036-02-29');
    await act(async () => root.unmount());
  });
  it('does not expose edit actions in read-only mode', async () => {
    const container = document.createElement('div'),
      root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(PriceGrid, {
          rows: [
            {
              id: 't',
              label: 'King',
              days: [{ date: '2035-03-01', amount: null, status: 'Managed in Clock' }],
            },
          ],
        }),
      ),
    );
    expect(container.querySelector('button')).toBeNull();
    await act(async () => root.unmount());
  });
});
describe('PriceBreakdown', () => {
  it('shows supplied totals and component versions without recomputing', async () => {
    const container = document.createElement('div'),
      root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(PriceBreakdown, {
          value: {
            total: { amount: '101.01', currency: 'EUR' },
            nightlyRates: [
              {
                date: '2035-03-01',
                amount: '101.01',
                components: [
                  {
                    id: 'c',
                    kind: 'charge',
                    version: 2,
                    name: 'VAT',
                    amount: '1.01',
                    display: 'included',
                  },
                ],
              },
            ],
          },
        }),
      ),
    );
    expect(container.textContent).toContain('EUR 101.01');
    expect(container.textContent).toContain('VAT (included)');
    expect(container.textContent).toContain('charge / v2');
    await act(async () => root.unmount());
  });
});
