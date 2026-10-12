'use client';

import Link from 'next/link';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  BedDouble,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  ExternalLink,
  FileClock,
  Hotel,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';

import { Badge } from '../_ui/badge';
import { Button } from '../_ui/button';
import { Card } from '../_ui/card';
import {
  CalendarPicker,
  type CalendarSelection,
  formatCalendarSelection,
} from '../_ui/demo-calendar';
import { Input } from '../_ui/input';
import { Label } from '../_ui/label';
import { BookingStatusBadge, ChannelBadge, PaymentStatusBadge } from '../_ui/hotel';
import { Popover, PopoverContent, PopoverTrigger } from '../_ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../_ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../_ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../_ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../_ui/dialog';
import { useDesignPreviewContext } from '../design-shell';
import { defaultPhoneCountryCodeId, phoneCountryCodes } from '../_lib/phone-country-codes';

type OverviewTab = 'overview' | 'attention' | 'approvals' | 'quick-booking' | 'system-health';
type Tone = 'success' | 'info' | 'warning' | 'danger' | 'muted';

type Metric = {
  label: string;
  value: string;
  context: string;
  delta: string;
  comparison: string;
  icon: LucideIcon;
  tone: Tone;
  deltaVariant: 'success' | 'secondary' | 'warning' | 'danger' | 'info';
  trend: number[];
};

const metricTones: Record<Tone, { icon: string; bars: string }> = {
  success: { icon: 'bg-success-surface text-success', bars: 'bg-success/60' },
  info: { icon: 'bg-info-surface text-info', bars: 'bg-info/60' },
  warning: { icon: 'bg-warning-surface text-warning', bars: 'bg-warning/70' },
  danger: { icon: 'bg-destructive-surface text-destructive', bars: 'bg-destructive/60' },
  muted: { icon: 'bg-muted text-muted-foreground', bars: 'bg-muted-foreground/40' },
};

const metrics: Metric[] = [
  {
    label: 'Arrivals today',
    value: '4',
    context: '12 guests',
    delta: '+1',
    comparison: 'vs yesterday',
    icon: CalendarCheck,
    tone: 'success',
    deltaVariant: 'success',
    trend: [22, 34, 30, 49, 43, 58, 72],
  },
  {
    label: 'Departures today',
    value: '3',
    context: '8 guests',
    delta: '−1',
    comparison: 'vs yesterday',
    icon: ArrowRight,
    tone: 'info',
    deltaVariant: 'secondary',
    trend: [36, 40, 29, 53, 45, 62, 48],
  },
  {
    label: 'In house now',
    value: '14',
    context: '34 guests',
    delta: '+3',
    comparison: 'since start of day',
    icon: Users,
    tone: 'info',
    deltaVariant: 'success',
    trend: [43, 48, 56, 54, 64, 70, 76],
  },
  {
    label: 'Occupancy tonight',
    value: '78%',
    context: '21 / 27 units',
    delta: '+5.4%',
    comparison: 'vs same day last week',
    icon: BedDouble,
    tone: 'success',
    deltaVariant: 'success',
    trend: [46, 52, 49, 62, 66, 73, 78],
  },
  {
    label: 'Needs review',
    value: '6',
    context: '2 new',
    delta: '2 new',
    comparison: 'added today',
    icon: ClipboardList,
    tone: 'warning',
    deltaVariant: 'warning',
    trend: [30, 40, 38, 51, 46, 61, 74],
  },
  {
    label: 'Payment follow-up',
    value: '3',
    context: '€920 due',
    delta: '2 urgent',
    comparison: '€920 outstanding',
    icon: CircleDollarSign,
    tone: 'danger',
    deltaVariant: 'danger',
    trend: [78, 68, 65, 53, 48, 42, 36],
  },
  {
    label: 'Payments received',
    value: '€4,800',
    context: '6 payments',
    delta: '+12.5%',
    comparison: 'vs same weekday last week',
    icon: CreditCard,
    tone: 'info',
    deltaVariant: 'success',
    trend: [28, 40, 35, 50, 57, 66, 79],
  },
  {
    label: 'Unavailable inventory',
    value: '5',
    context: '3 manual · 2 maintenance',
    delta: '3 manual',
    comparison: '2 maintenance',
    icon: Wrench,
    tone: 'muted',
    deltaVariant: 'secondary',
    trend: [42, 38, 55, 52, 70, 58, 48],
  },
];

type MetricValue = Pick<Metric, 'value' | 'context' | 'delta' | 'comparison'>;

const hotelMetricOverrides: Record<
  string,
  Partial<Record<Metric['label'], Partial<MetricValue>>>
> = {
  all: {
    'Arrivals today': { value: '11', context: '28 guests', delta: '+3' },
    'Departures today': { value: '7', context: '18 guests', delta: '−2' },
    'In house now': { value: '38', context: '94 guests', delta: '+8' },
    'Occupancy tonight': {
      value: '74%',
      context: '62 / 84 units',
      delta: '+3.1%',
    },
    'Needs review': {
      value: '4',
      context: '2 bookings · 2 payments',
      delta: '1 urgent',
      comparison: '3 need review',
    },
    'Payment follow-up': {
      value: '2',
      context: '2 payment records',
      delta: '1 urgent',
      comparison: '1 failed · 1 partial',
    },
    'Payments received': {
      value: '€12,460',
      context: '15 payments',
      delta: '+8.8%',
    },
    'Unavailable inventory': {
      value: '11',
      context: '7 manual · 4 maintenance',
      delta: '7 manual',
      comparison: '4 maintenance',
    },
  },
  marina: {
    'Arrivals today': { value: '3', context: '8 guests' },
    'Departures today': { value: '2', context: '5 guests' },
    'In house now': { value: '9', context: '22 guests' },
    'Occupancy tonight': { value: '72%', context: '18 / 25 units', delta: '+2.5%' },
    'Needs review': { value: '3', context: '1 new', delta: '1 new' },
    'Payment follow-up': {
      value: '2',
      context: '€560 due',
      delta: '1 urgent',
      comparison: '€560 outstanding',
    },
    'Payments received': { value: '€3,100', context: '4 payments' },
    'Unavailable inventory': {
      value: '3',
      context: '2 manual · 1 maintenance',
      delta: '2 manual',
      comparison: '1 maintenance',
    },
  },
  'old-town': {
    'Arrivals today': { value: '4', context: '8 guests' },
    'Departures today': { value: '2', context: '5 guests' },
    'In house now': { value: '15', context: '38 guests' },
    'Occupancy tonight': { value: '69%', context: '22 / 32 units', delta: '+1.8%' },
    'Needs review': { value: '2', context: '1 new', delta: '1 new' },
    'Payment follow-up': {
      value: '2',
      context: '€860 due',
      delta: '1 urgent',
      comparison: '€860 outstanding',
    },
    'Payments received': { value: '€4,560', context: '5 payments' },
    'Unavailable inventory': {
      value: '3',
      context: '2 manual · 1 maintenance',
      delta: '2 manual',
      comparison: '1 maintenance',
    },
  },
};

function metricsForHotel(hotel: string) {
  const overrides = hotelMetricOverrides[hotel];
  return metrics.map((metric) => ({ ...metric, ...overrides?.[metric.label] }));
}

const operationsSummaryByHotel: Record<string, string> = {
  all: '11 arrivals · 7 departures · 38 guests in house. Review today’s exceptions and keep bookings moving.',
  empire:
    '4 arrivals · 3 departures · 14 guests in house. Review today’s exceptions and keep bookings moving.',
  marina:
    '3 arrivals · 2 departures · 9 guests in house. Review today’s exceptions and keep bookings moving.',
  'old-town':
    '4 arrivals · 2 departures · 15 guests in house. Review today’s exceptions and keep bookings moving.',
};

const reservations = [
  {
    guest: 'Elira Hoxha',
    reference: 'MHB-1088',
    property: 'Empire Beach Resort',
    room: 'Room 204 · Deluxe Sea View',
    stay: 'Today · 3 nights',
    booking: 'confirmed' as const,
    payment: 'paid' as const,
    amount: '€540',
    channel: 'website' as const,
  },
  {
    guest: 'Ardit Kola',
    reference: 'MHB-1089',
    property: 'Empire Beach Resort',
    room: 'Room 208 · Deluxe Sea View',
    stay: 'Today · 5 nights',
    booking: 'pending' as const,
    payment: 'unpaid' as const,
    amount: '€920',
    channel: 'clock' as const,
  },
  {
    guest: 'Sara Dervishi',
    reference: 'MHB-1090',
    property: 'Marina Bay Hotel',
    room: 'Room 108 · Standard Room',
    stay: 'Tomorrow · 2 nights',
    booking: 'confirmed' as const,
    payment: 'paid' as const,
    amount: '€260',
    channel: 'website' as const,
  },
  {
    guest: 'Noel Berisha',
    reference: 'MHB-1091',
    property: 'Old Town Suites',
    room: 'Suite 301 · Family Suite',
    stay: '24 Oct · 4 nights',
    booking: 'pending' as const,
    payment: 'unpaid' as const,
    amount: '€680',
    channel: 'walk-in' as const,
  },
  {
    guest: 'Luan Gashi',
    reference: 'MHB-1092',
    property: 'Empire Beach Resort',
    room: 'Room 312 · Deluxe Sea View',
    stay: 'Tomorrow · 2 nights',
    booking: 'confirmed' as const,
    payment: 'partial' as const,
    amount: '€380',
    channel: 'booking' as const,
  },
  {
    guest: 'Mira Kola',
    reference: 'MHB-1093',
    property: 'Marina Bay Hotel',
    room: 'Room 110 · Standard Room',
    stay: '26 Oct · 1 night',
    booking: 'confirmed' as const,
    payment: 'paid' as const,
    amount: '€145',
    channel: 'website' as const,
  },
  {
    guest: 'Drita Leka',
    reference: 'MHB-1094',
    property: 'Old Town Suites',
    room: 'Suite 305 · Family Suite',
    stay: '27 Oct · 3 nights',
    booking: 'pending' as const,
    payment: 'failed' as const,
    amount: '€720',
    channel: 'airbnb' as const,
  },
  {
    guest: 'Bledi Hysa',
    reference: 'MHB-1095',
    property: 'Empire Beach Resort',
    room: 'Room 406 · Deluxe Sea View',
    stay: '28 Oct · 4 nights',
    booking: 'confirmed' as const,
    payment: 'paid' as const,
    amount: '€960',
    channel: 'clock' as const,
  },
];

type AttentionIssue = {
  id: string;
  category: 'booking' | 'payment';
  priority: 'urgent' | 'review';
  issue: string;
  context: string;
  recommendedAction: string;
  reservation: (typeof reservations)[number];
};

const attentionItems: AttentionIssue[] = reservations.flatMap((reservation): AttentionIssue[] => {
  const issues: AttentionIssue[] = [];

  if (reservation.booking === 'pending') {
    issues.push({
      id: `${reservation.reference}-booking`,
      category: 'booking',
      priority: 'review',
      issue: 'Reservation awaiting review',
      context: `Booking is pending · ${reservation.amount} booking total`,
      recommendedAction:
        'Review the reservation details and payment status before confirming the booking.',
      reservation,
    });
  }

  if (reservation.payment === 'failed') {
    issues.push({
      id: `${reservation.reference}-payment`,
      category: 'payment',
      priority: 'urgent',
      issue: 'Payment failed',
      context: `Payment status is failed · ${reservation.amount} booking total`,
      recommendedAction:
        'Review the payment record and provider result before updating the reservation payment state.',
      reservation,
    });
  } else if (reservation.payment === 'partial') {
    issues.push({
      id: `${reservation.reference}-payment`,
      category: 'payment',
      priority: 'review',
      issue: 'Partial payment to review',
      context: `Payment status is partial · ${reservation.amount} booking total`,
      recommendedAction:
        'Check the recorded payment against the reservation terms and confirm the remaining balance with the guest.',
      reservation,
    });
  } else if (reservation.payment === 'unpaid') {
    issues.push({
      id: `${reservation.reference}-payment`,
      category: 'payment',
      priority: 'review',
      issue: 'Payment not received',
      context: `Payment is unpaid · ${reservation.amount} booking total`,
      recommendedAction:
        'Check the reservation payment terms and follow up before the stay is confirmed.',
      reservation,
    });
  }

  return issues;
});

const attentionQueues: {
  label: string;
  detail: string;
  count: number;
  icon: LucideIcon;
  tone: Tone;
}[] = [
  {
    label: 'Booking review',
    detail: 'Pending reservation records',
    count: attentionItems.filter((item) => item.category === 'booking').length,
    icon: CalendarCheck,
    tone: 'warning',
  },
  {
    label: 'Payment follow-up',
    detail: 'Unpaid, partial or failed payment states',
    count: attentionItems.filter((item) => item.category === 'payment').length,
    icon: CreditCard,
    tone: 'danger',
  },
];

const healthRows: {
  label: string;
  detail: string;
  status: string;
  variant: 'success' | 'warning' | 'danger';
  icon: LucideIcon;
}[] = [
  {
    label: 'Public booking flow',
    detail: 'Accepting reservations',
    status: 'Healthy',
    variant: 'success',
    icon: ClipboardList,
  },
  {
    label: 'PokPay API + callback',
    detail: 'Last sample event · 1m ago',
    status: 'Healthy',
    variant: 'success',
    icon: CreditCard,
  },
  {
    label: 'Clock PMS+ connection',
    detail: 'Sandbox connection',
    status: 'Healthy',
    variant: 'success',
    icon: BedDouble,
  },
  {
    label: 'Reservation synchronization',
    detail: 'Last success · 12m ago',
    status: 'Delayed 12m',
    variant: 'warning',
    icon: RefreshCw,
  },
  {
    label: 'Payment → folio accounting',
    detail: 'One sample event needs review',
    status: '1 failed',
    variant: 'danger',
    icon: FileClock,
  },
  {
    label: 'WordPress scheduled jobs',
    detail: 'Last run · 2m ago',
    status: 'Healthy',
    variant: 'success',
    icon: Activity,
  },
];

const activities: {
  time: string;
  title: string;
  detail: string;
  status: string;
  variant: 'success' | 'info' | 'warning';
  icon: LucideIcon;
}[] = [
  {
    time: '14:42',
    title: 'Payment confirmed',
    detail: 'PokPay payment recorded for MHB-1088 · €540',
    status: 'Paid',
    variant: 'success',
    icon: Check,
  },
  {
    time: '14:41',
    title: 'Reservation created',
    detail: 'Elira Hoxha · Deluxe Sea View · 3 nights',
    status: 'Created',
    variant: 'info',
    icon: CalendarPlus,
  },
  {
    time: '13:18',
    title: 'Availability blocked',
    detail: 'Deluxe Sea View · 22 Oct · maintenance block',
    status: 'Updated',
    variant: 'warning',
    icon: Wrench,
  },
  {
    time: '12:54',
    title: 'Clock sync delayed',
    detail: 'Reservation synchronization is 12 minutes behind',
    status: 'Review',
    variant: 'warning',
    icon: RefreshCw,
  },
  {
    time: '11:36',
    title: 'Guest details updated',
    detail: 'Mira Kola added a phone number to MHB-1089',
    status: 'Updated',
    variant: 'info',
    icon: UserRound,
  },
];

type ApprovalStatus = 'pending' | 'approved' | 'declined';

const sampleApprovals = [
  {
    guest: 'Ardit Kola',
    reference: 'MHB-1089',
    request: 'Late checkout · 12:00 → 14:00',
    submitted: '09:12',
    property: 'Empire Beach Resort',
    details: 'The guest asks to keep the room until 14:00 on departure day.',
    recommendation: 'Check the room schedule before confirming the later checkout.',
  },
  {
    guest: 'Sara Dervishi',
    reference: 'MHB-1090',
    request: 'Room change · Deluxe Sea View',
    submitted: '08:44',
    property: 'Marina Bay Hotel',
    details: 'The guest asks to move from the current Standard Room to a Deluxe Sea View.',
    recommendation: 'Confirm room availability and any price difference before approving.',
  },
];

const weekLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const quickBookingRooms = [
  {
    id: 'deluxe',
    name: 'Deluxe Sea View',
    count: 3,
    rate: 220,
    capacity: 3,
    roomNumbers: ['204', '208', '312'],
    description: 'Sea view · Balcony · 28 m²',
  },
  {
    id: 'suite',
    name: 'Family Suite',
    count: 1,
    rate: 280,
    capacity: 5,
    roomNumbers: ['301'],
    description: 'Family layout · Separate living area · 42 m²',
  },
  {
    id: 'standard',
    name: 'Standard Double',
    count: 5,
    rate: 160,
    capacity: 3,
    roomNumbers: ['110', '112', '206', '210', '214'],
    description: 'Courtyard view · 22 m²',
  },
] as const;

type QuickBookingRoomId = (typeof quickBookingRooms)[number]['id'];

function stayNightCount(dates: CalendarSelection) {
  if (!dates.start || !dates.end) return 0;
  const toUtcDay = (date: string) => {
    const [year, month, day] = date.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.max(0, Math.round((toUtcDay(dates.end) - toUtcDay(dates.start)) / 86_400_000));
}

function euroAmount(amount: number) {
  return `€${amount.toLocaleString('en-GB')}`;
}

function QuantityStepper({
  label,
  value,
  minimum,
  maximum,
  onChange,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex h-10 items-center justify-between rounded-lg border bg-card p-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={value <= minimum}
          onClick={() => onChange(Math.max(minimum, value - 1))}
        >
          <Minus aria-hidden="true" />
        </Button>
        <output
          aria-live="polite"
          className="min-w-8 text-center text-sm font-semibold tabular-nums"
        >
          {value}
        </output>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={value >= maximum}
          onClick={() => onChange(Math.min(maximum, value + 1))}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function PhoneCountryCodePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (countryId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected =
    phoneCountryCodes.find((country) => country.id === value) ??
    phoneCountryCodes.find((country) => country.id === defaultPhoneCountryCodeId)!;
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const digits = search.replace(/\D/g, '');
  const filteredCountries = phoneCountryCodes.filter((country) => {
    if (!normalizedSearch) return true;
    const searchableText =
      `${country.name} ${country.id} ${country.callingCode} ${(country.searchPrefixes ?? []).join(' ')}`.toLocaleLowerCase();
    const searchableNumbers = [country.callingCode, ...(country.searchPrefixes ?? [])].map((code) =>
      code.replace(/\D/g, ''),
    );
    return (
      searchableText.includes(normalizedSearch) ||
      (digits.length > 0 && searchableNumbers.some((code) => code.includes(digits)))
    );
  });

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label="Phone country code"
          aria-expanded={open}
          className="h-10 w-32 shrink-0 justify-between bg-card px-3"
        >
          <span className="truncate">
            {selected.callingCode} · {selected.id}
          </span>
          <ChevronDown aria-hidden="true" className="size-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] space-y-2 p-2">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search countries or calling codes"
            autoComplete="off"
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search country or code"
            className="pl-9"
          />
        </div>
        <div role="listbox" aria-label="Phone country codes" className="max-h-64 overflow-y-auto">
          {filteredCountries.map((country) => {
            const isSelected = country.id === selected.id;
            return (
              <button
                key={country.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(country.id);
                  setOpen(false);
                }}
                className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${isSelected ? 'bg-accent/70 font-semibold' : ''}`}
              >
                <span className="min-w-0 truncate">{country.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {country.callingCode}
                </span>
              </button>
            );
          })}
          {filteredCountries.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No country or calling code found.
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MetricSparkline({ metric }: { metric: Metric }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const peak = Math.max(...metric.trend);
  const activeValue = activeIndex === null ? null : metric.trend[activeIndex];

  return (
    <div className="rounded-lg bg-muted/70 p-2.5">
      <div className="mb-2 flex items-center justify-between text-[10px] font-medium text-muted-foreground">
        <span>7-day trend</span>
        <span>
          {activeIndex === null
            ? 'Hover or focus a bar'
            : `${weekLabels[activeIndex]} · ${activeValue}`}
        </span>
      </div>
      <div
        role="group"
        aria-label={`${metric.label} sample trend`}
        className="flex h-8 items-end gap-1"
      >
        {metric.trend.map((value, index) => {
          const active = activeIndex === index;
          return (
            <button
              key={metric.label + '-' + index}
              type="button"
              aria-label={`${weekLabels[index]}, ${metric.label}: ${value}`}
              title={`${weekLabels[index]} · ${metric.label}: ${value}`}
              onPointerEnter={() => setActiveIndex(index)}
              onPointerLeave={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
              className={`min-w-0 flex-1 rounded-t-sm outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring ${toneClass(metric.tone, active)}`}
              style={{ height: `${Math.max(14, Math.round((value / peak) * 100))}%` }}
            />
          );
        })}
      </div>
      <p className="sr-only" aria-live="polite">
        {activeIndex === null
          ? `${metric.label} sample values for seven days.`
          : `${weekLabels[activeIndex]}: ${activeValue}.`}
      </p>
    </div>
  );
}

function toneClass(tone: Tone, active: boolean) {
  const base = metricTones[tone].bars;
  return active ? `${base} scale-y-110 brightness-90` : base;
}

function MetricCard({ metric }: { metric: Metric }) {
  const Icon = metric.icon;
  const tone = metricTones[metric.tone];

  return (
    <Card className="min-w-0 gap-3 px-4 py-4 transition-shadow hover:shadow-sm sm:px-5">
      <div className="w-full text-left">
        <span className="flex items-start justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              className={'flex size-9 shrink-0 items-center justify-center rounded-lg ' + tone.icon}
            >
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <span className="min-w-0 text-sm font-semibold leading-tight">{metric.label}</span>
          </span>
          <Badge variant="muted" className="max-w-[45%] truncate text-[10px]">
            {metric.context}
          </Badge>
        </span>
        <span className="mt-3 block text-3xl font-extrabold tracking-tight tabular-nums">
          {metric.value}
        </span>
        <span className="mt-2 flex min-h-6 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={metric.deltaVariant}>{metric.delta}</Badge>
          <span>{metric.comparison}</span>
        </span>
      </div>
      <MetricSparkline metric={metric} />
    </Card>
  );
}

function PanelHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h3 className="text-base font-bold">{title}</h3>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

function OverviewHero({
  dashboardName,
  summary,
  onAddReservation,
  onOpenCalendar,
  onViewReservations,
}: {
  dashboardName: string;
  summary: string;
  onAddReservation: () => void;
  onOpenCalendar: () => void;
  onViewReservations: () => void;
}) {
  return (
    <Card className="gap-5 p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
        <div className="max-w-2xl space-y-2">
          <p className="text-xs font-bold tracking-wide text-primary uppercase">
            {dashboardName} · Today
          </p>
          <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Today at a glance</h2>
          <p className="text-sm text-muted-foreground">{summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={onAddReservation}>
            <CalendarPlus aria-hidden="true" />
            Add reservation
          </Button>
          <Button type="button" variant="secondary" onClick={onOpenCalendar}>
            <CalendarDays aria-hidden="true" />
            Open calendar
          </Button>
          <Button type="button" variant="ghost" onClick={onViewReservations}>
            View reservations
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Badge variant="success">
          <CheckCircle2 aria-hidden="true" />
          Local · 2m
        </Badge>
        <Badge variant="warning">
          <CircleAlert aria-hidden="true" />
          {attentionItems.length} need attention
        </Badge>
        <Badge variant="info">
          <RefreshCw aria-hidden="true" />
          Clock · 12m behind
        </Badge>
        <Badge variant="outline">
          <CreditCard aria-hidden="true" />
          PokPay · 1m
        </Badge>
      </div>
    </Card>
  );
}

function RecentReservations() {
  const [query, setQuery] = useState('');
  const [bookingFilter, setBookingFilter] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const [sortByTotal, setSortByTotal] = useState(false);
  const [sortAscending, setSortAscending] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<(typeof reservations)[number] | null>(null);
  const pageSize = 4;
  const filtered = reservations
    .filter((reservation) => {
      const value =
        `${reservation.guest} ${reservation.reference} ${reservation.property} ${reservation.room}`.toLowerCase();
      return (
        value.includes(query.toLowerCase()) &&
        (bookingFilter === 'all' || reservation.booking === bookingFilter)
      );
    })
    .sort((left, right) => {
      if (!sortByTotal) return 0;
      const leftAmount = Number(left.amount.replace(/[^0-9.]/g, ''));
      const rightAmount = Number(right.amount.replace(/[^0-9.]/g, ''));
      return sortAscending ? leftAmount - rightAmount : rightAmount - leftAmount;
    });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = showAll
    ? filtered.slice(page * pageSize, (page + 1) * pageSize)
    : filtered.slice(0, pageSize);

  return (
    <Card id="recent-reservations" className="min-w-0 scroll-mt-24 gap-4 p-4 sm:p-5">
      <PanelHeading
        title="Recent reservations"
        subtitle="Search, filter, sort totals and open a sample reservation record."
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowAll((value) => !value);
              setPage(0);
            }}
          >
            {showAll ? 'Show recent' : `View all ${reservations.length}`}
            <ArrowRight aria-hidden="true" />
          </Button>
        }
      />
      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-48 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="Search guest, reference or room"
            aria-label="Search reservations"
            className="pl-9"
          />
        </label>
        <label>
          <span className="sr-only">Booking status</span>
          <select
            value={bookingFilter}
            onChange={(event) => {
              setBookingFilter(event.target.value);
              setPage(0);
            }}
            className="h-9 rounded-md border bg-card px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="all">All bookings</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
          </select>
        </label>
      </div>
      <Table className="min-w-[660px]">
        <caption className="sr-only">Illustrative recent reservation records</caption>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-2">Guest</TableHead>
            <TableHead>Room · stay</TableHead>
            <TableHead>Booking</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead className="text-right">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  setSortByTotal(true);
                  setSortAscending((value) => !value);
                }}
                aria-label={`Sort totals ${sortAscending ? 'high to low' : 'low to high'}`}
              >
                Total <ArrowUpDown aria-hidden="true" className="size-3" />
              </button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.length ? (
            pageRows.map((reservation) => (
              <TableRow
                key={reservation.reference}
                className={
                  selected?.reference === reservation.reference
                    ? 'bg-muted/70'
                    : 'hover:bg-muted/40'
                }
              >
                <TableCell className="pl-2">
                  <div className="space-y-1">
                    <button
                      type="button"
                      className="text-left font-semibold text-primary hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setSelected(reservation)}
                    >
                      {reservation.guest}
                    </button>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {reservation.reference}
                    </p>
                    <ChannelBadge channel={reservation.channel} />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-40 space-y-1 whitespace-normal">
                    <p className="font-medium">{reservation.room}</p>
                    <p className="text-xs text-muted-foreground">{reservation.stay}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <BookingStatusBadge status={reservation.booking} />
                </TableCell>
                <TableCell>
                  <PaymentStatusBadge status={reservation.payment} />
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {reservation.amount}
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                No sample reservations match these filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {showAll ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span>
            {filtered.length} matching reservations · page {page + 1} of {pageCount}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
      {selected ? (
        <div className="rounded-xl border bg-muted/30 p-4" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">
                {selected.guest} · {selected.reference}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {selected.property} · {selected.stay} · {selected.amount}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <BookingStatusBadge status={selected.booking} />
              <PaymentStatusBadge status={selected.payment} />
            </div>
          </div>
          <p className="mt-3 text-xs text-info">
            Illustrative reservation details. No booking or payment state was changed.
          </p>
        </div>
      ) : null}
    </Card>
  );
}

function NeedsAttention({ onOpen }: { onOpen: (tab: OverviewTab) => void }) {
  const total = attentionQueues.reduce((sum, queue) => sum + queue.count, 0);

  return (
    <Card className="gap-4 p-4 sm:p-5">
      <PanelHeading
        title="Needs attention"
        subtitle="Review bookings and payment records that need follow-up."
        action={<Badge variant="warning">{total} open</Badge>}
      />
      <div className="space-y-2">
        {attentionQueues.map((queue) => {
          const Icon = queue.icon;
          const tone = metricTones[queue.tone];
          return (
            <button
              key={queue.label}
              type="button"
              onClick={() => onOpen('attention')}
              className="flex min-h-12 w-full items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span
                className={
                  'flex size-8 shrink-0 items-center justify-center rounded-md ' + tone.icon
                }
              >
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{queue.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{queue.detail}</span>
              </span>
              <span className="font-semibold tabular-nums">{queue.count}</span>
              <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
            </button>
          );
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        className="justify-start px-0"
        onClick={() => onOpen('attention')}
      >
        Open operations queue
        <ArrowRight aria-hidden="true" />
      </Button>
    </Card>
  );
}

function HealthPanel({ expanded = false }: { expanded?: boolean }) {
  return (
    <Card className="gap-4 p-4 sm:p-5">
      <PanelHeading
        title="System health"
        subtitle="Sample booking, payment and provider checks."
        action={<Badge variant="warning">Degraded</Badge>}
      />
      <div className="divide-y">
        {healthRows.slice(0, expanded ? healthRows.length : 6).map((row) => {
          const Icon = row.icon;
          return (
            <div key={row.label} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.label}</p>
                <p className="truncate text-[11px] text-muted-foreground">{row.detail}</p>
              </div>
              <Badge variant={row.variant}>{row.status}</Badge>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RecentActivity({ className }: { className?: string }) {
  return (
    <Card className={`gap-4 p-4 sm:p-5 ${className ?? ''}`}>
      <PanelHeading
        title="Recent activity · Today"
        subtitle="Latest sample booking, payment, staff and provider events."
        action={
          <Button asChild size="sm" variant="ghost">
            <Link href="/design/timeline">
              View activity log
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <Badge variant="muted">5 events</Badge>
        <Badge variant="warning">1 needs attention</Badge>
        <span className="ml-auto text-xs text-muted-foreground">Updated 2m ago</span>
      </div>
      <ol className="divide-y xl:flex xl:flex-1 xl:flex-col xl:justify-evenly">
        {activities.map((event) => {
          const Icon = event.icon;
          return (
            <li key={event.title} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span
                className={
                  'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ' +
                  (event.variant === 'success'
                    ? 'bg-success-surface text-success'
                    : event.variant === 'warning'
                      ? 'bg-warning-surface text-warning'
                      : 'bg-info-surface text-info')
                }
              >
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{event.title}</p>
                <p className="text-xs text-muted-foreground">{event.detail}</p>
              </div>
              <time className="shrink-0 pt-0.5 text-xs text-muted-foreground">{event.time}</time>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <Button asChild variant="link" size="sm" className="h-auto px-0">
          <Link href="/design/timeline">Open full activity timeline</Link>
        </Button>
        <span className="text-xs text-muted-foreground">Showing 5 of 18 sample events</span>
      </div>
    </Card>
  );
}

function QuickActions({ onSelect }: { onSelect: (tab: OverviewTab) => void }) {
  const paymentIssueCount = attentionItems.filter((item) => item.category === 'payment').length;

  return (
    <Card className="gap-4 p-4 sm:p-5">
      <PanelHeading title="Quick actions" subtitle="Fast routes for today’s hotel operations." />
      <div className="space-y-2">
        <p className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
          Priority
        </p>
        <button
          type="button"
          onClick={() => onSelect('attention')}
          className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-destructive/20 bg-destructive-surface/40 px-3 py-2 text-left hover:bg-destructive-surface/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-card text-destructive">
            <CreditCard aria-hidden="true" className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Review payment issues</span>
            <span className="block text-xs text-muted-foreground">
              {paymentIssueCount} payments need follow-up
            </span>
          </span>
          <Badge variant="danger">{paymentIssueCount}</Badge>
          <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
        </button>
        <button
          type="button"
          onClick={() => onSelect('system-health')}
          className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-warning/30 bg-warning-surface/40 px-3 py-2 text-left hover:bg-warning-surface/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-card text-warning">
            <RefreshCw aria-hidden="true" className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Review provider status</span>
            <span className="block text-xs text-muted-foreground">1 Clock operation delayed</span>
          </span>
          <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
        </button>
      </div>
      <div className="space-y-2">
        <p className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
          Common
        </p>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between"
          onClick={() => onSelect('quick-booking')}
        >
          <span className="flex items-center gap-2">
            <CalendarPlus aria-hidden="true" />
            Create reservation
          </span>
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button asChild variant="outline" className="w-full justify-between">
          <Link href="/design/forms">
            <span className="flex items-center gap-2">
              <CalendarDays aria-hidden="true" />
              Block availability
            </span>
            <ChevronRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </Card>
  );
}

function QuickBookingWorkspace({
  calendarOpen,
  onCalendarOpenChange,
}: {
  calendarOpen: boolean;
  onCalendarOpenChange: (open: boolean) => void;
}) {
  const [feedback, setFeedback] = useState<{ text: string; available: boolean } | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingStep, setBookingStep] = useState<1 | 2 | 3>(1);
  const [bookingCreated, setBookingCreated] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestPhonePrefix, setGuestPhonePrefix] = useState('+355');
  const [childAges, setChildAges] = useState(['7 years']);
  const [stayDates, setStayDates] = useState<CalendarSelection>({
    start: '2026-10-20',
    end: '2026-10-23',
  });
  const [roomType, setRoomType] = useState('deluxe');
  const [roomNumber, setRoomNumber] = useState('204');
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState('pay-at-hotel');
  const [paymentStatus, setPaymentStatus] = useState('unpaid');
  const [amountCollected, setAmountCollected] = useState('0');
  const [availability, setAvailability] = useState<{
    roomName: string;
    nights: number;
    rate: number;
    total: number;
  } | null>(null);

  const roomOptions = {
    any: {
      name: 'Deluxe Sea View',
      count: 3,
      rate: 220,
      capacity: 3,
      rooms: ['204', '208', '312'],
    },
    deluxe: {
      name: 'Deluxe Sea View',
      count: 3,
      rate: 220,
      capacity: 3,
      rooms: ['204', '208', '312'],
    },
    standard: {
      name: 'Standard Double',
      count: 5,
      rate: 160,
      capacity: 3,
      rooms: ['110', '112', '206', '210', '214'],
    },
    suite: { name: 'Family Suite', count: 1, rate: 280, capacity: 5, rooms: ['301'] },
  } as const;
  const selectedRoomOption =
    roomOptions[roomType as keyof typeof roomOptions] ?? roomOptions.deluxe;

  function clearBookingResult() {
    setFeedback(null);
    setAvailability(null);
    setBookingCreated(false);
  }

  function openBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearBookingResult();
    setBookingStep(1);
    onCalendarOpenChange(false);
    setBookingOpen(true);
  }

  function checkAvailability() {
    setFeedback(null);
    setAvailability(null);
    if (!stayDates.start || !stayDates.end) {
      setFeedback({
        text: 'Choose both check-in and check-out dates to see available rooms.',
        available: false,
      });
      return false;
    }
    const start = new Date(`${stayDates.start}T00:00:00`);
    const end = new Date(`${stayDates.end}T00:00:00`);
    const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    if (nights <= 0) {
      setFeedback({
        text: 'Check-out must be at least one night after check-in.',
        available: false,
      });
      return false;
    }
    if (adults + children > selectedRoomOption.capacity) {
      setFeedback({
        text: `${selectedRoomOption.name} fits up to ${selectedRoomOption.capacity} guests. Adjust the party or choose a larger room.`,
        available: false,
      });
      return false;
    }
    const total = selectedRoomOption.rate * nights;
    setAvailability({
      roomName: selectedRoomOption.name,
      nights,
      rate: selectedRoomOption.rate,
      total,
    });
    setFeedback({
      text: `${selectedRoomOption.count} ${selectedRoomOption.name} rooms match these dates.`,
      available: true,
    });
    return true;
  }

  function continueBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (bookingStep === 1) {
      if (checkAvailability()) setBookingStep(2);
      return;
    }
    if (bookingStep === 2) {
      if (!guestName.trim()) {
        setFeedback({ text: 'Enter the lead guest’s full name.', available: false });
        return;
      }
      if (!guestEmail.trim() && !guestPhone.trim()) {
        setFeedback({
          text: 'Add an email address or phone number for the lead guest.',
          available: false,
        });
        return;
      }
      setFeedback(null);
      setBookingStep(3);
      return;
    }
    const total = availability?.total ?? 0;
    const collected = Number(amountCollected || 0);
    if (paymentStatus === 'paid' && collected < total) {
      setFeedback({
        text: 'A paid reservation must include the full stay total.',
        available: false,
      });
      return;
    }
    if (paymentStatus === 'partial' && (collected <= 0 || collected >= total)) {
      setFeedback({
        text: 'Enter a deposit greater than zero and less than the stay total.',
        available: false,
      });
      return;
    }
    if (paymentStatus === 'unpaid' && collected > 0) {
      setFeedback({
        text: 'Set the payment status to Deposit paid or Paid when recording an amount.',
        available: false,
      });
      return;
    }
    setBookingCreated(true);
  }

  return (
    <Card id="quick-booking-workspace" className="gap-4 p-4 sm:p-5">
      <PanelHeading
        title="Quick booking workspace"
        subtitle="Check room availability, select a room and continue through the booking details."
      />
      <form
        onSubmit={openBooking}
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(210px,1.4fr)_minmax(150px,1fr)_minmax(190px,1.2fr)_minmax(160px,1fr)_auto]"
      >
        <div className="space-y-2">
          <Label>Stay dates</Label>
          <CalendarPicker
            label={`Stay dates${stayDates.start ? ` · ${formatCalendarSelection(stayDates, 'range')}` : ''}`}
            mode="range"
            value={stayDates}
            onChange={(value) => {
              setStayDates(value);
              clearBookingResult();
            }}
            open={calendarOpen}
            onOpenChange={onCalendarOpenChange}
            className="w-full"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="overview-room-type">Room type</Label>
          <Select
            value={roomType}
            onValueChange={(value) => {
              setRoomType(value);
              const nextOption =
                roomOptions[value as keyof typeof roomOptions] ?? roomOptions.deluxe;
              setRoomNumber(nextOption.rooms[0]);
              clearBookingResult();
            }}
          >
            <SelectTrigger id="overview-room-type" className="h-9 w-full bg-card pr-4">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="any">Any room type</SelectItem>
              <SelectItem value="deluxe">Deluxe Sea View</SelectItem>
              <SelectItem value="standard">Standard Room</SelectItem>
              <SelectItem value="suite">Family Suite</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="overview-adults">Adults</Label>
            <Input
              id="overview-adults"
              type="number"
              min={1}
              max={8}
              value={adults}
              onChange={(event) => {
                setAdults(Math.max(1, Number(event.target.value)));
                clearBookingResult();
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="overview-children">Children</Label>
            <Input
              id="overview-children"
              type="number"
              min={0}
              max={6}
              value={children}
              onChange={(event) => {
                const nextChildren = Math.max(0, Number(event.target.value));
                setChildren(nextChildren);
                setChildAges((current) =>
                  Array.from({ length: nextChildren }, (_, index) => current[index] ?? '7 years'),
                );
                clearBookingResult();
              }}
            />
          </div>
        </div>
        <div className="flex items-end">
          <Button type="submit" className="w-full">
            <CalendarCheck aria-hidden="true" />
            Check availability
          </Button>
        </div>
        {feedback ? (
          <p
            role="status"
            aria-live="polite"
            className={`rounded-lg border p-3 text-sm sm:col-span-2 xl:col-span-5 ${feedback.available ? 'border-success/30 bg-success-surface/40 text-success' : 'border-warning/40 bg-warning-surface/40 text-warning'}`}
          >
            {feedback.available ? (
              <CheckCircle2 aria-hidden="true" className="mr-2 inline size-4" />
            ) : (
              <CircleAlert aria-hidden="true" className="mr-2 inline size-4" />
            )}
            {feedback.text}
          </p>
        ) : null}
      </form>
      <Dialog
        open={bookingOpen}
        onOpenChange={(open) => {
          setBookingOpen(open);
          if (!open) setFeedback(null);
        }}
      >
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New reservation</DialogTitle>
            <DialogDescription>
              Complete the stay, guest and payment details in three steps.
            </DialogDescription>
          </DialogHeader>
          {bookingCreated ? (
            <div
              role="status"
              className="rounded-lg border border-success/30 bg-success-surface/40 p-4"
            >
              <p className="font-semibold text-success">Reservation details confirmed</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {guestName} · {selectedRoomOption.name} · Room {roomNumber}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {paymentStatus === 'paid'
                  ? 'Paid'
                  : paymentStatus === 'partial'
                    ? 'Deposit paid'
                    : 'Unpaid'}
                {' · '}
                {paymentMethod.replaceAll('-', ' ')} · €
                {Number(amountCollected || 0).toLocaleString('en-GB')} collected
              </p>
            </div>
          ) : (
            <>
              <ol aria-label="Reservation progress" className="grid grid-cols-3 gap-2">
                {[
                  { number: 1, title: 'Stay & room' },
                  { number: 2, title: 'Guest details' },
                  { number: 3, title: 'Payment' },
                ].map(({ number, title }) => (
                  <li
                    key={number}
                    aria-current={bookingStep === number ? 'step' : undefined}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold ${bookingStep === number ? 'border-primary bg-primary/5 text-primary' : bookingStep > number ? 'border-success/30 bg-success-surface/40 text-success' : 'text-muted-foreground'}`}
                  >
                    <span className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-muted text-[10px]">
                      {bookingStep > number ? (
                        <Check aria-hidden="true" className="size-3" />
                      ) : (
                        number
                      )}
                    </span>
                    {title}
                  </li>
                ))}
              </ol>
              <form onSubmit={continueBooking} className="space-y-5">
                {bookingStep === 1 ? (
                  <section className="space-y-3">
                    <h3 className="text-sm font-bold">Stay and room</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Check-in and check-out</Label>
                        <CalendarPicker
                          label={`Stay dates · ${formatCalendarSelection(stayDates, 'range')}`}
                          mode="range"
                          value={stayDates}
                          onChange={(value) => {
                            setStayDates(value);
                            clearBookingResult();
                          }}
                          open={calendarOpen}
                          onOpenChange={onCalendarOpenChange}
                          className="w-full"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="overview-booking-room-type">Room type</Label>
                        <Select
                          value={roomType}
                          onValueChange={(nextType) => {
                            const nextOption =
                              roomOptions[nextType as keyof typeof roomOptions] ??
                              roomOptions.deluxe;
                            setRoomType(nextType);
                            setRoomNumber(nextOption.rooms[0]);
                            clearBookingResult();
                          }}
                        >
                          <SelectTrigger
                            id="overview-booking-room-type"
                            className="h-9 w-full bg-card pr-4"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent align="start">
                            <SelectItem value="any">Any room type</SelectItem>
                            <SelectItem value="deluxe">Deluxe Sea View</SelectItem>
                            <SelectItem value="standard">Standard Room</SelectItem>
                            <SelectItem value="suite">Family Suite</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="overview-booking-room-number">Individual room</Label>
                        <Select
                          value={roomNumber}
                          onValueChange={(value) => {
                            setRoomNumber(value);
                            clearBookingResult();
                          }}
                        >
                          <SelectTrigger
                            id="overview-booking-room-number"
                            className="h-9 w-full bg-card pr-4"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent align="start">
                            {selectedRoomOption.rooms.map((room) => (
                              <SelectItem key={room} value={room}>
                                Room {room}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor="overview-booking-adults">Adults</Label>
                          <Input
                            id="overview-booking-adults"
                            type="number"
                            min={1}
                            max={8}
                            value={adults}
                            onChange={(event) => {
                              setAdults(Math.max(1, Number(event.target.value)));
                              clearBookingResult();
                            }}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="overview-booking-children">Children</Label>
                          <Input
                            id="overview-booking-children"
                            type="number"
                            min={0}
                            max={6}
                            value={children}
                            onChange={(event) => {
                              const nextChildren = Math.max(0, Number(event.target.value));
                              setChildren(nextChildren);
                              setChildAges((current) =>
                                Array.from(
                                  { length: nextChildren },
                                  (_, index) => current[index] ?? '7 years',
                                ),
                              );
                              clearBookingResult();
                            }}
                          />
                        </div>
                      </div>
                      {children > 0 ? (
                        <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
                          {childAges.map((age, index) => (
                            <div key={index} className="space-y-2">
                              <Label htmlFor={`overview-booking-child-age-${index}`}>
                                Child {index + 1} age
                              </Label>
                              <Select
                                value={age}
                                onValueChange={(value) =>
                                  setChildAges((current) =>
                                    current.map((currentAge, currentIndex) =>
                                      currentIndex === index ? value : currentAge,
                                    ),
                                  )
                                }
                              >
                                <SelectTrigger
                                  id={`overview-booking-child-age-${index}`}
                                  className="h-9 w-full bg-card pr-4"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent align="start">
                                  {[
                                    'Under 2',
                                    '2 years',
                                    '3 years',
                                    '4 years',
                                    '5 years',
                                    '6 years',
                                    '7 years',
                                    '8 years',
                                    '9 years',
                                    '10 years',
                                    '11 years',
                                    '12 years',
                                  ].map((ageOption) => (
                                    <SelectItem key={ageOption} value={ageOption}>
                                      {ageOption}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                {bookingStep === 2 ? (
                  <section className="space-y-3">
                    <h3 className="text-sm font-bold">Lead guest</h3>
                    <p className="text-xs text-muted-foreground">
                      Add the primary guest’s contact details. An email address or phone number is
                      required.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="overview-booking-guest-name">Full name</Label>
                        <Input
                          id="overview-booking-guest-name"
                          autoComplete="name"
                          value={guestName}
                          onChange={(event) => setGuestName(event.target.value)}
                          placeholder="Guest name"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="overview-booking-guest-email">Email</Label>
                        <Input
                          id="overview-booking-guest-email"
                          type="email"
                          autoComplete="email"
                          value={guestEmail}
                          onChange={(event) => setGuestEmail(event.target.value)}
                          placeholder="guest@example.com"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="overview-booking-guest-phone">Phone</Label>
                        <div className="flex gap-2">
                          <Select value={guestPhonePrefix} onValueChange={setGuestPhonePrefix}>
                            <SelectTrigger
                              aria-label="Phone country code"
                              className="h-9 w-28 shrink-0 bg-card pr-3"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="start">
                              <SelectItem value="+355">+355 · AL</SelectItem>
                              <SelectItem value="+44">+44 · UK</SelectItem>
                              <SelectItem value="+39">+39 · IT</SelectItem>
                              <SelectItem value="+1">+1 · US</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            id="overview-booking-guest-phone"
                            type="tel"
                            autoComplete="tel-national"
                            value={guestPhone}
                            onChange={(event) => setGuestPhone(event.target.value)}
                            placeholder="69 123 4567"
                            className="h-9 min-w-0 flex-1"
                          />
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}

                {bookingStep === 3 ? (
                  <section className="space-y-4">
                    <div className="rounded-lg border bg-muted/30 p-4">
                      <h3 className="text-sm font-bold">Booking summary</h3>
                      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-xs text-muted-foreground">Stay</dt>
                          <dd className="font-medium">
                            {formatCalendarSelection(stayDates, 'range')} ·{' '}
                            {availability?.nights ?? 0} nights
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Room</dt>
                          <dd className="font-medium">
                            {selectedRoomOption.name} · Room {roomNumber}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Guests</dt>
                          <dd className="font-medium">
                            {adults} adults · {children} children
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Lead guest</dt>
                          <dd className="font-medium">{guestName}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Guest contact</dt>
                          <dd className="font-medium">
                            {guestEmail ||
                              (guestPhone
                                ? `${guestPhonePrefix} ${guestPhone}`
                                : 'No contact added')}
                          </dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-xs text-muted-foreground">Stay total</dt>
                          <dd className="text-lg font-bold">
                            €{(availability?.total ?? 0).toLocaleString('en-GB')}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="overview-booking-payment-method">Payment method</Label>
                        <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                          <SelectTrigger
                            id="overview-booking-payment-method"
                            className="h-9 w-full bg-card pr-4"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent align="start">
                            <SelectItem value="pay-at-hotel">Pay at hotel</SelectItem>
                            <SelectItem value="cash">Cash</SelectItem>
                            <SelectItem value="card-in-person">Card in person</SelectItem>
                            <SelectItem value="bank-transfer">Bank transfer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="overview-booking-payment-status">Payment status</Label>
                        <Select
                          value={paymentStatus}
                          onValueChange={(nextStatus) => {
                            setPaymentStatus(nextStatus);
                            if (nextStatus === 'paid')
                              setAmountCollected(String(availability?.total ?? 0));
                            if (nextStatus === 'unpaid') setAmountCollected('0');
                          }}
                        >
                          <SelectTrigger
                            id="overview-booking-payment-status"
                            className="h-9 w-full bg-card pr-4"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent align="start">
                            <SelectItem value="unpaid">Unpaid</SelectItem>
                            <SelectItem value="partial">Deposit paid</SelectItem>
                            <SelectItem value="paid">Paid</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="overview-booking-amount-collected">
                          Amount collected now
                        </Label>
                        <div className="relative">
                          <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                            €
                          </span>
                          <Input
                            id="overview-booking-amount-collected"
                            type="number"
                            min={0}
                            max={availability?.total ?? 0}
                            step="0.01"
                            value={amountCollected}
                            onChange={(event) => setAmountCollected(event.target.value)}
                            className="pl-8"
                          />
                        </div>
                      </div>
                    </div>
                    <p className="rounded-lg border border-info/30 bg-info-surface/40 p-3 text-xs text-muted-foreground">
                      Card details belong in a secure payment flow and are never entered here.
                    </p>
                  </section>
                ) : null}

                {feedback ? (
                  <p
                    role="status"
                    aria-live="polite"
                    className={`rounded-lg border p-3 text-sm ${feedback.available ? 'border-success/30 bg-success-surface/40 text-success' : 'border-warning/40 bg-warning-surface/40 text-warning'}`}
                  >
                    {feedback.available ? (
                      <CheckCircle2 aria-hidden="true" className="mr-2 inline size-4" />
                    ) : (
                      <CircleAlert aria-hidden="true" className="mr-2 inline size-4" />
                    )}
                    {feedback.text}
                  </p>
                ) : null}
                <DialogFooter className="border-t pt-4">
                  {bookingStep > 1 ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setBookingStep((step) => (step === 3 ? 2 : 1));
                        setFeedback(null);
                      }}
                    >
                      Back
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" onClick={() => setBookingOpen(false)}>
                      Cancel
                    </Button>
                  )}
                  <Button type="submit">
                    {bookingStep === 1 ? (
                      <>
                        <CalendarCheck aria-hidden="true" />
                        Find room & continue
                      </>
                    ) : bookingStep === 2 ? (
                      'Continue to payment'
                    ) : (
                      'Confirm booking details'
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
          {bookingCreated ? (
            <DialogFooter>
              <Button type="button" onClick={() => setBookingOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AttentionTab({ onBack }: { onBack: () => void }) {
  const [category, setCategory] = useState<'all' | 'booking' | 'payment'>('all');
  const [priority, setPriority] = useState<'all' | 'urgent' | 'review'>('all');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'priority' | 'guest' | 'reservation'>('priority');
  const [selectedId, setSelectedId] = useState(attentionItems[0]?.id ?? '');
  const bookingCount = attentionItems.filter((item) => item.category === 'booking').length;
  const paymentCount = attentionItems.filter((item) => item.category === 'payment').length;
  const urgentCount = attentionItems.filter((item) => item.priority === 'urgent').length;
  const visibleIssues = attentionItems
    .filter((item) => category === 'all' || item.category === category)
    .filter((item) => priority === 'all' || item.priority === priority)
    .filter((item) => {
      const searchable = [
        item.issue,
        item.reservation.guest,
        item.reservation.reference,
        item.reservation.property,
        item.reservation.room,
      ]
        .join(' ')
        .toLowerCase();
      return searchable.includes(query.trim().toLowerCase());
    })
    .sort((left, right) => {
      if (sortBy === 'guest') return left.reservation.guest.localeCompare(right.reservation.guest);
      if (sortBy === 'reservation') {
        return left.reservation.reference.localeCompare(right.reservation.reference);
      }
      return (
        (left.priority === 'urgent' ? 0 : 1) - (right.priority === 'urgent' ? 0 : 1) ||
        left.reservation.reference.localeCompare(right.reservation.reference)
      );
    });
  const selectedIssue = visibleIssues.find((item) => item.id === selectedId) ?? visibleIssues[0];
  const filtersActive =
    category !== 'all' || priority !== 'all' || query.length > 0 || sortBy !== 'priority';

  function clearFilters() {
    setCategory('all');
    setPriority('all');
    setQuery('');
    setSortBy('priority');
  }

  return (
    <div className="space-y-5 pt-5">
      <Card className="gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-2">
            <p className="text-[11px] font-bold tracking-wide text-primary uppercase">
              Dashboard · Exception queue
            </p>
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Needs attention</h2>
            <p className="text-sm text-muted-foreground">
              Review pending reservations and payment states that need staff follow-up.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={onBack}>
              <ArrowLeft aria-hidden="true" />
              Dashboard overview
            </Button>
            <Button
              type="button"
              onClick={() => {
                const currentIndex = visibleIssues.findIndex((item) => item.id === selectedId);
                const nextIssue = visibleIssues[(currentIndex + 1) % visibleIssues.length];
                setSelectedId(nextIssue?.id ?? '');
              }}
              disabled={visibleIssues.length === 0}
            >
              Review next
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      </Card>

      <section aria-label="Queue overview and quick filters" className="space-y-3">
        <div>
          <h3 className="text-base font-bold">Queue overview</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Select a summary to focus the list on the work that needs attention.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: 'Open issues',
              value: attentionItems.length,
              detail: 'All booking and payment items',
              icon: CircleAlert,
              tone: 'warning' as Tone,
              category: 'all' as const,
              priority: 'all' as const,
            },
            {
              label: 'Booking review',
              value: bookingCount,
              detail: 'Reservations awaiting review',
              icon: CalendarCheck,
              tone: 'info' as Tone,
              category: 'booking' as const,
              priority: 'all' as const,
            },
            {
              label: 'Payment follow-up',
              value: paymentCount,
              detail: 'Payments to verify or reconcile',
              icon: CreditCard,
              tone: 'danger' as Tone,
              category: 'payment' as const,
              priority: 'all' as const,
            },
            {
              label: 'Urgent',
              value: urgentCount,
              detail: 'Requires prompt review',
              icon: CircleAlert,
              tone: 'danger' as Tone,
              category: 'all' as const,
              priority: 'urgent' as const,
            },
          ].map((stat) => {
            const Icon = stat.icon;
            const isActive = category === stat.category && priority === stat.priority;
            return (
              <button
                key={stat.label}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  setCategory(stat.category);
                  setPriority(stat.priority);
                }}
                className={`group flex min-h-32 items-start justify-between gap-4 rounded-xl border bg-card p-4 text-left shadow-xs transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${isActive ? 'border-primary/40 bg-primary/[0.03]' : ''}`}
              >
                <span className="flex min-w-0 flex-col items-start gap-3">
                  <span
                    className={`flex size-10 items-center justify-center rounded-xl ${metricTones[stat.tone].icon}`}
                  >
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{stat.label}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{stat.detail}</span>
                  </span>
                </span>
                <span className="text-3xl leading-none font-bold tabular-nums tracking-tight">
                  {stat.value}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <Card className="gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="group"
            aria-label="Filter attention items by category"
            className="flex flex-wrap gap-2"
          >
            {(
              [
                ['all', 'All issues', attentionItems.length],
                ['booking', 'Bookings', bookingCount],
                ['payment', 'Payments', paymentCount],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={category === value}
                onClick={() => setCategory(value)}
                className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${category === value ? 'border-primary/30 bg-primary/10 text-primary' : 'bg-card text-muted-foreground hover:bg-muted'}`}
              >
                {label}
                <span className="rounded-full bg-background/80 px-1.5 py-0.5 tabular-nums">
                  {count}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="relative min-w-56 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search reservation, guest or issue"
              aria-label="Search attention items"
              className="pl-9"
            />
          </label>
          <label className="min-w-36 space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Priority</span>
            <Select
              value={priority}
              onValueChange={(value) => setPriority(value as typeof priority)}
            >
              <SelectTrigger
                aria-label="Filter attention items by priority"
                className="h-10 w-full bg-card pr-4"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="all">All priorities</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="review">Review</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="min-w-44 space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Sort by</span>
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
              <SelectTrigger aria-label="Sort attention items" className="h-10 w-full bg-card pr-4">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="priority">Priority</SelectItem>
                <SelectItem value="guest">Guest name</SelectItem>
                <SelectItem value="reservation">Reservation reference</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <Button type="button" variant="ghost" onClick={clearFilters} disabled={!filtersActive}>
            Clear filters
          </Button>
        </div>
      </Card>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.8fr)]">
        <Card className="min-w-0 gap-0 overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 sm:px-5">
            <div>
              <h3 className="text-base font-bold">Open queue</h3>
              <p className="text-xs text-muted-foreground">
                {visibleIssues.length} of {attentionItems.length} issues · Select a row to view
                details
              </p>
            </div>
          </div>
          {visibleIssues.length ? (
            <Table containerClassName="overflow-x-hidden" className="w-full table-fixed">
              <caption className="sr-only">Reservation and payment issues that need review</caption>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[58%] whitespace-normal px-2 sm:w-[31%] sm:px-3">
                    Issue
                  </TableHead>
                  <TableHead className="w-[42%] whitespace-normal px-2 sm:w-[23%] sm:px-3">
                    Reservation · guest
                  </TableHead>
                  <TableHead className="hidden whitespace-normal px-2 sm:table-cell sm:w-[27%] sm:px-3">
                    Room · hotel
                  </TableHead>
                  <TableHead className="hidden whitespace-normal px-2 sm:table-cell sm:w-[19%] sm:px-3">
                    Booking · payment
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleIssues.map((item) => {
                  const CategoryIcon = item.category === 'payment' ? CreditCard : CalendarCheck;
                  const isSelected = selectedIssue?.id === item.id;
                  return (
                    <TableRow
                      key={item.id}
                      tabIndex={0}
                      aria-selected={isSelected}
                      aria-label={`Select ${item.issue} for ${item.reservation.guest}, ${item.reservation.reference}`}
                      data-state={isSelected ? 'selected' : undefined}
                      onClick={() => setSelectedId(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedId(item.id);
                        }
                      }}
                      className="cursor-pointer outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=selected]:bg-primary/5"
                    >
                      <TableCell className="min-w-0 px-2 py-3 sm:px-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${metricTones[item.category === 'payment' ? 'danger' : 'warning'].icon}`}
                          >
                            <CategoryIcon aria-hidden="true" className="size-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block break-words text-sm font-semibold">
                              {item.issue}
                            </span>
                            <Badge
                              className="mt-1"
                              variant={item.priority === 'urgent' ? 'danger' : 'warning'}
                            >
                              {item.priority === 'urgent' ? 'Urgent' : 'Review'}
                            </Badge>
                            <span className="mt-1 flex flex-wrap gap-1 sm:hidden">
                              <BookingStatusBadge status={item.reservation.booking} />
                              <PaymentStatusBadge status={item.reservation.payment} />
                            </span>
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="min-w-0 px-2 py-3 sm:px-3">
                        <span className="block truncate font-medium">
                          {item.reservation.reference}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.reservation.guest}
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground sm:hidden">
                          {item.reservation.room}
                        </span>
                      </TableCell>
                      <TableCell className="hidden min-w-0 px-2 py-3 sm:table-cell sm:px-3">
                        <span className="block truncate font-medium">{item.reservation.room}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.reservation.property}
                        </span>
                      </TableCell>
                      <TableCell className="hidden min-w-0 px-2 py-3 sm:table-cell sm:px-3">
                        <div className="flex min-w-0 flex-col items-start gap-1">
                          <BookingStatusBadge status={item.reservation.booking} />
                          <PaymentStatusBadge status={item.reservation.payment} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Search aria-hidden="true" className="size-5" />
              </span>
              <div>
                <h4 className="font-semibold">No matching issues</h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  Change your search or filters to see other items.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          )}
        </Card>

        <aside aria-label="Selected attention item">
          {selectedIssue ? (
            <Card className="gap-4 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <Badge variant={selectedIssue.priority === 'urgent' ? 'danger' : 'warning'}>
                  {selectedIssue.priority === 'urgent' ? 'Urgent' : 'Needs review'}
                </Badge>
                <span className="text-xs font-medium text-muted-foreground">
                  {selectedIssue.category === 'payment' ? 'Payment follow-up' : 'Booking review'}
                </span>
              </div>
              <div>
                <h3 className="text-lg font-bold">{selectedIssue.issue}</h3>
                <p className="mt-1 text-sm text-primary">
                  {selectedIssue.reservation.reference} · {selectedIssue.reservation.guest}
                </p>
              </div>
              <section className="rounded-xl bg-muted/60 p-4">
                <p className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
                  Why this is flagged
                </p>
                <p className="mt-2 text-sm">{selectedIssue.context}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <BookingStatusBadge status={selectedIssue.reservation.booking} />
                  <PaymentStatusBadge status={selectedIssue.reservation.payment} />
                </div>
              </section>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Property</dt>
                <dd className="text-right font-medium">{selectedIssue.reservation.property}</dd>
                <dt className="text-muted-foreground">Room</dt>
                <dd className="text-right font-medium">{selectedIssue.reservation.room}</dd>
                <dt className="text-muted-foreground">Stay</dt>
                <dd className="text-right font-medium">{selectedIssue.reservation.stay}</dd>
                <dt className="text-muted-foreground">Booking total</dt>
                <dd className="text-right font-medium">{selectedIssue.reservation.amount}</dd>
              </dl>
              <section className="rounded-xl border border-warning/30 bg-warning-surface/30 p-4">
                <p className="text-xs font-bold text-warning">Recommended next step</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {selectedIssue.recommendedAction}
                </p>
              </section>
              <Button asChild>
                <Link href="/design/tables">
                  {selectedIssue.category === 'payment'
                    ? 'Review payment record'
                    : 'Open reservation record'}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </Card>
          ) : (
            <Card className="items-center gap-3 p-8 text-center">
              <h3 className="font-semibold">Select an issue</h3>
              <p className="text-sm text-muted-foreground">
                Choose a queue item to see its reservation and payment context.
              </p>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function ApprovalsTab({
  statuses,
  onDecisionChange,
}: {
  statuses: Record<string, ApprovalStatus>;
  onDecisionChange: (reference: string, status: ApprovalStatus) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'decided'>('all');
  const [selectedReference, setSelectedReference] = useState(sampleApprovals[0]?.reference ?? '');
  const [decisionTarget, setDecisionTarget] = useState<{
    reference: string;
    status: Exclude<ApprovalStatus, 'pending'>;
  } | null>(null);
  const pendingCount = Object.values(statuses).filter((status) => status === 'pending').length;
  const approvedCount = Object.values(statuses).filter((status) => status === 'approved').length;
  const declinedCount = Object.values(statuses).filter((status) => status === 'declined').length;
  const visibleApprovals = sampleApprovals.filter((approval) => {
    const status = statuses[approval.reference] ?? 'pending';
    return filter === 'all' || (filter === 'pending' ? status === 'pending' : status !== 'pending');
  });
  const selectedApproval =
    visibleApprovals.find((approval) => approval.reference === selectedReference) ??
    visibleApprovals[0];
  const selectedStatus = selectedApproval
    ? (statuses[selectedApproval.reference] ?? 'pending')
    : 'pending';
  const selectedReservation = selectedApproval
    ? reservations.find((reservation) => reservation.reference === selectedApproval.reference)
    : undefined;
  const approvalForDialog = decisionTarget
    ? sampleApprovals.find((approval) => approval.reference === decisionTarget.reference)
    : undefined;

  function recordDecision(reference: string, status: ApprovalStatus) {
    onDecisionChange(reference, status);
    setSelectedReference(reference);
  }

  return (
    <div className="space-y-5 pt-1">
      <Card className="gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-2">
            <p className="text-[11px] font-bold tracking-wide text-primary uppercase">
              Dashboard · Guest requests
            </p>
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Approvals</h2>
            <p className="text-sm text-muted-foreground">
              Review guest requests, check the reservation context, then record a decision.
            </p>
          </div>
          <Badge variant={pendingCount ? 'warning' : 'success'}>
            {pendingCount ? `${pendingCount} awaiting decision` : 'All requests reviewed'}
          </Badge>
        </div>
      </Card>

      <section aria-label="Approval summary" className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Awaiting decision', value: pendingCount, variant: 'warning' as const },
          { label: 'Approved', value: approvedCount, variant: 'success' as const },
          { label: 'Declined', value: declinedCount, variant: 'secondary' as const },
        ].map((item) => (
          <Card key={item.label} className="flex-row items-center justify-between gap-3 p-4">
            <span className="flex min-w-0 items-center gap-3">
              <span
                className={`flex size-10 items-center justify-center rounded-xl ${item.variant === 'warning' ? 'bg-warning-surface text-warning' : item.variant === 'success' ? 'bg-success-surface text-success' : 'bg-muted text-muted-foreground'}`}
              >
                {item.variant === 'warning' ? (
                  <CircleAlert aria-hidden="true" className="size-5" />
                ) : item.variant === 'success' ? (
                  <CheckCircle2 aria-hidden="true" className="size-5" />
                ) : (
                  <ArrowUpDown aria-hidden="true" className="size-5" />
                )}
              </span>
              <span className="text-sm font-semibold">{item.label}</span>
            </span>
            <span className="text-2xl font-bold tabular-nums">{item.value}</span>
          </Card>
        ))}
      </section>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.5fr)]">
        <Card className="min-w-0 gap-4 p-4 sm:p-5">
          <div>
            <h3 className="font-bold">Guest requests</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose a request to review its stay and current booking status.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter approval requests">
            {(
              [
                ['all', 'All', sampleApprovals.length],
                ['pending', 'Pending', pendingCount],
                ['decided', 'Decided', approvedCount + declinedCount],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${filter === value ? 'border-primary/30 bg-primary/10 text-primary' : 'bg-card text-muted-foreground hover:bg-muted'}`}
              >
                {label}
                <span className="rounded-full bg-background/80 px-1.5 py-0.5 tabular-nums">
                  {count}
                </span>
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {visibleApprovals.map((approval) => {
              const status = statuses[approval.reference] ?? 'pending';
              const isSelected = selectedApproval?.reference === approval.reference;
              return (
                <button
                  key={approval.reference}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedReference(approval.reference)}
                  className={`w-full rounded-xl border p-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${isSelected ? 'border-primary/40 bg-primary/[0.04]' : 'hover:bg-muted/60'}`}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {approval.request}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {approval.guest} · {approval.reference}
                      </span>
                    </span>
                    <Badge
                      variant={
                        status === 'pending'
                          ? 'warning'
                          : status === 'approved'
                            ? 'success'
                            : 'secondary'
                      }
                    >
                      {status === 'pending'
                        ? 'Pending'
                        : status === 'approved'
                          ? 'Approved'
                          : 'Declined'}
                    </Badge>
                  </span>
                  <span className="mt-2 block truncate text-xs text-muted-foreground">
                    {approval.property} · Submitted {approval.submitted}
                  </span>
                </button>
              );
            })}
            {visibleApprovals.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center">
                <p className="text-sm font-semibold">No requests in this view</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose another filter to continue.
                </p>
              </div>
            ) : null}
          </div>
        </Card>

        {selectedApproval ? (
          <Card className="gap-5 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-muted-foreground">Request details</p>
                <h3 className="mt-1 text-lg font-bold">{selectedApproval.request}</h3>
                <p className="mt-1 text-sm text-primary">
                  {selectedApproval.guest} · {selectedApproval.reference}
                </p>
              </div>
              <Badge
                variant={
                  selectedStatus === 'pending'
                    ? 'warning'
                    : selectedStatus === 'approved'
                      ? 'success'
                      : 'secondary'
                }
              >
                {selectedStatus === 'pending'
                  ? 'Pending decision'
                  : selectedStatus === 'approved'
                    ? 'Approved'
                    : 'Declined'}
              </Badge>
            </div>

            <section className="rounded-xl bg-muted/60 p-4">
              <p className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
                Guest request
              </p>
              <p className="mt-2 text-sm">{selectedApproval.details}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Submitted {selectedApproval.submitted} · {selectedApproval.property}
              </p>
            </section>

            {selectedReservation ? (
              <section>
                <h4 className="text-sm font-bold">Reservation context</h4>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Room</dt>
                  <dd className="text-right font-medium">{selectedReservation.room}</dd>
                  <dt className="text-muted-foreground">Stay</dt>
                  <dd className="text-right font-medium">{selectedReservation.stay}</dd>
                  <dt className="text-muted-foreground">Booking</dt>
                  <dd className="flex justify-end">
                    <BookingStatusBadge status={selectedReservation.booking} />
                  </dd>
                  <dt className="text-muted-foreground">Payment</dt>
                  <dd className="flex justify-end">
                    <PaymentStatusBadge status={selectedReservation.payment} />
                  </dd>
                  <dt className="text-muted-foreground">Booking total</dt>
                  <dd className="text-right font-medium">{selectedReservation.amount}</dd>
                </dl>
              </section>
            ) : null}

            <section className="rounded-xl border border-info/30 bg-info-surface/30 p-4">
              <p className="text-xs font-bold text-info">Before deciding</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {selectedApproval.recommendation}
              </p>
            </section>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <Button asChild variant="outline">
                <Link href="/design/tables">View reservation</Link>
              </Button>
              {selectedStatus === 'pending' ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setDecisionTarget({
                        reference: selectedApproval.reference,
                        status: 'declined',
                      })
                    }
                  >
                    Decline
                  </Button>
                  <Button
                    type="button"
                    onClick={() =>
                      setDecisionTarget({
                        reference: selectedApproval.reference,
                        status: 'approved',
                      })
                    }
                  >
                    <Check aria-hidden="true" />
                    Approve request
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => recordDecision(selectedApproval.reference, 'pending')}
                >
                  Return to pending
                </Button>
              )}
            </div>
          </Card>
        ) : (
          <Card className="items-center justify-center gap-2 p-8 text-center">
            <h3 className="font-semibold">No requests to review</h3>
            <p className="text-sm text-muted-foreground">
              There are no guest requests in this filter.
            </p>
          </Card>
        )}
      </div>

      <Dialog
        open={decisionTarget !== null}
        onOpenChange={(open) => !open && setDecisionTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decisionTarget?.status === 'approved'
                ? 'Approve this request?'
                : 'Decline this request?'}
            </DialogTitle>
            <DialogDescription>
              {approvalForDialog
                ? `${approvalForDialog.request} from ${approvalForDialog.guest} · ${approvalForDialog.reference}`
                : 'Confirm your decision for this guest request.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDecisionTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={decisionTarget?.status === 'declined' ? 'destructive' : 'default'}
              onClick={() => {
                if (decisionTarget) recordDecision(decisionTarget.reference, decisionTarget.status);
                setDecisionTarget(null);
              }}
            >
              {decisionTarget?.status === 'approved' ? 'Approve request' : 'Decline request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SystemHealthTab() {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
      <HealthPanel expanded />
      <Card className="gap-4 p-4 sm:p-5">
        <PanelHeading title="Operational summary" subtitle="Current sample snapshot." />
        <div className="rounded-xl border border-warning/30 bg-warning-surface/30 p-4">
          <div className="flex items-center gap-2 font-semibold text-warning">
            <CircleAlert aria-hidden="true" className="size-4" />
            Some checks need review
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Reservation synchronization is delayed, and one payment-to-folio sample event failed.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted/70 p-3">
            <p className="text-xs text-muted-foreground">Healthy checks</p>
            <p className="mt-1 text-xl font-bold tabular-nums">4 / 6</p>
          </div>
          <div className="rounded-lg bg-muted/70 p-3">
            <p className="text-xs text-muted-foreground">Needs follow-up</p>
            <p className="mt-1 text-xl font-bold tabular-nums">2</p>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link href="/design/timeline">
            <Activity aria-hidden="true" />
            View sample event timeline
          </Link>
        </Button>
      </Card>
    </div>
  );
}

function QuickBookingTab({
  calendarOpen,
  onCalendarOpenChange,
}: {
  calendarOpen: boolean;
  onCalendarOpenChange: (open: boolean) => void;
}) {
  type RoomOccupancy = { adults: number; children: number; childAges: string[] };
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [stayDates, setStayDates] = useState<CalendarSelection>({
    start: '2026-10-20',
    end: '2026-10-23',
  });
  const [roomTypeFilter, setRoomTypeFilter] = useState<'all' | QuickBookingRoomId>('all');
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState<QuickBookingRoomId>('deluxe');
  const [roomCount, setRoomCount] = useState(1);
  const [roomNumbers, setRoomNumbers] = useState(['204']);
  const [roomOccupancies, setRoomOccupancies] = useState<RoomOccupancy[]>([
    { adults: 2, children: 1, childAges: ['7 years'] },
  ]);
  const [hasSearched, setHasSearched] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [guestFirstName, setGuestFirstName] = useState('');
  const [guestLastName, setGuestLastName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [phoneCountryId, setPhoneCountryId] = useState(defaultPhoneCountryCodeId);
  const [otherGuestNames, setOtherGuestNames] = useState<Record<string, string>>({});
  const [companyName, setCompanyName] = useState('');
  const [addressCountry, setAddressCountry] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [county, setCounty] = useState('');
  const [postcode, setPostcode] = useState('');
  const [specialRequest, setSpecialRequest] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<'unpaid' | 'partial' | 'paid'>('unpaid');
  const [paymentMethod, setPaymentMethod] = useState<
    'pay-at-hotel' | 'pokpay' | 'cash' | 'card-in-person' | 'bank-transfer'
  >('pay-at-hotel');
  const [amountCollected, setAmountCollected] = useState('0');

  const nights = stayNightCount(stayDates);
  const selectedRoom = quickBookingRooms.find((room) => room.id === selectedRoomTypeId);
  const roomRows = roomOccupancies.slice(0, roomCount).map((occupancy, index) => ({
    index,
    occupancy,
    number: roomNumbers[index] ?? selectedRoom?.roomNumbers[index] ?? '',
  }));
  const adultsTotal = roomRows.reduce((sum, room) => sum + room.occupancy.adults, 0);
  const childrenTotal = roomRows.reduce((sum, room) => sum + room.occupancy.children, 0);
  const largestRoomParty = Math.max(
    ...roomRows.map((room) => room.occupancy.adults + room.occupancy.children),
  );
  const dateSummary =
    stayDates.start && stayDates.end
      ? formatCalendarSelection(stayDates, 'range')
      : 'Select stay dates';
  const phoneCountry =
    phoneCountryCodes.find((country) => country.id === phoneCountryId) ??
    phoneCountryCodes.find((country) => country.id === defaultPhoneCountryCodeId)!;
  const phonePrefix = phoneCountry.callingCode;
  const guestName = [guestFirstName.trim(), guestLastName.trim()].filter(Boolean).join(' ');
  const paymentMethodLabel = {
    'pay-at-hotel': 'Pay at hotel',
    pokpay: 'PokPay',
    cash: 'Cash',
    'card-in-person': 'Card in person',
    'bank-transfer': 'Bank transfer',
  }[paymentMethod];
  const guestContactSummary = [
    guestEmail.trim(),
    guestPhone.trim() ? `${phonePrefix} ${guestPhone.trim()}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const roomTypesInScope = quickBookingRooms.filter(
    (room) => roomTypeFilter === 'all' || room.id === roomTypeFilter,
  );
  const suitableRoomTypes = roomTypesInScope.filter(
    (room) => room.count >= roomCount && room.capacity >= largestRoomParty,
  );
  const total = (selectedRoom?.rate ?? 0) * nights * roomCount;
  const collected = Number(amountCollected || 0);
  const guestCountSummary = `${adultsTotal} ${adultsTotal === 1 ? 'adult' : 'adults'}${childrenTotal ? ` · ${childrenTotal} ${childrenTotal === 1 ? 'child' : 'children'}` : ''}`;
  const additionalGuestSlots = roomRows.flatMap(({ index, occupancy }) => {
    const adultsToName = Math.max(0, occupancy.adults - (index === 0 ? 1 : 0));
    const adultSlots = Array.from({ length: adultsToName }, (_, slot) => {
      const adultNumber = slot + (index === 0 ? 2 : 1);
      return {
        id: `room-${index + 1}-adult-${adultNumber}`,
        label: `Room ${index + 1} · Adult ${adultNumber}`,
      };
    });
    const childSlots = Array.from({ length: occupancy.children }, (_, slot) => ({
      id: `room-${index + 1}-child-${slot + 1}`,
      label: `Room ${index + 1} · Child ${slot + 1}`,
    }));
    return [...adultSlots, ...childSlots];
  });
  const availableRoomNumbers: readonly string[] = selectedRoom?.roomNumbers ?? [];
  const roomAssignmentsValid =
    Boolean(selectedRoom) &&
    roomCount <= (selectedRoom?.count ?? 0) &&
    roomRows.every(
      ({ number, occupancy }) =>
        Boolean(number) &&
        availableRoomNumbers.includes(number) &&
        occupancy.adults + occupancy.children <= (selectedRoom?.capacity ?? 0),
    ) &&
    new Set(roomRows.map((room) => room.number)).size === roomCount;
  const canContinueFromSearch = hasSearched && roomAssignmentsValid;
  const pokpayCheckoutHref = `/design/pokpay-checkout?${new URLSearchParams({
    amount: String(Math.max(0, total - collected)),
    stay: dateSummary,
    rooms: String(roomCount),
    roomType: selectedRoom?.name ?? '',
  }).toString()}`;

  function markSearchStale() {
    setHasSearched(false);
    setMessage(null);
  }

  function refreshAvailability() {
    if (nights < 1) {
      setHasSearched(false);
      setMessage('Choose a check-in and check-out date at least one night apart.');
      return;
    }
    if (!roomAssignmentsValid) {
      setHasSearched(false);
      setMessage(
        'Assign an available room to each guest group and make sure every room is within capacity.',
      );
      return;
    }
    setHasSearched(true);
    setMessage(
      `Availability refreshed for ${roomCount} ${roomCount === 1 ? 'room' : 'rooms'} and ${guestCountSummary.toLowerCase()}.`,
    );
  }

  function updateRoomCount(value: number) {
    const maximum = Math.max(...quickBookingRooms.map((room) => room.count));
    const nextCount = Math.max(1, Math.min(maximum, value));
    setRoomCount(nextCount);
    setRoomOccupancies((current) =>
      Array.from(
        { length: nextCount },
        (_, index) => current[index] ?? { adults: 2, children: 0, childAges: [] },
      ),
    );
    setRoomNumbers((current) =>
      Array.from(
        { length: nextCount },
        (_, index) => current[index] ?? selectedRoom?.roomNumbers[index] ?? '',
      ),
    );
    markSearchStale();
  }

  function updateRoomOccupancy(index: number, update: (current: RoomOccupancy) => RoomOccupancy) {
    setRoomOccupancies((current) =>
      current.map((occupancy, roomIndex) => (roomIndex === index ? update(occupancy) : occupancy)),
    );
    markSearchStale();
  }

  function changeRoomType(room: (typeof quickBookingRooms)[number]) {
    setSelectedRoomTypeId(room.id);
    setRoomNumbers(room.roomNumbers.slice(0, roomCount));
    setMessage(null);
  }

  function resetBooking() {
    setStep(1);
    setStayDates({ start: '2026-10-20', end: '2026-10-23' });
    setRoomTypeFilter('all');
    setSelectedRoomTypeId('deluxe');
    setRoomCount(1);
    setRoomNumbers(['204']);
    setRoomOccupancies([{ adults: 2, children: 1, childAges: ['7 years'] }]);
    setHasSearched(true);
    setMessage(null);
    setGuestFirstName('');
    setGuestLastName('');
    setGuestEmail('');
    setGuestPhone('');
    setPhoneCountryId(defaultPhoneCountryCodeId);
    setOtherGuestNames({});
    setCompanyName('');
    setAddressCountry('');
    setStreetAddress('');
    setAddressLine2('');
    setCity('');
    setCounty('');
    setPostcode('');
    setSpecialRequest('');
    setPaymentStatus('unpaid');
    setPaymentMethod('pay-at-hotel');
    setAmountCollected('0');
    onCalendarOpenChange(false);
  }

  function continueToReview() {
    if (!guestFirstName.trim() || !guestLastName.trim()) {
      setMessage('Enter the lead guest’s first and last name to continue.');
      return;
    }
    if (!guestEmail.trim() && !guestPhone.trim()) {
      setMessage('Add an email address or phone number for the lead guest.');
      return;
    }
    if (guestEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail.trim())) {
      setMessage('Enter a valid email address or remove it and provide a phone number.');
      return;
    }
    setMessage(null);
    setStep(3);
  }

  function confirmBookingDetails() {
    if (paymentStatus === 'paid' && collected < total) {
      setMessage('The amount received must cover the full stay total for a paid booking.');
      return;
    }
    if (paymentStatus === 'partial' && (collected <= 0 || collected >= total)) {
      setMessage('Enter a deposit greater than zero and less than the stay total.');
      return;
    }
    if (paymentStatus === 'unpaid' && collected > 0) {
      setMessage('Choose Deposit paid or Paid when recording an amount received.');
      return;
    }
    setMessage(null);
    setStep(4);
  }

  function setPaymentState(value: 'unpaid' | 'partial' | 'paid') {
    setPaymentStatus(value);
    if (value !== 'unpaid' && paymentMethod === 'pay-at-hotel') setPaymentMethod('cash');
    if (value === 'unpaid') {
      setAmountCollected('0');
      return;
    }
    if (value === 'paid') setAmountCollected(String(total));
    if (value === 'partial') setAmountCollected(String(Math.max(1, Math.min(100, total - 1))));
  }

  const stepTitles = [
    { number: 1, title: 'Stay & rooms', detail: 'Dates, occupancy and room assignment' },
    { number: 2, title: 'Guest details', detail: 'Lead guest and optional companions' },
    { number: 3, title: 'Review & payment', detail: 'Final booking and payment details' },
    { number: 4, title: 'Confirmation', detail: 'Review the completed booking details' },
  ] as const;

  return (
    <div className="space-y-5 pt-5">
      <Card className="gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-2">
            <p className="text-[11px] font-bold tracking-wide text-primary uppercase">
              Staff booking workspace
            </p>
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Quick booking</h2>
            <p className="text-sm text-muted-foreground">
              Find a suitable room, capture guest details, and review the stay before confirmation.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setStep(1);
                onCalendarOpenChange(true);
              }}
            >
              <CalendarDays aria-hidden="true" />
              Open calendar
            </Button>
            <Button type="button" variant="outline" onClick={resetBooking}>
              <RotateCcw aria-hidden="true" />
              Reset search
            </Button>
          </div>
        </div>
      </Card>

      <Card className="gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold sm:text-base">Booking progress</h3>
            <Badge variant="info">Step {step} of 4</Badge>
          </div>
          {step === 1 && !hasSearched ? (
            <Badge variant="warning">Refresh availability to continue</Badge>
          ) : null}
        </div>
        <ol
          aria-label="Booking progress"
          className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4"
        >
          {stepTitles.map((item) => {
            const isComplete = item.number < step;
            const isCurrent = item.number === step;
            return (
              <li key={item.number}>
                <button
                  type="button"
                  aria-current={isCurrent ? 'step' : undefined}
                  disabled={item.number > step}
                  onClick={() => setStep(item.number)}
                  className={`flex min-h-[4.75rem] w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-default ${isCurrent ? 'border-primary/40 bg-primary/[0.045] text-foreground shadow-xs ring-1 ring-primary/10' : isComplete ? 'border-success/30 bg-success-surface/20 text-foreground hover:bg-success-surface/35' : 'bg-muted/20 text-muted-foreground'}`}
                >
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${isCurrent ? 'bg-primary text-primary-foreground shadow-sm' : isComplete ? 'bg-success-surface text-success' : 'bg-muted text-muted-foreground'}`}
                  >
                    {isComplete ? <Check aria-hidden="true" className="size-4" /> : item.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="block text-sm font-semibold">{item.title}</span>
                      <span
                        className={`shrink-0 text-[10px] font-semibold tracking-wide uppercase ${isCurrent ? 'text-primary' : isComplete ? 'text-success' : 'text-muted-foreground'}`}
                      >
                        {isCurrent ? 'Current' : isComplete ? 'Complete' : 'Next'}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">{item.detail}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.85fr)]">
        <div className="min-w-0 space-y-5">
          {step === 1 ? (
            <>
              <Card className="gap-4 p-4 sm:p-5">
                <PanelHeading
                  title="Search availability"
                  subtitle="Set the stay and guest mix to find matching room types."
                  action={
                    <Badge variant={hasSearched ? 'success' : 'muted'}>
                      {hasSearched ? 'Search ready' : 'Search needs refresh'}
                    </Badge>
                  }
                />
                <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(210px,1.3fr)_minmax(170px,1fr)_minmax(145px,0.75fr)]">
                  <div className="space-y-2">
                    <Label>Stay dates</Label>
                    <CalendarPicker
                      label={`Stay dates${stayDates.start ? ` · ${dateSummary}` : ''}`}
                      mode="range"
                      value={stayDates}
                      onChange={(value) => {
                        setStayDates(value);
                        markSearchStale();
                      }}
                      open={calendarOpen}
                      onOpenChange={onCalendarOpenChange}
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="quick-booking-room-filter">Room type</Label>
                    <Select
                      value={roomTypeFilter}
                      onValueChange={(value) => {
                        setRoomTypeFilter(value as typeof roomTypeFilter);
                        markSearchStale();
                      }}
                    >
                      <SelectTrigger
                        id="quick-booking-room-filter"
                        className="h-10 w-full bg-card pr-4"
                      >
                        <SelectValue placeholder="Any room type" />
                      </SelectTrigger>
                      <SelectContent align="start">
                        <SelectItem value="all">Any room type</SelectItem>
                        {quickBookingRooms.map((room) => (
                          <SelectItem key={room.id} value={room.id}>
                            {room.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <QuantityStepper
                    label="Rooms"
                    value={roomCount}
                    minimum={1}
                    maximum={Math.max(...quickBookingRooms.map((room) => room.count))}
                    onChange={updateRoomCount}
                  />
                </div>
                <section aria-labelledby="quick-booking-room-guests-title" className="space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 id="quick-booking-room-guests-title" className="text-sm font-semibold">
                      Guests per room
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {guestCountSummary} across {roomCount} {roomCount === 1 ? 'room' : 'rooms'}
                    </p>
                  </div>
                  <div className="space-y-3">
                    {roomRows.map(({ index, occupancy }) => (
                      <article key={index} className="rounded-xl border bg-muted/15 p-3 sm:p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                              {index + 1}
                            </span>
                            <h4 className="text-sm font-semibold">Room {index + 1}</h4>
                            {selectedRoom ? (
                              <Badge variant="muted">{selectedRoom.name}</Badge>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Up to {selectedRoom?.capacity ?? '—'} guests
                          </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <QuantityStepper
                            label="Adults"
                            value={occupancy.adults}
                            minimum={1}
                            maximum={8}
                            onChange={(value) =>
                              updateRoomOccupancy(index, (current) => ({
                                ...current,
                                adults: value,
                              }))
                            }
                          />
                          <QuantityStepper
                            label="Children"
                            value={occupancy.children}
                            minimum={0}
                            maximum={6}
                            onChange={(value) =>
                              updateRoomOccupancy(index, (current) => ({
                                ...current,
                                children: value,
                                childAges: Array.from(
                                  { length: value },
                                  (_, ageIndex) => current.childAges[ageIndex] ?? '7 years',
                                ),
                              }))
                            }
                          />
                        </div>
                        {occupancy.children > 0 ? (
                          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {occupancy.childAges.map((age, childIndex) => (
                              <div key={childIndex} className="space-y-2">
                                <Label
                                  htmlFor={`quick-booking-room-${index + 1}-child-age-${childIndex + 1}`}
                                >
                                  Child {childIndex + 1} age
                                </Label>
                                <Select
                                  value={age}
                                  onValueChange={(value) =>
                                    updateRoomOccupancy(index, (current) => ({
                                      ...current,
                                      childAges: current.childAges.map((currentAge, ageIndex) =>
                                        ageIndex === childIndex ? value : currentAge,
                                      ),
                                    }))
                                  }
                                >
                                  <SelectTrigger
                                    id={`quick-booking-room-${index + 1}-child-age-${childIndex + 1}`}
                                    className="h-10 w-full bg-card pr-4"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent align="start">
                                    {[
                                      'Under 2',
                                      '2 years',
                                      '3 years',
                                      '4 years',
                                      '5 years',
                                      '6 years',
                                      '7 years',
                                      '8 years',
                                      '9 years',
                                      '10 years',
                                      '11 years',
                                      '12 years',
                                    ].map((ageOption) => (
                                      <SelectItem key={ageOption} value={ageOption}>
                                        {ageOption}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </section>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <p className="text-xs text-muted-foreground">
                    Room availability and rates are checked again before confirmation.
                  </p>
                  <Button type="button" onClick={refreshAvailability}>
                    <RefreshCw aria-hidden="true" />
                    Refresh availability
                  </Button>
                </div>
                {message ? (
                  <p
                    role="status"
                    aria-live="polite"
                    className="rounded-lg border border-info/30 bg-info-surface/30 p-3 text-sm text-info"
                  >
                    {message}
                  </p>
                ) : null}
              </Card>

              <Card className="gap-4 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold">Available room types</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {hasSearched
                        ? `${suitableRoomTypes.length} room types fit ${dateSummary} for ${guestCountSummary}.`
                        : 'Refresh availability to see rooms that match this search.'}
                    </p>
                  </div>
                  {hasSearched ? (
                    <Badge variant="success">{suitableRoomTypes.length} matches</Badge>
                  ) : null}
                </div>
                {hasSearched ? (
                  <div className="space-y-3">
                    {roomTypesInScope.map((room) => {
                      const fitsParty =
                        room.capacity >= largestRoomParty && room.count >= roomCount;
                      const isSelected = selectedRoomTypeId === room.id && fitsParty;
                      const roomTotal = room.rate * nights * roomCount;
                      return (
                        <article
                          key={room.id}
                          className={`rounded-xl border p-4 transition-colors ${isSelected ? 'border-primary/50 bg-primary/[0.025]' : 'bg-card'}`}
                        >
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex min-w-0 gap-3">
                              <span
                                className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${isSelected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
                              >
                                <BedDouble aria-hidden="true" className="size-5" />
                              </span>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="font-semibold">{room.name}</h4>
                                  <Badge
                                    variant={
                                      fitsParty
                                        ? room.count <= 1
                                          ? 'warning'
                                          : 'success'
                                        : 'muted'
                                    }
                                  >
                                    {fitsParty
                                      ? `${room.count} ${room.count === 1 ? 'room' : 'rooms'} available`
                                      : room.count < roomCount
                                        ? `Only ${room.count} ${room.count === 1 ? 'room' : 'rooms'} available`
                                        : `Fits up to ${room.capacity} per room`}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {room.description}
                                </p>
                                <p className="mt-2 text-xs text-muted-foreground">
                                  Up to {room.capacity} guests per room · {room.roomNumbers.length}{' '}
                                  individual rooms
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end">
                              <div className="text-right">
                                <p className="text-lg font-bold">{euroAmount(room.rate)} / night</p>
                                <p className="text-xs text-muted-foreground">
                                  {euroAmount(roomTotal)} · {nights}{' '}
                                  {nights === 1 ? 'night' : 'nights'}
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant={isSelected ? 'success' : 'outline'}
                                disabled={!fitsParty}
                                aria-pressed={isSelected}
                                onClick={() => {
                                  changeRoomType(room);
                                }}
                              >
                                {isSelected ? <Check aria-hidden="true" /> : null}
                                {isSelected ? 'Selected' : 'Select room type'}
                              </Button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                    {roomTypesInScope.length === 0 ? (
                      <div className="rounded-xl border border-dashed p-8 text-center">
                        <p className="font-semibold">No room types found</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Choose another room type or search scope.
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed p-8 text-center">
                    <Search aria-hidden="true" className="mx-auto size-5 text-muted-foreground" />
                    <p className="mt-2 font-semibold">Search to see matching rooms</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Your current dates and guest count will be used to refresh the list.
                    </p>
                  </div>
                )}
              </Card>
            </>
          ) : null}

          {step === 2 ? (
            <Card className="gap-5 p-4 sm:p-6">
              <PanelHeading
                title="Guest details"
                subtitle="Add the lead guest’s contact details, then fill in any companion names."
                action={<Badge variant="info">Step 2 of 4</Badge>}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="quick-booking-guest-first-name">First name</Label>
                  <Input
                    id="quick-booking-guest-first-name"
                    autoComplete="given-name"
                    value={guestFirstName}
                    onChange={(event) => setGuestFirstName(event.target.value)}
                    placeholder="First name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quick-booking-guest-last-name">Last name</Label>
                  <Input
                    id="quick-booking-guest-last-name"
                    autoComplete="family-name"
                    value={guestLastName}
                    onChange={(event) => setGuestLastName(event.target.value)}
                    placeholder="Last name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quick-booking-guest-email">Email address</Label>
                  <Input
                    id="quick-booking-guest-email"
                    type="email"
                    autoComplete="email"
                    value={guestEmail}
                    onChange={(event) => setGuestEmail(event.target.value)}
                    placeholder="guest@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quick-booking-guest-phone">Phone number</Label>
                  <div className="flex gap-2">
                    <PhoneCountryCodePicker value={phoneCountryId} onChange={setPhoneCountryId} />
                    <Input
                      id="quick-booking-guest-phone"
                      type="tel"
                      autoComplete="tel-national"
                      value={guestPhone}
                      onChange={(event) => setGuestPhone(event.target.value)}
                      placeholder="69 123 4567"
                    />
                  </div>
                </div>
                <section
                  className="space-y-3 border-t pt-4 sm:col-span-2"
                  aria-labelledby="quick-booking-additional-guests"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 id="quick-booking-additional-guests" className="text-sm font-semibold">
                        Other guests
                      </h3>
                      <Badge variant="muted">Optional</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {additionalGuestSlots.length
                        ? `Add names for the ${additionalGuestSlots.length} other ${additionalGuestSlots.length === 1 ? 'guest' : 'guests'} in the selected rooms.`
                        : 'The lead guest is the only guest in this booking.'}
                    </p>
                  </div>
                  {additionalGuestSlots.length ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {additionalGuestSlots.map((slot) => (
                        <div key={slot.id} className="space-y-2">
                          <Label htmlFor={`quick-booking-${slot.id}`}>{slot.label}</Label>
                          <Input
                            id={`quick-booking-${slot.id}`}
                            value={otherGuestNames[slot.id] ?? ''}
                            onChange={(event) =>
                              setOtherGuestNames((current) => ({
                                ...current,
                                [slot.id]: event.target.value,
                              }))
                            }
                            placeholder="Full name (optional)"
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
                <details className="rounded-xl border px-4 py-3 sm:col-span-2">
                  <summary className="cursor-pointer text-sm font-semibold focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
                    More guest profile details{' '}
                    <span className="font-normal text-muted-foreground">· Optional</span>
                  </summary>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="quick-booking-company">Company</Label>
                      <Input
                        id="quick-booking-company"
                        autoComplete="organization"
                        value={companyName}
                        onChange={(event) => setCompanyName(event.target.value)}
                        placeholder="Company name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="quick-booking-country">Country</Label>
                      <Input
                        id="quick-booking-country"
                        autoComplete="country-name"
                        value={addressCountry}
                        onChange={(event) => setAddressCountry(event.target.value)}
                        placeholder="Country of address"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="quick-booking-street-address">Street address</Label>
                      <Input
                        id="quick-booking-street-address"
                        autoComplete="address-line1"
                        value={streetAddress}
                        onChange={(event) => setStreetAddress(event.target.value)}
                        placeholder="Street and number"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="quick-booking-address-line-2">Address line 2</Label>
                      <Input
                        id="quick-booking-address-line-2"
                        autoComplete="address-line2"
                        value={addressLine2}
                        onChange={(event) => setAddressLine2(event.target.value)}
                        placeholder="Apartment, suite, unit (optional)"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="quick-booking-city">City</Label>
                      <Input
                        id="quick-booking-city"
                        autoComplete="address-level2"
                        value={city}
                        onChange={(event) => setCity(event.target.value)}
                        placeholder="City"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="quick-booking-county">Region / county</Label>
                      <Input
                        id="quick-booking-county"
                        autoComplete="address-level1"
                        value={county}
                        onChange={(event) => setCounty(event.target.value)}
                        placeholder="Region or county"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="quick-booking-postcode">Postcode</Label>
                      <Input
                        id="quick-booking-postcode"
                        autoComplete="postal-code"
                        value={postcode}
                        onChange={(event) => setPostcode(event.target.value)}
                        placeholder="Postcode"
                      />
                    </div>
                  </div>
                </details>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="quick-booking-special-request">
                    Special request{' '}
                    <span className="font-normal text-muted-foreground">· Optional</span>
                  </Label>
                  <Input
                    id="quick-booking-special-request"
                    value={specialRequest}
                    onChange={(event) => setSpecialRequest(event.target.value)}
                    placeholder="Add a request for the front desk"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  Provide an email address or a phone number.
                </p>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setStep(1)}>
                    <ArrowLeft aria-hidden="true" />
                    Back to room search
                  </Button>
                  <Button type="button" onClick={continueToReview}>
                    Continue to review
                    <ArrowRight aria-hidden="true" />
                  </Button>
                </div>
              </div>
              {message ? (
                <p
                  role="alert"
                  className="rounded-lg border border-warning/30 bg-warning-surface/30 p-3 text-sm text-warning"
                >
                  {message}
                </p>
              ) : null}
            </Card>
          ) : null}

          {step === 3 ? (
            <Card className="gap-5 p-4 sm:p-6">
              <PanelHeading
                title="Review & payment"
                subtitle="Review each room, guest assignment and payment arrangement."
                action={<Badge variant="info">Step 3 of 4</Badge>}
              />
              <section className="rounded-xl border bg-muted/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{guestName}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{guestContactSummary}</p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setStep(2)}>
                    Edit guest
                  </Button>
                </div>
                <dl className="mt-4 grid gap-3 border-t pt-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Stay</dt>
                    <dd className="mt-1 font-medium">
                      {dateSummary} · {nights} {nights === 1 ? 'night' : 'nights'}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">Room assignments</dt>
                    <dd className="mt-1 space-y-1 font-medium">
                      {roomRows.map(({ index, number, occupancy }) => (
                        <p key={index}>
                          Room {index + 1} · {selectedRoom?.name} · Unit {number} ·{' '}
                          {occupancy.adults} {occupancy.adults === 1 ? 'adult' : 'adults'}
                          {occupancy.children
                            ? ` · ${occupancy.children} ${occupancy.children === 1 ? 'child' : 'children'} (${occupancy.childAges.join(', ')})`
                            : ''}
                        </p>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Guests</dt>
                    <dd className="mt-1 font-medium">{guestCountSummary}</dd>
                  </div>
                  {companyName.trim() ? (
                    <div>
                      <dt className="text-xs text-muted-foreground">Company</dt>
                      <dd className="mt-1 font-medium">{companyName.trim()}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-xs text-muted-foreground">Special request</dt>
                    <dd className="mt-1 font-medium">{specialRequest || 'None'}</dd>
                  </div>
                </dl>
              </section>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="quick-booking-payment-status">Payment status</Label>
                  <Select
                    value={paymentStatus}
                    onValueChange={(value) => setPaymentState(value as typeof paymentStatus)}
                  >
                    <SelectTrigger
                      id="quick-booking-payment-status"
                      className="h-10 w-full bg-card pr-4"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectItem value="unpaid">Unpaid</SelectItem>
                      <SelectItem value="partial">Deposit paid</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quick-booking-payment-method">Payment method</Label>
                  <Select
                    value={paymentMethod}
                    onValueChange={(value) => setPaymentMethod(value as typeof paymentMethod)}
                  >
                    <SelectTrigger
                      id="quick-booking-payment-method"
                      className="h-10 w-full bg-card pr-4"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectItem value="pay-at-hotel">Pay at hotel</SelectItem>
                      <SelectItem value="pokpay">PokPay online</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="card-in-person">Card in person</SelectItem>
                      <SelectItem value="bank-transfer">Bank transfer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {paymentMethod === 'pokpay' ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-info/30 bg-info-surface/20 p-3 sm:col-span-2">
                    <div>
                      <p className="text-sm font-semibold">PokPay checkout</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Opens a separate payment page for{' '}
                        {euroAmount(Math.max(0, total - collected))}.
                      </p>
                    </div>
                    <Button asChild variant="outline">
                      <a href={pokpayCheckoutHref} target="_blank" rel="noopener noreferrer">
                        <ExternalLink aria-hidden="true" />
                        Open PokPay in new tab
                      </a>
                    </Button>
                  </div>
                ) : null}
                {paymentStatus !== 'unpaid' ? (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="quick-booking-amount-collected">Amount received</Label>
                    <div className="relative">
                      <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                        €
                      </span>
                      <Input
                        id="quick-booking-amount-collected"
                        type="number"
                        min={0}
                        max={total}
                        step="0.01"
                        value={amountCollected}
                        onChange={(event) => setAmountCollected(event.target.value)}
                        className="pl-8"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <Button type="button" variant="outline" onClick={() => setStep(2)}>
                  <ArrowLeft aria-hidden="true" />
                  Back to guest details
                </Button>
                <Button type="button" onClick={confirmBookingDetails}>
                  Confirm booking details
                  <ArrowRight aria-hidden="true" />
                </Button>
              </div>
              {message ? (
                <p
                  role="alert"
                  className="rounded-lg border border-warning/30 bg-warning-surface/30 p-3 text-sm text-warning"
                >
                  {message}
                </p>
              ) : null}
            </Card>
          ) : null}

          {step === 4 ? (
            <Card className="gap-5 p-5 sm:p-7">
              <div className="flex flex-col items-center gap-3 py-5 text-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-success-surface text-success">
                  <CheckCircle2 aria-hidden="true" className="size-7" />
                </span>
                <div>
                  <Badge variant="success">Confirmation</Badge>
                  <h3 className="mt-3 text-2xl font-extrabold tracking-tight">
                    Booking details confirmed
                  </h3>
                  <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
                    {guestName} · {roomCount} {roomCount === 1 ? 'room' : 'rooms'} · {dateSummary}
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border p-4">
                  <p className="text-xs text-muted-foreground">Guest</p>
                  <p className="mt-1 font-semibold">{guestName}</p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {guestContactSummary}
                  </p>
                </div>
                <div className="rounded-xl border p-4">
                  <p className="text-xs text-muted-foreground">Stay</p>
                  <p className="mt-1 font-semibold">{dateSummary}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {nights} {nights === 1 ? 'night' : 'nights'} · {guestCountSummary}
                  </p>
                </div>
                <div className="rounded-xl border p-4">
                  <p className="text-xs text-muted-foreground">Rooms</p>
                  <p className="mt-1 font-semibold">
                    {roomCount} {roomCount === 1 ? 'room' : 'rooms'} · {selectedRoom?.name}
                  </p>
                  {roomRows.map(({ index, number }) => (
                    <p key={index} className="mt-1 text-xs text-muted-foreground">
                      Room {index + 1} · Unit {number}
                    </p>
                  ))}
                </div>
                <div className="rounded-xl border p-4">
                  <p className="text-xs text-muted-foreground">Payment</p>
                  <p className="mt-1 font-semibold">
                    {paymentStatus === 'paid'
                      ? 'Paid'
                      : paymentStatus === 'partial'
                        ? 'Deposit received'
                        : paymentMethod === 'pokpay'
                          ? 'Payment due · PokPay'
                          : paymentMethod === 'pay-at-hotel'
                            ? 'Pay at hotel'
                            : 'Payment due'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {paymentStatus === 'unpaid'
                      ? paymentMethodLabel
                      : `${euroAmount(collected)} · ${paymentMethodLabel}`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <Button type="button" variant="outline" onClick={() => setStep(3)}>
                  <ArrowLeft aria-hidden="true" />
                  Review booking
                </Button>
                <Button type="button" onClick={resetBooking}>
                  <CalendarPlus aria-hidden="true" />
                  Start another booking
                </Button>
              </div>
            </Card>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-5" aria-label="Booking summary">
          <Card className="gap-4 p-4 sm:p-5">
            <PanelHeading
              title="Booking summary"
              subtitle="Your current stay selection."
              action={
                step > 1 && step < 4 ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setStep(1)}>
                    Edit search
                  </Button>
                ) : undefined
              }
            />
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Dates</dt>
                <dd className="text-right font-medium">{dateSummary}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Length</dt>
                <dd className="font-medium">
                  {nights} {nights === 1 ? 'night' : 'nights'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Rooms</dt>
                <dd className="text-right font-medium">
                  {roomCount} {roomCount === 1 ? 'room' : 'rooms'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Guests</dt>
                <dd className="text-right font-medium">{guestCountSummary}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Search scope</dt>
                <dd className="text-right font-medium">
                  {roomTypeFilter === 'all'
                    ? 'All room types'
                    : quickBookingRooms.find((room) => room.id === roomTypeFilter)?.name}
                </dd>
              </div>
            </dl>
            {selectedRoom ? (
              <div className="border-t pt-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-info-surface text-info">
                    <BedDouble aria-hidden="true" className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{selectedRoom.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{selectedRoom.description}</p>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {roomRows.map(({ index, number }) => (
                    <div key={index} className="space-y-2">
                      <Label htmlFor={`quick-booking-individual-room-${index + 1}`}>
                        Room {index + 1} · Individual room
                      </Label>
                      <Select
                        value={number}
                        onValueChange={(value) =>
                          setRoomNumbers((current) =>
                            current.map((roomNumberValue, roomIndex) =>
                              roomIndex === index ? value : roomNumberValue,
                            ),
                          )
                        }
                        disabled={!hasSearched || step !== 1}
                      >
                        <SelectTrigger
                          id={`quick-booking-individual-room-${index + 1}`}
                          className="h-10 w-full bg-card pr-4"
                        >
                          <SelectValue placeholder="Select an individual room" />
                        </SelectTrigger>
                        <SelectContent align="start">
                          {selectedRoom.roomNumbers.map((room) => (
                            <SelectItem
                              key={room}
                              value={room}
                              disabled={roomRows.some(
                                (otherRoom) =>
                                  otherRoom.index !== index && otherRoom.number === room,
                              )}
                            >
                              Room {room}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          <Card className="gap-4 p-4 sm:p-5">
            <PanelHeading
              title="Price & booking checks"
              subtitle="Based on the selected rooms and stay length."
            />
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">
                  {roomCount} × {nights} {nights === 1 ? 'night' : 'nights'} ×{' '}
                  {euroAmount(selectedRoom?.rate ?? 0)}
                </dt>
                <dd className="font-medium">{euroAmount(total)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t pt-3 text-base font-bold">
                <dt>Stay total</dt>
                <dd className="text-primary">{euroAmount(total)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Availability</dt>
                <dd
                  className={hasSearched ? 'font-medium text-success' : 'font-medium text-warning'}
                >
                  {hasSearched ? 'Search complete' : 'Refresh needed'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Payment</dt>
                <dd className="font-medium">
                  {paymentStatus === 'paid'
                    ? 'Paid'
                    : paymentStatus === 'partial'
                      ? 'Deposit paid'
                      : 'Not collected'}
                </dd>
              </div>
            </dl>
            <div className="space-y-2 border-t pt-4 text-xs text-muted-foreground">
              <p className="flex items-start gap-2">
                <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                Guest count is checked against room capacity.
              </p>
              <p className="flex items-start gap-2">
                <RefreshCw aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
                Availability and price should be revalidated before the booking is submitted.
              </p>
            </div>
          </Card>

          <Card className="gap-3 p-4 sm:p-5">
            <h3 className="font-bold">
              {step === 1
                ? 'Ready for guest details'
                : step === 2
                  ? 'Ready for review'
                  : step === 3
                    ? 'Ready to confirm'
                    : 'Booking details confirmed'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {step === 1
                ? 'Choose a room type, assign individual rooms and set guests for each room.'
                : step === 2
                  ? 'Verify contact details before reviewing payment and the full stay total.'
                  : step === 3
                    ? 'Check the selected room, stay dates and payment status before confirming.'
                    : 'Review the booking details or start another reservation.'}
            </p>
            {step === 1 ? (
              <Button
                type="button"
                className="w-full"
                disabled={!canContinueFromSearch}
                onClick={() => {
                  if (!canContinueFromSearch) {
                    setMessage(
                      'Refresh availability and assign a suitable room to each guest group.',
                    );
                    return;
                  }
                  setMessage(null);
                  setStep(2);
                }}
              >
                Continue to guest details
                <ArrowRight aria-hidden="true" />
              </Button>
            ) : step === 2 ? (
              <Button type="button" className="w-full" onClick={continueToReview}>
                Continue to review
                <ArrowRight aria-hidden="true" />
              </Button>
            ) : step === 3 ? (
              <Button type="button" className="w-full" onClick={confirmBookingDetails}>
                Confirm booking details
                <Check aria-hidden="true" />
              </Button>
            ) : (
              <Button type="button" variant="outline" className="w-full" onClick={resetBooking}>
                Start another booking
                <CalendarPlus aria-hidden="true" />
              </Button>
            )}
            {step === 2 && message ? (
              <p role="alert" className="text-sm text-warning">
                {message}
              </p>
            ) : null}
            {step === 3 && message ? (
              <p role="alert" className="text-sm text-warning">
                {message}
              </p>
            ) : null}
          </Card>
        </aside>
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const { dashboardName } = useDesignPreviewContext();
  const [tab, setTab] = useState<OverviewTab>('overview');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [approvalStatuses, setApprovalStatuses] = useState<Record<string, ApprovalStatus>>(
    () =>
      Object.fromEntries(sampleApprovals.map(({ reference }) => [reference, 'pending'])) as Record<
        string,
        ApprovalStatus
      >,
  );
  const pendingApprovalCount = Object.values(approvalStatuses).filter(
    (status) => status === 'pending',
  ).length;
  const bookingIssueCount = attentionItems.filter((item) => item.category === 'booking').length;
  const paymentIssueCount = attentionItems.filter((item) => item.category === 'payment').length;
  const urgentIssueCount = attentionItems.filter((item) => item.priority === 'urgent').length;
  const displayedMetrics = metricsForHotel('all').map((metric) => {
    if (metric.label === 'Needs review') {
      return {
        ...metric,
        value: String(attentionItems.length),
        context: `${bookingIssueCount} bookings · ${paymentIssueCount} payments`,
        delta: `${urgentIssueCount} urgent`,
        comparison: `${attentionItems.length - urgentIssueCount} need review`,
      };
    }
    if (metric.label === 'Payment follow-up') {
      const failedCount = attentionItems.filter(
        (item) => item.category === 'payment' && item.reservation.payment === 'failed',
      ).length;
      const partialCount = attentionItems.filter(
        (item) => item.category === 'payment' && item.reservation.payment === 'partial',
      ).length;
      const unpaidCount = attentionItems.filter(
        (item) => item.category === 'payment' && item.reservation.payment === 'unpaid',
      ).length;
      return {
        ...metric,
        value: String(paymentIssueCount),
        context: `${paymentIssueCount} payment records`,
        delta: `${failedCount} urgent`,
        comparison: `${unpaidCount} unpaid · ${failedCount} failed · ${partialCount} partial`,
      };
    }
    return metric;
  });

  function updateApprovalStatus(reference: string, status: ApprovalStatus) {
    setApprovalStatuses((current) => ({ ...current, [reference]: status }));
  }

  function changeTab(value: string) {
    if (
      value === 'overview' ||
      value === 'attention' ||
      value === 'approvals' ||
      value === 'quick-booking' ||
      value === 'system-health'
    ) {
      setTab(value);
    }
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList
          aria-label="Dashboard workspaces"
          className="mx-auto h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border bg-card p-1 sm:w-fit sm:max-w-full"
        >
          <TabsTrigger
            value="overview"
            className="min-h-10 flex-none px-3 data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
          >
            <CalendarDays aria-hidden="true" />
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="attention"
            className="min-h-10 flex-none px-3 data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
          >
            <CircleAlert aria-hidden="true" />
            Needs attention
            <span className="rounded-full bg-warning-surface px-1.5 text-[10px] leading-4 font-bold text-warning">
              {attentionItems.length}
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="approvals"
            className="min-h-10 flex-none px-3 data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
          >
            <CheckCircle2 aria-hidden="true" />
            Approvals
            {pendingApprovalCount > 0 ? (
              <span className="rounded-full bg-warning-surface px-1.5 text-[10px] leading-4 font-bold text-warning">
                {pendingApprovalCount}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger
            value="quick-booking"
            className="min-h-10 flex-none px-3 data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
          >
            <CalendarPlus aria-hidden="true" />
            Quick booking
          </TabsTrigger>
          <TabsTrigger
            value="system-health"
            className="min-h-10 flex-none px-3 data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
          >
            <ShieldCheck aria-hidden="true" />
            System health
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pt-5">
          <OverviewHero
            dashboardName={dashboardName}
            summary={operationsSummaryByHotel.all}
            onAddReservation={() => {
              setTab('quick-booking');
              setCalendarOpen(true);
            }}
            onOpenCalendar={() => {
              setTab('quick-booking');
              setCalendarOpen(true);
            }}
            onViewReservations={() =>
              document
                .getElementById('recent-reservations')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          />
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Operations overview</h2>
              <p className="text-sm text-muted-foreground">
                Today across stays, guests, payments and sellable inventory.
              </p>
            </div>
            <Badge variant="outline">
              <Hotel aria-hidden="true" />
              {dashboardName}
            </Badge>
          </div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {displayedMetrics.map((metric) => (
              <MetricCard key={metric.label} metric={metric} />
            ))}
          </div>
          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.9fr)]">
            <div className="flex min-w-0 flex-col gap-5 xl:h-full">
              <RecentReservations />
              <RecentActivity className="xl:flex-1" />
            </div>
            <div className="min-w-0 space-y-5">
              <NeedsAttention onOpen={setTab} />
              <HealthPanel />
              <QuickActions onSelect={setTab} />
            </div>
          </div>
          <QuickBookingWorkspace
            calendarOpen={calendarOpen}
            onCalendarOpenChange={setCalendarOpen}
          />
        </TabsContent>

        <TabsContent value="attention" className="pt-5">
          <AttentionTab onBack={() => setTab('overview')} />
        </TabsContent>

        <TabsContent value="approvals" className="pt-5">
          <ApprovalsTab statuses={approvalStatuses} onDecisionChange={updateApprovalStatus} />
        </TabsContent>

        <TabsContent value="quick-booking" className="pt-5">
          <QuickBookingTab calendarOpen={calendarOpen} onCalendarOpenChange={setCalendarOpen} />
        </TabsContent>

        <TabsContent value="system-health" className="pt-5">
          <SystemHealthTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
