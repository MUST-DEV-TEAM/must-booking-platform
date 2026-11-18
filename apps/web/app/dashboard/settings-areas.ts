/** The Settings areas, how healthy each one looks, and the checks the forms run before saving. */
export type PaymentGateways = { stripe: boolean; pokpay: boolean; payAtHotel: boolean };
export type BookingMode = 'ROOM_TYPE_ONLY' | 'INDIVIDUAL_ROOM_ONLY' | 'MIXED';
/** What happens to the guest's online payment when the hotel cancels the booking inside Clock. */
export type ClockCancelRefundPolicy = 'NEVER' | 'FREE_WINDOW' | 'ALWAYS';
export type ClockPaymentFolio = 'DEPOSIT' | 'MAIN';

export type Property = {
  dateFormat?: string;
  timeFormat?: string;
  weekStart?: string;
  numberFormat?: string;
  legalName?: string | null;
  taxNumber?: string | null;
  country?: string | null;
  defaultCurrency?: string | null;
  defaultCurrencyLocked?: boolean;
  languages?: string[];
  website?: string | null;
  reservationsEmail?: string | null;
  description?: string | null;
  starRating?: number | null;
  chainName?: string | null;
  propertyType?: string | null;
  starRatingOfficial?: boolean;
  yearOpened?: number | null;
  yearRenovated?: number | null;
  summary?: string | null;
  tourismLicence?: string | null;
  vatRegistered?: boolean;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  directions?: string | null;
  nearestAirportCode?: string | null;
  nearestAirportKm?: number | null;
  allowSameDayBooking?: boolean;
  sameDayCutoffTime?: string | null;
  maxGuestsPerBooking?: number | null;
  maxRoomsPerBooking?: number | null;
  noShowRule?: string;
  earlyCheckInPolicy?: string | null;
  earlyCheckInUntil?: string | null;
  earlyCheckInNote?: string | null;
  lateCheckOutPolicy?: string | null;
  lateCheckOutUntil?: string | null;
  lateCheckOutNote?: string | null;
  idRequiredAtArrival?: boolean;
  quietHoursFrom?: string | null;
  quietHoursTo?: string | null;
  childrenPolicy?: string | null;
  childrenPolicyNote?: string | null;
  petsPolicy?: string | null;
  petsPolicyNote?: string | null;

  id: string;
  name: string;
  address: string;
  timezone: string;
  onlinePaymentHoldMinutes?: number;
  autoRefundOnFreeCancellation?: boolean;
  /** A refund the guest asked for keeps back the payment provider's fee. */
  deductPaymentFeeOnGuestRefund?: boolean;
  clockCancelRefundPolicy?: ClockCancelRefundPolicy;
  clockPaymentFolio?: ClockPaymentFolio;
  brandColour?: string | null;
  emailFooterText?: string | null;
  termsUrl?: string | null;
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
    key: 'integrations',
    label: 'Integrations',
    scope: 'Property',
    description: 'Connect Clock PMS+ and PokPay, test credentials and monitor synchronization.',
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
    label: 'Website connection',
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

/** "Ready to take bookings": worked out by the server (G-65); the browser only shows it. */
export type ReadinessStep = {
  key: 'profile' | 'booking-rules' | 'policies' | 'payment-methods' | 'website';
  tab: 'profile' | 'booking-rules' | 'policies' | 'payment-methods' | 'integrations';
  label: string;
  status: 'done' | 'attention' | 'todo';
  note: string;
};
export type SettingsReadiness = { ready: boolean; steps: ReadinessStep[] };

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
