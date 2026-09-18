'use client';

import { Card, Heading, Stack, StatePanel, StatusBadge, Text } from '@must/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, LoaderCircle } from 'lucide-react';
import { useMemo, useState } from 'react';

import styles from './reservations.module.css';

export type Reservation = {
  id: string;
  guestId: string;
  guestFirstName: string | null;
  guestLastName: string | null;
  // Real, matches the API (2026-09-04, fixing the same-day dashboard-list
  // gap): a Clock-hydrated booking with no captured guest email genuinely
  // has no guest at all — never a fabricated placeholder string.
  guestEmail: string | null;
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
  // Visibility only — every real Clock folio for this booking. A booking can
  // genuinely have both a deposit folio and a general folio at once.
  clockFolios: ClockFolioReservation[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ClockFolioReservation = {
  id: string;
  isDeposit: boolean;
  balance: string | null;
  closedAt: string | null;
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
  const [sorting, setSorting] = useState<SortingState>([]);
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
        accessorFn: (booking) => guestName(booking),
        sortDescFirst: false,
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
        accessorKey: 'startsOn',
        sortDescFirst: false,
        cell: ({ row }) => (
          <>
            {row.original.startsOn} – {row.original.endsOn}
          </>
        ),
      },
      {
        id: 'roomRate',
        header: 'Room & rate',
        enableSorting: false,
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
        enableSorting: false,
        cell: ({ row }) => <StatusBadge {...reservationStatusBadge(row.original.status)} />,
      },
      {
        id: 'payment',
        header: 'Payment',
        accessorFn: (booking) => Number(booking.total.amount),
        sortDescFirst: false,
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
        enableSorting: false,
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
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (booking) => booking.id,
  });

  if (bookingsQuery.isPending)
    return (
      <StatePanel
        body={null}
        icon={<LoaderCircle aria-hidden="true" />}
        title="Loading reservations…"
        variant="loading"
      />
    );
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
        <div aria-label="Reservation filters" className={styles.filters} role="group">
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
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <button
                            className={styles.sortButton}
                            onClick={header.column.getToggleSortingHandler()}
                            type="button"
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <SortIcon direction={header.column.getIsSorted()} />
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
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
          onChanged={() =>
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
      // guestEmail is genuinely null for a Clock-hydrated booking with no
      // captured guest (real, previously unreachable here — these bookings
      // were silently hidden from this list entirely until 2026-09-04's fix).
      [guestName(booking), booking.guestEmail ?? '', booking.guestPhone ?? ''].some((value) =>
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
  onChanged,
  tenantId,
  propertyId,
}: {
  booking: Reservation;
  onClose: () => void;
  onChanged: () => void;
  tenantId: string;
  propertyId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [settling, setSettling] = useState<'manual' | 'pokpay' | null>(null);
  const [manualMethod, setManualMethod] = useState<'cash' | 'card_in_person' | 'bank_transfer'>(
    'cash',
  );
  const [pokpayCheckoutUrl, setPokpayCheckoutUrl] = useState<string | null>(null);
  const canCancel = ['PAYMENT_PENDING', 'PMS_CONFIRMATION_PENDING', 'CONFIRMED'].includes(
    booking.status,
  );
  const canSettlePendingPayment = booking.status === 'PAYMENT_PENDING';

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
      onChanged();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to cancel reservation.');
    } finally {
      setCancelling(false);
    }
  }

  async function settlePendingPayment(kind: 'manual' | 'pokpay') {
    setSettling(kind);
    setError(null);
    try {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/bookings/${booking.id}/${
          kind === 'manual' ? 'manual-payment' : 'resend-pokpay-checkout'
        }`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
          ...(kind === 'manual' ? { body: JSON.stringify({ method: manualMethod }) } : {}),
        },
      );
      if (!response.ok) throw new Error('Unable to settle the pending payment.');
      const result = (await response.json()) as {
        ok: boolean;
        value?: { checkoutUrl?: string };
        error?: { message: string };
      };
      if (!result.ok)
        throw new Error(result.error?.message ?? 'Unable to settle the pending payment.');
      if (kind === 'pokpay') {
        const checkoutUrl = result.value?.checkoutUrl;
        if (!checkoutUrl) throw new Error('PokPay did not return a checkout link.');
        setPokpayCheckoutUrl(checkoutUrl);
        return;
      }
      onChanged();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to settle the pending payment.');
    } finally {
      setSettling(null);
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
              {booking.guestEmail ?? 'No guest on file'}
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
            <dd>
              <StatusBadge {...reservationStatusBadge(booking.status)} />
            </dd>
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
          {booking.clockFolios.map((folio) => (
            <div key={folio.id}>
              <dt>{folio.isDeposit ? 'Clock deposit folio' : 'Clock folio'}</dt>
              <dd>
                {formatMoney({
                  amount: folio.balance ?? '0',
                  currency: booking.total.currency,
                })}{' '}
                balance · {folio.closedAt ? 'Closed' : 'Open'}
              </dd>
            </div>
          ))}
          {booking.specialRequests ? (
            <div className={styles.specialRequests}>
              <dt>Special requests</dt>
              <dd>{booking.specialRequests}</dd>
            </div>
          ) : null}
        </dl>
        {canSettlePendingPayment ? (
          <section aria-label="Settle pending reservation">
            <Heading level={3}>Settle payment</Heading>
            {booking.paymentMethod === 'POKPAY' ? (
              <div>
                <button
                  type="button"
                  disabled={settling !== null}
                  onClick={() => void settlePendingPayment('pokpay')}
                >
                  {settling === 'pokpay' ? 'Creating PokPay link…' : 'Create fresh PokPay link'}
                </button>
                {pokpayCheckoutUrl ? (
                  <a href={pokpayCheckoutUrl} target="_blank" rel="noreferrer">
                    Open fresh PokPay checkout
                  </a>
                ) : null}
              </div>
            ) : null}
            <div>
              <label htmlFor={`manual-payment-method-${booking.id}`}>Manual payment method</label>
              <select
                id={`manual-payment-method-${booking.id}`}
                value={manualMethod}
                disabled={settling !== null}
                onChange={(event) =>
                  setManualMethod(event.target.value as 'cash' | 'card_in_person' | 'bank_transfer')
                }
              >
                <option value="cash">Cash</option>
                <option value="card_in_person">Card / POS</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
              <button
                type="button"
                disabled={settling !== null}
                onClick={() => void settlePendingPayment('manual')}
              >
                {settling === 'manual' ? 'Recording payment…' : 'Record manual payment'}
              </button>
            </div>
          </section>
        ) : null}
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

function SortIcon({ direction }: { direction: 'asc' | 'desc' | false }) {
  if (direction === 'asc') return <ArrowUp aria-hidden="true" size={14} />;
  if (direction === 'desc') return <ArrowDown aria-hidden="true" size={14} />;
  return <ArrowUpDown aria-hidden="true" size={14} />;
}

function guestName(booking: Pick<Reservation, 'guestFirstName' | 'guestLastName' | 'guestEmail'>) {
  return (
    [booking.guestFirstName, booking.guestLastName].filter(Boolean).join(' ') ||
    booking.guestEmail ||
    'No guest on file'
  );
}

function formatStatus(value: string) {
  return value.toLocaleLowerCase().replaceAll('_', ' ');
}

function reservationStatusBadge(status: string) {
  const label = formatStatus(status);
  if (status === 'CONFIRMED') {
    return { domain: 'booking' as const, state: 'confirmed' as const, label: 'Confirmed' };
  }
  if (status === 'CANCELLED') {
    return { domain: 'booking' as const, state: 'cancelled' as const, label: 'Cancelled' };
  }
  if (status === 'MANUAL_REVIEW') {
    return { domain: 'booking' as const, state: 'pending' as const, label: 'Needs review' };
  }
  return { domain: 'booking' as const, state: 'pending' as const, label };
}

function formatPaymentMethod(value: string) {
  return value.toLocaleLowerCase().replaceAll('_', ' ');
}
function formatMoney(total: Reservation['total']) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: total.currency }).format(
    Number(total.amount),
  );
}
