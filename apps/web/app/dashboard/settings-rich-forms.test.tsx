// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import { GeneralSettings, BookingRulesSettings, CheckInOutSettings } from './settings-forms';
import { UnsavedChangesBoundary } from '../../components/ui/unsaved-changes';
import type { Property } from './settings-areas';
import { areaHealth } from './settings-areas';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const property: Property = {
  id: 'p',
  name: 'Hotel',
  address: 'Main street',
  timezone: 'Europe/Tirane',
  logoUrl: null,
  phone: null,
  supportEmail: null,
  minStayNights: null,
  maxStayNights: null,
  checkInTime: '15:00',
  checkOutTime: '11:00',
  rules: null,
  advanceBookingDays: null,
  freeCancellationDaysBeforeArrival: 14,
  bookingMode: 'ROOM_TYPE_ONLY',
  paymentGateways: { stripe: false, pokpay: false, payAtHotel: true },
  wordpressConnectedAt: null,
  publicWebsiteOrigin: null,
};
async function mount(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement('div')),
    root = createRoot(host);
  await act(async () => root.render(<UnsavedChangesBoundary>{node}</UnsavedChangesBoundary>));
  return {
    host,
    root,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
async function value(id: string, v: string) {
  await act(async () => {
    const e = document.querySelector<HTMLInputElement>('#' + id)!;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value')!.set!.call(e, v);
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!;
it('groups General, validates business/about fields, locks a priced currency and saves only changed values', async () => {
  const save = vi.fn(),
    m = await mount(
      <GeneralSettings
        property={{ ...property, defaultCurrency: 'EUR', defaultCurrencyLocked: true }}
        saving={false}
        canWrite
        onSave={save}
      />,
    );
  try {
    expect(m.host.textContent).toContain('Business');
    expect(m.host.querySelector<HTMLInputElement>('#hotel-supportEmail')?.placeholder).toBe(
      'reservations@example.com',
    );
    expect(m.host.querySelector<HTMLInputElement>('#hotel-phone')?.placeholder).toBe('+355 ...');
    expect(m.host.textContent).toContain('About the hotel');
    expect(button('Save changes')).toBeUndefined();
    expect(
      [...m.host.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.includes('EUR'),
      )!.disabled,
    ).toBe(true);
    await value('hotel-legalName', 'Hotel Ltd');
    await value('hotel-website', 'http://hotel.test');
    await value('hotel-reservationsEmail', 'bad');
    expect(button('Save changes').disabled).toBe(true);
    expect(m.host.textContent).toContain('full https website');
    await value('hotel-website', 'https://hotel.test');
    await value('hotel-reservationsEmail', 'book@hotel.test');
    await value('hotel-description', 'A quiet hotel.');
    await act(async () => button('Save changes').click());
    expect(save).toHaveBeenCalledWith({
      legalName: 'Hotel Ltd',
      website: 'https://hotel.test',
      reservationsEmail: 'book@hotel.test',
      description: 'A quiet hotel.',
    });
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    await act(async () => button('Discard').click());
    expect(button('Save changes')).toBeUndefined();
  } finally {
    await m.close();
  }
});
it('groups same-day, limits and no-show guidance, validates whole numbers and saves one payload', async () => {
  const save = vi.fn(),
    m = await mount(
      <BookingRulesSettings property={property} saving={false} canWrite onSave={save} />,
    );
  try {
    expect(m.host.textContent).toContain('No-show guidance');
    expect(m.host.textContent).toContain('never charges');
    await value('hotel-maxGuestsPerBooking', '2.5');
    expect(button('Save changes').disabled).toBe(true);
    await value('hotel-maxGuestsPerBooking', '4');
    await value('hotel-maxRoomsPerBooking', '2');
    await value('hotel-sameDayCutoffTime', '18:00');
    await act(async () => {
      (document.querySelector('#hotel-allowSameDayBooking') as HTMLButtonElement).click();
    });
    await act(async () => button('Save changes').click());
    expect(save).toHaveBeenCalledWith({
      maxGuestsPerBooking: 4,
      maxRoomsPerBooking: 2,
      sameDayCutoffTime: '18:00',
      allowSameDayBooking: false,
    });
  } finally {
    await m.close();
  }
});
it('groups arrival and policies, validates paired hours and saves notes without changing standard times', async () => {
  const save = vi.fn(),
    m = await mount(
      <CheckInOutSettings property={property} saving={false} canWrite onSave={save} />,
    );
  try {
    expect(m.host.textContent).toContain('Early check-in and late check-out');
    expect(m.host.textContent).toContain('Children and pets');
    await value('hotel-quietHoursFrom', '22:00');
    expect(button('Save changes').disabled).toBe(true);
    await value('hotel-quietHoursTo', '07:00');
    await value('hotel-earlyCheckInNote', 'Ask reception.');
    await act(async () => {
      (document.querySelector('#hotel-idRequiredAtArrival') as HTMLButtonElement).click();
    });
    await act(async () => button('Save changes').click());
    expect(save).toHaveBeenCalledWith({
      quietHoursFrom: '22:00',
      quietHoursTo: '07:00',
      earlyCheckInNote: 'Ask reception.',
      idRequiredAtArrival: true,
    });
    expect(areaHealth({ ...property, quietHoursFrom: '22:00' }, null)['check-in-out'].status).toBe(
      'attention',
    );
  } finally {
    await m.close();
  }
});
it.each([GeneralSettings, BookingRulesSettings, CheckInOutSettings])(
  'renders values but no save controls for a read-only viewer',
  async (Component) => {
    const m = await mount(
      <Component
        property={{ ...property, legalName: 'Hotel Ltd' }}
        saving={false}
        canWrite={false}
        onSave={vi.fn()}
      />,
    );
    try {
      expect(m.host.querySelectorAll('input:disabled,textarea:disabled').length).toBeGreaterThan(0);
      expect(button('Save changes')).toBeUndefined();
      expect(m.host.querySelector('input:not(:disabled)')).toBeNull();
    } finally {
      await m.close();
    }
  },
);
