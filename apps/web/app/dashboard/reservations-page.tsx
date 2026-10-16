'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  CirclePlus,
  EllipsisVertical,
  ListFilter,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { BookingStatusBadge, PaymentStatusBadge, SourceBadge } from '../../components/ui/status-badge';
import { Button } from '../../components/ui/button';
import { CalendarPicker, formatCalendarSelection, type CalendarSelection } from '../../components/ui/calendar-picker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { FilterChips, type FilterChip } from '../../components/ui/filter-chips';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../components/ui/sheet';
import { StatTile } from '../../components/ui/stat-tile';
import { EmptyPanel, ErrorPanel, ListSkeleton, NoResultsPanel } from '../../components/ui/state-panel';
import { TabBar, type TabBarEntry } from '../../components/ui/tab-bar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { balanceDue, bookingStatusDisplay, nightsBetween } from '../../lib/reservation-display';

type View =
  | 'all'
  | 'arriving_today'
  | 'in_house'
  | 'departing_today'
  | 'upcoming'
  | 'needs_attention'
  | 'unpaid'
  | 'cancelled';

type SortKey = 'stay' | 'created' | 'total' | 'guest';
type DateType = 'arrival' | 'departure' | 'stay' | 'created';

type ReservationRow = {
  id: string;
  externalReference: string;
  status: string;
  paymentMethod: string;
  paymentState: string;
  source: string | null;
  startsOn: string;
  endsOn: string;
  createdAt: string;
  adults: number;
  children: number;
  specialRequests: string | null;
  roomName: string | null;
  roomTypeName: string;
  ratePlanName: string;
  guestId: string | null;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  total: { amount: string; currency: string };
  paidAmount: string;
  refundedAmount: string;
};

type SearchResult = {
  items: ReservationRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<View, number>;
};

type Filters = {
  view: View;
  search: string;
  status: string;
  payment: string;
  source: string;
  dateType: DateType;
  range: CalendarSelection;
  sort: SortKey;
  direction: 'asc' | 'desc';
  page: number;
};

const PAGE_SIZE = 25;
const ALL = 'all';

const initialFilters: Filters = {
  view: 'all',
  search: '',
  status: ALL,
  payment: ALL,
  source: ALL,
  dateType: 'stay',
  range: { start: null, end: null },
  sort: 'stay',
  direction: 'desc',
  page: 1,
};

const statusOptions = [
  'CONFIRMED',
  'PAYMENT_PENDING',
  'MANUAL_REVIEW',
  'PAYMENT_FAILED',
  'PMS_UNKNOWN_RESULT',
  'CANCELLED',
  'EXPIRED',
];
const paymentOptions: Array<[string, string]> = [
  ['paid', 'Paid'],
  ['deposit', 'Deposit paid'],
  ['unpaid', 'Unpaid or pending'],
  ['pay_at_hotel', 'Pay at hotel'],
  ['refunded', 'Refunded'],
  ['failed', 'Failed'],
  ['none', 'No payment due'],
];
const sourceOptions: Array<[string, string]> = [
  ['DIRECT', 'Direct'],
  ['WEBSITE', 'Website'],
  ['UNKNOWN', 'Not recorded'],
];
const dateTypeOptions: Array<[DateType, string]> = [
  ['stay', 'Stay overlaps'],
  ['arrival', 'Arrival'],
  ['departure', 'Departure'],
  ['created', 'Created'],
];

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function queryString(filters: Filters, search: string): string {
  const params = new URLSearchParams();
  params.set('view', filters.view);
  if (search.trim()) params.set('search', search.trim());
  if (filters.status !== ALL) params.set('status', filters.status);
  if (filters.payment !== ALL) params.set('payment', filters.payment);
  if (filters.source !== ALL) params.set('source', filters.source);
  if (filters.range.start) {
    params.set('dateType', filters.dateType);
    params.set('from', filters.range.start);
    params.set('to', filters.range.end ?? filters.range.start);
  }
  params.set('sort', filters.sort);
  params.set('direction', filters.direction);
  params.set('page', String(filters.page));
  params.set('pageSize', String(PAGE_SIZE));
  return params.toString();
}

const money = (amount: string, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount));

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(
    new Date(`${iso}T00:00:00`),
  );
const longDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${iso}T00:00:00`),
  );
const createdLabel = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

const guestName = (row: ReservationRow) =>
  [row.guestFirstName, row.guestLastName].filter(Boolean).join(' ') || 'No guest details';

function guestsLabel(row: ReservationRow) {
  const adults = `${row.adults} adult${row.adults === 1 ? '' : 's'}`;
  return row.children > 0 ? `${adults} · ${row.children} child${row.children === 1 ? '' : 'ren'}` : adults;
}

function dashboardHref(tenantId: string, propertyId: string, extra: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&${extra}`;
}

export function ReservationsPage({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [searchText, setSearchText] = useState('');
  const [selected, setSelected] = useState<ReservationRow | null>(null);
  const debouncedSearch = useDebounced(searchText, 300);

  // A new search term always starts from the first page.
  useEffect(() => {
    setFilters((current) =>
      current.page === 1 ? current : { ...current, page: 1 },
    );
  }, [debouncedSearch]);

  const query = useQuery({
    queryKey: ['dashboard', 'reservations-search', tenantId, propertyId, filters, debouncedSearch],
    queryFn: async (): Promise<SearchResult> => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/bookings/search?${queryString(filters, debouncedSearch)}`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error(`Unable to load reservations (${response.status}).`);
      return (await response.json()) as SearchResult;
    },
    placeholderData: keepPreviousData,
  });

  const update = (patch: Partial<Filters>) =>
    setFilters((current) => ({ ...current, page: 1, ...patch }));

  const clearAll = () => {
    setSearchText('');
    setFilters((current) => ({ ...initialFilters, view: current.view }));
  };

  const counts = query.data?.counts;
  const tabs: TabBarEntry[] = [
    { id: 'all', label: 'All', count: counts?.all },
    { id: 'arriving_today', label: 'Arriving today', count: counts?.arriving_today },
    { id: 'in_house', label: 'In house', count: counts?.in_house },
    { id: 'departing_today', label: 'Departing today', count: counts?.departing_today },
    { id: 'upcoming', label: 'Upcoming', count: counts?.upcoming },
    { id: 'needs_attention', label: 'Needs attention', count: counts?.needs_attention },
    { id: 'unpaid', label: 'Unpaid', count: counts?.unpaid },
    { id: 'cancelled', label: 'Cancelled', count: counts?.cancelled },
  ];

  const chips = useMemo<FilterChip[]>(() => {
    const list: FilterChip[] = [];
    if (filters.status !== ALL) list.push({ key: 'status', label: bookingStatusDisplay(filters.status).label });
    if (filters.payment !== ALL)
      list.push({
        key: 'payment',
        label: `Payment: ${paymentOptions.find(([value]) => value === filters.payment)?.[1] ?? filters.payment}`,
      });
    if (filters.source !== ALL)
      list.push({
        key: 'source',
        label: `Source: ${sourceOptions.find(([value]) => value === filters.source)?.[1] ?? filters.source}`,
      });
    if (filters.range.start)
      list.push({
        key: 'range',
        label: `${dateTypeOptions.find(([value]) => value === filters.dateType)?.[1]}: ${formatCalendarSelection(filters.range, 'range')}`,
      });
    return list;
  }, [filters]);

  const removeChip = (key: string) => {
    if (key === 'status') update({ status: ALL });
    if (key === 'payment') update({ payment: ALL });
    if (key === 'source') update({ source: ALL });
    if (key === 'range') update({ range: { start: null, end: null } });
  };

  const toggleSort = (key: SortKey) =>
    update({
      sort: key,
      direction: filters.sort === key && filters.direction === 'desc' ? 'asc' : 'desc',
    });

  const sortIcon = (key: SortKey) =>
    filters.sort !== key ? (
      <ArrowUpDown aria-hidden="true" className="size-3.5 opacity-50" />
    ) : filters.direction === 'asc' ? (
      <ArrowUp aria-hidden="true" className="size-3.5" />
    ) : (
      <ArrowDown aria-hidden="true" className="size-3.5" />
    );

  const data = query.data;
  const filtered = Boolean(searchText.trim() || chips.length > 0 || filters.view !== 'all');
  const addHref = dashboardHref(tenantId, propertyId, 'section=overview&tab=quick-booking');
  const calendarHref = dashboardHref(tenantId, propertyId, 'section=calendar');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reservations"
        description="Find, review and manage every reservation for this hotel."
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={calendarHref}>
                <CalendarDays /> Calendar view
              </a>
            </Button>
            <Button asChild>
              <a href={addHref}>
                <CirclePlus /> Add reservation
              </a>
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Arriving today"
          value={counts?.arriving_today ?? '–'}
          active={filters.view === 'arriving_today'}
          onClick={() => update({ view: 'arriving_today' })}
        />
        <StatTile
          label="In house"
          value={counts?.in_house ?? '–'}
          active={filters.view === 'in_house'}
          onClick={() => update({ view: 'in_house' })}
        />
        <StatTile
          label="Departing today"
          value={counts?.departing_today ?? '–'}
          active={filters.view === 'departing_today'}
          onClick={() => update({ view: 'departing_today' })}
        />
        <StatTile
          label="Needs attention"
          value={counts?.needs_attention ?? '–'}
          tone={counts && counts.needs_attention > 0 ? 'warning' : 'default'}
          active={filters.view === 'needs_attention'}
          onClick={() => update({ view: 'needs_attention' })}
        />
      </div>

      <TabBar
        tabs={tabs}
        current={filters.view}
        onSelect={(id) => update({ view: id as View })}
        label="Reservation views"
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search reservations"
            placeholder="Search guest, reference, phone or email"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            className="pl-9"
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">
              <ListFilter /> More filters{chips.length > 0 ? ` (${chips.length})` : ''}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 space-y-3">
            <FilterField label="Reservation status">
              <FilterSelect
                value={filters.status}
                onChange={(value) => update({ status: value })}
                options={statusOptions.map((value) => [value, bookingStatusDisplay(value).label])}
                allLabel="Any status"
              />
            </FilterField>
            <FilterField label="Payment">
              <FilterSelect
                value={filters.payment}
                onChange={(value) => update({ payment: value })}
                options={paymentOptions}
                allLabel="Any payment state"
              />
            </FilterField>
            <FilterField label="Source">
              <FilterSelect
                value={filters.source}
                onChange={(value) => update({ source: value })}
                options={sourceOptions}
                allLabel="Any source"
              />
            </FilterField>
            <FilterField label="Date">
              <div className="grid gap-2">
                <FilterSelect
                  value={filters.dateType}
                  onChange={(value) => update({ dateType: value as DateType })}
                  options={dateTypeOptions}
                />
                <CalendarPicker
                  label="Date range"
                  mode="range"
                  value={filters.range}
                  onChange={(range) => update({ range })}
                  months={1}
                />
              </div>
            </FilterField>
          </PopoverContent>
        </Popover>

        <div className="ml-auto text-sm text-muted-foreground" aria-live="polite">
          {data ? `${data.total} reservation${data.total === 1 ? '' : 's'}` : ''}
        </div>
      </div>

      <FilterChips chips={chips} onRemove={removeChip} onClearAll={clearAll} />

      {query.isPending ? (
        <ListSkeleton />
      ) : query.isError && !data ? (
        <ErrorPanel
          title="We could not load reservations"
          description={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
        />
      ) : data && data.total === 0 ? (
        counts && counts.all === 0 ? (
          <EmptyPanel
            title="No reservations yet"
            description="Reservations made by guests on your website or entered by your team will appear here."
            action={
              <Button asChild>
                <a href={addHref}>
                  <CirclePlus /> Add the first reservation
                </a>
              </Button>
            }
          />
        ) : (
          <NoResultsPanel onClear={filtered ? clearAll : undefined} />
        )
      ) : data ? (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <SortButton onClick={() => toggleSort('created')} icon={sortIcon('created')}>
                      Reservation
                    </SortButton>
                  </TableHead>
                  <TableHead>
                    <SortButton onClick={() => toggleSort('guest')} icon={sortIcon('guest')}>
                      Guest
                    </SortButton>
                  </TableHead>
                  <TableHead>Room</TableHead>
                  <TableHead>
                    <SortButton onClick={() => toggleSort('stay')} icon={sortIcon('stay')}>
                      Stay
                    </SortButton>
                  </TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">
                    <SortButton onClick={() => toggleSort('total')} icon={sortIcon('total')} end>
                      Total
                    </SortButton>
                  </TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={query.isFetching ? 'opacity-60 transition-opacity' : undefined}>
                {data.items.map((row) => {
                  const due = balanceDue({
                    total: row.total.amount,
                    paid: row.paidAmount,
                    refunded: row.refundedAmount,
                  });
                  const live = !['CANCELLED', 'EXPIRED', 'DRAFT', 'QUOTED'].includes(row.status);
                  const nights = nightsBetween(row.startsOn, row.endsOn);
                  return (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(row)}
                    >
                      <TableCell>
                        <div className="font-bold">{row.externalReference}</div>
                        <div className="text-xs text-muted-foreground">
                          Created {createdLabel(row.createdAt)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-semibold">{guestName(row)}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.guestPhone ?? row.guestEmail ?? ''}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>{row.roomTypeName}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.roomName ? `Room ${row.roomName}` : 'Not assigned'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="whitespace-nowrap">
                          {shortDate(row.startsOn)} – {shortDate(row.endsOn)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {nights} night{nights === 1 ? '' : 's'} · {guestsLabel(row)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <SourceBadge source={row.source} />
                      </TableCell>
                      <TableCell>
                        <BookingStatusBadge status={row.status} />
                      </TableCell>
                      <TableCell>
                        <PaymentStatusBadge
                          status={row.status}
                          paymentMethod={row.paymentMethod}
                          total={row.total.amount}
                          paid={row.paidAmount}
                          refunded={row.refundedAmount}
                        />
                        {live && due > 0 ? (
                          <div className="mt-1 text-xs font-semibold text-destructive">
                            {money(String(due), row.total.currency)} due
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-bold whitespace-nowrap">
                        {money(row.total.amount, row.total.currency)}
                      </TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <RowActions
                          row={row}
                          tenantId={tenantId}
                          propertyId={propertyId}
                          onView={() => setSelected(row)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPage={(page) => setFilters((current) => ({ ...current, page }))}
          />
        </div>
      ) : null}

      <ReservationSheet
        row={selected}
        tenantId={tenantId}
        propertyId={propertyId}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  allLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
  allLabel?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full" aria-label={allLabel ?? 'Filter'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allLabel ? <SelectItem value={ALL}>{allLabel}</SelectItem> : null}
        {options.map(([optionValue, label]) => (
          <SelectItem key={optionValue} value={optionValue}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SortButton({
  children,
  icon,
  onClick,
  end = false,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  end?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 font-semibold outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${end ? 'ml-auto' : ''}`}
    >
      {children}
      {icon}
    </button>
  );
}

function RowActions({
  row,
  tenantId,
  propertyId,
  onView,
}: {
  row: ReservationRow;
  tenantId: string;
  propertyId: string;
  onView: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.externalReference}`}>
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onView}>View details</DropdownMenuItem>
        {row.guestId ? (
          <DropdownMenuItem asChild>
            <a href={dashboardHref(tenantId, propertyId, `section=guests&guest=${row.guestId}`)}>
              Open guest
            </a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <a href={dashboardHref(tenantId, propertyId, `section=payments&payment=${row.id}`)}>
            Open payment
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DetailLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function ReservationSheet({
  row,
  tenantId,
  propertyId,
  onClose,
}: {
  row: ReservationRow | null;
  tenantId: string;
  propertyId: string;
  onClose: () => void;
}) {
  const due = row
    ? balanceDue({ total: row.total.amount, paid: row.paidAmount, refunded: row.refundedAmount })
    : 0;
  return (
    <Sheet open={row !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
        {row ? (
          <>
            <SheetHeader>
              <SheetTitle>{row.externalReference}</SheetTitle>
              <SheetDescription>{guestName(row)}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-6">
              <div className="flex flex-wrap items-center gap-2">
                <BookingStatusBadge status={row.status} />
                <PaymentStatusBadge
                  status={row.status}
                  paymentMethod={row.paymentMethod}
                  total={row.total.amount}
                  paid={row.paidAmount}
                  refunded={row.refundedAmount}
                />
                <SourceBadge source={row.source} />
              </div>
              <dl className="divide-y rounded-lg border px-3">
                <DetailLine label="Stay">
                  {longDate(row.startsOn)} – {longDate(row.endsOn)}
                </DetailLine>
                <DetailLine label="Nights">{nightsBetween(row.startsOn, row.endsOn)}</DetailLine>
                <DetailLine label="Guests">{guestsLabel(row)}</DetailLine>
                <DetailLine label="Room type">{row.roomTypeName}</DetailLine>
                <DetailLine label="Room">{row.roomName ?? 'Not assigned'}</DetailLine>
                <DetailLine label="Rate plan">{row.ratePlanName}</DetailLine>
              </dl>
              <dl className="divide-y rounded-lg border px-3">
                <DetailLine label="Total">{money(row.total.amount, row.total.currency)}</DetailLine>
                <DetailLine label="Paid">{money(row.paidAmount, row.total.currency)}</DetailLine>
                {Number(row.refundedAmount) > 0 ? (
                  <DetailLine label="Refunded">
                    {money(row.refundedAmount, row.total.currency)}
                  </DetailLine>
                ) : null}
                <DetailLine label="Balance due">{money(String(due), row.total.currency)}</DetailLine>
                <DetailLine label="Payment method">
                  {row.paymentMethod.toLowerCase().replaceAll('_', ' ')}
                </DetailLine>
              </dl>
              <dl className="divide-y rounded-lg border px-3">
                <DetailLine label="Guest">{guestName(row)}</DetailLine>
                {row.guestEmail ? <DetailLine label="Email">{row.guestEmail}</DetailLine> : null}
                {row.guestPhone ? <DetailLine label="Phone">{row.guestPhone}</DetailLine> : null}
              </dl>
              {row.specialRequests ? (
                <div className="rounded-lg border p-3 text-sm">
                  <div className="mb-1 text-xs font-semibold text-muted-foreground">
                    Special requests
                  </div>
                  {row.specialRequests}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {row.guestId ? (
                  <Button variant="outline" asChild>
                    <a href={dashboardHref(tenantId, propertyId, `section=guests&guest=${row.guestId}`)}>
                      Open guest
                    </a>
                  </Button>
                ) : null}
                <Button variant="outline" asChild>
                  <a href={dashboardHref(tenantId, propertyId, `section=payments&payment=${row.id}`)}>
                    Open payment
                  </a>
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
