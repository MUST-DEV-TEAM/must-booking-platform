/**
 * "Ready to take bookings": the status of each setting guests depend on, worked out on the server
 * from the saved settings alone (nothing is guessed). The Settings overview, the Hotels directory
 * and every other reader use this one answer (settings redesign plan, S0c, G-65).
 */
export type ReadinessStatus = 'done' | 'attention' | 'todo';
export type ReadinessStepKey =
  'profile' | 'contact' | 'booking-rules' | 'policies' | 'payment-methods' | 'website' | 'email';
export type ReadinessStep = {
  key: ReadinessStepKey;
  /** The Settings tab that fixes it. */
  tab:
    | 'profile'
    | 'contact-brand'
    | 'booking-rules'
    | 'policies'
    | 'payment-methods'
    | 'integrations'
    | 'emails';
  label: string;
  status: ReadinessStatus;
  note: string;
  /** A recommended step that does not decide "ready to take bookings" (guests can book without it). */
  optional?: boolean;
};
export type SettingsReadiness = { ready: boolean; steps: ReadinessStep[] };

export type ReadinessInput = {
  name: string;
  address: string | null;
  timezone: string | null;
  minStayNights: number | null;
  maxStayNights: number | null;
  maxGuestsPerBooking?: number | null;
  maxRoomsPerBooking?: number | null;
  sameDayCutoffTime?: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  earlyCheckInPolicy?: string | null;
  earlyCheckInUntil?: string | null;
  lateCheckOutPolicy?: string | null;
  lateCheckOutUntil?: string | null;
  quietHoursFrom?: string | null;
  quietHoursTo?: string | null;
  paymentGateways: { stripe: boolean; pokpay: boolean; payAtHotel: boolean };
  connectedProviders: readonly string[];
  wordpressConnectedAt: Date | string | null;
  publicWebsiteOrigin: string | null;
  /** The guest contact on Contact and brand; the step is omitted when a reader does not load them. */
  supportEmail?: string | null;
  phone?: string | null;
  /**
   * True when the hotel sends its emails through its own provider (Resend, SMTP or Brevo), not MUST's.
   * Left out by readers that cannot see the hotel's sending profile (the hotels list); the step is then omitted.
   */
  emailProviderActive?: boolean;
};

const present = (value: string | null | undefined) => !!value && value.trim() !== '';
const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function settingsReadiness(hotel: ReadinessInput): SettingsReadiness {
  const stayOrderWrong =
    hotel.minStayNights !== null &&
    hotel.maxStayNights !== null &&
    hotel.minStayNights > hotel.maxStayNights;
  const invalidLimits =
    [hotel.maxGuestsPerBooking, hotel.maxRoomsPerBooking].some(
      (value) => value != null && (!Number.isInteger(value) || value < 1),
    ) ||
    (present(hotel.sameDayCutoffTime) && !validTime(hotel.sameDayCutoffTime!));
  const invalidArrival =
    (hotel.earlyCheckInPolicy === 'free_until' && !hotel.earlyCheckInUntil) ||
    (hotel.lateCheckOutPolicy === 'free_until' && !hotel.lateCheckOutUntil) ||
    Boolean(hotel.quietHoursFrom) !== Boolean(hotel.quietHoursTo);
  const gateways = hotel.paymentGateways;
  const connected = new Set(hotel.connectedProviders);
  const steps: ReadinessStep[] = [
    {
      key: 'profile',
      tab: 'profile',
      label: 'Hotel profile',
      ...(present(hotel.name) && present(hotel.address) && present(hotel.timezone)
        ? { status: 'done' as const, note: 'Name, address and time zone are set.' }
        : { status: 'attention' as const, note: 'The name, address or time zone is missing.' }),
    },
    ...(hotel.supportEmail === undefined && hotel.phone === undefined
      ? []
      : ([
          {
            key: 'contact',
            tab: 'contact-brand',
            label: 'Contact details',
            ...(present(hotel.supportEmail) && present(hotel.phone)
              ? { status: 'done' as const, note: 'Guests can reach you by email and phone.' }
              : {
                  status: 'todo' as const,
                  note: 'Add the guest contact email and phone shown on the booking page and in emails.',
                }),
          },
        ] satisfies ReadinessStep[])),
    {
      key: 'booking-rules',
      tab: 'booking-rules',
      label: 'Booking rules',
      ...(invalidLimits
        ? {
            status: 'attention' as const,
            note: 'Check the same-day cutoff and booking size limits.',
          }
        : stayOrderWrong
          ? {
              status: 'attention' as const,
              note: 'The minimum stay is longer than the maximum stay.',
            }
          : { status: 'done' as const, note: 'Stay limits and cancellation window are set.' }),
    },
    {
      key: 'policies',
      tab: 'policies',
      label: 'Check-in and check-out times',
      ...(invalidArrival
        ? { status: 'attention' as const, note: 'Complete the free-until or quiet-hours times.' }
        : present(hotel.checkInTime) && present(hotel.checkOutTime)
          ? {
              status: 'done' as const,
              note: `From ${hotel.checkInTime} to ${hotel.checkOutTime}.`,
            }
          : {
              status: 'todo' as const,
              note: 'Guests are not shown a check-in or check-out time.',
            }),
    },
    {
      key: 'payment-methods',
      tab: 'payment-methods',
      label: 'Payment method',
      ...(gateways.payAtHotel ||
      (gateways.stripe && connected.has('STRIPE')) ||
      (gateways.pokpay && connected.has('POKPAY'))
        ? { status: 'done' as const, note: 'At least one payment method is available to guests.' }
        : {
            status: 'attention' as const,
            note: 'Switch on pay at hotel or connect an enabled online payment provider.',
          }),
    },
    {
      key: 'website',
      tab: 'integrations',
      label: 'Website connection',
      ...(hotel.wordpressConnectedAt && present(hotel.publicWebsiteOrigin)
        ? { status: 'done' as const, note: 'The hotel website is connected.' }
        : { status: 'todo' as const, note: 'The hotel website is not connected yet.' }),
    },
    ...(hotel.emailProviderActive === undefined
      ? []
      : ([
          {
            key: 'email',
            tab: 'emails',
            label: 'Connect your email provider',
            optional: true,
            ...(hotel.emailProviderActive
              ? { status: 'done' as const, note: 'Guest emails are sent from your own address.' }
              : {
                  status: 'todo' as const,
                  note: "Guest emails are sent from MUST's address until you connect your own provider.",
                }),
          },
        ] satisfies ReadinessStep[])),
  ];
  return {
    ready: steps.every((step) => step.optional || step.status === 'done'),
    steps,
  };
}
