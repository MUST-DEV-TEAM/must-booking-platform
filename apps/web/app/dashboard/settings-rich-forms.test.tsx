// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import { GeneralSettings, BookingRulesSettings, CheckInOutSettings } from './settings-forms';
import { UnsavedChangesBoundary } from '../../components/ui/unsaved-changes';
import type { Property } from './settings-areas';
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
    for (const group of [
      'Hotel identity',
      'Location',
      'Legal and tax',
      'Languages spoken at the hotel',
      'Currency',
      'Formats',
    ])
      expect(m.host.textContent).toContain(group);
    // The street address lives in Location only (no second address box), the room count is read-only.
    expect(m.host.querySelectorAll('#hotel-address')).toHaveLength(1);
    expect(m.host.querySelector('#hotel-roomCount')?.textContent).toBe('Not counted yet');
    expect(button('Find from address')).toBeDefined();
    expect(button('Save changes')).toBeUndefined();
    // The hotel name is required, checked before saving.
    await value('hotel-name', ' ');
    expect(m.host.textContent).toContain('Enter the hotel name.');
    await value('hotel-name', 'Hotel');
    // The registered address asks for its fields only when it differs from the hotel's.
    expect(m.host.querySelector('#hotel-registeredStreet')).toBeNull();
    await act(async () =>
      m.host.querySelector<HTMLButtonElement>('#hotel-registeredSameAsHotel')!.click(),
    );
    expect(m.host.querySelector('#hotel-registeredStreet')).not.toBeNull();
    expect(m.host.textContent).toContain('Enter the registered street address.');
    await act(async () =>
      m.host.querySelector<HTMLButtonElement>('#hotel-registeredSameAsHotel')!.click(),
    );
    expect(
      [...m.host.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.includes('EUR'),
      )!.disabled,
    ).toBe(true);
    await value('hotel-legalName', 'Hotel Ltd');
    await value('hotel-description', 'A quiet hotel.');
    expect(m.host.textContent).toContain('at least 50 characters');
    expect(button('Save changes').disabled).toBe(true);
    const description = 'A quiet beach hotel with a garden, a pool and a short walk to the sea.';
    await value('hotel-description', description);
    await value('hotel-taxNumber', '12345');
    expect(m.host.textContent).not.toContain('NUIS is a letter');
    await value('hotel-taxNumber', 'l12345678a');
    await value('hotel-summary', 'Quiet beach hotel.');
    await act(async () => button('Save changes').click());
    expect(save).toHaveBeenCalledWith({
      legalName: 'Hotel Ltd',
      description,
      taxNumber: 'L12345678A',
      summary: 'Quiet beach hotel.',
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
it('lists every language by name with the common ones first', async () => {
  const { languageOptions } = await import('./hotel-settings-fields');
  const list = languageOptions();
  expect(list.length).toBeGreaterThan(150);
  expect(list[0]).toMatchObject({ value: 'sq', group: 'Common' });
  expect(list[0]!.label).toBe('Albanian · Shqip');
  expect(list.find((item) => item.value === 'ja')?.group).toBe('All languages');
  expect(new Set(list.map((item) => item.value)).size).toBe(list.length);
});
