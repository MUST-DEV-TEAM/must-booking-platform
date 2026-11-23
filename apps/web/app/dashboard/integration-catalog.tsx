import type { ReactNode } from 'react';

import { onBrevo } from './brevo-setup';
import type { EmailSendingProfile } from './email-sending-profile';

import { formatDateTime } from '../../lib/hotel-format';

export type ConnectionProvider = 'CLOCK_PMS' | 'POKPAY' | 'STRIPE';

export type Connection = {
  id: string;
  provider: ConnectionProvider;
  name: string;
  status: string;
  /** TEST or LIVE for a payment account; null for Clock. */
  mode?: 'TEST' | 'LIVE' | null;
  /** Random id in this connection's public webhook address (Stripe). */
  webhookPublicId?: string;
  lastTestedAt: string | null;
  lastTestResult: string | null;
};

export const CATEGORIES = [
  'All',
  'Property systems',
  'Payments',
  'Email',
  'Website',
  'Channels',
  'Restaurants',
] as const;

/** What each integration is for and what it owns, written for the card and the detail view. */
export const INTEGRATIONS = [
  {
    provider: 'CLOCK_PMS',
    name: 'Clock PMS+',
    category: 'Property systems',
    role: 'Property system',
    owns: 'rooms, rates, availability and reservations',
    what: "Clock PMS+ runs the hotel's rooms, prices and reservations. MUST reads them and sends new bookings back.",
    available: true,
  },
  {
    provider: 'POKPAY',
    name: 'PokPay',
    category: 'Payments',
    role: 'Payments',
    owns: 'online payments through PokPay',
    what: "Guests pay online through the hotel's own PokPay account. PokPay accepts cards.",
    available: true,
  },
  {
    provider: 'STRIPE',
    name: 'Stripe',
    category: 'Payments',
    role: 'Payments',
    owns: 'online payments through Stripe',
    what: "Guests pay online through the hotel's own Stripe account, by card, and with Apple Pay or Google Pay where Stripe supports them.",
    available: true,
  },
  {
    provider: 'RAIFFEISEN',
    name: 'Raiffeisen',
    category: 'Payments',
    role: 'Payments',
    owns: 'online payments through Raiffeisen',
    what: '',
    available: false,
  },
  {
    provider: 'PAYPAL',
    name: 'PayPal',
    category: 'Payments',
    role: 'Payments',
    owns: 'online payments through PayPal',
    what: '',
    available: false,
  },
  {
    provider: 'BOOKING',
    name: 'Booking.com',
    category: 'Channels',
    role: 'Channel',
    owns: 'bookings and availability on Booking.com',
    what: '',
    available: false,
  },
  {
    provider: 'AIRBNB',
    name: 'Airbnb',
    category: 'Channels',
    role: 'Channel',
    owns: 'bookings and availability on Airbnb',
    what: '',
    available: false,
  },
  {
    provider: 'SMTP',
    name: 'SMTP email',
    category: 'Email',
    role: 'Email',
    owns: "the hotel's own guest email sending",
    what: '',
    available: false,
  },
];

export type CatalogItem = (typeof INTEGRATIONS)[number];

/** A short status with a coloured dot: green when it works, red when it failed, grey otherwise. */
export function StatusLine({
  tone,
  children,
}: {
  tone: 'ok' | 'failed' | 'idle';
  children: ReactNode;
}) {
  return (
    <p className="m-0 flex items-start gap-2 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className={`mt-1 size-2 shrink-0 rounded-full ${
          tone === 'ok'
            ? 'bg-success'
            : tone === 'failed'
              ? 'bg-destructive'
              : 'bg-muted-foreground/40'
        }`}
      />
      <span>{children}</span>
    </p>
  );
}

/** Whether an integration works, from its last check (a fuller health history is not recorded yet). */
export function HealthLine({ connection }: { connection: Connection | null }) {
  const state = !connection
    ? 'none'
    : connection.status === 'CONNECTED'
      ? 'ok'
      : connection.status === 'FAILED'
        ? 'failed'
        : 'unknown';
  return (
    <p className="m-0 flex items-start gap-2 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className={`mt-1 size-2 shrink-0 rounded-full ${
          state === 'ok'
            ? 'bg-success'
            : state === 'failed'
              ? 'bg-destructive'
              : 'bg-muted-foreground/40'
        }`}
      />
      <span>
        {state === 'none'
          ? 'Not connected yet'
          : state === 'ok'
            ? 'Working'
            : state === 'failed'
              ? 'Last check failed'
              : 'Not checked yet'}
        {connection?.lastTestedAt ? ` · checked ${formatDateTime(connection.lastTestedAt)}` : ''}
        {connection?.lastTestResult ? (
          <span className="block">{connection.lastTestResult}</span>
        ) : null}
      </span>
    </p>
  );
}

/** How the hotel's own Brevo sending stands, for the Brevo card and its detail view. */
export function brevoState(
  profile: EmailSendingProfile | undefined,
  unavailable: boolean,
  optionLabels: Record<string, string>,
): { badge: string; active: boolean; tone: 'ok' | 'failed' | 'idle'; text: string } {
  if (unavailable)
    return {
      badge: 'Status unavailable',
      active: false,
      tone: 'idle',
      text: 'The sending setup could not be read.',
    };
  if (!profile) return { badge: 'Checking…', active: false, tone: 'idle', text: 'Checking…' };
  if (
    onBrevo(profile) &&
    profile.activeMode === profile.mode &&
    profile.connectionStatus === 'verified'
  )
    return {
      badge: 'Sending guest emails',
      active: true,
      tone: 'ok',
      text: `Guest emails go out through your Brevo account${
        profile.fromAddress ? ` as ${profile.fromAddress}` : ''
      }.`,
    };
  if (onBrevo(profile) && profile.connectionStatus === 'failed')
    return {
      badge: 'Connection failed',
      active: false,
      tone: 'failed',
      text: 'The saved Brevo connection failed its last check.',
    };
  if (onBrevo(profile))
    return {
      badge: 'Set up, not active',
      active: false,
      tone: 'idle',
      text: 'Saved. Verify the sender and activate it to switch guest emails over.',
    };
  return {
    badge: 'Not connected',
    active: false,
    tone: 'idle',
    text:
      profile.activeMode === 'DEFAULT'
        ? 'Guest emails are sent by the MUST system sender.'
        : `Guest emails use ${optionLabels[profile.activeMode] ?? 'another sender'} instead.`,
  };
}
