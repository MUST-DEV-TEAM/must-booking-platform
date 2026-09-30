'use client';
import { Card, Heading, Stack, StatePanel, StatusBadge, Text } from '@must/ui';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { RefundDialog } from './payment-refund-dialog';
import {
  hasRefundableBalance,
  outstandingAmount,
  paymentMethodLabel,
  paymentStatus,
  remainingRefundable,
} from './payment-status';
import {
  fetchPropertyBookings,
  guestName,
  reservationStatusBadge,
  type Reservation,
} from './reservations';
import styles from './data-table.module.css';

export type LedgerEntry = {
  id: string;
  kind: 'CHARGE' | 'REFUND';
  provider: string;
  method: string | null;
  externalPaymentId: string;
  status: string;
  amount: string;
  currency: string;
  note: string | null;
  createdAt: string;
  actorEmail: string | null;
};

export type LedgerEvent = {
  action: string;
  createdAt: string;
  actorEmail: string | null;
  details: Record<string, unknown>;
};

export type Ledger = { bookingId: string; entries: LedgerEntry[]; events: LedgerEvent[] };

const EVENT_LABELS: Record<string, string> = {
  'booking.created': 'Booking created',
  'booking.clock_reservation_created': 'Reservation created in Clock',
  'booking.clock_deposit_posted': 'Deposit posted to Clock',
  'payment.refunded': 'Refund recorded',
};

function eventLabel(action: string) {
  if (EVENT_LABELS[action]) return EVENT_LABELS[action];
  const words = action.replaceAll('.', ' ').replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function eventDetail(event: LedgerEvent) {
  const parts: string[] = [];
  const amount = event.details.amount as { amount?: string; currency?: string } | undefined;
  if (amount?.amount) parts.push(`${amount.amount} ${amount.currency ?? ''}`.trim());
  if (typeof event.details.folioId === 'number' || typeof event.details.folioId === 'string')
    parts.push(`folio ${event.details.folioId}`);
  if (typeof event.details.note === 'string') parts.push(event.details.note);
  return parts.join(' · ');
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDay(value: string | undefined, withYear: boolean) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

function entryMethod(entry: LedgerEntry) {
  if (entry.provider === 'manual')
    return entry.method
      ? `Recorded by staff (${entry.method.replaceAll('_', ' ')})`
      : 'Recorded by staff';
  return paymentMethodLabel(entry.provider === 'pokpay' ? 'POKPAY' : entry.provider.toUpperCase());
}

export function listHref(tenantId: string, propertyId: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=payments`;
}

export function guestHref(tenantId: string, propertyId: string, guestId: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=guests&guest=${encodeURIComponent(guestId)}`;
}

export function paymentHref(tenantId: string, propertyId: string, bookingId: string) {
  return `${listHref(tenantId, propertyId)}&payment=${encodeURIComponent(bookingId)}`;
}

/** One booking's money: summary, every charge and refund, Clock's folios and the audit trail. */
export function PaymentDetail({
  tenantId,
  propertyId,
  bookingId,
}: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
}) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const [refunding, setRefunding] = useState(false);
  const bookingsQuery = useQuery({
    queryKey: ['dashboard', 'payments-bookings', tenantId, propertyId],
    queryFn: () => fetchPropertyBookings(tenantId, propertyId),
  });
  const capabilitiesQuery = useQuery({
    queryKey: ['dashboard', 'payment-capabilities', tenantId, propertyId],
    queryFn: async () => {
      const response = await fetch(`${base}/capabilities/mine`, { credentials: 'include' });
      if (!response.ok) throw new Error('Unable to load payment permissions.');
      return (await response.json()) as string[];
    },
  });
  const ledgerQuery = useQuery({
    queryKey: ['dashboard', 'payment-ledger', tenantId, propertyId, bookingId],
    queryFn: async () => {
      const response = await fetch(`${base}/payments/bookings/${bookingId}`, {
        credentials: 'include',
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Unable to load the payment history.');
      return (await response.json()) as Ledger;
    },
  });

  const back = (
    <a className={styles.backLink} href={listHref(tenantId, propertyId)}>
      ← All payments
    </a>
  );

  if (bookingsQuery.isPending || capabilitiesQuery.isPending || ledgerQuery.isPending)
    return (
      <Stack gap="lg">
        {back}
        <StatePanel
          body={null}
          icon={<Loader2 aria-hidden="true" />}
          title="Loading payment…"
          variant="loading"
        />
      </Stack>
    );
  const loadError = bookingsQuery.error ?? capabilitiesQuery.error ?? ledgerQuery.error;
  if (loadError)
    return (
      <Stack gap="lg">
        {back}
        <div role="alert">
          <Text>{loadError.message}</Text>
        </div>
      </Stack>
    );

  const booking: Reservation | undefined = bookingsQuery.data?.find((b) => b.id === bookingId);
  if (!booking || !ledgerQuery.data)
    return (
      <Stack gap="lg">
        {back}
        <StatePanel
          action={null}
          body="This booking is not in this property."
          icon={null}
          title="Payment not found"
          variant="empty"
        />
      </Stack>
    );

  const ledger = ledgerQuery.data;
  const status = paymentStatus(booking);
  const bookingBadge = reservationStatusBadge(booking.status ?? '');
  const currency = booking.total.currency;
  const canRefund = (capabilitiesQuery.data ?? []).includes('payments.refund');
  const refundable = remainingRefundable(booking);
  const folios = booking.clockFolios ?? [];
  const hasOpenDeposit = folios.some((folio) => folio.isDeposit && !folio.closedAt);

  return (
    <Stack gap="lg">
      {back}
      <header className={styles.detailHeader}>
        <div>
          <Heading>
            <code className={styles.reference}>{booking.externalReference ?? booking.id}</code>
          </Heading>
          <Text tone="secondary">
            <a href={guestHref(tenantId, propertyId, booking.guestId)}>{guestName(booking)}</a>
            {booking.startsOn && booking.endsOn
              ? ` · ${formatDay(booking.startsOn, false)} → ${formatDay(booking.endsOn, true)}`
              : ''}
            {booking.roomTypeName ? ` · ${booking.roomTypeName}` : ''}
          </Text>
          <div className={styles.badges}>
            {booking.status ? (
              <StatusBadge domain="booking" state={bookingBadge.state} label={bookingBadge.label} />
            ) : null}
            <StatusBadge domain="payment" state={status.state} label={status.label} />
          </div>
        </div>
        {canRefund && hasRefundableBalance(booking) ? (
          <button
            className="must-button must-button--danger"
            onClick={() => setRefunding(true)}
            type="button"
          >
            Refund
          </button>
        ) : null}
      </header>

      <Card>
        <Heading>Summary</Heading>
        <dl className={styles.summary}>
          <div>
            <dt>Total</dt>
            <dd>
              {booking.total.amount} {currency}
            </dd>
          </div>
          <div>
            <dt>Paid</dt>
            <dd>
              {booking.paidAmount} {currency}
            </dd>
          </div>
          <div>
            <dt>Refunded</dt>
            <dd>
              {booking.refundedAmount} {currency}
            </dd>
          </div>
          <div>
            <dt>Refundable</dt>
            <dd>
              {refundable.amount} {currency}
            </dd>
          </div>
          <div>
            <dt>Outstanding</dt>
            <dd>
              {outstandingAmount(booking)} {currency}
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <Heading>Payments and refunds</Heading>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>
                  <span className={styles.numHeader}>Amount</span>
                </th>
                <th>Method</th>
                <th>Reference</th>
                <th>Status</th>
                <th>By</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {ledger.entries.length === 0 ? (
                <tr>
                  <td colSpan={8}>No payments have been recorded for this booking.</td>
                </tr>
              ) : null}
              {ledger.entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatTime(entry.createdAt)}</td>
                  <td>{entry.kind === 'REFUND' ? 'Refund' : 'Payment'}</td>
                  <td>
                    <span className={styles.num}>
                      {entry.kind === 'REFUND' ? '−' : '+'}
                      {entry.amount} {entry.currency}
                    </span>
                  </td>
                  <td>{entryMethod(entry)}</td>
                  <td>
                    <code className={styles.reference} title={entry.externalPaymentId}>
                      {entry.externalPaymentId.length > 14
                        ? `…${entry.externalPaymentId.slice(-12)}`
                        : entry.externalPaymentId}
                    </code>
                  </td>
                  <td>{entry.status}</td>
                  <td>{entry.actorEmail ?? '—'}</td>
                  <td>{entry.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <Heading>Clock accounting</Heading>
        {folios.length === 0 ? (
          <Text tone="secondary">No Clock folios are recorded for this booking.</Text>
        ) : (
          <ul className={styles.plainList}>
            {folios.map((folio) => (
              <li key={folio.id}>
                Folio {folio.id} · {folio.isDeposit ? 'Deposit' : 'General'} ·{' '}
                {folio.closedAt ? `Closed ${formatTime(folio.closedAt)}` : 'Open'}
                {folio.balance !== null ? ` · balance ${folio.balance}` : ''}
              </li>
            ))}
          </ul>
        )}
        {hasOpenDeposit ? (
          <Text tone="secondary">
            An open deposit folio counts toward the booking balance in Clock, so a fully paid
            booking shows 0.00 there. When the hotel converts it to an advance in Clock, the balance
            returns to the full stay amount until check-in.
          </Text>
        ) : null}
      </Card>

      <Card>
        <Heading>Activity</Heading>
        {ledger.events.length === 0 ? (
          <Text tone="secondary">No activity has been recorded for this booking.</Text>
        ) : (
          <ul className={styles.plainList}>
            {ledger.events.map((event, index) => (
              <li key={`${event.action}-${event.createdAt}-${index}`}>
                <strong>{eventLabel(event.action)}</strong>
                {eventDetail(event) ? ` · ${eventDetail(event)}` : ''}
                <span className={styles.muted}>
                  {' '}
                  {formatTime(event.createdAt)}
                  {event.actorEmail ? ` · ${event.actorEmail}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {refunding ? (
        <RefundDialog
          base={base}
          booking={booking}
          onClose={() => setRefunding(false)}
          onRefunded={() => {
            void bookingsQuery.refetch();
            void ledgerQuery.refetch();
          }}
        />
      ) : null}
    </Stack>
  );
}
