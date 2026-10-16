'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, MoreHorizontal, UserRound } from 'lucide-react';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { StatTile } from '../../components/ui/stat-tile';
import { EmptyPanel, ErrorPanel, ListSkeleton, NoResultsPanel } from '../../components/ui/state-panel';
import { BookingStatusBadge } from '../../components/ui/status-badge';
import { TabBar } from '../../components/ui/tab-bar';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { cn } from '../../lib/utils';
import { nightsBetween } from '../../lib/reservation-display';
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
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'created', direction: 'desc' });
  const sorted = useMemo(() => {
    const value = (booking: Reservation): string | number => {
      if (sort.key === 'guest') return guestName(booking).toLowerCase();
      if (sort.key === 'stay') return booking.startsOn ?? '';
      if (sort.key === 'total') return Number(booking.total.amount);
      return booking.createdAt ?? '';
    };
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...bookings].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      return (left < right ? -1 : left > right ? 1 : 0) * factor;
    });
  }, [bookings, sort]);
  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: key === 'created' || key === 'total' ? 'desc' : 'asc' },
    );
    setPage(1);
  };
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);
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
          <Button variant="outline" disabled={bookings.length === 0} onClick={() => downloadCsv(sorted)}>
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
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SearchInput
              aria-label="Search payments"
              className="w-full sm:w-80"
              placeholder="Search reference, guest, email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        {allBookings.length === 0 ? (
          <EmptyPanel title="No payment activity yet" description="Payments appear here once a reservation is paid or refunded." />
        ) : bookings.length === 0 ? (
          <NoResultsPanel onClear={clearFilters} />
        ) : (
          <>
            <Table containerClassName="overflow-x-clip" className="text-[11px]">
              <TableHeader className="sticky top-[var(--app-header-height,86px)] z-20 bg-muted">
                <TableRow className="hover:bg-muted">
                  <SortHeader label="Reference" sortKey="created" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Guest" sortKey="guest" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Stay" sortKey="stay" sort={sort} onSort={toggleSort} />
                  <TableHead className="px-2 py-2 normal-case tracking-normal">Booking</TableHead>
                  <TableHead className="px-2 py-2 normal-case tracking-normal">Payment</TableHead>
                  <SortHeader label="Total" sortKey="total" sort={sort} onSort={toggleSort} end />
                  <TableHead className="px-2 py-2 text-right normal-case tracking-normal">Outstanding</TableHead>
                  <TableHead className="w-10 px-2 py-2 text-right">
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
                  const nights = booking.startsOn && booking.endsOn ? nightsBetween(booking.startsOn, booking.endsOn) : 0;
                  const owed = outstandingAmount(booking);
                  const unpaid =
                    booking.paymentMethod === 'PAY_AT_HOTEL' && status.state === 'unpaid' && !isDead(booking);
                  const refundable = canRefund && hasRefundableBalance(booking);
                  const busy = busyBookingId === booking.id;
                  const detailHref = paymentHref(tenantId, propertyId, booking.id);
                  return (
                    <TableRow
                      key={booking.id}
                      className="h-12 cursor-pointer"
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('button, a, [role="menuitem"]')) return;
                        window.location.assign(detailHref);
                      }}
                    >
                      <TableCell className="px-2 py-2">
                        <a className="font-semibold text-primary no-underline hover:underline" href={detailHref}>
                          <code>{booking.externalReference ?? '—'}</code>
                        </a>
                        {booking.createdAt ? (
                          <span className="block text-[10px] text-muted-foreground">
                            Created {formatDay(booking.createdAt.slice(0, 10), true)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                            <UserRound aria-hidden="true" className="size-3.5" />
                          </span>
                          <span className="min-w-0">
                            {booking.guestId ? (
                              <a
                                className="block truncate font-semibold text-foreground no-underline hover:underline"
                                href={guestHref(tenantId, propertyId, booking.guestId)}
                              >
                                {name}
                              </a>
                            ) : (
                              <span className="block truncate font-semibold">{name}</span>
                            )}
                            {email && email !== name ? (
                              <span className="block truncate text-[10px] text-muted-foreground">{email}</span>
                            ) : null}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <span className="block whitespace-nowrap">{formatStay(booking)}</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {booking.roomTypeName ?? ''}
                          {nights > 0 ? ` · ${nights} night${nights === 1 ? '' : 's'}` : ''}
                        </span>
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        {booking.status ? <BookingStatusBadge status={booking.status} /> : null}
                      </TableCell>
                      <TableCell className="px-2 py-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              tabIndex={0}
                              className="inline-block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <Badge
                                variant={PAYMENT_BADGE_TONE[status.state]}
                                className="max-w-full truncate rounded-full px-2 py-0 text-[10px] font-semibold"
                              >
                                {status.label}
                              </Badge>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="space-y-0.5">
                            {booking.paymentMethod ? (
                              <span className="block font-semibold">{paymentMethodLabel(booking.paymentMethod)}</span>
                            ) : null}
                            <span className="block">Total {money(booking.total.amount, currency)}</span>
                            <span className="block">Paid {money(booking.paidAmount, currency)}</span>
                            {Number(booking.refundedAmount) > 0 ? (
                              <span className="block">Refunded {money(booking.refundedAmount, currency)}</span>
                            ) : null}
                            {Number(owed) > 0 ? (
                              <span className="block font-semibold">Still owed {money(owed, currency)}</span>
                            ) : null}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="px-2 py-2 text-right font-semibold whitespace-nowrap">
                        {money(booking.total.amount, currency)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'px-2 py-2 text-right whitespace-nowrap',
                          Number(owed) > 0 ? 'font-semibold text-warning' : 'text-muted-foreground',
                        )}
                      >
                        {money(owed, currency)}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`More actions for ${booking.externalReference ?? 'booking'}`}
                              className="size-7"
                              disabled={busy}
                            >
                              <MoreHorizontal aria-hidden="true" className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>{booking.externalReference}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem asChild>
                              <a href={detailHref}>View payment</a>
                            </DropdownMenuItem>
                            {booking.guestId ? (
                              <DropdownMenuItem asChild>
                                <a href={guestHref(tenantId, propertyId, booking.guestId)}>Open guest</a>
                              </DropdownMenuItem>
                            ) : null}
                            {refundable ? (
                              <DropdownMenuItem onSelect={() => openRefundDialog(booking)}>Refund…</DropdownMenuItem>
                            ) : null}
                            {unpaid ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel>Mark as paid by</DropdownMenuLabel>
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
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={sorted.length}
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

type SortKey = 'created' | 'guest' | 'stay' | 'total';

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  end = false,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; direction: 'asc' | 'desc' };
  onSort: (key: SortKey) => void;
  end?: boolean;
}) {
  const active = sort.key === sortKey;
  const Icon = active ? (sort.direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('px-2 py-2', end && 'text-right')}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 bg-transparent p-0 text-left normal-case tracking-normal outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
          end && 'ml-auto',
        )}
      >
        {label}
        <Icon aria-hidden="true" className="size-3 shrink-0" />
      </button>
    </TableHead>
  );
}
