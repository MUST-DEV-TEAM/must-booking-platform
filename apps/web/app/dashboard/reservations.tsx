'use client';

import { Card, Heading, Stack, Text } from '@must/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

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
  specialRequests?: string | null;
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
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const bookingsQuery = useQuery({
    queryKey: ['dashboard', 'reservations', tenantId, propertyId],
    queryFn: () => fetchPropertyBookings(tenantId, propertyId),
    initialData: initialBookings,
    staleTime: initialBookings ? Infinity : 0,
  });
  const bookings = bookingsQuery.data ?? [];

  const filteredBookings = useMemo(
    () => filterReservations(bookings, { search, status, from, to }),
    [bookings, from, search, status, to],
  );
  const selectedBooking = bookings.find((booking) => booking.id === selectedId) ?? null;
  const columns = useMemo<ColumnDef<Reservation>[]>(
    () => [
      {
        id: 'guest',
        header: 'Guest',
        cell: ({ row }) => (
          <>
            <strong>{guestName(row.original)}</strong>
            <span>{row.original.guestEmail}</span>
          </>
        ),
      },
      {
        id: 'stay',
        header: 'Stay',
        cell: ({ row }) => (
          <>
            {row.original.startsOn} – {row.original.endsOn}
          </>
        ),
      },
      {
        id: 'roomRate',
        header: 'Room & rate',
        cell: ({ row }) => (
          <>
            <strong>{row.original.roomTypeName}</strong>
            <span>{row.original.ratePlanName}</span>
          </>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <span className={styles.status}>{formatStatus(row.original.status)}</span>
        ),
      },
      {
        id: 'payment',
        header: 'Payment',
        cell: ({ row }) => (
          <>
            <strong>{formatMoney(row.original.total)}</strong>
            <span>{formatPaymentMethod(row.original.paymentMethod)}</span>
          </>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <button type="button" onClick={() => setSelectedId(row.original.id)}>
            View details
          </button>
        ),
      },
    ],
    [],
  );
  const table = useReactTable({
    data: filteredBookings,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (booking) => booking.id,
  });

  if (bookingsQuery.isPending) return <DashboardLoadingSkeleton label="Loading reservations…" />;
  if (bookingsQuery.isError)
    return (
      <div className={styles.error} role="alert">
        <Text>{bookingsQuery.error.message}</Text>
        <button onClick={() => void bookingsQuery.refetch()} type="button">
          Retry
        </button>
      </div>
    );

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
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th key={header.id} colSpan={header.colSpan}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selectedBooking ? (
        <ReservationDetails
          booking={selectedBooking}
          onClose={() => setSelectedId(null)}
          onCancelled={() =>
            void queryClient.invalidateQueries({
              queryKey: ['dashboard', 'reservations', tenantId, propertyId],
            })
          }
          tenantId={tenantId}
          propertyId={propertyId}
        />
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

function ReservationDetails({
  booking,
  onClose,
  onCancelled,
  tenantId,
  propertyId,
}: {
  booking: Reservation;
  onClose: () => void;
  onCancelled: () => void;
  tenantId: string;
  propertyId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const canCancel = ['PAYMENT_PENDING', 'PMS_CONFIRMATION_PENDING', 'CONFIRMED'].includes(
    booking.status,
  );

  async function cancel() {
    if (!window.confirm(`Cancel reservation ${booking.externalReference}?`)) return;
    setCancelling(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/staff-bookings/${booking.id}`,
        {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            expectedVersion: booking.version,
            reason: 'Cancelled by property staff.',
          }),
        },
      );
      if (!response.ok) throw new Error('Unable to cancel reservation.');
      const result = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!result.ok) throw new Error(result.error?.message ?? 'Unable to cancel reservation.');
      onCancelled();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to cancel reservation.');
    } finally {
      setCancelling(false);
    }
  }

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
          {booking.specialRequests ? (
            <div className={styles.specialRequests}>
              <dt>Special requests</dt>
              <dd>{booking.specialRequests}</dd>
            </div>
          ) : null}
        </dl>
        {canCancel ? (
          <div>
            <button type="button" disabled={cancelling} onClick={() => void cancel()}>
              {cancelling ? 'Cancellingâ€¦' : 'Cancel reservation'}
            </button>
            {error ? (
              <div role="alert">
                <Text>{error}</Text>
              </div>
            ) : null}
          </div>
        ) : null}
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
