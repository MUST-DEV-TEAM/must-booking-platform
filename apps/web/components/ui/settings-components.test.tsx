// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  areaHealth,
  validateRules,
  validTime,
  type Property,
} from '../../app/dashboard/settings-areas';
import { ChecklistPanel } from './checklist-panel';
import { SaveBar } from './save-bar';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  document.body.replaceChildren();
});
async function render(element: React.ReactElement) {
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  await act(async () => root.render(element));
  mounted.push(async () => act(async () => root.unmount()));
  return container;
}

const property: Property = {
  id: 'p',
  name: 'Grand Hotel',
  address: '1 Main Street',
  timezone: 'Europe/Tirane',
  logoUrl: null,
  phone: null,
  supportEmail: null,
  minStayNights: 2,
  maxStayNights: 7,
  checkInTime: '15:00',
  checkOutTime: '11:00',
  rules: null,
  advanceBookingDays: null,
  freeCancellationDaysBeforeArrival: 21,
  bookingMode: 'ROOM_TYPE_ONLY',
  paymentGateways: { stripe: false, pokpay: false, payAtHotel: true },
  wordpressConnectedAt: null,
  publicWebsiteOrigin: null,
};

describe('settings status and checks', () => {
  it('reports each area from the saved settings only', () => {
    const health = areaHealth(property, 'Free');
    expect(health.general.status).toBe('done');
    expect(health['check-in-out'].note).toBe('From 15:00 to 11:00.');
    expect(health.payments.status).toBe('done');
    expect(health.branding.status).toBe('attention');
    expect(health['managed-pages'].status).toBe('todo');
    expect(health.billing.note).toBe('Plan: Free.');
    expect(health.email.status).toBe('none');
    const broken = areaHealth(
      {
        ...property,
        address: ' ',
        minStayNights: 9,
        paymentGateways: { stripe: false, pokpay: false, payAtHotel: false },
        checkOutTime: null,
      },
      null,
    );
    expect(broken.general.status).toBe('attention');
    expect(broken['booking-rules'].status).toBe('attention');
    expect(broken.payments.status).toBe('attention');
    expect(broken['check-in-out'].status).toBe('todo');
    expect(broken.billing.status).toBe('todo');
  });

  it('explains stay-limit mistakes in plain words', () => {
    const base = {
      minStayNights: '2',
      maxStayNights: '7',
      advanceBookingDays: '',
      freeCancellationDaysBeforeArrival: '21',
    };
    expect(validateRules(base)).toEqual({});
    expect(validateRules({ ...base, minStayNights: '9' }).minStayNights).toContain(
      'cannot be longer',
    );
    expect(validateRules({ ...base, maxStayNights: '0' }).maxStayNights).toContain('1 or more');
    expect(validateRules({ ...base, advanceBookingDays: '-1' }).advanceBookingDays).toContain(
      '0 or more',
    );
    expect(
      validateRules({ ...base, freeCancellationDaysBeforeArrival: '' })
        .freeCancellationDaysBeforeArrival,
    ).toBeTruthy();
    expect(validTime('')).toBe(true);
    expect(validTime('15:00')).toBe(true);
    expect(validTime('25:00')).toBe(false);
    expect(validTime('3pm')).toBe(false);
  });
});

describe('save bar and checklist', () => {
  it('shows the bar only when something changed and offers Save and Discard', async () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const clean = await render(
      createElement(SaveBar, { dirty: false, saving: false, onSave, onDiscard }),
    );
    expect(clean.textContent).toBe('');
    const dirty = await render(
      createElement(SaveBar, { dirty: true, saving: false, canSave: false, onSave, onDiscard }),
    );
    expect(dirty.textContent).toContain('You have unsaved changes.');
    const buttons = [...dirty.querySelectorAll('button')];
    expect(buttons.find((b) => b.textContent === 'Save changes')!.disabled).toBe(true);
    await act(async () => buttons.find((b) => b.textContent === 'Discard')!.click());
    expect(onDiscard).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('counts ready items and links each one to where it is fixed', async () => {
    const view = await render(
      createElement(ChecklistPanel, {
        title: 'Ready to take bookings',
        items: [
          { key: 'a', label: 'Hotel identity', status: 'done', href: '/a' },
          {
            key: 'b',
            label: 'Payment method',
            status: 'attention',
            detail: 'None is on.',
            href: '/b',
          },
          { key: 'c', label: 'Website', status: 'todo' },
        ],
      }),
    );
    expect(view.textContent).toContain('1 of 3 ready');
    expect(view.textContent).toContain('Needs attention');
    expect(view.textContent).toContain('None is on.');
    expect([...view.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/a',
      '/b',
    ]);
  });
});
