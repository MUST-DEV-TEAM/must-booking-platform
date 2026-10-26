'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BedDouble,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  CreditCard,
  Download,
  FileText,
  Filter,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  Table2,
  UserRound,
} from 'lucide-react';

import { cn } from '../../../lib/utils';
import {
  bookingStatusMeta,
  bookingStatusOptions,
  paymentStatusMeta,
  paymentStatusOptions,
  type BookingStatusCode as BookingState,
  type DemoStatusTone as StatusTone,
  type PaymentStatusLabel as PaymentState,
} from '../_lib/demo-domain';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { Checkbox } from '../../../components/ui/checkbox';
import { CalendarPicker, type CalendarSelection } from '../../../components/ui/calendar-picker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import { Input } from '../../../components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { PageHeader } from '../_ui/hotel';

type StayState = 'Upcoming' | 'In house' | 'Departed' | 'Not staying';
type SortKey = 'id' | 'guest' | 'hotel' | 'createdAt' | 'checkIn' | 'booking' | 'payment' | 'total';

const separatedStatusGroups = [
  {
    label: 'Booking',
    states: [
      ['PMS send pending', 'warning'],
      ['PMS rejected', 'danger'],
    ],
  },
  {
    label: 'Payment',
    states: [
      ['Paid', 'success'],
      ['Refunded', 'warning'],
    ],
  },
  {
    label: 'Stay',
    states: [
      ['Upcoming', 'info'],
      ['In house', 'pine'],
    ],
  },
  {
    label: 'Clock event',
    states: [
      ['Received', 'info'],
      ['Queued', 'warning'],
      ['Hydrated', 'success'],
      ['Ignored', 'muted'],
      ['Failed', 'danger'],
      ['Needs reconciliation', 'warning'],
    ],
  },
] as const;

type Booking = {
  id: string;
  guest: string;
  email: string;
  guestType: 'Guest' | 'Staff';
  hotel: string;
  location: string;
  room: string;
  unit: string;
  createdAt: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  booking: BookingState;
  payment: PaymentState;
  total: number;
  stay: StayState;
  source: string;
  provider: string;
};

const bookings: Booking[] = [
  {
    id: 'MHB-1042',
    guest: 'Elira Hoxha',
    email: 'elira@must.al',
    guestType: 'Guest',
    hotel: 'Empire Beach Resort',
    location: 'Sarandë, Albania',
    room: 'Deluxe Sea View',
    unit: 'Room 204',
    createdAt: '2026-10-05T10:24:00+02:00',
    checkIn: '2026-10-20',
    checkOut: '2026-10-22',
    nights: 2,
    booking: 'CONFIRMED',
    payment: 'Paid',
    total: 540,
    stay: 'Upcoming',
    source: 'Website',
    provider: 'Clock PMS+',
  },
  {
    id: 'MHB-1043',
    guest: 'Ardit Kola',
    email: 'ardit@must.al',
    guestType: 'Guest',
    hotel: 'Empire Beach Resort',
    location: 'Sarandë, Albania',
    room: 'Family Suite',
    unit: 'Unit 118',
    createdAt: '2026-10-08T16:41:00+02:00',
    checkIn: '2026-10-12',
    checkOut: '2026-10-17',
    nights: 5,
    booking: 'MANUAL_REVIEW',
    payment: 'Payment pending',
    total: 920,
    stay: 'Upcoming',
    source: 'Staff booking',
    provider: 'Clock PMS+',
  },
  {
    id: 'MHB-1044',
    guest: 'Sara Dervishi',
    email: 'sara@must.al',
    guestType: 'Guest',
    hotel: 'Marina Bay Hotel',
    location: 'Vlorë, Albania',
    room: 'Standard Double',
    unit: 'Room 305',
    createdAt: '2026-10-06T08:13:00+02:00',
    checkIn: '2026-10-10',
    checkOut: '2026-10-12',
    nights: 2,
    booking: 'CONFIRMED',
    payment: 'Paid',
    total: 260,
    stay: 'In house',
    source: 'Website',
    provider: 'Clock PMS+',
  },
  {
    id: 'MHB-1045',
    guest: 'Noel Berisha',
    email: 'noel@must.al',
    guestType: 'Guest',
    hotel: 'Old Town Suites',
    location: 'Tiranë, Albania',
    room: 'Executive Room',
    unit: 'Auto-assign',
    createdAt: '2026-10-11T09:05:00+02:00',
    checkIn: '2026-10-24',
    checkOut: '2026-10-28',
    nights: 4,
    booking: 'PMS_CONFIRMATION_PENDING',
    payment: 'Pay at hotel',
    total: 680,
    stay: 'Upcoming',
    source: 'Staff booking',
    provider: 'Clock PMS+',
  },
  {
    id: 'MHB-1046',
    guest: 'Adea Meta',
    email: 'adea@must.al',
    guestType: 'Guest',
    hotel: 'Empire Beach Resort',
    location: 'Sarandë, Albania',
    room: 'Ocean Pool Villa',
    unit: 'Unit 102',
    createdAt: '2026-10-03T12:37:00+02:00',
    checkIn: '2026-10-06',
    checkOut: '2026-10-08',
    nights: 2,
    booking: 'CANCELLED',
    payment: 'Refunded',
    total: 1890,
    stay: 'Not staying',
    source: 'Website',
    provider: 'Clock PMS+',
  },
  {
    id: 'MHB-1047',
    guest: 'Klea Pasha',
    email: 'klea@must.al',
    guestType: 'Guest',
    hotel: 'Marina Bay Hotel',
    location: 'Vlorë, Albania',
    room: 'Standard Double',
    unit: 'Room 212',
    createdAt: '2026-10-09T19:42:00+02:00',
    checkIn: '2026-10-12',
    checkOut: '2026-10-13',
    nights: 1,
    booking: 'PAYMENT_FAILED',
    payment: 'Failed',
    total: 130,
    stay: 'Not staying',
    source: 'Website',
    provider: 'PokPay',
  },
  {
    id: 'MHB-1048',
    guest: 'Jon Ilazi',
    email: 'jon@must.al',
    guestType: 'Guest',
    hotel: 'Empire Beach Resort',
    location: 'Sarandë, Albania',
    room: 'Deluxe Sea View',
    unit: 'Room 209',
    createdAt: '2026-10-02T11:20:00+02:00',
    checkIn: '2026-10-29',
    checkOut: '2026-11-01',
    nights: 3,
    booking: 'CONFIRMED',
    payment: 'Partially refunded',
    total: 450,
    stay: 'Upcoming',
    source: 'Website',
    provider: 'Clock PMS+',
  },
  {
    id: 'MHB-1049',
    guest: 'Ina Meta',
    email: 'ina@must.al',
    guestType: 'Staff',
    hotel: 'Old Town Suites',
    location: 'Tiranë, Albania',
    room: 'Family Suite',
    unit: 'Unit 105',
    createdAt: '2026-10-07T14:05:00+02:00',
    checkIn: '2026-10-18',
    checkOut: '2026-10-20',
    nights: 2,
    booking: 'PMS_UNKNOWN_RESULT',
    payment: 'Paid',
    total: 620,
    stay: 'Upcoming',
    source: 'Staff booking',
    provider: 'Clock PMS+',
  },
  {
    id: 'MHB-1050',
    guest: 'Luan Balla',
    email: 'luan@must.al',
    guestType: 'Guest',
    hotel: 'Marina Bay Hotel',
    location: 'Vlorë, Albania',
    room: 'Standard Double',
    unit: 'Room 110',
    createdAt: '2026-10-10T22:12:00+02:00',
    checkIn: '2026-10-30',
    checkOut: '2026-10-31',
    nights: 1,
    booking: 'EXPIRED',
    payment: 'Unpaid',
    total: 180,
    stay: 'Not staying',
    source: 'Website',
    provider: 'Clock PMS+',
  },
  {
    id: 'MHB-1051',
    guest: 'Mira Hoxha',
    email: 'mira@must.al',
    guestType: 'Guest',
    hotel: 'Empire Beach Resort',
    location: 'Sarandë, Albania',
    room: 'Deluxe Sea View',
    unit: 'Room 211',
    createdAt: '2026-10-10T17:30:00+02:00',
    checkIn: '2026-10-31',
    checkOut: '2026-11-02',
    nights: 2,
    booking: 'PAYMENT_NOT_REQUIRED',
    payment: 'No payment due',
    total: 560,
    stay: 'Upcoming',
    source: 'Walk-in',
    provider: 'Clock PMS+',
  },
];

const bookingLabel = Object.fromEntries(
  Object.entries(bookingStatusMeta).map(([status, meta]) => [status, meta.label]),
) as Record<BookingState, string>;
const bookingTone = Object.fromEntries(
  Object.entries(bookingStatusMeta).map(([status, meta]) => [status, meta.tone]),
) as Record<BookingState, StatusTone>;
const paymentTone = Object.fromEntries(
  Object.entries(paymentStatusMeta).map(([status, meta]) => [status, meta.tone]),
) as Record<PaymentState, StatusTone>;
const stayTone: Record<StayState, StatusTone> = {
  Upcoming: 'info',
  'In house': 'pine',
  Departed: 'muted',
  'Not staying': 'muted',
};

const money = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const formatDay = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${value}T12:00:00`),
  );
const formatBookedAt = (value: string) => {
  const date = new Date(value);
  return {
    date: new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Europe/Tirane',
    }).format(date),
    time: new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Europe/Tirane',
    }).format(date),
  };
};

function StateBadge({ children, tone }: { children: ReactNode; tone: StatusTone }) {
  return (
    <Badge
      variant={tone === 'pine' ? 'secondary' : tone}
      title={typeof children === 'string' ? children : undefined}
      className={cn(
        'max-w-full truncate rounded-full px-2 py-0 text-[10px] font-semibold',
        tone === 'pine' && 'bg-primary/10 text-primary',
      )}
    >
      {children}
    </Badge>
  );
}

function NumberedCard({
  number,
  title,
  note,
  children,
  className,
}: {
  number: string;
  title: string;
  note?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('gap-3 p-4', className)}>
      <div className="flex min-w-0 items-start gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary text-[10px] font-bold text-primary-foreground">
          {number}
        </span>
        <h3 className="min-w-0 text-sm font-bold leading-tight">{title}</h3>
      </div>
      {note ? (
        <p className="-mt-1 text-[11px] leading-relaxed text-muted-foreground">{note}</p>
      ) : null}
      {children}
    </Card>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; direction: 'asc' | 'desc' };
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const SortIcon = active ? (sort.direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('px-2 py-2', className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="flex w-full items-center justify-between gap-1 text-left normal-case tracking-normal hover:text-foreground"
      >
        <span>{label}</span>
        <SortIcon aria-hidden="true" className="size-3 shrink-0" />
      </button>
    </TableHead>
  );
}

function BookingRowActions({ booking }: { booking: Booking }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`More actions for ${booking.id}`}
          className="size-7"
        >
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{booking.id}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>View booking</DropdownMenuItem>
        <DropdownMenuItem>Edit booking</DropdownMenuItem>
        <DropdownMenuItem>Assign room</DropdownMenuItem>
        <DropdownMenuItem>Download invoice</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">Cancel booking</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ExpandedBooking({ booking }: { booking: Booking }) {
  return (
    <div className="grid gap-3 border-t border-primary/15 bg-muted/50 px-3 py-3 text-[10px] @md/design-preview:grid-cols-2 @xl/design-preview:grid-cols-4">
      <div>
        <p className="font-semibold">Guest & stay</p>
        <p className="mt-1 text-muted-foreground">
          {booking.guest} · {booking.email}
        </p>
        <p className="text-muted-foreground">+355 69 220 1043 · 2 Adults</p>
      </div>
      <div>
        <p className="font-semibold">Stay information</p>
        <p className="mt-1 text-muted-foreground">
          Check-in: {formatDay(booking.checkIn)} · 2:00 PM
        </p>
        <p className="text-muted-foreground">Check-out: {formatDay(booking.checkOut)} · 11:00 AM</p>
        <p className="text-muted-foreground">Rate plan: Flexible</p>
      </div>
      <div>
        <p className="font-semibold">Notes</p>
        <p className="mt-1 text-muted-foreground">Late check-in requested.</p>
        <p className="text-muted-foreground">Room assignment pending.</p>
      </div>
      <div>
        <p className="font-semibold">Channel / source</p>
        <p className="mt-1 text-muted-foreground">{booking.source}</p>
        <p className="text-muted-foreground">Provider: {booking.provider}</p>
      </div>
    </div>
  );
}

function ResponsiveBookingCard({
  booking,
  selected,
  expanded,
  onSelect,
  onExpand,
}: {
  booking: Booking;
  selected: boolean;
  expanded: boolean;
  onSelect: (checked: boolean) => void;
  onExpand: () => void;
}) {
  const bookedAt = formatBookedAt(booking.createdAt);

  return (
    <article
      data-state={selected ? 'selected' : undefined}
      className={cn(
        'min-w-0 rounded-lg border bg-card p-3 transition-colors',
        selected && 'border-primary/30 bg-primary/5',
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Checkbox
          aria-label={`Select ${booking.id}`}
          checked={selected}
          onCheckedChange={(value) => onSelect(value === true)}
          className="mt-1"
        />
        <button
          type="button"
          onClick={onExpand}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-start justify-between gap-2 text-left"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-primary">{booking.id}</span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">
              Booked {bookedAt.date} · {bookedAt.time}
            </span>
          </span>
          <StateBadge tone={bookingTone[booking.booking]}>
            {bookingLabel[booking.booking]}
          </StateBadge>
        </button>
        <BookingRowActions booking={booking} />
      </div>

      <div className="mt-3 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold">{booking.guest}</p>
          <p className="truncate text-[10px] text-muted-foreground">{booking.hotel}</p>
          <p className="truncate text-[10px] text-muted-foreground">
            {booking.room} · {booking.unit}
          </p>
        </div>
        <p className="shrink-0 text-xs font-bold">{money.format(booking.total)}</p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 rounded-md bg-muted/60 p-2.5 text-[10px]">
        <div className="min-w-0">
          <p className="text-muted-foreground">Check-in</p>
          <p className="mt-0.5 font-semibold">{formatDay(booking.checkIn)}</p>
          <p className="text-muted-foreground">{booking.nights} nights</p>
        </div>
        <div className="min-w-0">
          <p className="text-muted-foreground">Check-out</p>
          <p className="mt-0.5 font-semibold">{formatDay(booking.checkOut)}</p>
          <p className="text-muted-foreground">{booking.provider}</p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground">Payment</span>
        <StateBadge tone={paymentTone[booking.payment]}>{booking.payment}</StateBadge>
        <span className="ml-auto text-[10px] text-muted-foreground">Stay</span>
        <StateBadge tone={stayTone[booking.stay]}>{booking.stay}</StateBadge>
      </div>

      {expanded ? (
        <div className="mt-3 overflow-hidden rounded-md border">
          <ExpandedBooking booking={booking} />
        </div>
      ) : null}
    </article>
  );
}

function BookingTableShowcase() {
  const [query, setQuery] = useState('');
  const [bookingFilter, setBookingFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [dateRange, setDateRange] = useState<CalendarSelection>({
    start: '2026-10-01',
    end: '2026-10-31',
  });
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'checkIn',
    direction: 'asc',
  });
  const [selected, setSelected] = useState<string[]>(['MHB-1043']);
  const [expanded, setExpanded] = useState<string | null>('MHB-1043');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [message, setMessage] = useState('');
  const [columns, setColumns] = useState({
    hotel: true,
    room: true,
    bookedAt: true,
    checkIn: true,
    payment: true,
    total: true,
  });

  const filteredRows = useMemo(() => {
    const start = dateRange.start ?? '';
    const end = dateRange.end ?? start;
    const lowerQuery = query.trim().toLowerCase();
    return bookings
      .filter(
        (row) =>
          !lowerQuery ||
          [row.id, row.guest, row.email, row.hotel, row.room].some((value) =>
            value.toLowerCase().includes(lowerQuery),
          ),
      )
      .filter((row) => bookingFilter === 'all' || row.booking === bookingFilter)
      .filter((row) => paymentFilter === 'all' || row.payment === paymentFilter)
      .filter((row) => !start || (row.checkIn <= end && row.checkOut > start));
  }, [bookingFilter, dateRange, paymentFilter, query]);

  const sortedRows = useMemo(
    () =>
      [...filteredRows].sort((left, right) => {
        const leftValue =
          sort.key === 'total'
            ? left.total
            : sort.key === 'booking'
              ? bookingLabel[left.booking]
              : left[sort.key];
        const rightValue =
          sort.key === 'total'
            ? right.total
            : sort.key === 'booking'
              ? bookingLabel[right.booking]
              : right[sort.key];
        const result =
          typeof leftValue === 'number' && typeof rightValue === 'number'
            ? leftValue - rightValue
            : String(leftValue).localeCompare(String(rightValue));
        return sort.direction === 'asc' ? result : -result;
      }),
    [filteredRows, sort],
  );

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleRows = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((row) => selected.includes(row.id));
  const someVisibleSelected = visibleRows.some((row) => selected.includes(row.id));

  const changeSort = (key: SortKey) =>
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));

  const toggleRow = (id: string, checked: boolean) => {
    setSelected((current) =>
      checked ? [...new Set([...current, id])] : current.filter((item) => item !== id),
    );
  };

  const toggleVisible = (checked: boolean) => {
    setSelected((current) =>
      checked
        ? [...new Set([...current, ...visibleRows.map((row) => row.id)])]
        : current.filter((id) => !visibleRows.some((row) => row.id === id)),
    );
  };

  const exportRows = () => {
    const csv = [
      [
        'Booking ID',
        'Guest',
        'Hotel',
        'Room',
        'Booked at',
        'Check-in',
        'Booking status',
        'Payment status',
        'Total',
      ],
      ...filteredRows.map((row) => [
        row.id,
        row.guest,
        row.hotel,
        row.room,
        row.createdAt,
        row.checkIn,
        row.booking,
        row.payment,
        row.total.toFixed(2),
      ]),
    ]
      .map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'must-bookings-demo.csv';
    link.click();
    URL.revokeObjectURL(url);
    setMessage(`Exported ${filteredRows.length} demo bookings.`);
  };

  const toggleColumn = (column: keyof typeof columns) =>
    setColumns((current) => ({ ...current, [column]: !current[column] }));
  const tableColumnCount =
    6 +
    Number(columns.hotel) +
    Number(columns.room) +
    Number(columns.bookedAt) +
    Number(columns.checkIn) +
    Number(columns.payment) +
    Number(columns.total);
  const compactTableColumnCount = 6 + Number(columns.checkIn);

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="space-y-3 border-b p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold">Bookings</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full @sm/design-preview:w-44">
              <Search
                aria-hidden="true"
                className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label="Search bookings"
                placeholder="Search booking, guest, hotel…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                className="h-9 pl-8 text-xs"
              />
            </div>
            <Select
              value={bookingFilter}
              onValueChange={(value) => {
                setBookingFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger aria-label="Booking status filter" className="h-9 w-[122px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Booking: All</SelectItem>
                {bookingStatusOptions.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={paymentFilter}
              onValueChange={(value) => {
                setPaymentFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger aria-label="Payment status filter" className="h-9 w-[112px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Payment: All</SelectItem>
                {paymentStatusOptions.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <CalendarPicker
              label="Stay date range"
              mode="range"
              value={dateRange}
              onChange={(value) => {
                setDateRange(value);
                setPage(1);
              }}
              className="h-9 w-full justify-between px-3 text-xs @sm/design-preview:w-auto"
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <Columns3 aria-hidden="true" />
                  Columns
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-2">
                <p className="px-2 py-1 text-xs font-semibold">Show columns</p>
                {Object.entries({
                  hotel: 'Hotel',
                  room: 'Room',
                  bookedAt: 'Booked',
                  checkIn: 'Check-in',
                  payment: 'Payment',
                  total: 'Total',
                }).map(([key, label]) => {
                  const column = key as keyof typeof columns;
                  return (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"
                    >
                      <Checkbox
                        checked={columns[column]}
                        onCheckedChange={() => toggleColumn(column)}
                      />
                      {label}
                    </label>
                  );
                })}
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" onClick={exportRows}>
              <Download aria-hidden="true" />
              Export
            </Button>
            <Button
              size="sm"
              onClick={() => setMessage('Create booking is a demo action. No booking was created.')}
            >
              <Plus aria-hidden="true" />
              Create booking
            </Button>
          </div>
        </div>
        {selected.length ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-2 text-xs">
            <span className="font-semibold">{selected.length} selected</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setMessage('Selected bookings marked for confirmation.')}
            >
              Confirm
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setMessage('Room assignment opened for selected bookings.')}
            >
              Assign room
            </Button>
            <Button variant="secondary" size="sm" onClick={exportRows}>
              Export
            </Button>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected([])}>
              Clear selection
            </Button>
          </div>
        ) : null}
        {message ? (
          <p role="status" className="text-xs text-muted-foreground">
            {message}
          </p>
        ) : null}
      </div>

      <section
        aria-label="Bookings list"
        className="space-y-2 border-t p-3 @xl/design-preview:hidden"
      >
        <div className="flex items-center justify-between gap-3 px-1 pb-1 text-[11px] text-muted-foreground">
          <span>{visibleRows.length} bookings shown</span>
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox
              aria-label="Select visible bookings"
              checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
              onCheckedChange={(value) => toggleVisible(value === true)}
            />
            Select visible
          </label>
        </div>
        {visibleRows.length ? (
          visibleRows.map((row) => (
            <ResponsiveBookingCard
              key={row.id}
              booking={row}
              selected={selected.includes(row.id)}
              expanded={expanded === row.id}
              onSelect={(checked) => toggleRow(row.id, checked)}
              onExpand={() => setExpanded((current) => (current === row.id ? null : row.id))}
            />
          ))
        ) : (
          <div className="rounded-lg border px-4 py-8 text-center">
            <p className="text-sm font-semibold">No bookings match these filters</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try another guest, booking status, payment status, or date range.
            </p>
          </div>
        )}
      </section>

      <div className="hidden @xl/design-preview:block">
        <Table containerClassName="overflow-x-hidden" className="table-fixed text-[11px]">
          <TableHeader className="sticky top-0 z-10 bg-muted">
            <TableRow className="hover:bg-muted">
              <TableHead className="w-8 px-1 py-2">
                <Checkbox
                  aria-label="Select visible bookings"
                  checked={
                    allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false
                  }
                  onCheckedChange={(value) => toggleVisible(value === true)}
                />
              </TableHead>
              <SortHeader
                label="Booking ID"
                sortKey="id"
                sort={sort}
                onSort={changeSort}
                className="w-[74px] px-1 py-2"
              />
              <SortHeader
                label="Guest"
                sortKey="guest"
                sort={sort}
                onSort={changeSort}
                className="w-[106px] px-1 py-2"
              />
              {columns.bookedAt ? (
                <SortHeader
                  label="Booked"
                  sortKey="createdAt"
                  sort={sort}
                  onSort={changeSort}
                  className="hidden w-[74px] px-1 py-2 @2xl/design-preview:table-cell"
                />
              ) : null}
              {columns.hotel ? (
                <SortHeader
                  label="Hotel"
                  sortKey="hotel"
                  sort={sort}
                  onSort={changeSort}
                  className="hidden w-[104px] px-1 py-2 @2xl/design-preview:table-cell"
                />
              ) : null}
              {columns.room ? (
                <TableHead className="hidden w-[92px] px-1 py-2 @2xl/design-preview:table-cell">
                  Room
                </TableHead>
              ) : null}
              {columns.checkIn ? (
                <SortHeader
                  label="Check-in"
                  sortKey="checkIn"
                  sort={sort}
                  onSort={changeSort}
                  className="hidden w-[78px] px-1 py-2 @xl/design-preview:table-cell"
                />
              ) : null}
              <SortHeader
                label="Booking"
                sortKey="booking"
                sort={sort}
                onSort={changeSort}
                className="w-[108px] px-1 py-2"
              />
              {columns.payment ? (
                <SortHeader
                  label="Payment"
                  sortKey="payment"
                  sort={sort}
                  onSort={changeSort}
                  className="hidden w-[86px] px-1 py-2 @2xl/design-preview:table-cell"
                />
              ) : null}
              {columns.total ? (
                <SortHeader
                  label="Total"
                  sortKey="total"
                  sort={sort}
                  onSort={changeSort}
                  className="hidden w-[68px] px-1 py-2 text-right @2xl/design-preview:table-cell"
                />
              ) : null}
              <TableHead className="hidden w-[66px] px-1 py-2 @xl/design-preview:table-cell">
                Stay
              </TableHead>
              <TableHead className="w-8 px-1 py-2 text-right">
                <span className="sr-only">Actions</span>
                <span aria-hidden="true">More</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length ? (
              visibleRows.map((row) => (
                <FragmentBookingRow
                  key={row.id}
                  booking={row}
                  selected={selected.includes(row.id)}
                  expanded={expanded === row.id}
                  columns={columns}
                  colSpan={tableColumnCount}
                  compactColSpan={compactTableColumnCount}
                  onSelect={(checked) => toggleRow(row.id, checked)}
                  onExpand={() => setExpanded((current) => (current === row.id ? null : row.id))}
                />
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={compactTableColumnCount}
                  className="py-8 text-center @2xl:hidden"
                >
                  <p className="font-semibold">No bookings match these filters</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Try another guest, booking status, payment status, or date range.
                  </p>
                </TableCell>
                <TableCell
                  colSpan={tableColumnCount}
                  className="hidden py-8 text-center @2xl:table-cell"
                >
                  <p className="font-semibold">No bookings match these filters</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Try another guest, booking status, payment status, or date range.
                  </p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-[11px] text-muted-foreground">
        <span>
          Showing {sortedRows.length ? (safePage - 1) * pageSize + 1 : 0}–
          {Math.min(safePage * pageSize, sortedRows.length)} of {sortedRows.length} bookings
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <label htmlFor="booking-page-size">Rows per page</label>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              setPageSize(Number(value));
              setPage(1);
            }}
          >
            <SelectTrigger
              id="booking-page-size"
              aria-label="Rows per page"
              className="h-8 w-[68px] text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="6">6</SelectItem>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="25">25</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="First page"
            disabled={safePage <= 1}
            onClick={() => setPage(1)}
          >
            <ChevronsLeft aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={safePage <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
            <Button
              key={number}
              variant={number === safePage ? 'default' : 'outline'}
              size="icon-sm"
              aria-current={number === safePage ? 'page' : undefined}
              onClick={() => setPage(number)}
            >
              {number}
            </Button>
          ))}
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={safePage >= pageCount}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Last page"
            disabled={safePage >= pageCount}
            onClick={() => setPage(pageCount)}
          >
            <ChevronsRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function FragmentBookingRow({
  booking,
  selected,
  expanded,
  columns,
  colSpan,
  compactColSpan,
  onSelect,
  onExpand,
}: {
  booking: Booking;
  selected: boolean;
  expanded: boolean;
  columns: {
    hotel: boolean;
    room: boolean;
    bookedAt: boolean;
    checkIn: boolean;
    payment: boolean;
    total: boolean;
  };
  colSpan: number;
  compactColSpan: number;
  onSelect: (checked: boolean) => void;
  onExpand: () => void;
}) {
  return (
    <>
      <TableRow
        data-state={selected ? 'selected' : undefined}
        className={cn('h-10', selected && 'bg-primary/10 hover:bg-primary/10')}
      >
        <TableCell className="px-1 py-2">
          <Checkbox
            aria-label={`Select ${booking.id}`}
            checked={selected}
            onCheckedChange={(value) => onSelect(value === true)}
          />
        </TableCell>
        <TableCell className="px-2 py-2">
          <button
            type="button"
            onClick={onExpand}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            {expanded ? (
              <ChevronDown aria-hidden="true" className="size-3" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-3" />
            )}
            {booking.id}
          </button>
          {columns.bookedAt ? (
            <span className="block text-[9px] text-muted-foreground @md/design-preview:hidden">
              Booked {formatBookedAt(booking.createdAt).date}
            </span>
          ) : null}
        </TableCell>
        <TableCell className="overflow-hidden px-1 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
              <UserRound aria-hidden="true" className="size-3.5" />
            </span>
            <span className="min-w-0 truncate">
              <span className="block truncate font-semibold">{booking.guest}</span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {booking.email}
              </span>
            </span>
          </div>
        </TableCell>
        {columns.bookedAt ? (
          <TableCell className="hidden px-1 py-2 @2xl/design-preview:table-cell">
            <span className="block">{formatBookedAt(booking.createdAt).date}</span>
            <span className="text-[10px] text-muted-foreground">
              {formatBookedAt(booking.createdAt).time}
            </span>
          </TableCell>
        ) : null}
        {columns.hotel ? (
          <TableCell className="hidden overflow-hidden px-1 py-2 @2xl/design-preview:table-cell">
            <span className="block truncate font-medium">{booking.hotel}</span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {booking.location}
            </span>
          </TableCell>
        ) : null}
        {columns.room ? (
          <TableCell className="hidden overflow-hidden px-1 py-2 @2xl/design-preview:table-cell">
            <span className="block truncate">{booking.room}</span>
            <span className="block truncate text-[10px] text-muted-foreground">{booking.unit}</span>
          </TableCell>
        ) : null}
        {columns.checkIn ? (
          <TableCell className="hidden px-1 py-2 @xl/design-preview:table-cell">
            <span className="block">{formatDay(booking.checkIn)}</span>
            <span className="text-[10px] text-muted-foreground">{booking.nights} nights</span>
          </TableCell>
        ) : null}
        <TableCell className="px-1 py-2">
          <StateBadge tone={bookingTone[booking.booking]}>
            {bookingLabel[booking.booking]}
          </StateBadge>
        </TableCell>
        {columns.payment ? (
          <TableCell className="hidden px-1 py-2 @2xl/design-preview:table-cell">
            <StateBadge tone={paymentTone[booking.payment]}>{booking.payment}</StateBadge>
          </TableCell>
        ) : null}
        {columns.total ? (
          <TableCell className="hidden px-1 py-2 text-right font-semibold @2xl/design-preview:table-cell">
            {money.format(booking.total)}
          </TableCell>
        ) : null}
        <TableCell className="hidden px-1 py-2 @xl/design-preview:table-cell">
          <StateBadge tone={stayTone[booking.stay]}>{booking.stay}</StateBadge>
        </TableCell>
        <TableCell className="px-1 py-1 text-right">
          <BookingRowActions booking={booking} />
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={compactColSpan} className="p-0 @2xl:hidden">
            <ExpandedBooking booking={booking} />
          </TableCell>
          <TableCell colSpan={colSpan} className="hidden p-0 @2xl:table-cell">
            <ExpandedBooking booking={booking} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function MiniTable({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-md border', className)}>
      <Table className="table-fixed text-[10px] [&_td]:max-w-0 [&_td]:overflow-hidden [&_td]:text-ellipsis [&_th]:max-w-0 [&_th]:overflow-hidden [&_th]:text-ellipsis">
        {children}
      </Table>
    </div>
  );
}

function domainCellTone(title: string, heading: string, value: string): StatusTone | null {
  const accessTones: Record<string, StatusTone> = {
    Customer: 'info',
    Bookings: 'success',
    Payments: 'warning',
  };
  const statusTones: Record<string, StatusTone> = {
    Paid: 'success',
    Verified: 'success',
    Succeeded: 'success',
    Hydrated: 'success',
    Reconciled: 'info',
    Received: 'info',
    'Payment pending': 'warning',
    Pending: 'warning',
    Queued: 'warning',
    'Needs reconciliation': 'warning',
    Refunded: 'warning',
    Failed: 'danger',
    Ignored: 'muted',
  };

  if (heading === 'Source') return value === 'Clock PMS+' ? 'info' : 'warning';
  if (heading === 'Provider') return value === 'Clock PMS+' ? 'info' : 'pine';
  if (heading === 'Type') return value === 'Guest' ? 'info' : 'warning';

  if (heading === 'Access') {
    return accessTones[value] ?? null;
  }

  if (heading === 'Status') {
    return statusTones[value] ?? null;
  }

  if (title === 'Payments & reconciliation' && heading === 'Paid') {
    return value === '€0' ? 'muted' : 'success';
  }
  if (title === 'Payments & reconciliation' && heading === 'Refunded') {
    return value === '€0' ? 'muted' : 'warning';
  }

  return null;
}

function TableHeaderSpecimen() {
  return (
    <MiniTable>
      <TableHeader>
        <TableRow>
          <TableHead className="px-2 py-2">
            Booking ID <ArrowUpDown aria-hidden="true" className="ml-1 inline size-3" />
          </TableHead>
          <TableHead className="px-2 py-2">
            Guest <ArrowUpDown aria-hidden="true" className="ml-1 inline size-3" />
          </TableHead>
          <TableHead className="px-2 py-2 text-right">
            Hotel <ArrowUpDown aria-hidden="true" className="ml-1 inline size-3" />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="px-2 py-2 font-semibold">MHB-1042</TableCell>
          <TableCell className="px-2 py-2">Elira Hoxha</TableCell>
          <TableCell className="px-2 py-2 text-right">Empire Beach</TableCell>
        </TableRow>
      </TableBody>
    </MiniTable>
  );
}

function RowSample({
  label,
  selected = false,
  hover = false,
  disabled = false,
}: {
  label: string;
  selected?: boolean;
  hover?: boolean;
  disabled?: boolean;
}) {
  const [checked, setChecked] = useState(selected);
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-2 py-2 text-xs',
        checked && 'border-primary/15 bg-primary/10',
        hover && 'bg-muted',
        disabled && 'bg-muted/50 text-muted-foreground',
      )}
    >
      <Checkbox
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => setChecked(value === true)}
      />
      <span className="font-medium">{label}</span>
      {disabled ? (
        <ShieldCheck aria-hidden="true" className="ml-auto size-3.5 text-muted-foreground" />
      ) : null}
    </div>
  );
}

function ExpandableRowSample() {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs hover:bg-muted"
      >
        {expanded ? (
          <ChevronDown aria-hidden="true" className="size-3.5" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-3.5" />
        )}
        {expanded ? 'Expanded row' : 'Collapsed row'}
      </button>
      {expanded ? (
        <div className="space-y-2 rounded-md border border-primary/50 bg-primary/5 p-3 text-xs">
          <p className="font-semibold">MHB-1042 · Elira Hoxha</p>
          <p className="text-[10px] text-muted-foreground">
            20–22 Oct · Deluxe Sea View · Website · Clock PMS+
          </p>
        </div>
      ) : null}
    </div>
  );
}

function MiniPagination() {
  const total = 128;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const pageCount = Math.ceil(total / pageSize);
  const firstPage = Math.max(1, Math.min(page - 2, pageCount - 4));
  const pageNumbers = Array.from(
    { length: Math.min(5, pageCount) },
    (_, index) => firstPage + index,
  );
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="space-y-2">
      <p aria-live="polite" className="text-[10px] text-muted-foreground">
        Showing {from}–{to} of {total} bookings
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Example first page"
          disabled={page === 1}
          onClick={() => setPage(1)}
        >
          <ChevronsLeft />
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Example previous page"
          disabled={page === 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >
          <ChevronLeft />
        </Button>
        {pageNumbers.map((number) => (
          <Button
            key={number}
            size="icon-sm"
            variant={number === page ? 'default' : 'outline'}
            aria-current={number === page ? 'page' : undefined}
            onClick={() => setPage(number)}
          >
            {number}
          </Button>
        ))}
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Example next page"
          disabled={page === pageCount}
          onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
        >
          <ChevronRight />
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Example last page"
          disabled={page === pageCount}
          onClick={() => setPage(pageCount)}
        >
          <ChevronsRight />
        </Button>
      </div>
      <Select
        value={String(pageSize)}
        onValueChange={(value) => {
          setPageSize(Number(value));
          setPage(1);
        }}
      >
        <SelectTrigger aria-label="Example page size" className="h-8 w-20 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="10">10 rows</SelectItem>
          <SelectItem value="25">25 rows</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function SortSamples() {
  return (
    <div className="grid gap-2 @md/design-preview:grid-cols-3">
      {(['Unsorted', 'Ascending', 'Descending'] as const).map((label, index) => (
        <div key={label} className="rounded-md border bg-background p-2">
          <div className="flex items-center justify-between text-[10px] font-medium">
            Booking ID
            {index === 0 ? (
              <ArrowUpDown className="size-3" />
            ) : index === 1 ? (
              <ArrowUp className="size-3" />
            ) : (
              <ArrowDown className="size-3" />
            )}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">{label}</p>
        </div>
      ))}
    </div>
  );
}

function GuestCell({
  name,
  email,
  type,
}: {
  name: string;
  email: string;
  type: 'Guest' | 'Staff';
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full',
          type === 'Staff' ? 'bg-warning-surface text-warning' : 'bg-secondary text-primary',
        )}
      >
        <UserRound aria-hidden="true" className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold">{name}</span>
        <span className="block truncate text-[10px] text-muted-foreground">{email}</span>
      </span>
    </div>
  );
}

function DomainExample({
  title,
  note,
  headings,
  rows,
}: {
  title: string;
  note: string;
  headings: string[];
  rows: string[][];
}) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div>
        <h3 className="text-xs font-bold">{title}</h3>
        <p className="text-[10px] text-muted-foreground">{note}</p>
      </div>
      <MiniTable>
        <TableHeader>
          <TableRow>
            {headings.map((heading) => (
              <TableHead key={heading} className="px-2 py-2 text-[9px]">
                {heading}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row[0]}>
              {row.map((cell, index) => (
                <TableCell
                  key={`${row[0]}-${index}`}
                  className={cn(
                    'max-w-28 overflow-hidden px-2 py-2 text-ellipsis',
                    headings[index] === 'Paid' && cell !== '€0' && 'font-semibold text-success',
                    headings[index] === 'Paid' && cell === '€0' && 'text-muted-foreground',
                    headings[index] === 'Refunded' && cell !== '€0' && 'font-semibold text-warning',
                    headings[index] === 'Refunded' && cell === '€0' && 'text-muted-foreground',
                  )}
                >
                  {domainCellTone(title, headings[index], cell) &&
                  headings[index] !== 'Paid' &&
                  headings[index] !== 'Refunded' ? (
                    <StateBadge tone={domainCellTone(title, headings[index], cell)!}>
                      {cell}
                    </StateBadge>
                  ) : (
                    cell
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </MiniTable>
    </div>
  );
}

function PermissionActions() {
  const [role, setRole] = useState('agent');
  const [message, setMessage] = useState('');
  const actions =
    role === 'readonly'
      ? ['View booking', 'View report']
      : role === 'finance'
        ? ['View booking', 'Download invoice', 'Review payment']
        : ['View booking', 'Edit booking', 'Assign room', 'Download invoice', 'Cancel booking'];
  return (
    <div className="space-y-2">
      <Select value={role} onValueChange={setRole}>
        <SelectTrigger aria-label="Role for row actions" className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="agent">Booking Agent</SelectItem>
          <SelectItem value="finance">Finance Staff</SelectItem>
          <SelectItem value="readonly">Read-only Staff</SelectItem>
        </SelectContent>
      </Select>
      <div className="rounded-md border p-1">
        <div className="flex items-center gap-2 rounded bg-secondary/70 px-2 py-2 text-xs text-primary">
          <MoreHorizontal aria-hidden="true" className="size-4" />
          <span className="font-semibold">MHB-1043</span>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {role === 'readonly' ? 'Read-only' : 'Allowed actions'}
          </span>
        </div>
        <div className="mt-1 grid grid-cols-1 gap-0.5 @md/design-preview:grid-cols-2">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => setMessage(`${action}: demo only.`)}
              className={cn(
                'flex items-center gap-2 rounded px-2 py-1.5 text-left text-[10px] hover:bg-muted',
                action === 'Cancel booking' && 'text-destructive',
              )}
            >
              {action === 'View booking' ? (
                <UserRound className="size-3" />
              ) : action === 'Assign room' ? (
                <BedDouble className="size-3" />
              ) : action === 'Download invoice' ? (
                <Download className="size-3" />
              ) : action === 'Review payment' ? (
                <CreditCard className="size-3" />
              ) : action === 'View report' ? (
                <FileText className="size-3" />
              ) : (
                <Check className="size-3" />
              )}
              {action}
            </button>
          ))}
        </div>
      </div>
      {message ? (
        <p role="status" className="text-[10px] text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function DomainTables() {
  return (
    <Card className="gap-4 p-4 @lg/design-preview:p-5">
      <div>
        <h2 className="text-base font-bold">17 · Domain table examples</h2>
        <p className="text-xs text-muted-foreground">
          Compact patterns for inventory, finance, identity and external-provider operations.
        </p>
      </div>
      <div className="grid gap-3 @xl/design-preview:grid-cols-2">
        <DomainExample
          title="Inventory & availability"
          note="Room-type quantities stay separate from physical room-unit assignment."
          headings={['Room type', 'Date', 'Available', 'Blocked', 'Source']}
          rows={[
            ['Deluxe Sea View', 'Oct 20', '4 / 6', '0', 'Clock PMS+'],
            ['Family Suite', 'Oct 20', '0 / 4', '4', 'Manual block'],
            ['Standard Double', 'Oct 21', '7 / 10', '1', 'Clock PMS+'],
          ]}
        />
        <DomainExample
          title="Payments & reconciliation"
          note="Payment truth, refunds and resulting balance are displayed independently."
          headings={['Payment', 'Booking', 'Provider', 'Paid', 'Refunded', 'Status']}
          rows={[
            ['PKP-8842', 'MHB-1042', 'PokPay', '€540', '€0', 'Paid'],
            ['PKP-8843', 'MHB-1043', 'PokPay', '€0', '€0', 'Payment pending'],
            ['PKP-8847', 'MHB-1046', 'PokPay', '€1,890', '€1,890', 'Refunded'],
          ]}
        />
        <DomainExample
          title="Guests & staff"
          note="Guest identity and staff permissions use different fields and visibility rules."
          headings={['Name', 'Type', 'Contact', 'Role / bookings', 'Access']}
          rows={[
            ['Elira Hoxha', 'Guest', 'elira@must.al', '2 bookings', 'Customer'],
            ['Ardit Kola', 'Staff', 'ardit@must.al', 'Booking Agent', 'Bookings'],
            ['Ina Meta', 'Staff', 'ina@must.al', 'Finance Staff', 'Payments'],
          ]}
        />
        <DomainExample
          title="Provider operations"
          note="Clock provider events expose their processing state and last attempt."
          headings={['Operation', 'Provider', 'Environment', 'Status', 'Last attempt']}
          rows={[
            ['Reservation webhook', 'Clock PMS+', 'Sandbox', 'Queued', '11 Oct · 14:22'],
            ['Reservation update', 'Clock PMS+', 'Sandbox', 'Hydrated', '11 Oct · 14:18'],
            ['Webhook recovery', 'Clock PMS+', 'Sandbox', 'Needs reconciliation', '11 Oct · 14:25'],
          ]}
        />
      </div>
    </Card>
  );
}

function LoadingErrorStates() {
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState('');
  return (
    <Card className="gap-4 p-4">
      <div>
        <h2 className="text-base font-bold">18 · Loading & error states</h2>
        <p className="text-xs text-muted-foreground">
          Keep table geometry stable while data is loading, unavailable, or restricted by
          permissions.
        </p>
      </div>
      <div className="grid gap-3 @lg/design-preview:grid-cols-3">
        <div className="space-y-2 rounded-lg border p-3">
          <h3 className="text-xs font-bold">Loading rows</h3>
          <p className="text-[10px] text-muted-foreground">
            Headers, filters and pagination stay visible while row content loads.
          </p>
          {[0, 1, 2].map((row) => (
            <div key={row} className="grid grid-cols-[1fr_1.5fr_1fr] gap-2 py-1">
              <Skeleton className="h-2.5" />
              <Skeleton className="h-2.5" />
              <Skeleton className="h-2.5" />
            </div>
          ))}
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <h3 className="text-xs font-bold">Provider operation failed</h3>
          <p className="text-[10px] text-muted-foreground">
            Rows remain unchanged until a verified provider response succeeds.
          </p>
          <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/20 bg-destructive-surface/50 p-2 text-[10px] text-destructive">
            <span>Clock PMS unavailable · no external write assumed</span>
            <Button
              variant="outline"
              size="sm"
              disabled={retrying}
              onClick={() => {
                setRetrying(true);
                setRetryMessage('Retry queued in this demo.');
                window.setTimeout(() => setRetrying(false), 450);
              }}
            >
              {retrying ? 'Retrying…' : 'Retry'}
            </Button>
          </div>
          {retryMessage ? (
            <p role="status" className="text-[10px] text-muted-foreground">
              {retryMessage}
            </p>
          ) : null}
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <h3 className="text-xs font-bold">Permission-limited table</h3>
          <p className="text-[10px] text-muted-foreground">
            Unsupported finance or provider actions are hidden, not merely greyed out.
          </p>
          <div className="flex items-center justify-between rounded-md bg-muted p-2 text-[10px]">
            <span>Read-only Staff · view bookings and reports only</span>
            <Badge variant="muted">Read-only</Badge>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function DataTablesPage() {
  const [bulkMessage, setBulkMessage] = useState('');
  const [emptyMessage, setEmptyMessage] = useState('');

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 @lg/design-preview:space-y-8">
      <PageHeader
        title="Data Tables"
        description="Booking, inventory, finance and provider operations. Demo data only."
      />

      <section className="space-y-2">
        <h2 className="text-sm font-bold">01 · Bookings table</h2>
        <BookingTableShowcase />
      </section>

      <div className="grid items-start gap-3 @md/design-preview:grid-cols-2 @2xl/design-preview:grid-cols-3">
        <NumberedCard
          number="02"
          title="Booking table header"
          note="Sticky header · clear domain labels · consistent column alignment"
        >
          <TableHeaderSpecimen />
        </NumberedCard>
        <NumberedCard number="03" title="Booking row states" note="Default · hover · selected rows">
          <RowSample label="Default row" />
          <RowSample label="Hovered row" hover />
          <RowSample label="Selected row" selected />
        </NumberedCard>
        <NumberedCard
          number="04"
          title="Sortable booking headers"
          note="Sort indicator · keyboard accessible · stable width"
        >
          <SortSamples />
          <p className="text-[10px] text-muted-foreground">Unsorted · ascending · descending</p>
        </NumberedCard>
      </div>

      <div className="grid items-start gap-3 @md/design-preview:grid-cols-2 @2xl/design-preview:grid-cols-3">
        <NumberedCard
          number="05"
          title="Selection states"
          note="Selection appears only for supported bulk actions"
        >
          <RowSample label="Select row" />
          <RowSample label="Selected row" selected />
          <RowSample label="Disabled row" disabled />
        </NumberedCard>
        <NumberedCard
          number="06"
          title="Expandable booking row"
          note="Expanded content adds booking, guest, payment and provider context"
        >
          <ExpandableRowSample />
        </NumberedCard>
        <NumberedCard
          number="07"
          title="Operational cell variants"
          note="Keep booking, payment, amount, context and provider states distinct"
        >
          <MiniTable>
            <TableHeader>
              <TableRow>
                {['Entity', 'Booking', 'Payment', 'Stay'].map((title) => (
                  <TableHead key={title} className="px-2 py-2 text-[9px]">
                    {title}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="px-2 py-2">MHB-1042</TableCell>
                <TableCell className="px-2 py-2">
                  <StateBadge tone="success">Confirmed</StateBadge>
                </TableCell>
                <TableCell className="px-2 py-2">
                  <StateBadge tone="success">Paid</StateBadge>
                </TableCell>
                <TableCell className="px-2 py-2">
                  <StateBadge tone="info">Upcoming</StateBadge>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="px-2 py-2">MHB-1047</TableCell>
                <TableCell className="px-2 py-2">
                  <StateBadge tone="danger">Payment failed</StateBadge>
                </TableCell>
                <TableCell className="px-2 py-2">
                  <StateBadge tone="danger">Failed</StateBadge>
                </TableCell>
                <TableCell className="px-2 py-2">
                  <StateBadge tone="muted">Not staying</StateBadge>
                </TableCell>
              </TableRow>
            </TableBody>
          </MiniTable>
        </NumberedCard>
      </div>

      <div className="grid items-start gap-3 @md/design-preview:grid-cols-2 @xl/design-preview:grid-cols-3 @2xl/design-preview:grid-cols-5">
        <NumberedCard
          number="08"
          title="Separated status cells"
          note="App booking and payment states stay separate from the Clock event lifecycle"
        >
          <div className="space-y-2">
            {separatedStatusGroups.map(({ label, states }) => (
              <div key={label} className="space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground">{label}</p>
                <div className="flex flex-wrap gap-1">
                  {states.map(([value, tone]) => (
                    <StateBadge key={value} tone={tone}>
                      {value}
                    </StateBadge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </NumberedCard>
        <NumberedCard
          number="09"
          title="Guest / staff cell"
          note="Identity stays stacked and scoped"
        >
          <div className="space-y-3">
            <GuestCell name="Elira Hoxha" email="elira@must.al" type="Guest" />
            <GuestCell name="Ardit Kola" email="Booking Agent" type="Staff" />
            <GuestCell name="Ina Meta" email="Finance Staff" type="Staff" />
          </div>
        </NumberedCard>
        <NumberedCard
          number="10"
          title="Payment / reconciliation cell"
          note="Gross stays neutral; paid, refunded and balance use separate cues"
        >
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Gross</span>
              <span className="font-semibold text-foreground">€540.00</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Paid</span>
              <span className="font-semibold text-success">€540.00</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Refunded</span>
              <span className="font-semibold text-warning">−€130.00</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Balance</span>
              <span className="font-semibold text-primary">€0.00</span>
            </div>
          </div>
        </NumberedCard>
        <NumberedCard
          number="11"
          title="Stay date / time cell"
          note="Date first · stay context below"
        >
          <div className="space-y-2 text-xs">
            <div className="border-b pb-2">
              <p className="font-semibold">Oct 20, 2026</p>
              <p className="text-[10px] text-muted-foreground">2 nights · upcoming</p>
            </div>
            <div>
              <p className="font-semibold">Oct 12, 2026</p>
              <p className="text-[10px] text-muted-foreground">2:00 PM check-in</p>
            </div>
            <div>
              <p className="font-semibold">Oct 17, 2026</p>
              <p className="text-[10px] text-muted-foreground">11:00 AM check-out</p>
            </div>
          </div>
        </NumberedCard>
        <NumberedCard
          number="12"
          title="Permission-aware row actions"
          note="Actions follow role and booking state"
        >
          <PermissionActions />
        </NumberedCard>
      </div>

      <div className="grid items-start gap-3 @md/design-preview:grid-cols-2 @xl/design-preview:grid-cols-4">
        <NumberedCard
          number="13"
          title="Table pagination"
          note="Stable placement · page size · record count"
        >
          <MiniPagination />
        </NumberedCard>
        <NumberedCard
          number="14"
          title="Bookings toolbar"
          note="Search · booking/payment filters · stay dates · columns · export"
        >
          <div className="grid grid-cols-2 gap-1">
            <Button
              variant="outline"
              size="sm"
              className="col-span-2 h-7 justify-start px-2 text-[10px] [&_svg]:size-3"
            >
              <Search aria-hidden="true" />
              Search bookings…
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 justify-between px-2 text-[10px] [&_svg]:size-3"
            >
              Booking <ChevronDown aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 justify-between px-2 text-[10px] [&_svg]:size-3"
            >
              Payment <ChevronDown aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 justify-start px-2 text-[10px] [&_svg]:size-3"
            >
              <CalendarDays aria-hidden="true" />
              Oct 1–31
            </Button>
            <Button
              variant="secondary"
              size="icon-sm"
              aria-label="Columns"
              title="Columns"
              className="size-7"
            >
              <Columns3 aria-hidden="true" className="size-3" />
            </Button>
            <Button
              variant="secondary"
              size="icon-sm"
              aria-label="Export"
              title="Export"
              className="size-7"
            >
              <Download aria-hidden="true" className="size-3" />
            </Button>
            <Button size="sm" className="col-span-2 h-7 px-2 text-[10px] [&_svg]:size-3">
              <Plus aria-hidden="true" />
              Manual booking
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Search · Booking/payment filters · Stay dates · Columns · Export
          </p>
        </NumberedCard>
        <NumberedCard
          number="15"
          title="Role-scoped bulk actions"
          note="Finance and provider actions require different permissions"
        >
          <div className="flex flex-wrap items-center gap-1 rounded-md bg-muted p-1.5">
            <Badge variant="outline" className="px-1.5 py-0 text-[9px]">
              3 selected
            </Badge>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 px-2 text-[10px]"
              onClick={() => setBulkMessage('Bookings confirmed in this demo.')}
            >
              Confirm
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 px-2 text-[10px]"
              onClick={() => setBulkMessage('Room assignment opened in this demo.')}
            >
              Assign
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 px-2 text-[10px]"
              onClick={() => setBulkMessage('CSV export is ready in this demo.')}
            >
              Export
            </Button>
            <Button variant="secondary" size="sm" className="h-7 px-2 text-[10px]">
              More
            </Button>
          </div>
          {bulkMessage ? (
            <p role="status" className="text-[10px] text-muted-foreground">
              {bulkMessage}
            </p>
          ) : null}
          <ul className="space-y-1 text-[10px] text-muted-foreground">
            <li>• Booking Agent example</li>
            <li>• Finance and provider actions require different permissions</li>
          </ul>
        </NumberedCard>
        <NumberedCard
          number="16"
          title="Empty / filtered state"
          note="Reset filters or create a manual booking"
        >
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary">
              <Search aria-hidden="true" className="size-5" />
            </span>
            <p className="text-xs font-bold">No bookings match filters</p>
            <p className="text-[10px] text-muted-foreground">
              Reset filters or create a manual booking.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEmptyMessage('Filters reset in this demo.')}
              >
                Reset filters
              </Button>
              <Button size="sm" onClick={() => setEmptyMessage('Manual booking is a demo action.')}>
                <Plus />
                Manual booking
              </Button>
            </div>
            {emptyMessage ? (
              <p role="status" className="text-[10px] text-muted-foreground">
                {emptyMessage}
              </p>
            ) : null}
          </div>
        </NumberedCard>
      </div>

      <DomainTables />
      <LoadingErrorStates />

      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-sm font-bold">Design rules & guidelines</h2>
          <div className="grid w-full gap-3 @md/design-preview:grid-cols-3 @2xl/design-preview:grid-cols-6">
            {[
              { icon: Columns3, title: 'Row height', text: '50px default' },
              { icon: BedDouble, title: 'Spacing scale', text: '4px base' },
              { icon: Table2, title: 'Border radius', text: '8px cards · 6px controls' },
              { icon: Filter, title: 'Borders', text: 'Semantic dividers' },
              { icon: Check, title: 'Status domains', text: 'Booking · Payment · Stay · Provider' },
              { icon: ShieldCheck, title: 'Permission safety', text: 'Hide unsupported actions' },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex items-center gap-2 rounded-md bg-muted/60 p-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-primary">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <span>
                  <span className="block text-[10px] font-semibold">{title}</span>
                  <span className="block text-[9px] text-muted-foreground">{text}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
