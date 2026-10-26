// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HotelCurrencyNote } from './hotel-currency-note';

vi.mock('next/navigation', () => ({ useParams: () => ({ tenantId: 't1' }) }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function mount(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(body)),
  );
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  roots.push(root);
  await act(async () => {
    root.render(createElement(HotelCurrencyNote, { propertyId: 'p1' }));
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe('HotelCurrencyNote', () => {
  it('says which currency the hotel uses and where it comes from', async () => {
    await mount({ currency: 'EUR', source: 'clock', setting: null, clock: 'EUR', mismatch: false });

    expect(document.body.textContent).toContain('Hotel currency: EUR');
    expect(document.body.textContent).toContain('taken from your Clock rates');
    expect(document.body.textContent).toContain('approximate display');
  });

  it('warns when the setting and the Clock rates disagree', async () => {
    await mount({
      currency: 'GBP',
      source: 'setting',
      setting: 'GBP',
      clock: 'EUR',
      mismatch: true,
    });

    expect(document.body.textContent).toContain('Currency does not match Clock');
    expect(document.body.textContent).toContain('Your setting is GBP');
  });
});
