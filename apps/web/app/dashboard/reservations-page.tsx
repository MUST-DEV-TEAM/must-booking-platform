'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Columns3,
  ListFilter,
  MoreHorizontal,
  RefreshCw,
  Rows3,
  Search,
  UserRound,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import { BookingStatusBadge, PaymentStatusBadge, SourceBadge } from '../../components/ui/status-badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { IconButton } from '../../components/ui/icon-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { Checkbox } from '../../components/ui/checkbox';
import { CalendarPicker, formatCalendarSelection, type CalendarSelection } from '../../components/ui/calendar-picker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { cn } from '../../lib/utils';
import {
  differsOnlyBySearch,
  paramsToFilters,
  withFilterParams,
  type ReservationFilters,
} from './reservations-url';

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
  pageSize: number;
};

const PAGE_SIZES = [10, 25, 50] as const;
const ALL = 'all';

type ColumnKey = 'room' | 'source' | 'payment' | 'total';
const columnLabels: Record<ColumnKey, string> = {
  room: 'Room',
  source: 'Source',
  payment: 'Payment',
  total: 'Total',
};
const COLUMNS_STORAGE_KEY = 'must.reservations.columns';
const defaultColumns: Record<ColumnKey, boolean> = { room: true, source: true, payment: true, total: true };

type Density = 'comfortable' | 'compact';
const DENSITY_STORAGE_KEY = 'must.reservations.density';

function loadDensity(): Density {
  try {
    return window.localStorage.getItem(DENSITY_STORAGE_KEY) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function loadColumns(): Record<ColumnKey, boolean> {
  try {
    const stored = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (stored) return { ...defaultColumns, ...(JSON.parse(stored) as Partial<Record<ColumnKey, boolean>>) };
  } catch {
    // Storage can be blocked or hold bad data; fall back to showing every column.
  }
  return defaultColumns;
}

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
  pageSize: 25,
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

/** "just now", "2 min ago", "3 h ago". */
function updatedLabel(updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

function toUrlFilters(filters: Filters): ReservationFilters {
  return { ...filters, from: filters.range.start, to: filters.range.end ?? filters.range.start };
}

function fromUrlFilters(filters: ReservationFilters): Filters {
  const { from, to, ...rest } = filters;
  return {
    ...(rest as Omit<Filters, 'range'>),
    view: rest.view as View,
    dateType: rest.dateType as DateType,
    sort: rest.sort as SortKey,
    range: { start: from, end: to },
  };
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
  params.set('pageSize', String(filters.pageSize));
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [columns, setColumns] = useState<Record<ColumnKey, boolean>>(defaultColumns);
  const [density, setDensity] = useState<Density>('comfortable');
  const [committedSearch, setCommittedSearch] = useState('');
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const lastSearchRef = useRef<string | null>(null);

  // Remembered column choice (a per-browser convenience).
  useEffect(() => {
    setColumns(loadColumns());
    setDensity(loadDensity());
  }, []);

  // Restore the filters from the page address on first load, and again on Back / Forward.
  useEffect(() => {
    const restore = () => {
      const parsed = paramsToFilters(new URLSearchParams(window.location.search));
      setFilters(fromUrlFilters(parsed.filters));
      setSearchText(parsed.search);
      setCommittedSearch(parsed.search);
      lastSearchRef.current = window.location.search;
    };
    restore();
    setReady(true);
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  // Search runs shortly after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => setCommittedSearch(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  // Write the filters to the address. Typing only replaces the entry; every other change adds one.
  useEffect(() => {
    if (!ready) return;
    const next = withFilterParams(window.location.search, toUrlFilters(filters), committedSearch);
    if (next === window.location.search || (next === '' && window.location.search === '')) return;
    const url = `${window.location.pathname}${next}${window.location.hash}`;
    if (lastSearchRef.current !== null && differsOnlyBySearch(lastSearchRef.current, next))
      window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    lastSearchRef.current = next;
  }, [filters, committedSearch, ready]);

  // Keeps the "Updated ... ago" text current.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const query = useQuery({
    queryKey: ['dashboard', 'reservations-search', tenantId, propertyId, filters, committedSearch],
    queryFn: async (): Promise<SearchResult> => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/bookings/search?${queryString(filters, committedSearch)}`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error(`Unable to load reservations (${response.status}).`);
      return (await response.json()) as SearchResult;
    },
    placeholderData: keepPreviousData,
    enabled: ready,
    refetchInterval: 60_000,
  });

  const update = (patch: Partial<Filters>) => {
    setSelectedIds([]);
    setExpandedId(null);
    setNotice(null);
    setFilters((current) => ({ ...current, page: 1, ...patch }));
  };

  const clearAll = () => {
    setSearchText('');
    setFilters((current) => ({ ...initialFilters, view: current.view, pageSize: current.pageSize }));
  };

  const counts = query.data?.counts;
  // The four "today" views are the summary tiles above; the tabs hold the other list segments.
  const tabs: TabBarEntry[] = [
    { id: 'all', label: 'All', count: counts?.all },
    { id: 'upcoming', label: 'Upcoming', count: counts?.upcoming },
    { id: 'unpaid', label: 'Unpaid', count: counts?.unpaid },
    { id: 'cancelled', label: 'Cancelled', count: counts?.cancelled },
  ];
  const tabViews: View[] = ['all', 'upcoming', 'unpaid', 'cancelled'];

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

  const filterCount = chips.filter((chip) => chip.key !== 'range').length;

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

  const data = query.data;
  const filtered = Boolean(searchText.trim() || chips.length > 0 || filters.view !== 'all');
  const addHref = dashboardHref(tenantId, propertyId, 'section=overview&tab=quick-booking');
  const calendarHref = dashboardHref(tenantId, propertyId, 'section=calendar');
  const rows = data?.items ?? [];
  const selectedRows = rows.filter((row) => selectedIds.includes(row.id));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const someSelected = selectedRows.length > 0 && !allSelected;
  const visibleColumnCount =
    7 + Object.values(columns).filter(Boolean).length;

  const toggleRow = (id: string, checked: boolean) =>
    setSelectedIds((current) => (checked ? [...new Set([...current, id])] : current.filter((value) => value !== id)));
  const toggleAll = (checked: boolean) => setSelectedIds(checked ? rows.map((row) => row.id) : []);
  const toggleColumn = (key: ColumnKey) => {
    const next = { ...columns, [key]: !columns[key] };
    setColumns(next);
    try {
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Remembering the choice is a convenience; ignore blocked storage.
    }
  };
  const toggleDensity = () => {
    const next: Density = density === 'compact' ? 'comfortable' : 'compact';
    setDensity(next);
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
    } catch {
      // Remembering the choice is a convenience; ignore blocked storage.
    }
  };
  const copyReferences = async () => {
    try {
      await navigator.clipboard.writeText(selectedRows.map((row) => row.externalReference).join('\n'));
      setNotice(`Copied ${selectedRows.length} reference${selectedRows.length === 1 ? '' : 's'}.`);
    } catch {
      setNotice('Could not copy. Select the references manually.');
    }
  };

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
          onClick={() => update({ view: filters.view === 'arriving_today' ? 'all' : 'arriving_today' })}
        />
        <StatTile
          label="In house"
          value={counts?.in_house ?? '–'}
          active={filters.view === 'in_house'}
          onClick={() => update({ view: filters.view === 'in_house' ? 'all' : 'in_house' })}
        />
        <StatTile
          label="Departing today"
          value={counts?.departing_today ?? '–'}
          active={filters.view === 'departing_today'}
          onClick={() => update({ view: filters.view === 'departing_today' ? 'all' : 'departing_today' })}
        />
        <StatTile
          label="Needs attention"
          value={counts?.needs_attention ?? '–'}
          tone={counts && counts.needs_attention > 0 ? 'warning' : 'default'}
          active={filters.view === 'needs_attention'}
          onClick={() => update({ view: filters.view === 'needs_attention' ? 'all' : 'needs_attention' })}
        />
      </div>

      <Card className="gap-0 overflow-clip p-0">
        <div className="space-y-3 border-b p-4">
          <TabBar
            tabs={tabs}
            current={tabViews.includes(filters.view) ? filters.view : ''}
            onSelect={(id) => update({ view: id as View })}
            label="Reservation views"
          />
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-xs text-muted-foreground" aria-live="polite">
              {query.dataUpdatedAt ? `Updated ${updatedLabel(query.dataUpdatedAt, now)}` : ''}
            </p>
            <div className="relative w-full sm:w-64">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label="Search reservations"
                placeholder="Search guest, reference, phone…"
                value={searchText}
                onChange={(event) => {
                  setSearchText(event.target.value);
                  setFilters((current) => (current.page === 1 ? current : { ...current, page: 1 }));
                }}
                className="h-9 pl-8 text-xs"
              />
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <IconButton
                  label="Filters"
                  hint={filterCount > 0 ? `${filterCount} active` : undefined}
                  className="relative"
                >
                  <ListFilter aria-hidden="true" />
                  {filterCount > 0 ? (
                    <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />
                  ) : null}
                </IconButton>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 space-y-3">
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
              </PopoverContent>
            </Popover>

            <CalendarPicker
              iconOnly
              label="Dates"
              mode="range"
              value={filters.range}
              active={Boolean(filters.range.start)}
              onChange={(range) => update({ range })}
              months={1}
              header={
                <FilterField label="Filter by">
                  <FilterSelect
                    value={filters.dateType}
                    onChange={(value) => update({ dateType: value as DateType })}
                    options={dateTypeOptions}
                  />
                </FilterField>
              }
            />

            <Popover>
              <PopoverTrigger asChild>
                <IconButton label="Columns">
                  <Columns3 aria-hidden="true" />
                </IconButton>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-2">
                <p className="px-2 py-1 text-xs font-semibold">Show columns</p>
                {(Object.keys(columnLabels) as ColumnKey[]).map((key) => (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"
                  >
                    <Checkbox checked={columns[key]} onCheckedChange={() => toggleColumn(key)} />
                    {columnLabels[key]}
                  </label>
                ))}
              </PopoverContent>
            </Popover>

            <IconButton
              label={density === 'compact' ? 'Comfortable rows' : 'Compact rows'}
              hint={density === 'compact' ? 'Showing one line per row' : 'Showing details under each name'}
              aria-pressed={density === 'compact'}
              onClick={toggleDensity}
            >
              <Rows3 aria-hidden="true" />
            </IconButton>

            <IconButton
              label="Refresh"
              hint={query.dataUpdatedAt ? `Updated ${updatedLabel(query.dataUpdatedAt, now)}` : undefined}
              onClick={() => void query.refetch()}
            >
              <RefreshCw aria-hidden="true" className={query.isFetching ? 'animate-spin' : undefined} />
            </IconButton>
          </div>

          <FilterChips chips={chips} onRemove={removeChip} onClearAll={clearAll} />

          {selectedRows.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-2 text-xs">
              <span className="font-semibold">{selectedRows.length} selected</span>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void copyReferences()}>
                  Copy references
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
                  Clear selection
                </Button>
              </div>
            </div>
          ) : null}
          {notice ? (
            <p role="status" className="text-xs text-muted-foreground">
              {notice}
            </p>
          ) : null}
        </div>

        {query.isPending ? (
          <div className="p-4">
            <ListSkeleton />
          </div>
        ) : query.isError && !data ? (
          <div className="p-4">
            <ErrorPanel
              title="We could not load reservations"
              description={query.error instanceof Error ? query.error.message : undefined}
              onRetry={() => void query.refetch()}
            />
          </div>
        ) : data && data.total === 0 ? (
          <div className="p-4">
            {counts && counts.all === 0 ? (
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
            )}
          </div>
        ) : data ? (
          <>
            <Table
              containerClassName="overflow-x-clip"
              data-density={density}
              className="group text-[11px] data-[density=compact]:[&_td]:py-1"
            >
              <TableHeader className="sticky top-[var(--app-header-height,86px)] z-20 bg-muted">
                <TableRow className="hover:bg-muted">
                  <TableHead className="w-8 px-3 py-2">
                    <Checkbox
                      aria-label="Select all reservations on this page"
                      checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                      onCheckedChange={(value) => toggleAll(value === true)}
                    />
                  </TableHead>
                  <SortHeader label="Reservation" sortKey="created" filters={filters} onSort={toggleSort} />
                  <SortHeader label="Guest" sortKey="guest" filters={filters} onSort={toggleSort} />
                  {columns.room ? <TableHead className="px-2 py-2 normal-case tracking-normal">Room</TableHead> : null}
                  <SortHeader label="Stay" sortKey="stay" filters={filters} onSort={toggleSort} />
                  {columns.source ? <TableHead className="px-2 py-2 normal-case tracking-normal">Source</TableHead> : null}
                  <TableHead className="px-2 py-2 normal-case tracking-normal">Status</TableHead>
                  {columns.payment ? <TableHead className="px-2 py-2 normal-case tracking-normal">Payment</TableHead> : null}
                  {columns.total ? (
                    <SortHeader label="Total" sortKey="total" filters={filters} onSort={toggleSort} end />
                  ) : null}
                  <TableHead className="w-10 px-2 py-2 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={query.isFetching ? 'opacity-60 transition-opacity' : undefined}>
                {rows.map((row) => {
                  const due = balanceDue({
                    total: row.total.amount,
                    paid: row.paidAmount,
                    refunded: row.refundedAmount,
                  });
                  const live = !['CANCELLED', 'EXPIRED', 'DRAFT', 'QUOTED'].includes(row.status);
                  const nights = nightsBetween(row.startsOn, row.endsOn);
                  const isSelected = selectedIds.includes(row.id);
                  const isExpanded = expandedId === row.id;
                  return (
                    <Fragment key={row.id}>
                      <TableRow
                        data-state={isSelected ? 'selected' : undefined}
                        className={cn(
                          'h-12 cursor-pointer group-data-[density=compact]:h-9',
                          isSelected && 'bg-primary/10 hover:bg-primary/10',
                        )}
                        onClick={(event) => {
                          if ((event.target as HTMLElement).closest('button, a, input, label, [role="checkbox"]')) return;
                          setSelected(row);
                        }}
                      >
                        <TableCell className="px-3 py-2">
                          <Checkbox
                            aria-label={`Select ${row.externalReference}`}
                            checked={isSelected}
                            onCheckedChange={(value) => toggleRow(row.id, value === true)}
                          />
                        </TableCell>
                        <TableCell className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : row.id)}
                            aria-expanded={isExpanded}
                            className="inline-flex items-center gap-1 bg-transparent p-0 font-semibold text-primary hover:underline"
                          >
                            {isExpanded ? (
                              <ChevronDown aria-hidden="true" className="size-3" />
                            ) : (
                              <ChevronRight aria-hidden="true" className="size-3" />
                            )}
                            {row.externalReference}
                          </button>
                          <span className="block pl-4 text-[10px] text-muted-foreground group-data-[density=compact]:hidden">
                            Created {createdLabel(row.createdAt)}
                          </span>
                        </TableCell>
                        <TableCell className="px-2 py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                              <UserRound aria-hidden="true" className="size-3.5" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-semibold">{guestName(row)}</span>
                              <span className="block truncate text-[10px] text-muted-foreground group-data-[density=compact]:hidden">
                                {row.guestEmail ?? row.guestPhone ?? ''}
                              </span>
                            </span>
                          </div>
                        </TableCell>
                        {columns.room ? (
                          <TableCell className="px-2 py-2">
                            <span className="block">{row.roomTypeName}</span>
                            <span className="block text-[10px] text-muted-foreground group-data-[density=compact]:hidden">
                              {row.roomName ? `Room ${row.roomName}` : 'Not assigned'}
                            </span>
                          </TableCell>
                        ) : null}
                        <TableCell className="px-2 py-2">
                          <span className="block whitespace-nowrap">
                            {shortDate(row.startsOn)} – {shortDate(row.endsOn)}
                          </span>
                          <span className="block text-[10px] text-muted-foreground group-data-[density=compact]:hidden">
                            {nights} night{nights === 1 ? '' : 's'} · {guestsLabel(row)}
                          </span>
                        </TableCell>
                        {columns.source ? (
                          <TableCell className="px-2 py-2">
                            <SourceBadge source={row.source} />
                          </TableCell>
                        ) : null}
                        <TableCell className="px-2 py-2">
                          <BookingStatusBadge status={row.status} />
                        </TableCell>
                        {columns.payment ? (
                          <TableCell className="px-2 py-2">
                            <PaymentBadgeWithDetails row={row} due={due} live={live} />
                          </TableCell>
                        ) : null}
                        {columns.total ? (
                          <TableCell className="px-2 py-2 text-right font-semibold whitespace-nowrap">
                            {money(row.total.amount, row.total.currency)}
                          </TableCell>
                        ) : null}
                        <TableCell className="px-2 py-1 text-right">
                          <RowActions
                            row={row}
                            tenantId={tenantId}
                            propertyId={propertyId}
                            onView={() => setSelected(row)}
                          />
                        </TableCell>
                      </TableRow>
                      {isExpanded ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={visibleColumnCount} className="p-0">
                            <ExpandedReservation row={row} />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              noun="reservations"
              onPage={(page) => {
                setSelectedIds([]);
                setFilters((current) => ({ ...current, page }));
              }}
              pageSizeOptions={PAGE_SIZES}
              onPageSize={(pageSize) => update({ pageSize })}
            />
          </>
        ) : null}
      </Card>

      <ReservationSheet
        row={selected}
        tenantId={tenantId}
        propertyId={propertyId}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function PaymentBadgeWithDetails({
  row,
  due,
  live,
}: {
  row: ReservationRow;
  due: number;
  live: boolean;
}) {
  const currency = row.total.currency;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PaymentStatusBadge
            status={row.status}
            paymentMethod={row.paymentMethod}
            total={row.total.amount}
            paid={row.paidAmount}
            refunded={row.refundedAmount}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent className="space-y-0.5">
        <span className="block">Total {money(row.total.amount, currency)}</span>
        <span className="block">Paid {money(row.paidAmount, currency)}</span>
        {Number(row.refundedAmount) > 0 ? (
          <span className="block">Refunded {money(row.refundedAmount, currency)}</span>
        ) : null}
        {live ? (
          <span className="block font-semibold">Balance due {money(String(due), currency)}</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

function ExpandedReservation({ row }: { row: ReservationRow }) {
  const nights = nightsBetween(row.startsOn, row.endsOn);
  return (
    <div className="grid gap-3 border-t border-primary/15 bg-muted/50 px-4 py-3 text-[10px] sm:grid-cols-2 xl:grid-cols-4">
      <div>
        <p className="font-semibold">Guest &amp; stay</p>
        <p className="mt-1 text-muted-foreground">{guestName(row)}</p>
        {row.guestEmail ? <p className="text-muted-foreground">{row.guestEmail}</p> : null}
        {row.guestPhone ? <p className="text-muted-foreground">{row.guestPhone}</p> : null}
        <p className="text-muted-foreground">{guestsLabel(row)}</p>
      </div>
      <div>
        <p className="font-semibold">Stay information</p>
        <p className="mt-1 text-muted-foreground">Check-in: {longDate(row.startsOn)}</p>
        <p className="text-muted-foreground">Check-out: {longDate(row.endsOn)}</p>
        <p className="text-muted-foreground">
          {nights} night{nights === 1 ? '' : 's'} · Rate plan: {row.ratePlanName}
        </p>
      </div>
      <div>
        <p className="font-semibold">Notes</p>
        <p className="mt-1 text-muted-foreground">{row.specialRequests ?? 'No special requests.'}</p>
        <p className="text-muted-foreground">
          {row.roomName ? `Room ${row.roomName} assigned.` : 'Room not assigned yet.'}
        </p>
      </div>
      <div>
        <p className="font-semibold">Channel / payment</p>
        <p className="mt-1 text-muted-foreground">{sourceLabelOrUnknown(row.source)}</p>
        <p className="text-muted-foreground">
          Payment method: {row.paymentMethod.toLowerCase().replaceAll('_', ' ')}
        </p>
      </div>
    </div>
  );
}

function sourceLabelOrUnknown(source: string | null) {
  if (source === 'DIRECT') return 'Created by staff (Direct)';
  if (source === 'WEBSITE') return 'Booked on the website';
  return 'Source not recorded';
}

function SortHeader({
  label,
  sortKey,
  filters,
  onSort,
  end = false,
}: {
  label: string;
  sortKey: SortKey;
  filters: Filters;
  onSort: (key: SortKey) => void;
  end?: boolean;
}) {
  const active = filters.sort === sortKey;
  const Icon = active ? (filters.direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead
      aria-sort={active ? (filters.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
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
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`More actions for ${row.externalReference}`}
          className="size-7"
        >
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{row.externalReference}</DropdownMenuLabel>
        <DropdownMenuSeparator />
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
