// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect } from 'vitest';
import { ClockFinancialCard, type ClockFinancial } from './clock-financial';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it('shows the authoritative credit and outside payments without adding the MUST ledger', async () => {
  const host = document.body.appendChild(document.createElement('div')),
    root = createRoot(host);
  const money = (amount: string) => ({ amount, currency: 'EUR' });
  const data: ClockFinancial = {
    fetchedAt: new Date().toISOString(),
    bookingVersion: 1,
    balance: money('-1700.00'),
    paid: money('3400.00'),
    refunded: money('0.00'),
    folios: [
      {
        id: '1',
        deposit: true,
        value: money('0.00'),
        balance: money('-3400.00'),
        payments: [
          { id: '1', amount: money('1700.00'), type: 'on-line', reference: 'first' },
          { id: '2', amount: money('1700.00'), type: 'on-line', reference: 'second' },
        ],
      },
    ],
  };
  await act(async () =>
    root.render(
      createElement(ClockFinancialCard, { data, status: 'SYNCED', localPaid: '1700.00' }),
    ),
  );
  expect(host.textContent).toContain('Guest credit in Clock');
  expect(host.textContent).toContain('payments beyond the MUST');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(host.textContent).not.toContain('5,100');
  await act(async () => root.unmount());
  host.remove();
});
it('shows synchronization instead of inventing a zero balance', async () => {
  const host = document.body.appendChild(document.createElement('div')),
    root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(ClockFinancialCard, { data: null, status: 'READY', localPaid: '0.00' }),
    ),
  );
  expect(host.textContent).toContain('being synchronized');
  expect(host.textContent).not.toContain('0.00');
  await act(async () => root.unmount());
  host.remove();
});
