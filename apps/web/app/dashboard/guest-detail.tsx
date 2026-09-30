'use client';
import { Card, Heading, Stack, StatePanel, StatusBadge, Text } from '@must/ui';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { guestHref, paymentHref } from './payment-detail';
import { outstandingAmount, paymentStatus, sortNewestFirst, summarize } from './payment-status';
import {
  fetchPropertyBookings,
  guestName,
  reservationStatusBadge,
  type Reservation,
} from './reservations';
import styles from './data-table.module.css';

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

function normalize(value: string | null | undefined) {
  return (value ?? '').trim().toLocaleLowerCase();
}

function fullName(booking: Reservation) {
  return normalize([booking.guestFirstName, booking.guestLastName].filter(Boolean).join(' '));
}

/** Other guest profiles that look like the same person: same email or same full name. */
export function possibleDuplicates(guestId: string, bookings: Reservation[]) {
  const own = bookings.filter((booking) => booking.guestId === guestId);
  const emails = new Set(own.map((booking) => normalize(booking.guestEmail)).filter(Boolean));
  const names = new Set(own.map(fullName).filter(Boolean));
  const others = new Map<string, Reservation>();
  for (const booking of bookings) {
    if (!booking.guestId || booking.guestId === guestId || others.has(booking.guestId)) continue;
    if (emails.has(normalize(booking.guestEmail)) || names.has(fullName(booking)))
      others.set(booking.guestId, booking);
  }
  return [...others.values()];
}

export function backToGuestsHref(tenantId: string, propertyId: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=guests`;
}

/** One guest: who they are, what they have paid, and every booking they have made. */
export function GuestDetail({
  tenantId,
  propertyId,
  guestId,
}: {
  tenantId: string;
  propertyId: string;
  guestId: string;
}) {
  const bookingsQuery = useQuery({
    queryKey: ['dashboard', 'payments-bookings', tenantId, propertyId],
    queryFn: () => fetchPropertyBookings(tenantId, propertyId),
  });
  const all = bookingsQuery.data;
  const bookings = useMemo(
    () => sortNewestFirst((all ?? []).filter((booking) => booking.guestId === guestId)),
    [all, guestId],
  );
  const duplicates = useMemo(() => possibleDuplicates(guestId, all ?? []), [all, guestId]);
  const totals = useMemo(() => summarize(bookings), [bookings]);

  const back = (
    <a className={styles.backLink} href={backToGuestsHref(tenantId, propertyId)}>
      ← All guests
    </a>
  );

  if (bookingsQuery.isPending)
    return (
      <Stack gap="lg">
        {back}
        <StatePanel
          body={null}
          icon={<Loader2 aria-hidden="true" />}
          title="Loading guest…"
          variant="loading"
        />
      </Stack>
    );
  if (bookingsQuery.error)
    return (
      <Stack gap="lg">
        {back}
        <div role="alert">
          <Text>{bookingsQuery.error.message}</Text>
        </div>
      </Stack>
    );
  if (bookings.length === 0)
    return (
      <Stack gap="lg">
        {back}
        <StatePanel
          action={null}
          body="This guest has no bookings in this property."
          icon={null}
          title="Guest not found"
          variant="empty"
        />
      </Stack>
    );

  // The newest booking carries the most recent contact details.
  const profile = bookings[0];
  const address = [
    profile.guestStreetAddress,
    profile.guestAddressLine2,
    profile.guestCity,
    profile.guestCounty,
    profile.guestPostcode,
  ]
    .filter(Boolean)
    .join(', ');
  const cancelled = bookings.filter((booking) => booking.status === 'CANCELLED').length;

  return (
    <Stack gap="lg">
      {back}
      <header>
        <Heading>{guestName(profile)}</Heading>
        <Text tone="secondary">
          {[profile.guestEmail, profile.guestPhone, address].filter(Boolean).join(' · ') ||
            'No contact details on file'}
        </Text>
      </header>

      <Card>
        <Heading>Payments</Heading>
        <dl className={styles.summary}>
          <div>
            <dt>Bookings</dt>
            <dd>
              {bookings.length}
              {cancelled > 0 ? ` (${cancelled} cancelled)` : ''}
            </dd>
          </div>
          {totals.byCurrency.flatMap((row) => [
            <div key={`${row.currency}-paid`}>
              <dt>Paid</dt>
              <dd>
                {row.collected} {row.currency}
              </dd>
            </div>,
            <div key={`${row.currency}-refunded`}>
              <dt>Refunded</dt>
              <dd>
                {row.refunded} {row.currency}
              </dd>
            </div>,
            <div key={`${row.currency}-net`}>
              <dt>Net</dt>
              <dd>
                {row.net} {row.currency}
              </dd>
            </div>,
            <div key={`${row.currency}-outstanding`}>
              <dt>Outstanding</dt>
              <dd>
                {row.outstanding} {row.currency}
              </dd>
            </div>,
          ])}
        </dl>
      </Card>

      <Card>
        <Heading>Bookings</Heading>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Stay</th>
                <th>Booking</th>
                <th>Payment</th>
                <th>
                  <span className={styles.numHeader}>Total</span>
                </th>
                <th>
                  <span className={styles.numHeader}>Paid</span>
                </th>
                <th>
                  <span className={styles.numHeader}>Refunded</span>
                </th>
                <th>
                  <span className={styles.numHeader}>Outstanding</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => {
                const status = paymentStatus(booking);
                const badge = reservationStatusBadge(booking.status ?? '');
                return (
                  <tr key={booking.id}>
                    <td>
                      <a href={paymentHref(tenantId, propertyId, booking.id)}>
                        <code className={styles.reference}>
                          {booking.externalReference ?? booking.id}
                        </code>
                      </a>
                    </td>
                    <td>
                      {booking.startsOn && booking.endsOn
                        ? `${formatDay(booking.startsOn, false)} → ${formatDay(booking.endsOn, true)}`
                        : '—'}
                      {booking.roomTypeName ? <span>{booking.roomTypeName}</span> : null}
                    </td>
                    <td>
                      {booking.status ? (
                        <StatusBadge domain="booking" state={badge.state} label={badge.label} />
                      ) : null}
                    </td>
                    <td>
                      <StatusBadge domain="payment" state={status.state} label={status.label} />
                    </td>
                    <td>
                      <span className={styles.num}>
                        {booking.total.amount} {booking.total.currency}
                      </span>
                    </td>
                    <td>
                      <span className={styles.num}>
                        {booking.paidAmount} {booking.total.currency}
                      </span>
                    </td>
                    <td>
                      <span className={styles.num}>
                        {booking.refundedAmount} {booking.total.currency}
                      </span>
                    </td>
                    <td>
                      <span className={styles.num}>
                        {outstandingAmount(booking)} {booking.total.currency}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {duplicates.length > 0 ? (
        <Card>
          <Heading>Possible duplicate profiles</Heading>
          <Text tone="secondary">
            These profiles share this guest&apos;s email or name. Review and merge them from the
            Guests page (suspected duplicates).
          </Text>
          <ul className={styles.plainList}>
            {duplicates.map((other) => (
              <li key={other.guestId}>
                <a href={guestHref(tenantId, propertyId, other.guestId)}>{guestName(other)}</a>
                {other.guestEmail && other.guestEmail !== guestName(other) ? (
                  <span className={styles.muted}> · {other.guestEmail}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </Stack>
  );
}
