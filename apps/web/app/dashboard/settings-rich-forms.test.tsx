// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import { GeneralSettings, BookingRulesSettings, CheckInOutSettings } from './settings-forms';
import { UnsavedChangesBoundary } from '../../components/ui/unsaved-changes';
import type { Property } from './settings-areas';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout: the time wheels scroll to the chosen row, so give them something to call.
HTMLElement.prototype.scrollTo = vi.fn();
const property: Property = {
  id: 'p',
  name: 'Hotel',
  city: 'Tirana',
  country: 'AL',
  propertyType: 'hotel',
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <UnsavedChangesBoundary>{node}</UnsavedChangesBoundary>
      </QueryClientProvider>,
    ),
  );
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
/** Pick a time on the designed wheel picker: open it, choose the hour and the minute, press Done. */
async function pickTime(id: string, time: string) {
  const [hour, minute] = time.split(':') as [string, string];
  await act(async () => document.querySelector<HTMLButtonElement>('#' + id)!.click());
  const option = (list: string, text: string) =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        `[role="listbox"][aria-label="${list}"] button`,
      ),
    ].find((b) => b.textContent === text)!;
  await act(async () => option('Hours', hour).click());
  await act(async () => option('Minutes', minute).click());
  await act(async () => button('Done').click());
}
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
    expect(m.host.querySelector('#hotel-roomCount')?.textContent).toContain('Not counted yet');
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
    // A priced hotel's currency is shown as a locked box, not as something to change.
    expect(m.host.textContent).toContain('EUR · Euro');
    expect(m.host.textContent).toContain('Locked');
    expect(
      [...m.host.querySelectorAll<HTMLButtonElement>('button')].some((b) =>
        b.textContent?.includes('EUR'),
      ),
    ).toBe(false);
    await value('hotel-legalName', 'Hotel Ltd');
    await value('hotel-description', 'A quiet hotel.');
    expect(m.host.textContent).toContain('at least 50 characters');
    expect(button('Save changes').disabled).toBe(true);
    const description = 'A quiet beach hotel with a garden, a pool and a short walk to the sea.';
    await value('hotel-description', description);
    await value('hotel-taxNumber', '12345');
    // The sample hotel is in Albania, so a short number is refused with the Albanian rule.
    expect(m.host.textContent).toContain('Albanian NUIS is a letter');
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
    await pickTime('hotel-sameDayCutoffTime', '18:00');
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
    expect(m.host.textContent).toContain('Early check-in');
    expect(m.host.textContent).toContain('Late check-out');
    for (const title of [
      'Cots and extra beds',
      'Children',
      'Pets',
      'House rules',
      'Damage deposit',
      'Guests will read',
    ])
      expect(m.host.textContent).toContain(title);
    await pickTime('hotel-quietHoursFrom', '22:00');
    expect(button('Save changes').disabled).toBe(true);
    await pickTime('hotel-quietHoursTo', '07:00');
    await value('hotel-earlyCheckInNote', 'Ask reception.');
    await value('hotel-otherHouseRules', 'No loud music after 23:00.');
    await act(async () => button('Save changes').click());
    expect(save).toHaveBeenCalledWith({
      quietHoursFrom: '22:00',
      quietHoursTo: '07:00',
      earlyCheckInNote: 'Ask reception.',
      otherHouseRules: 'No loud music after 23:00.',
    });
  } finally {
    await m.close();
  }
});
it('holds the policies to the shared rules before saving', async () => {
  const save = vi.fn(),
    m = await mount(
      <CheckInOutSettings
        property={{
          ...property,
          checkInTime: '15:00',
          checkOutTime: '11:00',
          cotsPolicy: 'paid',
          idAtArrival: 'all_adults',
          idDocuments: [],
          damageDepositAmount: '100.00',
        }}
        saving={false}
        canWrite
        onSave={save}
      />,
    );
  try {
    await pickTime('hotel-quietHoursFrom', '22:00');
    await pickTime('hotel-quietHoursTo', '07:00');
    expect(m.host.textContent).toContain('Enter the price per night.');
    expect(m.host.textContent).toContain('Enter how many per room, from 1 to 3.');
    expect(m.host.textContent).toContain('Choose at least one accepted document.');
    expect(m.host.textContent).toContain('Choose how the deposit is taken.');
    expect(button('Save changes').disabled).toBe(true);
    await pickTime('hotel-checkInUntil', '10:00');
    expect(m.host.textContent).toContain('Check-in until must be later than check-in from.');
    await pickTime('hotel-checkInUntil', '23:00');
    expect(m.host.textContent).not.toContain('Check-in until must be later');
    expect(save).not.toHaveBeenCalled();
  } finally {
    await m.close();
  }
});
it('locks what a connected PMS owns and hides gap filling', async () => {
  const m = await mount(
    <BookingRulesSettings
      property={{ ...property, pmsSource: 'CLOCK_PMS' }}
      saving={false}
      canWrite
      onSave={vi.fn()}
    />,
  );
  try {
    expect(m.host.textContent).toContain('Not used with a connected PMS yet');
    expect(m.host.textContent).not.toContain('Fill gap nights');
    expect((m.host.querySelector('#hotel-childrenUpToAge') as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((m.host.querySelector('#hotel-minBookingAge') as HTMLInputElement).disabled).toBe(false);
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
  // The modern, widely spoken languages only (no obscure codes such as aa or ab).
  expect(list.length).toBeGreaterThan(70);
  expect(list.length).toBeLessThan(260);
  expect(list.some((item) => item.value === 'aa' || item.value === 'ab')).toBe(false);
  expect(list[0]).toMatchObject({ value: 'sq', group: 'Common' });
  expect(list[0]!.label).toBe('Albanian · Shqip');
  expect(list.find((item) => item.value === 'ja')?.group).toBe('All languages');
  expect(new Set(list.map((item) => item.value)).size).toBe(list.length);
});
it('asks for notice, season and arrival days with the same rules as the server', async () => {
  const save = vi.fn(),
    m = await mount(
      <BookingRulesSettings property={property} saving={false} canWrite onSave={save} />,
    );
  try {
    expect(m.host.textContent).toContain('Booking window and season');
    await value('hotel-minNoticeHours', '900');
    expect(m.host.textContent).toContain('0 to 720');
    expect(button('Save changes').disabled).toBe(true);
    await value('hotel-minNoticeHours', '24');
    // Switch Monday to Friday off for arrivals: only Saturday and Sunday remain.
    const arrival = (day: string) =>
      m.host.querySelector<HTMLButtonElement>(`button[aria-label="Arrival days: ${day}"]`)!;
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
      await act(async () => arrival(day).click());
    expect(arrival('Sat').getAttribute('aria-pressed')).toBe('true');
    expect(arrival('Mon').getAttribute('aria-pressed')).toBe('false');
    // Switching the last two off is refused: at least one day stays on.
    await act(async () => arrival('Sat').click());
    await act(async () => arrival('Sun').click());
    expect(m.host.textContent).toContain('Choose at least one day');
    expect(button('Save changes').disabled).toBe(true);
    await act(async () => arrival('Sat').click());
    await act(async () => button('Save changes').click());
    expect(save).toHaveBeenCalledWith({ minNoticeHours: 24, arrivalDays: [6] });
  } finally {
    await m.close();
  }
});
