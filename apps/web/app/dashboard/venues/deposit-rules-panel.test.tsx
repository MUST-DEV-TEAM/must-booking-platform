// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardQueryProvider } from '../query-provider';
import { DepositRulesPanel } from './deposit-rules-panel';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  )!;
it('saves an explicit service/area rate with the original version and can restore inheritance', async () => {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const baseRule = {
    serviceId: null,
    areaId: null,
    mode: 'per_booking',
    amount: '10.00',
    minParty: 1,
    freeCancelHours: 24,
  };
  let stored = [baseRule];
  let version = 4;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url.endsWith('/services')) return Response.json([{ id: 'dinner', name: 'Dinner' }]);
      if (url.endsWith('/layout'))
        return Response.json({
          areas: [{ id: 'terrace', name: 'Terrace', active: true, tables: [] }],
        });
      if (init?.method === 'PUT') {
        stored = JSON.parse(init.body as string).rules;
        version += 1;
      }
      return Response.json({
        version,
        currency: 'EUR',
        requiresLegacyConversion: false,
        rules: stored,
      });
    }),
  );
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DepositRulesPanel, { tenantId: 'tenant', venueId: 'venue' }),
      ),
    );
    await settle();
  });
  await act(settle);
  await act(settle);
  const open = async () =>
    act(async () => {
      [...document.querySelectorAll<HTMLTableCellElement>('tbody td')][1]!
        .querySelector('button')!
        .click();
      await settle();
    });
  await open();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Dinner');
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="Deposit amount"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '20.00');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    button('Apply rule').click();
    await settle();
  });
  await act(async () => {
    button('Save deposit rules').click();
    await settle();
  });
  const sent = calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(sent[1]!.body as string)).toEqual({
    version: 4,
    rules: [baseRule, { ...baseRule, serviceId: 'dinner', areaId: 'terrace', amount: '20.00' }],
  });
  await open();
  await act(async () => {
    button('Use inherited rule').click();
    await settle();
  });
  expect(document.querySelector('tbody')?.textContent).toContain('Inherit: 10.00 EUR per booking');
  await act(async () => {
    button('Save deposit rules').click();
    await settle();
  });
  expect(
    JSON.parse(calls.filter(([, init]) => init?.method === 'PUT').at(-1)![1]!.body as string).rules,
  ).toEqual([baseRule]);
});
