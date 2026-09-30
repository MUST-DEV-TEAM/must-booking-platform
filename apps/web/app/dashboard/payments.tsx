'use client';
import { Card, Heading, Stack, StatePanel, StatusBadge, Text } from '@must/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMemo, useState } from 'react';
import {
  fetchPropertyBookings,
  guestName,
  reservationStatusBadge,
  type Reservation,
} from './reservations';
import {
  hasRefundableBalance,
  isDead,
  isHiddenFromPayments,
  matchesFilter,
  matchesSearch,
  outstandingAmount,
  paymentMethodLabel,
  paymentStatus,
  paymentsCsv,
  sortNewestFirst,
  summarize,
  type PaymentFilter,
} from './payment-status';
import { guestHref, paymentHref } from './payment-detail';
import { RefundDialog } from './payment-refund-dialog';
import styles from './data-table.module.css';
const id = () => crypto.randomUUID();
type ManualPaymentMethod = 'cash' | 'card_in_person' | 'bank_transfer';

const FILTERS: Array<{ key: PaymentFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'needs-action', label: 'Needs action' },
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'paid', label: 'Paid' },
  { key: 'refunded', label: 'Refunded' },
  { key: 'cancelled', label: 'Cancelled' },
];

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

// A byte-order mark makes Excel read the file as UTF-8, so accented guest names survive.
const CSV_BOM = String.fromCharCode(0xfeff);

function downloadCsv(bookings: Reservation[]) {
  const blob = new Blob([CSV_BOM, paymentsCsv(bookings)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function formatStay(booking: Pick<Reservation, 'startsOn' | 'endsOn'>) {
  if (!booking.startsOn || !booking.endsOn) return '—';
  return `${formatDay(booking.startsOn, false)} → ${formatDay(booking.endsOn, true)}`;
}

export function DashboardPayments({
  tenantId,
  propertyId,
  initialBookings,
  initialCapabilities,
}: {
  tenantId: string;
  propertyId: string;
  initialBookings?: Reservation[];
  initialCapabilities?: string[];
}) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const bookingsQuery = useQuery({
    queryKey: ['dashboard', 'payments-bookings', tenantId, propertyId],
    queryFn: () => fetchPropertyBookings(tenantId, propertyId),
    initialData: initialBookings,
    staleTime: initialBookings ? Infinity : 0,
  });
  const capabilitiesQuery = useQuery({
    queryKey: ['dashboard', 'payment-capabilities', tenantId, propertyId],
    queryFn: async () => {
      const response = await fetch(`${base}/capabilities/mine`, { credentials: 'include' });
      if (!response.ok) throw new Error('Unable to load payment permissions.');
      return (await response.json()) as string[];
    },
    initialData: initialCapabilities,
    staleTime: initialCapabilities ? Infinity : 0,
  });
  const [manualMethods, setManualMethods] = useState<Record<string, ManualPaymentMethod>>({});
  const [refundBooking, setRefundBooking] = useState<Reservation | null>(null);
  const actionMutation = useMutation({
    mutationFn: async ({
      bookingId,
      url,
      body,
      success,
    }: {
      bookingId: string;
      url: string;
      body: unknown;
      success: string;
    }) => {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id() },
        body: JSON.stringify(body),
      });
      const value = (await response.json()) as { ok: boolean; error?: { message?: string } };
      if (!value.ok) throw new Error(value.error?.message ?? 'Payment action failed.');
      return { bookingId, success };
    },
    onSuccess: ({ success }) => {
      void bookingsQuery.refetch();
      toast.success(success);
    },
    onError: (error) => toast.error(error.message),
  });
  const [filter, setFilter] = useState<PaymentFilter>('all');
  const [search, setSearch] = useState('');
  // The table library re-queues a state update whenever its `data` array is a
  // new object, which loops forever if the array is rebuilt on every render.
  const allBookings = useMemo(
    () =>
      sortNewestFirst(
        (bookingsQuery.data ?? []).filter((booking) => !isHiddenFromPayments(booking)),
      ),
    [bookingsQuery.data],
  );
  const filterCounts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map(({ key }) => [
          key,
          allBookings.filter((booking) => matchesFilter(booking, key)).length,
        ]),
      ) as Record<PaymentFilter, number>,
    [allBookings],
  );
  const bookings = useMemo(
    () =>
      allBookings.filter(
        (booking) => matchesFilter(booking, filter) && matchesSearch(booking, search),
      ),
    [allBookings, filter, search],
  );
  const summary = useMemo(() => summarize(allBookings), [allBookings]);
  const capabilities = capabilitiesQuery.data ?? [];
  const busyBookingId = actionMutation.isPending ? actionMutation.variables?.bookingId : null;
  const canRefund = capabilities.includes('payments.refund');

  function openRefundDialog(booking: Reservation) {
    setRefundBooking(booking);
  }
  const columns: ColumnDef<Reservation>[] = [
    {
      id: 'reference',
      header: 'Reference',
      cell: ({ row }) => (
        <a href={paymentHref(tenantId, propertyId, row.original.id)}>
          <code className={styles.reference}>{row.original.externalReference ?? '—'}</code>
        </a>
      ),
    },
    {
      id: 'guest',
      header: 'Guest',
      cell: ({ row }) => {
        const name = guestName(row.original);
        const email = row.original.guestEmail;
        return (
          <>
            {row.original.guestId ? (
              <a href={guestHref(tenantId, propertyId, row.original.guestId)}>{name}</a>
            ) : (
              name
            )}
            {email && email !== name ? <span>{email}</span> : null}
          </>
        );
      },
    },
    {
      id: 'stay',
      header: 'Stay',
      cell: ({ row }) => (
        <>
          {formatStay(row.original)}
          {row.original.roomTypeName ? <span>{row.original.roomTypeName}</span> : null}
        </>
      ),
    },
    {
      id: 'booking-status',
      header: 'Booking',
      cell: ({ row }) => {
        const badge = reservationStatusBadge(row.original.status ?? '');
        return row.original.status ? (
          <StatusBadge domain="booking" state={badge.state} label={badge.label} />
        ) : null;
      },
    },
    {
      id: 'status',
      header: 'Payment',
      cell: ({ row }) => {
        const status = paymentStatus(row.original);
        return (
          <>
            <StatusBadge domain="payment" state={status.state} label={status.label} />
            {row.original.paymentMethod ? (
              <span>{paymentMethodLabel(row.original.paymentMethod)}</span>
            ) : null}
          </>
        );
      },
    },
    {
      id: 'total',
      header: () => <span className={styles.numHeader}>Total</span>,
      cell: ({ row }) => (
        <span className={styles.num}>
          {row.original.total.amount} {row.original.total.currency}
        </span>
      ),
    },
    {
      id: 'paid',
      header: () => <span className={styles.numHeader}>Paid</span>,
      cell: ({ row }) => (
        <span className={styles.num}>
          {row.original.paidAmount} {row.original.total.currency}
        </span>
      ),
    },
    {
      id: 'refunded',
      header: () => <span className={styles.numHeader}>Refunded</span>,
      cell: ({ row }) => (
        <span className={styles.num}>
          {row.original.refundedAmount} {row.original.total.currency}
        </span>
      ),
    },
    {
      id: 'outstanding',
      header: () => <span className={styles.numHeader}>Outstanding</span>,
      cell: ({ row }) => (
        <span className={styles.num}>
          {outstandingAmount(row.original)} {row.original.total.currency}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const booking = row.original;
        const status = paymentStatus(booking);
        const unpaid =
          booking.paymentMethod === 'PAY_AT_HOTEL' && status.state === 'unpaid' && !isDead(booking);
        const method = manualMethods[booking.id] ?? 'cash';
        return (
          <>
            {unpaid ? (
              <>
                <label htmlFor={`manual-payment-method-${booking.id}`}>Payment method</label>
                <select
                  id={`manual-payment-method-${booking.id}`}
                  value={method}
                  onChange={(event) =>
                    setManualMethods((current) => ({
                      ...current,
                      [booking.id]: event.target.value as ManualPaymentMethod,
                    }))
                  }
                  disabled={busyBookingId === booking.id}
                >
                  <option value="cash">Cash</option>
                  <option value="card_in_person">Card in person</option>
                  <option value="bank_transfer">Bank transfer</option>
                </select>
                <button
                  className="must-button must-button--secondary"
                  onClick={() =>
                    actionMutation.mutate({
                      bookingId: booking.id,
                      url: `${base}/bookings/${booking.id}/manual-payment`,
                      body: { method },
                      success: 'Payment recorded.',
                    })
                  }
                  disabled={busyBookingId === booking.id}
                  type="button"
                >
                  {busyBookingId === booking.id ? (
                    <Loader2 aria-hidden="true" size={16} />
                  ) : (
                    'Mark as Paid'
                  )}
                </button>
              </>
            ) : null}
            {canRefund && hasRefundableBalance(booking) ? (
              <button
                className="must-button must-button--danger"
                onClick={() => openRefundDialog(booking)}
                disabled={busyBookingId === booking.id}
                type="button"
              >
                {busyBookingId === booking.id ? <Loader2 aria-hidden="true" size={16} /> : 'Refund'}
              </button>
            ) : null}
          </>
        );
      },
    },
  ];
  const table = useReactTable({ data: bookings, columns, getCoreRowModel: getCoreRowModel() });
  if (bookingsQuery.isPending || capabilitiesQuery.isPending)
    return (
      <StatePanel
        body={null}
        icon={<Loader2 aria-hidden="true" />}
        title="Loading payments…"
        variant="loading"
      />
    );
  const loadError = bookingsQuery.error ?? capabilitiesQuery.error;
  if (loadError)
    return (
      <div role="alert">
        <Text>{loadError.message}</Text>
        <button
          className="must-button must-button--secondary"
          onClick={() => {
            void bookingsQuery.refetch();
            void capabilitiesQuery.refetch();
          }}
          type="button"
        >
          Retry
        </button>
      </div>
    );
  return (
    <Stack gap="lg">
      <header>
        <Heading>Payments</Heading>
        <Text tone="secondary">Booking payment activity for this property.</Text>
      </header>
      {summary.byCurrency.map((totals) => (
        <Card key={totals.currency}>
          <dl aria-label={`Payment totals in ${totals.currency}`} className={styles.summary}>
            <div>
              <dt>Collected</dt>
              <dd>
                {totals.collected} {totals.currency}
              </dd>
            </div>
            <div>
              <dt>Refunded</dt>
              <dd>
                {totals.refunded} {totals.currency}
              </dd>
            </div>
            <div>
              <dt>Net received</dt>
              <dd>
                {totals.net} {totals.currency}
              </dd>
            </div>
            <div>
              <dt>Outstanding</dt>
              <dd>
                {totals.outstanding} {totals.currency}
              </dd>
            </div>
            <div>
              <dt>Needs action</dt>
              <dd>{summary.needsAction}</dd>
            </div>
          </dl>
        </Card>
      ))}
      <Card>
        <div className={styles.toolbar}>
          <div aria-label="Payment filters" className={styles.tabs} role="group">
            {FILTERS.map(({ key, label }) => (
              <button
                aria-pressed={filter === key}
                className={filter === key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                key={key}
                onClick={() => setFilter(key)}
                type="button"
              >
                {label} <span className={styles.tabCount}>{filterCounts[key]}</span>
              </button>
            ))}
          </div>
          <input
            aria-label="Search payments"
            className={styles.search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search reference, guest or email"
            type="search"
            value={search}
          />
          <button
            className={styles.tab}
            disabled={bookings.length === 0}
            onClick={() => downloadCsv(bookings)}
            type="button"
          >
            Export CSV
          </button>
        </div>
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
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length}>
                    {allBookings.length === 0
                      ? 'No payment activity yet.'
                      : 'No payments match this filter or search.'}
                  </td>
                </tr>
              ) : null}
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
      </Card>
      {refundBooking ? (
        <RefundDialog
          base={base}
          booking={refundBooking}
          onClose={() => setRefundBooking(null)}
          onRefunded={() => void bookingsQuery.refetch()}
        />
      ) : null}
    </Stack>
  );
}
