/** The Settings areas, how healthy each one looks, and the checks the forms run before saving. */
export type PaymentGateways = { stripe: boolean; pokpay: boolean; payAtHotel: boolean };
export type BookingMode = 'ROOM_TYPE_ONLY' | 'INDIVIDUAL_ROOM_ONLY' | 'MIXED';

export type Property = {
  id: string;
  name: string;
  address: string;
  timezone: string;
  logoUrl: string | null;
  phone: string | null;
  supportEmail: string | null;
  minStayNights: number | null;
  maxStayNights: number | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  rules: string | null;
  advanceBookingDays: number | null;
  freeCancellationDaysBeforeArrival: number;
  bookingMode: BookingMode;
  paymentGateways: PaymentGateways;
  wordpressConnectedAt: string | null;
  publicWebsiteOrigin: string | null;
};

export const settingsAreas = [
  {
    key: 'general',
    label: 'General',
    scope: 'Property',
    description: 'Hotel name, address and time zone.',
  },
  {
    key: 'booking-rules',
    label: 'Booking rules',
    scope: 'Property',
    description: 'Stay limits, free cancellation, inventory mode and house rules.',
  },
  {
    key: 'check-in-out',
    label: 'Check-in & check-out',
    scope: 'Property',
    description: 'The arrival and departure times shown to guests.',
  },
  {
    key: 'payments',
    label: 'Payments',
    scope: 'Property',
    description: 'Choose the payment methods available for this property.',
  },
  {
    key: 'branding',
    label: 'Branding',
    scope: 'Property',
    description: 'The logo and contact details used in booking emails.',
  },
  {
    key: 'email',
    label: 'Emails',
    scope: 'Property',
    description: 'Who gets which emails, the wording, and every email sent.',
  },
  {
    key: 'managed-pages',
    label: 'Managed Pages',
    scope: 'Property',
    description: 'Connect the property website and manage its WordPress pairing.',
  },
  {
    key: 'billing',
    label: 'Billing account',
    scope: 'Account',
    description: 'The current platform plan and billing controls.',
  },
] as const;

export type SettingsArea = (typeof settingsAreas)[number]['key'];

export function isSettingsArea(value: string | null): value is SettingsArea {
  return settingsAreas.some((area) => area.key === value);
}

export type AreaHealth = { status: 'done' | 'attention' | 'todo' | 'none'; note: string };

/** What each area looks like from the saved settings alone; nothing is guessed. */
export function areaHealth(
  property: Property,
  planName: string | null,
): Record<SettingsArea, AreaHealth> {
  const present = (value: string | null | undefined) => !!value && value.trim() !== '';
  const stayOrderWrong =
    property.minStayNights !== null &&
    property.maxStayNights !== null &&
    property.minStayNights > property.maxStayNights;
  const gateways = property.paymentGateways;
  return {
    general:
      present(property.name) && present(property.address) && present(property.timezone)
        ? { status: 'done', note: 'Name, address and time zone are set.' }
        : { status: 'attention', note: 'The name, address or time zone is missing.' },
    'booking-rules': stayOrderWrong
      ? { status: 'attention', note: 'The minimum stay is longer than the maximum stay.' }
      : { status: 'done', note: 'Stay limits and cancellation window are set.' },
    'check-in-out':
      present(property.checkInTime) && present(property.checkOutTime)
        ? { status: 'done', note: `From ${property.checkInTime} to ${property.checkOutTime}.` }
        : { status: 'todo', note: 'Guests are not shown a check-in or check-out time.' },
    payments:
      gateways.stripe || gateways.pokpay || gateways.payAtHotel
        ? { status: 'done', note: 'At least one payment method is on.' }
        : { status: 'attention', note: 'No payment method is switched on.' },
    branding: present(property.supportEmail)
      ? { status: 'done', note: 'A support email is set for guests.' }
      : { status: 'attention', note: 'Guests have no support email in booking emails.' },
    email: { status: 'none', note: '' },
    'managed-pages':
      property.wordpressConnectedAt || present(property.publicWebsiteOrigin)
        ? { status: 'done', note: 'The hotel website is connected.' }
        : { status: 'todo', note: 'The hotel website is not connected yet.' },
    billing: planName
      ? { status: 'done', note: `Plan: ${planName}.` }
      : { status: 'todo', note: 'No plan information is available.' },
  };
}

export function timeZoneOptions(current: string): string[] {
  let zones: string[] = [];
  try {
    zones =
      (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.(
        'timeZone',
      ) ?? [];
  } catch {
    zones = [];
  }
  return zones.includes(current) || !current ? zones : [current, ...zones];
}

const wholeNumber = (value: string) => /^\d+$/.test(value.trim());

export type RulesDraft = {
  minStayNights: string;
  maxStayNights: string;
  advanceBookingDays: string;
  freeCancellationDaysBeforeArrival: string;
};

/** Plain-words problems with the stay limits; an empty object means they can be saved. */
export function validateRules(draft: RulesDraft): Partial<Record<keyof RulesDraft, string>> {
  const errors: Partial<Record<keyof RulesDraft, string>> = {};
  const min = draft.minStayNights.trim();
  const max = draft.maxStayNights.trim();
  if (min !== '' && (!wholeNumber(min) || Number(min) < 1))
    errors.minStayNights = 'Use a whole number of nights, 1 or more.';
  if (max !== '' && (!wholeNumber(max) || Number(max) < 1))
    errors.maxStayNights = 'Use a whole number of nights, 1 or more.';
  if (
    !errors.minStayNights &&
    !errors.maxStayNights &&
    min !== '' &&
    max !== '' &&
    Number(min) > Number(max)
  )
    errors.minStayNights = 'The minimum stay cannot be longer than the maximum stay.';
  const advance = draft.advanceBookingDays.trim();
  if (advance !== '' && !wholeNumber(advance))
    errors.advanceBookingDays = 'Use a whole number of days, 0 or more.';
  const cancel = draft.freeCancellationDaysBeforeArrival.trim();
  if (cancel === '' || !wholeNumber(cancel))
    errors.freeCancellationDaysBeforeArrival = 'Use a whole number of days, 0 or more.';
  return errors;
}

export const validTime = (value: string) => value === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
