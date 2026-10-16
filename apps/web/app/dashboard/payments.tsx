'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, Download } from 'lucide-react';
import { toast } from 'sonner';
import { useMemo, useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchInput } from '../../components/ui/search-input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { StatTile } from '../../components/ui/stat-tile';
import { EmptyPanel, ErrorPanel, ListSkeleton, NoResultsPanel } from '../../components/ui/state-panel';
import { BookingStatusBadge } from '../../components/ui/status-badge';
import { TabBar } from '../../components/ui/tab-bar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { fetchPropertyBookings, guestName, type Reservation } from './reservations';
import {
  PAYMENT_BADGE_TONE,
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
const id = () => crypto.randomUUID();
const MANUAL_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card_in_person', label: 'Card in person' },
  { value: 'bank_transfer', label: 'Bank transfer' },
] as const;

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
  const [filter, setFilterState] = useState<PaymentFilter>('all');
  const [search, setSearchState] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  // Any change to what is shown starts again from the first page.
  const setFilter = (next: PaymentFilter) => {
    setFilterState(next);
    setPage(1);
  };
  const setSearch = (next: string) => {
    setSearchState(next);
    setPage(1);
  };
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
  const money = (amount: string, currency: string) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount));
  const pageRows = bookings.slice((page - 1) * pageSize, page * pageSize);
  const tabs = FILTERS.map(({ key, label }) => ({ id: key, label, count: filterCounts[key] }));
  const joined = (pick: (totals: (typeof summary.byCurrency)[number]) => string) =>
    summary.byCurrency.map((totals) => money(pick(totals), totals.currency)).join(' · ') || '–';
  const clearFilters = () => {
    setFilter('all');
    setSearch('');
  };

  if (bookingsQuery.isPending || capabilitiesQuery.isPending)
    return (
      <div className="space-y-5">
        <PageHeader title="Payments" description="Booking payment activity for this hotel." />
        <ListSkeleton />
      </div>
    );
  const loadError = bookingsQuery.error ?? capabilitiesQuery.error;
  if (loadError)
    return (
      <ErrorPanel
        title="Payments could not be loaded"
        description={loadError.message}
        onRetry={() => {
          void bookingsQuery.refetch();
          void capabilitiesQuery.refetch();
        }}
      />
    );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payments"
        description="Money collected, refunded and still owed for the reservations of this hotel."
        actions={
          <Button variant="outline" disabled={bookings.length === 0} onClick={() => downloadCsv(bookings)}>
            <Download /> Export CSV
          </Button>
        }
      />

      <div aria-label="Payment totals" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" role="group">
        <StatTile label="Collected" size="sm" value={joined((totals) => totals.collected)} />
        <StatTile label="Refunded" size="sm" value={joined((totals) => totals.refunded)} />
        <StatTile label="Net received" size="sm" value={joined((totals) => totals.net)} />
        <StatTile
          label="Outstanding"
          size="sm"
          value={joined((totals) => totals.outstanding)}
          active={filter === 'outstanding'}
          onClick={() => setFilter(filter === 'outstanding' ? 'all' : 'outstanding')}
        />
        <StatTile
          label="Needs action"
          value={summary.needsAction}
          tone={summary.needsAction > 0 ? 'warning' : 'default'}
          active={filter === 'needs-action'}
          onClick={() => setFilter(filter === 'needs-action' ? 'all' : 'needs-action')}
        />
      </div>

      <Card className="gap-0 overflow-clip p-0">
        <div className="space-y-3 border-b p-4">
          <TabBar tabs={tabs} current={filter} onSelect={(id) => setFilter(id as PaymentFilter)} label="Payment views" />
          <SearchInput
            aria-label="Search payments"
            className="w-full sm:w-80"
            placeholder="Search reference, guest or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {allBookings.length === 0 ? (
          <EmptyPanel title="No payment activity yet" description="Payments appear here once a reservation is paid or refunded." />
        ) : bookings.length === 0 ? (
          <NoResultsPanel onClear={clearFilters} />
        ) : (
          <>
            <Table>
              <TableHeader className="bg-muted">
                <TableRow className="hover:bg-muted">
                  <TableHead className="px-3 py-2">Reference</TableHead>
                  <TableHead className="px-2 py-2">Guest</TableHead>
                  <TableHead className="px-2 py-2">Stay</TableHead>
                  <TableHead className="px-2 py-2">Booking</TableHead>
                  <TableHead className="px-2 py-2">Payment</TableHead>
                  <TableHead className="px-2 py-2 text-right">Total</TableHead>
                  <TableHead className="px-2 py-2 text-right">Paid</TableHead>
                  <TableHead className="px-2 py-2 text-right">Refunded</TableHead>
                  <TableHead className="px-2 py-2 text-right">Outstanding</TableHead>
                  <TableHead className="px-2 py-2 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((booking) => {
                  const status = paymentStatus(booking);
                  const currency = booking.total.currency;
                  const name = guestName(booking);
                  const email = booking.guestEmail;
                  const unpaid =
                    booking.paymentMethod === 'PAY_AT_HOTEL' && status.state === 'unpaid' && !isDead(booking);
                  const busy = busyBookingId === booking.id;
                  return (
                    <TableRow key={booking.id}>
                      <TableCell className="px-3 py-2">
                        <a
                          className="font-semibold text-primary no-underline hover:underline"
                          href={paymentHref(tenantId, propertyId, booking.id)}
                        >
                          <code>{booking.externalReference ?? '—'}</code>
                        </a>
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        {booking.guestId ? (
                          <a
                            className="font-semibold text-foreground no-underline hover:underline"
                            href={guestHref(tenantId, propertyId, booking.guestId)}
                          >
                            {name}
                          </a>
                        ) : (
                          <span className="font-semibold">{name}</span>
                        )}
                        {email && email !== name ? <div className="text-xs text-muted-foreground">{email}</div> : null}
                      </TableCell>
                      <TableCell className="px-2 py-2 whitespace-nowrap">
                        {formatStay(booking)}
                        {booking.roomTypeName ? (
                          <div className="text-xs text-muted-foreground">{booking.roomTypeName}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        {booking.status ? <BookingStatusBadge status={booking.status} /> : null}
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <Badge
                          variant={PAYMENT_BADGE_TONE[status.state]}
                          className="rounded-full px-2 py-0 text-[10px] font-semibold"
                        >
                          {status.label}
                        </Badge>
                        {booking.paymentMethod ? (
                          <div className="text-xs text-muted-foreground">{paymentMethodLabel(booking.paymentMethod)}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="px-2 py-2 text-right whitespace-nowrap">
                        {money(booking.total.amount, currency)}
                      </TableCell>
                      <TableCell className="px-2 py-2 text-right whitespace-nowrap">
                        {money(booking.paidAmount, currency)}
                      </TableCell>
                      <TableCell className="px-2 py-2 text-right whitespace-nowrap">
                        {money(booking.refundedAmount, currency)}
                      </TableCell>
                      <TableCell className="px-2 py-2 text-right whitespace-nowrap">
                        {money(outstandingAmount(booking), currency)}
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <div className="flex items-center justify-end gap-2">
                          {unpaid ? (
                            <>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="outline" loading={busy}>
                                    Mark as paid <ChevronDown />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuLabel>Paid by</DropdownMenuLabel>
                                  {MANUAL_METHODS.map(({ value, label }) => (
                                    <DropdownMenuItem
                                      key={value}
                                      onSelect={() =>
                                        actionMutation.mutate({
                                          bookingId: booking.id,
                                          url: `${base}/bookings/${booking.id}/manual-payment`,
                                          body: { method: value },
                                          success: 'Payment recorded.',
                                        })
                                      }
                                    >
                                      {label}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </>
                          ) : null}
                          {canRefund && hasRefundableBalance(booking) ? (
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => openRefundDialog(booking)}>
                              Refund
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={bookings.length}
              onPage={setPage}
              noun="payments"
              pageSizeOptions={[10, 25, 50]}
              onPageSize={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </>
        )}
      </Card>
      {refundBooking ? (
        <RefundDialog
          base={base}
          booking={refundBooking}
          onClose={() => setRefundBooking(null)}
          onRefunded={() => void bookingsQuery.refetch()}
        />
      ) : null}
    </div>
  );
}
