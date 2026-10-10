'use client';

import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  FileUp,
  Filter,
  Minus,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';

import { Badge } from '../_ui/badge';
import { Button } from '../_ui/button';
import { Card } from '../_ui/card';
import { Checkbox } from '../_ui/checkbox';
import { Input, Textarea } from '../_ui/input';
import { Label } from '../_ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../_ui/select';
import { Switch } from '../_ui/switch';

type FieldState = 'Default' | 'Focused' | 'Filled' | 'Error' | 'Disabled';
type FieldKind =
  'text' | 'notes' | 'room' | 'rates' | 'search' | 'adults' | 'money' | 'phone' | 'secret';

const fieldStates: FieldState[] = ['Default', 'Focused', 'Filled', 'Error', 'Disabled'];
const fieldExamples: Array<{ number: string; title: string; kind: FieldKind; error?: string }> = [
  { number: '01', title: 'Guest name', kind: 'text', error: 'Guest name is required.' },
  { number: '02', title: 'Internal notes', kind: 'notes', error: 'Enter a valid internal note.' },
  { number: '03', title: 'Room type', kind: 'room', error: 'Select a room type.' },
  { number: '04', title: 'Rate plans', kind: 'rates', error: 'Select at least one rate plan.' },
  { number: '05', title: 'Booking search', kind: 'search' },
  { number: '06', title: 'Adults', kind: 'adults', error: 'At least 1 adult is required.' },
  { number: '07', title: 'Deposit amount', kind: 'money', error: 'Deposit must be positive.' },
  { number: '08', title: 'Guest phone', kind: 'phone', error: 'Enter a valid phone number.' },
  { number: '09', title: 'Provider secret', kind: 'secret', error: 'Provider secret is required.' },
];

function StateInput({
  state,
  kind,
  error,
}: {
  state: FieldState;
  kind: FieldKind;
  error?: string;
}) {
  const focusClass = state === 'Focused' ? 'border-primary ring-[3px] ring-primary/20' : '';
  const invalid = state === 'Error';
  const disabled = state === 'Disabled';
  const stateClass = `${focusClass} ${invalid ? 'border-destructive text-destructive' : ''}`;
  let control;

  if (kind === 'room') {
    control = (
      <Select defaultValue={state === 'Filled' ? 'deluxe' : undefined} disabled={disabled}>
        <SelectTrigger
          aria-label={`${state} room type`}
          aria-invalid={invalid || undefined}
          className={`h-9 w-full bg-card ${stateClass}`}
        >
          <SelectValue placeholder="Select room type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="standard">Standard Double</SelectItem>
          <SelectItem value="deluxe">Deluxe Sea View</SelectItem>
          <SelectItem value="suite">Family Suite</SelectItem>
        </SelectContent>
      </Select>
    );
  } else if (kind === 'rates') {
    control = (
      <div
        aria-label={`${state} rate plans`}
        aria-invalid={invalid || undefined}
        className={`flex min-h-9 items-center gap-1 rounded-md border border-input bg-card px-2 py-1 text-xs ${stateClass} ${disabled ? 'bg-muted text-muted-foreground' : ''}`}
      >
        {state === 'Filled' ? (
          <>
            <Badge variant="secondary">
              Flexible <X aria-hidden="true" />
            </Badge>
            <Badge variant="secondary">
              Prepaid <X aria-hidden="true" />
            </Badge>
          </>
        ) : (
          <span className="flex-1 text-muted-foreground">Select rate plans</span>
        )}
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </div>
    );
  } else if (kind === 'notes') {
    control = (
      <Textarea
        aria-label={`${state} internal notes`}
        aria-invalid={invalid || undefined}
        className={`min-h-9 resize-none ${stateClass}`}
        disabled={disabled}
        placeholder="Add internal notes…"
        defaultValue={state === 'Filled' ? 'Late arrival after 22:00.' : undefined}
      />
    );
  } else if (kind === 'adults') {
    control = (
      <div
        aria-label={`${state} adults`}
        className={`flex h-9 items-center justify-between rounded-md border border-input bg-card px-2 ${stateClass} ${disabled ? 'bg-muted text-muted-foreground' : ''}`}
      >
        <Minus aria-hidden="true" className="size-4 text-muted-foreground" />
        <span>{state === 'Filled' ? '4' : state === 'Error' ? '0' : '1'}</span>
        <Plus aria-hidden="true" className="size-4 text-muted-foreground" />
      </div>
    );
  } else if (kind === 'money') {
    control = (
      <div className="relative">
        <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
          €
        </span>
        <Input
          aria-label={`${state} deposit amount`}
          aria-invalid={invalid || undefined}
          className={`pl-8 ${stateClass}`}
          disabled={disabled}
          defaultValue={state === 'Filled' ? '1,250.00' : state === 'Error' ? '-10.00' : '0.00'}
        />
      </div>
    );
  } else if (kind === 'phone') {
    control = (
      <div className="flex h-9 overflow-hidden rounded-md border border-input bg-card">
        <span className="flex items-center gap-1 border-r px-2 text-xs text-muted-foreground">
          +355 <ChevronDown className="size-3" />
        </span>
        <Input
          aria-label={`${state} guest phone`}
          aria-invalid={invalid || undefined}
          className={`h-full border-0 shadow-none focus-visible:ring-0 ${stateClass}`}
          disabled={disabled}
          defaultValue={
            state === 'Error' ? '69 123 45' : state === 'Filled' ? '69 123 4567' : '069 123 4567'
          }
        />
      </div>
    );
  } else if (kind === 'secret') {
    control = (
      <div className="relative">
        <Input
          aria-label={`${state} provider secret`}
          aria-invalid={invalid || undefined}
          className={`pr-9 ${stateClass}`}
          disabled={disabled}
          placeholder="Enter API secret"
          type="password"
          defaultValue={state === 'Filled' ? 'demo-secret' : undefined}
        />
        <Eye
          className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
      </div>
    );
  } else {
    control = (
      <div className="relative">
        {kind === 'search' ? (
          <Search
            aria-hidden="true"
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
        ) : null}
        <Input
          aria-label={`${state} ${kind === 'search' ? 'booking search' : 'guest name'}`}
          aria-invalid={invalid || undefined}
          className={`${kind === 'search' ? 'pl-9' : ''} ${stateClass}`}
          disabled={disabled}
          placeholder={kind === 'search' ? 'Booking, guest…' : 'Enter guest name'}
          defaultValue={
            state === 'Filled' ? (kind === 'search' ? 'MH-1042' : undefined) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-2">
      <span className="text-[11px] text-muted-foreground">{state}</span>
      <div className="min-w-0 space-y-1">
        {control}
        {invalid && error ? (
          <p className="flex items-center gap-1 text-[10px] leading-4 text-destructive">
            <AlertCircle aria-hidden="true" className="size-3 shrink-0" />
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function FieldCard({ number, title, kind, error }: (typeof fieldExamples)[number]) {
  return (
    <Card className="gap-4 p-4 shadow-xs">
      <h3 className="flex items-center gap-2 text-sm font-bold">
        <span className="flex size-6 items-center justify-center rounded-md bg-secondary text-[10px] text-primary">
          {number}
        </span>
        {title}
      </h3>
      <div className="space-y-2.5">
        {fieldStates.map((state) => (
          <StateInput key={state} state={state} kind={kind} error={error} />
        ))}
      </div>
    </Card>
  );
}

function ToggleExamples() {
  return (
    <div className="grid gap-3 @md/design-preview:grid-cols-3">
      <Card className="gap-4 p-4">
        <h3 className="text-sm font-bold">10 · Confirmation checkbox</h3>
        <div className="space-y-3 text-xs">
          <label className="flex items-center gap-2">
            <Checkbox aria-label="Unchecked confirmation" />
            Send booking confirmation
          </label>
          <label className="flex items-center gap-2">
            <Checkbox aria-label="Checked confirmation" defaultChecked />
            Send booking confirmation
          </label>
          <label className="flex items-center gap-2 text-muted-foreground">
            <Checkbox aria-label="Disabled confirmation" disabled />
            Send booking confirmation
          </label>
          <label className="flex items-center gap-2 text-muted-foreground">
            <Checkbox aria-label="Disabled checked confirmation" defaultChecked disabled />
            Send booking confirmation
          </label>
        </div>
      </Card>
      <Card className="gap-4 p-4">
        <h3 className="text-sm font-bold">11 · Booking mode</h3>
        <div className="space-y-3 text-xs">
          {[
            ['Instant booking', false, false],
            ['Request approval', true, false],
            ['Instant booking', false, true],
            ['Request approval', true, true],
          ].map(([label, checked, disabled], index) => (
            <label
              key={index}
              className={`flex items-center gap-2 ${disabled ? 'text-muted-foreground' : ''}`}
            >
              <input
                type="radio"
                name={`booking-mode-${index}`}
                checked={Boolean(checked)}
                readOnly
                disabled={Boolean(disabled)}
                className="size-4 accent-primary"
              />
              {label}
            </label>
          ))}
        </div>
      </Card>
      <Card className="gap-4 p-4">
        <h3 className="text-sm font-bold">12 · PMS auto-sync</h3>
        <div className="space-y-3 text-xs">
          <label className="flex items-center gap-3">
            <Switch aria-label="Auto-sync off" />
            PMS auto-sync
          </label>
          <label className="flex items-center gap-3">
            <Switch aria-label="Auto-sync on" defaultChecked />
            PMS auto-sync
          </label>
          <label className="flex items-center gap-3 text-muted-foreground">
            <Switch aria-label="Disabled auto-sync off" disabled />
            PMS auto-sync
          </label>
          <label className="flex items-center gap-3 text-muted-foreground">
            <Switch aria-label="Disabled auto-sync on" defaultChecked disabled />
            PMS auto-sync
          </label>
        </div>
      </Card>
    </div>
  );
}

function CalendarMonth({
  month,
  range = false,
}: {
  month: 'October' | 'November';
  range?: boolean;
}) {
  const daysInMonth = month === 'October' ? 31 : 30;
  const monthDays = Array.from({ length: daysInMonth }, (_, index) => index + 1);
  const blankDays = month === 'October' ? 4 : 0;
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <div className="mb-3 flex items-center justify-between text-xs font-semibold">
        <Button variant="ghost" size="icon-sm" aria-label={`Previous month before ${month}`}>
          <ChevronLeft className="size-3" />
        </Button>
        <span>{month} 2026</span>
        <Button variant="ghost" size="icon-sm" aria-label={`Next month after ${month}`}>
          <ChevronRight className="size-3" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[9px] text-muted-foreground">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
          <span key={day} className="py-1">
            {day}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
        {Array.from({ length: blankDays }, (_, index) => (
          <span key={`blank-${index}`} />
        ))}
        {monthDays.map((day) => {
          const selected = range ? (month === 'October' ? day >= 30 : day <= 3) : day === 14;
          const edge = range && (month === 'October' ? day === 30 : day === 3);
          return (
            <span
              key={day}
              className={`flex aspect-square items-center justify-center rounded-full ${selected ? 'bg-secondary text-primary' : ''} ${edge ? 'bg-primary text-primary-foreground' : ''} ${day === 20 && !range ? 'outline outline-1 outline-primary' : ''}`}
            >
              {day}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function CalendarExamples() {
  return (
    <div className="grid gap-3 @lg/design-preview:grid-cols-[minmax(0,0.8fr)_minmax(0,1.7fr)]">
      <Card className="gap-4 p-4">
        <h3 className="text-sm font-bold">13 · Check-in date</h3>
        <div className="relative">
          <Input aria-label="Check-in date" placeholder="Select check-in date" className="pr-9" />
          <CalendarDays className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
        <CalendarMonth month="October" />
      </Card>
      <Card className="gap-4 p-4">
        <h3 className="text-sm font-bold">14 · Stay date range</h3>
        <div className="relative">
          <Input aria-label="Stay date range" placeholder="Select stay dates" className="pr-9" />
          <CalendarDays className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
        <div className="grid gap-3 @md/design-preview:grid-cols-2">
          <CalendarMonth month="October" range />
          <CalendarMonth month="November" range />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm">
            Clear
          </Button>
          <Button size="sm">Apply</Button>
        </div>
      </Card>
    </div>
  );
}

function UtilityFields() {
  return (
    <div className="grid gap-3 @md/design-preview:grid-cols-2 @xl/design-preview:grid-cols-5">
      <Card className="gap-3 p-4">
        <h3 className="text-sm font-bold">15 · Check-in time</h3>
        <div className="relative">
          <Input aria-label="Check-in time" placeholder="Select check-in time" />
          <Clock3 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-2 rounded-md border p-3 text-lg font-semibold">
          10 <span className="text-muted-foreground">:</span> 30{' '}
          <Badge variant="secondary">AM</Badge>
        </div>
      </Card>
      <Card className="gap-3 p-4">
        <h3 className="text-sm font-bold">16 · Booking attachment</h3>
        <div className="grid min-h-24 place-content-center justify-items-center rounded-md border border-dashed bg-muted/20 p-3 text-center text-xs text-muted-foreground">
          <FileUp className="mb-2 size-5 text-primary" />
          <strong className="text-foreground">Drop booking files here</strong>
          <span>or click to browse · PDF, JPG, PNG · Max 10MB</span>
        </div>
        <div className="flex items-center justify-between rounded-md border p-2 text-xs">
          <span>
            guest_document.pdf <span className="text-muted-foreground">· 1.2 MB</span>
          </span>
          <X className="size-3 text-muted-foreground" />
        </div>
      </Card>
      <Card className="gap-3 p-4">
        <h3 className="text-sm font-bold">17 · Field labels</h3>
        <Label htmlFor="demo-field-email">
          Guest email <span className="text-destructive">*</span>
        </Label>
        <Input id="demo-field-email" placeholder="guest@example.com" />
        <Label htmlFor="demo-company">
          Company name <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input id="demo-company" placeholder="Enter company name" />
      </Card>
      <Card className="gap-3 p-4">
        <h3 className="text-sm font-bold">18 · Helper text</h3>
        <Label htmlFor="demo-account">
          Provider account ID <span className="text-destructive">*</span>
        </Label>
        <Input id="demo-account" placeholder="Enter account ID" />
        <p className="text-[11px] text-muted-foreground">
          Use the account identifier provided by the PMS.
        </p>
        <Label htmlFor="demo-internal-ref">
          Internal reference <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input id="demo-internal-ref" placeholder="Enter internal reference" />
      </Card>
      <Card className="gap-3 p-4">
        <h3 className="text-sm font-bold">19 · Validation messages</h3>
        <Label htmlFor="demo-invalid-amount">
          Payment amount <span className="text-destructive">*</span>
        </Label>
        <Input id="demo-invalid-amount" aria-invalid defaultValue="-10.00" />
        <p className="text-[11px] text-destructive">Amount must be greater than zero.</p>
        <Label htmlFor="demo-invalid-room">
          Room type <span className="text-destructive">*</span>
        </Label>
        <Input id="demo-invalid-room" aria-invalid placeholder="Not selected" />
        <p className="text-[11px] text-destructive">Select a room type.</p>
      </Card>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
}: {
  label: string;
  value: string;
  options: string[];
}) {
  return (
    <div className="min-w-0 space-y-1">
      <Label className="text-[11px]">{label}</Label>
      <Select defaultValue={value}>
        <SelectTrigger aria-label={label} className="h-9 w-full bg-card text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function FiltersShowcase() {
  return (
    <div className="space-y-3">
      <Card className="gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-bold">20 · Booking filters</h3>
            <p className="text-xs text-muted-foreground">
              Combine common fields to narrow a reservations list.
            </p>
          </div>
          <Badge variant="muted">3 filters applied</Badge>
        </div>
        <div className="grid gap-3 @md/design-preview:grid-cols-2 @xl/design-preview:grid-cols-6">
          <div className="space-y-1">
            <Label htmlFor="filter-search" className="text-[11px]">
              Search
            </Label>
            <div className="relative">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="filter-search" className="pl-9 text-xs" placeholder="Booking or guest…" />
            </div>
          </div>
          <FilterSelect
            label="Booking status"
            value="All statuses"
            options={['All statuses', 'Confirmed', 'Pending', 'Cancelled']}
          />
          <FilterSelect
            label="Hotel"
            value="Demo hotel"
            options={['All hotels', 'Demo hotel', 'Harbor View Hotel']}
          />
          <div className="space-y-1">
            <Label htmlFor="filter-dates" className="text-[11px]">
              Stay dates
            </Label>
            <div className="relative">
              <Input id="filter-dates" className="pr-8 text-xs" defaultValue="Oct 30 – Nov 3" />
              <CalendarDays className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>
          <FilterSelect
            label="Source"
            value="All sources"
            options={['All sources', 'Website', 'Walk-in', 'Clock PMS']}
          />
          <FilterSelect
            label="Payment status"
            value="All payments"
            options={['All payments', 'Paid', 'Unpaid', 'Refunded']}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button>
            <Filter aria-hidden="true" />
            Apply filters
          </Button>
          <Button variant="outline">
            <X aria-hidden="true" />
            Reset
          </Button>
        </div>
      </Card>
      <div className="grid gap-3 @md/design-preview:grid-cols-2 @xl/design-preview:grid-cols-3">
        <Card className="gap-3 p-4">
          <h3 className="text-sm font-bold">21 · Filter chips</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">
              Confirmed <X />
            </Badge>
            <Badge variant="success">
              Paid <X />
            </Badge>
            <Badge variant="secondary">
              Hotel: Demo <X />
            </Badge>
            <Button variant="outline" size="sm">
              <Plus />
              Add filter
            </Button>
          </div>
        </Card>
        <Card className="gap-3 p-4">
          <h3 className="text-sm font-bold">22 · Active filter summary</h3>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <SlidersHorizontal className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">3 filters applied</span>
            <Badge variant="success">
              Confirmed <X />
            </Badge>
            <Badge variant="success">
              Paid <X />
            </Badge>
            <Badge variant="secondary">
              Hotel: Demo <X />
            </Badge>
          </div>
        </Card>
        <Card className="gap-3 p-4">
          <h3 className="text-sm font-bold">23 · Clear filters</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm">
              Clear filters <X />
            </Button>
            <span className="text-[11px] text-muted-foreground">Removes all active filters.</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

function CompositeFields() {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold">Hotel-specific composite fields</h2>
        <p className="text-sm text-muted-foreground">
          Examples that combine controls for booking, inventory, pricing, and provider workflows.
        </p>
      </div>
      <div className="grid gap-3 @lg/design-preview:grid-cols-2">
        <Card className="gap-3 p-4">
          <h3 className="text-sm font-bold">24 · Guest occupancy</h3>
          <p className="text-xs text-muted-foreground">
            Adults, children, and each child age are separate pricing inputs.
          </p>
          <div className="grid gap-3 @sm/design-preview:grid-cols-3">
            <div>
              <Label>Adults</Label>
              <Input className="mt-1" defaultValue="2" />
            </div>
            <div>
              <Label>Children</Label>
              <Input className="mt-1" defaultValue="1" />
            </div>
            <div>
              <Label>Child age</Label>
              <Input className="mt-1" defaultValue="7 years" />
            </div>
          </div>
          <p className="text-[11px] text-warning">
            At least one adult is required; every child needs a valid age.
          </p>
        </Card>
        <Card className="gap-3 p-4">
          <h3 className="text-sm font-bold">25 · Inventory mapping</h3>
          <p className="text-xs text-muted-foreground">
            A public room type maps to a demo room unit.
          </p>
          <div className="grid gap-3 @sm/design-preview:grid-cols-3">
            <FilterSelect
              label="Hotel"
              value="Demo hotel"
              options={['Demo hotel', 'Harbor View Hotel']}
            />
            <FilterSelect
              label="Room type"
              value="Deluxe Sea View"
              options={['Deluxe Sea View', 'Standard Double']}
            />
            <div>
              <Label>Room unit</Label>
              <Input className="mt-1" disabled defaultValue="204 · auto-assigned" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="muted">Clock PMS · demo</Badge>
            <span className="text-muted-foreground">Source selected; no provider connection.</span>
          </div>
        </Card>
        <Card className="gap-3 p-4">
          <h3 className="text-sm font-bold">26 · Pricing configuration</h3>
          <p className="text-xs text-muted-foreground">
            Rate plan, pricing rule, mode, and deposit form one reviewable example.
          </p>
          <div className="grid gap-3 @sm/design-preview:grid-cols-2 @xl/design-preview:grid-cols-4">
            <FilterSelect label="Rate plan" value="Flexible" options={['Flexible', 'Prepaid']} />
            <FilterSelect
              label="Pricing rule"
              value="Weekend +15%"
              options={['Weekend +15%', 'Standard rate']}
            />
            <FilterSelect
              label="Booking mode"
              value="Instant"
              options={['Instant', 'Request approval']}
            />
            <div>
              <Label>Deposit</Label>
              <Input className="mt-1" defaultValue="30%" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Demo values only. Price and availability would be revalidated before payment.
          </p>
        </Card>
        <Card className="gap-3 p-4">
          <h3 className="text-sm font-bold">27 · Provider connection</h3>
          <p className="text-xs text-muted-foreground">
            Environment-bound fields with a masked demo secret.
          </p>
          <div className="grid gap-3 @sm/design-preview:grid-cols-2 @xl/design-preview:grid-cols-4">
            <FilterSelect
              label="Provider"
              value="Clock PMS"
              options={['Clock PMS', 'Demo provider']}
            />
            <FilterSelect label="Environment" value="Sandbox" options={['Sandbox', 'Production']} />
            <div>
              <Label>Account ID</Label>
              <Input className="mt-1" defaultValue="CLK-DEMO-01" />
            </div>
            <div>
              <Label>Secret</Label>
              <Input className="mt-1" type="password" defaultValue="demo-secret" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="success">
              <Check />
              Demo verified
            </Badge>
            <span className="text-muted-foreground">
              No connection or verification request is made.
            </span>
          </div>
        </Card>
      </div>
    </section>
  );
}

export default function FormsAndFiltersPage() {
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Design preview · Demo only
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight @lg/design-preview:text-3xl">
            Forms &amp; filters
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Hotel controls for bookings, guests, inventory, pricing, payments, and provider
            settings.
          </p>
        </div>
        <div
          aria-label="Field state legend"
          className="flex flex-wrap gap-3 rounded-lg border bg-card px-3 py-2 text-[11px] text-muted-foreground"
        >
          {fieldStates.map((state) => (
            <span key={state} className="flex items-center gap-1.5">
              <i
                className={`size-2.5 rounded-sm border ${state === 'Focused' ? 'border-primary bg-primary' : state === 'Error' ? 'border-destructive bg-destructive' : state === 'Disabled' ? 'bg-muted' : state === 'Filled' ? 'bg-secondary' : 'bg-card'}`}
              />
              {state}
            </span>
          ))}
        </div>
      </header>
      <section aria-labelledby="core-fields-heading" className="space-y-3">
        <div>
          <h2 id="core-fields-heading" className="text-lg font-bold">
            Field states
          </h2>
          <p className="text-sm text-muted-foreground">
            The same controls shown in default, focused, filled, error, and disabled states.
          </p>
        </div>
        <div className="grid gap-3 @md/design-preview:grid-cols-2 @xl/design-preview:grid-cols-4">
          {fieldExamples.map((field) => (
            <FieldCard key={field.number} {...field} />
          ))}
        </div>
      </section>
      <ToggleExamples />
      <CalendarExamples />
      <UtilityFields />
      <section aria-labelledby="filters-heading" className="space-y-3">
        <div>
          <h2 id="filters-heading" className="text-lg font-bold">
            Booking filters
          </h2>
          <p className="text-sm text-muted-foreground">
            Search, narrow, review active filters, and clear them.
          </p>
        </div>
        <FiltersShowcase />
      </section>
      <CompositeFields />
      <footer className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4 text-xs text-muted-foreground">
        <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          Demo controls use neutral design tokens, explicit labels, and visible validation states.
          No form submits, provider actions, or live data are connected.
        </p>
      </footer>
    </div>
  );
}
