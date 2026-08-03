'use client';

import { Card, Heading, Stack, Text } from '@must/ui';
import { useEffect, useMemo, useState } from 'react';

import styles from './reservations.module.css';
import { DashboardLoadingSkeleton } from './loading-skeleton';

export type Reservation = {
  id: string;
  guestId: string;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestEmail: string;
  guestPhone: string | null;
  guestStreetAddress: string | null;
  guestAddressLine2: string | null;
  guestCity: string | null;
  guestCounty: string | null;
  guestPostcode: string | null;
  roomTypeId: string;
  roomTypeName: string;
  ratePlanId: string;
  ratePlanName: string;
  startsOn: string;
  endsOn: string;
  status: string;
  paymentMethod: string;
  total: { amount: string; currency: string };
  paidAmount: string;
  refundedAmount: string;
  externalReference: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export function DashboardReservations({
  tenantId,
  propertyId,
  initialBookings,
}: {
  tenantId: string;
  propertyId: string;
  initialBookings?: Reservation[];
}) {
  const [bookings, setBookings] = useState<Reservation[] | null | undefined>(initialBookings);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (initialBookings) return;
    let active = true;
    void fetchPropertyBookings(tenantId, propertyId)
      .then((value) => {
        if (active) setBookings(value);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setBookings(null);
        setError(reason instanceof Error ? reason.message : 'Unable to load reservations.');
      });
    return () => {
      active = false;
    };
  }, [initialBookings, propertyId, tenantId]);

  const filteredBookings = useMemo(
    () => filterReservations(bookings ?? [], { search, status, from, to }),
    [bookings, from, search, status, to],
  );
  const selectedBooking = bookings?.find((booking) => booking.id === selectedId) ?? null;

  if (bookings === undefined) return <DashboardLoadingSkeleton label="Loading reservations…" />;
  if (!bookings) return <Text className={styles.error}>{error}</Text>;

  return (
    <Stack className={styles.page} gap="lg">
      <header className={styles.heading}>
        <div>
          <Text className={styles.eyebrow} tone="secondary">
            PROPERTY OPERATIONS
          </Text>
          <Heading>Reservations</Heading>
          <Text tone="secondary">
            Search, filter, and inspect every reservation for this property.
          </Text>
        </div>
      </header>

      <Card>
        <div className={styles.filters} aria-label="Reservation filters">
          <label>
            <span>Search guest</span>
            <input
              aria-label="Search guest"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name or email"
            />
          </label>
          <label>
            <span>Status</span>
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {[...new Set(bookings.map((booking) => booking.status))].sort().map((value) => (
                <option key={value} value={value}>
                  {formatStatus(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>From</span>
            <input
              aria-label="From date"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            <span>To</span>
            <input
              aria-label="To date"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
        </div>

        {filteredBookings.length === 0 ? (
          <Text className={styles.empty} tone="secondary">
            No reservations match these filters.
          </Text>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Stay</th>
                  <th>Room &amp; rate</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredBookings.map((booking) => (
                  <tr key={booking.id}>
                    <td>
                      <strong>{guestName(booking)}</strong>
                      <span>{booking.guestEmail}</span>
                    </td>
                    <td>
                      {booking.startsOn} – {booking.endsOn}
                    </td>
                    <td>
                      <strong>{booking.roomTypeName}</strong>
                      <span>{booking.ratePlanName}</span>
                    </td>
                    <td>
                      <span className={styles.status}>{formatStatus(booking.status)}</span>
                    </td>
                    <td>
                      <strong>{formatMoney(booking.total)}</strong>
                      <span>{formatPaymentMethod(booking.paymentMethod)}</span>
                    </td>
                    <td>
                      <button type="button" onClick={() => setSelectedId(booking.id)}>
                        View details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selectedBooking ? (
        <ReservationDetails booking={selectedBooking} onClose={() => setSelectedId(null)} />
      ) : null}
    </Stack>
  );
}

export async function fetchPropertyBookings(tenantId: string, propertyId: string) {
  const response = await fetch(`/api/tenants/${tenantId}/properties/${propertyId}/bookings`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Unable to load reservations.');
  return (await response.json()) as Reservation[];
}

export function filterReservations(
  bookings: Reservation[],
  filters: { search: string; status: string; from: string; to: string },
) {
  const search = filters.search.trim().toLocaleLowerCase();
  return bookings.filter((booking) => {
    const matchesSearch =
      !search ||
      [guestName(booking), booking.guestEmail, booking.guestPhone ?? ''].some((value) =>
        value.toLocaleLowerCase().includes(search),
      );
    const matchesStatus = !filters.status || booking.status === filters.status;
    const overlapsFrom = !filters.from || booking.endsOn > filters.from;
    const overlapsTo = !filters.to || booking.startsOn <= filters.to;
    return matchesSearch && matchesStatus && overlapsFrom && overlapsTo;
  });
}

function ReservationDetails({ booking, onClose }: { booking: Reservation; onClose: () => void }) {
  return (
    <section aria-label="Reservation details">
      <Card className={styles.details}>
        <div className={styles.detailsHeading}>
          <div>
            <Text className={styles.eyebrow} tone="secondary">
              RESERVATION DETAILS
            </Text>
            <Heading level={2}>{guestName(booking)}</Heading>
          </div>
          <button type="button" onClick={onClose}>
            Close details
          </button>
        </div>
        <dl>
          <div>
            <dt>Guest</dt>
            <dd>
              {booking.guestEmail}
              {booking.guestPhone ? ` · ${booking.guestPhone}` : ''}
            </dd>
          </div>
          <div>
            <dt>Stay</dt>
            <dd>
              {booking.startsOn} – {booking.endsOn}
            </dd>
          </div>
          <div>
            <dt>Room</dt>
            <dd>
              {booking.roomTypeName} · {booking.ratePlanName}
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{formatStatus(booking.status)}</dd>
          </div>
          <div>
            <dt>Payment</dt>
            <dd>
              {formatMoney(booking.total)} · {formatPaymentMethod(booking.paymentMethod)}
            </dd>
          </div>
          <div>
            <dt>Reference</dt>
            <dd>{booking.externalReference}</dd>
          </div>
        </dl>
      </Card>
    </section>
  );
}

function guestName(booking: Pick<Reservation, 'guestFirstName' | 'guestLastName' | 'guestEmail'>) {
  return (
    [booking.guestFirstName, booking.guestLastName].filter(Boolean).join(' ') || booking.guestEmail
  );
}

function formatStatus(value: string) {
  return value.toLocaleLowerCase().replaceAll('_', ' ');
}
function formatPaymentMethod(value: string) {
  return value.toLocaleLowerCase().replaceAll('_', ' ');
}
function formatMoney(total: Reservation['total']) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: total.currency }).format(
    Number(total.amount),
  );
}
