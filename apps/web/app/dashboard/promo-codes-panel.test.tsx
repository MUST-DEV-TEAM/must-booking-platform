// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardQueryProvider } from './query-provider';
import { PromoCodesPanel, promoBody, promoSummary, type PromoCode } from './promo-codes-panel';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 15));
};

const code = (extra: Partial<PromoCode> = {}): PromoCode => ({
  id: 'c1',
  code: 'WELCOME10',
  kind: 'PERCENT',
  value: '10.00',
  currency: null,
  description: 'Welcome offer',
  bookFrom: null,
  bookUntil: null,
  stayFrom: '2027-05-01',
  stayUntil: '2027-09-30',
  minNights: 2,
  roomTypeIds: ['rt1'],
  maxRedemptions: 5,
  redemptions: 2,
  active: true,
  ...extra,
});

async function mount(listing: unknown, canEdit = true) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/room-types')) return Response.json([{ id: 'rt1', name: 'APP' }]);
    return Response.json(listing);
  });
  vi.stubGlobal('fetch', fetchMock);
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(PromoCodesPanel, { tenantId: 't1', propertyId: 'p1', canEdit }),
      ),
    );
    await settle();
  });
  await act(settle);
  return fetchMock;
}

describe('promoSummary', () => {
  it('says what a code does and when it can be used, in plain words', () => {
    expect(promoSummary(code(), [{ id: 'rt1', name: 'APP' }])).toBe(
      '10% off · stays 2027-05-01 to 2027-09-30 · at least 2 nights · APP',
    );
    expect(
      promoSummary(
        code({
          kind: 'FIXED',
          value: '25.00',
          currency: 'EUR',
          stayFrom: null,
          stayUntil: null,
          minNights: null,
          roomTypeIds: [],
        }),
        [],
      ),
    ).toBe('€25.00 off');
  });
});

describe('promoBody', () => {
  it('turns empty fields into no limit', () => {
    expect(
      promoBody({
        code: 'WELCOME10',
        kind: 'PERCENT',
        value: '10',
        description: '',
        bookFrom: '',
        bookUntil: '',
        stayFrom: '',
        stayUntil: '',
        minNights: '',
        maxRedemptions: '3',
        roomTypeIds: [],
        active: true,
      }),
    ).toMatchObject({
      value: 10,
      description: null,
      bookFrom: null,
      minNights: null,
      maxRedemptions: 3,
      roomTypeIds: null,
    });
  });
});

describe('PromoCodesPanel', () => {
  it('lists the hotel codes with their uses and the codes Clock manages', async () => {
    await mount({ codes: [code()], clockCodes: ['CLOCKSPECIAL'] });

    expect(document.body.textContent).toContain('WELCOME10');
    expect(document.body.textContent).toContain('Used 2 of 5 times');
    expect(document.body.textContent).toContain('Codes managed in Clock');
    expect(document.body.textContent).toContain('CLOCKSPECIAL');
    expect(document.body.textContent).toContain('New code');
  });

  it('says so when there are no codes and hides editing from people who cannot edit', async () => {
    await mount({ codes: [], clockCodes: [] }, false);

    expect(document.body.textContent).toContain('No promo codes yet');
    expect(document.body.textContent).not.toContain('New code');
  });
});
