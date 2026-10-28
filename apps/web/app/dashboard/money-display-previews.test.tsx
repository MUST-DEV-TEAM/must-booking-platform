// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { mountMoneyScreen, expectHotelAmount } from '../../lib/money-test-utils';
import { PriceBreakdown } from '../../components/ui/price-breakdown';
import { PriceGrid } from '../../components/ui/price-grid';
import { CancellationPreview } from '../../components/ui/cancellation-preview';
import { StayChangePreview } from '../../components/ui/stay-change-preview';
import { FinancialMetrics } from '../../components/ui/financial-metrics';
import { ReportEvidence } from '../../components/ui/report-breakdown';
import { RefundChoice } from './refund-choice';
import { ClockAvailabilityPanel } from './clock-availability-panel';
import { ClockFinancialCard } from './clock-financial';
import { GuestSheet } from './guest-sheet';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it.each(['EUR', 'ALL'])(
  'PriceBreakdown preserves %s and only requests foreign rates',
  async (currency) => {
    const money = { amount: '5000.00', currency };
    const element = createElement(PriceBreakdown, {
      value: {
        total: money,
        nightlyRates: [
          {
            date: '2026-11-01',
            amount: '5000.00',
            components: [{ id: 'tax', kind: 'charge', version: 1, name: 'Tax', amount: '5000.00' }],
          },
        ],
      },
    });
    const view = await mountMoneyScreen(element, () => ({}));
    await expectHotelAmount({ ...view, host: document.body }, currency, '5000.00');
    expect(document.body.textContent).not.toContain('[object Object]');
    await act(async () => view.root.unmount());
  },
);

it.each(['EUR', 'ALL'])(
  'PriceGrid preserves %s and only requests foreign rates',
  async (currency) => {
    const element = createElement(PriceGrid, {
      rows: [
        {
          id: 'rt',
          label: 'Suite',
          days: [{ date: '2026-11-01', amount: '5000.00', currency, status: 'Base' }],
        },
      ],
    });
    const view = await mountMoneyScreen(element, () => ({}));
    await expectHotelAmount({ ...view, host: document.body }, currency, '5000.00');
    expect(document.body.textContent).not.toContain('[object Object]');
    await act(async () => view.root.unmount());
  },
);

it.each(['EUR', 'ALL'])(
  'RefundChoice preserves %s and only requests foreign rates',
  async (currency) => {
    const money = { amount: '5000.00', currency };
    const element = createElement(RefundChoice, {
      booking: { total: money, paidAmount: '5000.00', refundedAmount: '0.00' },
      value: { mode: 'percentage', percentage: '50', amount: '' },
      onChange: () => {},
    });
    const view = await mountMoneyScreen(element, () => ({}));
    await expectHotelAmount({ ...view, host: document.body }, currency, '5000.00');
    expect(document.body.textContent).not.toContain('[object Object]');
    await act(async () => view.root.unmount());
  },
);

it.each(['EUR', 'ALL'])(
  'CancellationPreview preserves %s and only requests foreign rates',
  async (currency) => {
    const element = createElement(CancellationPreview, {
      evidence: {
        bookingId: 'b',
        reference: 'TEST',
        version: 1,
        status: 'CONFIRMED',
        ratePlan: 'Flexible',
        timezone: 'UTC',
        cutoffAt: null,
        isFree: true,
        currency,
        paid: '5000.00',
        alreadyRefunded: '0.00',
        penalty: '0.00',
        eligible: '5000.00',
        method: 'PAY_AT_HOTEL',
        legacyPolicy: false,
        previewHash: 'hash',
      },
      refundAmount: '5000.00',
    });
    const view = await mountMoneyScreen(element, () => ({}));
    await expectHotelAmount({ ...view, host: document.body }, currency, '5000.00');
    expect(document.body.textContent).not.toContain('[object Object]');
    await act(async () => view.root.unmount());
  },
);

it.each(['EUR', 'ALL'])(
  'StayChangePreview preserves %s and only requests foreign rates',
  async (currency) => {
    const element = createElement(StayChangePreview, {
      preview: {
        startsOn: '2026-11-01',
        endsOn: '2026-11-02',
        nights: 1,
        available: true,
        oldTotal: '5000.00',
        newTotal: '5000.00',
        difference: '0.00',
        currency,
        paid: '5000.00',
        refunded: '0.00',
        balance: '0.00',
        balanceState: 'paid',
        policyNotes: [],
        version: 1,
        previewHash: 'hash',
      },
    });
    const view = await mountMoneyScreen(element, () => ({}));
    await expectHotelAmount({ ...view, host: document.body }, currency, '5000.00');
    expect(document.body.textContent).not.toContain('[object Object]');
    await act(async () => view.root.unmount());
  },
);

it.each(['EUR', 'ALL'])(
  'FinancialMetrics preserves %s and only requests foreign rates',
  async (currency) => {
    const element = createElement(FinancialMetrics, {
      rows: [
        {
          currency,
          collected: '5000.00',
          refunded: '0.00',
          netCollected: '5000.00',
          outstanding: '0.00',
          expectedOnArrival: '5000.00',
          expectedWithoutGuest: '5000.00',
        },
      ],
    });
    const view = await mountMoneyScreen(element, () => ({}));
    await expectHotelAmount({ ...view, host: document.body }, currency, '5000.00');
    expect(document.body.textContent).not.toContain('[object Object]');
    await act(async () => view.root.unmount());
  },
);

it.each(['EUR', 'ALL'])(
  'ReportEvidence preserves %s and only requests foreign rates',
  async (currency) => {
    const element = createElement(ReportEvidence, {
      value: [{ currency, roomRevenue: '5000.00', bookings: 3 }],
      moneyKeys: ['roomRevenue'],
    });
    const view = await mountMoneyScreen(element, () => ({}));
    await expectHotelAmount({ ...view, host: document.body }, currency, '5000.00');
    expect(document.body.textContent).not.toContain('[object Object]');
    await act(async () => view.root.unmount());
  },
);

it.each(['EUR', 'ALL'])(
  'ClockFinancialCard preserves %s and only requests foreign rates',
  async (currency) => {
    const money = { amount: '5000.00', currency };
    const element = createElement(ClockFinancialCard, {
      tenantId: 't',
      propertyId: 'p',
      localPaid: '0.00',
      status: 'SYNCED',
      data: {
        fetchedAt: '2026-10-28T12:00:00Z',
        bookingVersion: 1,
        balance: money,
        paid: money,
        refunded: { amount: '0.00', currency },
        folios: [],
      },
    });
    const view = await mountMoneyScreen(element, () => ({}));
    await expectHotelAmount({ ...view, host: document.body }, currency, '5000.00');
    expect(document.body.textContent).not.toContain('[object Object]');
    await act(async () => view.root.unmount());
  },
);

it.each(['EUR', 'ALL'])(
  'GuestSheet preserves %s and only requests foreign rates',
  async (currency) => {
    const money = { amount: '5000.00', currency };
    const element = createElement(GuestSheet, {
      tenantId: 't',
      propertyId: 'p',
      guest: { id: 'g', firstName: 'Ada', lastName: 'Guest', email: 'ada@test', phone: null },
      stats: {
        guestId: 'g',
        bookings: 1,
        cancelled: 0,
        stays: 1,
        kind: 'first-time',
        net: [money],
        outstanding: [money],
        netValue: 5000,
        outstandingValue: 5000,
        hasBalance: true,
      },
      bookings: [],
      onClose: () => {},
    });
    const view = await mountMoneyScreen(element, () => ({}));
    await expectHotelAmount({ ...view, host: document.body }, currency, '5000.00');
    expect(document.body.textContent).not.toContain('[object Object]');
    await act(async () => view.root.unmount());
  },
);

it.each(['EUR', 'ALL'])('Clock restriction reference prices use %s', async (currency) => {
  const view = await mountMoneyScreen(
    createElement(ClockAvailabilityPanel, {
      tenantId: 't',
      propertyId: 'p',
      view: 'restrictions',
    }),
    (url) =>
      url.includes('/clock-sync/availability')
        ? {
            status: 'READY',
            data: {
              roomTypes: [
                {
                  id: 'rt',
                  name: 'Suite',
                  days: [
                    {
                      date: '2026-11-01',
                      status: 'closed',
                      availableUnits: 2,
                      referencePrice: { amount: '5000.00', currency },
                    },
                  ],
                },
              ],
            },
          }
        : { enabled: false, jobs: [] },
  );
  await expectHotelAmount(view, currency, '5000.00');
  await act(async () => view.root.unmount());
});
