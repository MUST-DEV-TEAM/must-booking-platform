'use client';

import { useState, type ChangeEvent, type DragEvent } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
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
import {
  CalendarPicker,
  DemoCalendar,
  formatCalendarSelection,
  type CalendarSelection,
} from '../_ui/demo-calendar';
import {
  bookingStatusOptions,
  demoBookingSourceOptions,
  demoHotelOptions,
  paymentStatusMeta,
  paymentStatusOptions,
} from '../_lib/demo-domain';
import { Input, Textarea } from '../_ui/input';
import { Label } from '../_ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../_ui/popover';
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
  const focusClass = state === 'Focused' ? 'border-ring ring-[3px] ring-ring/20' : '';
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
      <RatePlanControl
        state={state}
        invalid={invalid}
        disabled={disabled}
        stateClass={stateClass}
      />
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
        <Select defaultValue="+355" disabled={disabled}>
          <SelectTrigger
            aria-label={`${state} phone prefix`}
            className="h-full w-[5.5rem] shrink-0 rounded-none border-0 border-r bg-transparent px-2 text-xs shadow-none focus-visible:ring-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="+355">+355 · AL</SelectItem>
            <SelectItem value="+44">+44 · UK</SelectItem>
            <SelectItem value="+39">+39 · IT</SelectItem>
            <SelectItem value="+1">+1 · US</SelectItem>
          </SelectContent>
        </Select>
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
      <SecretControl state={state} stateClass={stateClass} disabled={disabled} invalid={invalid} />
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

function RatePlanControl({
  state,
  invalid,
  disabled,
  stateClass,
}: {
  state: FieldState;
  invalid: boolean;
  disabled: boolean;
  stateClass: string;
}) {
  const [selected, setSelected] = useState<string[]>(
    state === 'Filled' ? ['Flexible', 'Prepaid'] : [],
  );
  const [open, setOpen] = useState(false);
  const plans = ['Flexible', 'Prepaid', 'Non-refundable'];
  const fieldClass = `flex min-h-9 min-w-0 flex-wrap items-center gap-1 rounded-md border border-input bg-card px-2 py-1 text-xs ${stateClass} ${disabled ? 'bg-muted text-muted-foreground' : ''}`;

  function toggle(plan: string) {
    setSelected((current) =>
      current.includes(plan) ? current.filter((item) => item !== plan) : [...current, plan],
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div aria-invalid={invalid || undefined} className={fieldClass}>
        {selected.map((plan) => (
          <Badge
            key={plan}
            variant="secondary"
            className="max-w-full min-w-0 shrink gap-1 px-1.5 py-0.5 text-[10px] font-medium"
          >
            <span className="min-w-0 truncate">{plan}</span>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove ${plan} rate plan`}
              onClick={() => toggle(plan)}
              className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </Badge>
        ))}
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${state} rate plans${selected.length ? `, ${selected.length} selected` : ''}`}
            disabled={disabled}
            className="flex min-h-7 min-w-7 flex-1 items-center justify-between gap-2 rounded-sm text-left outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {selected.length ? null : (
              <span className="text-muted-foreground">Select rate plans</span>
            )}
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent align="start" className="w-56 p-2">
        <p className="px-2 py-1 text-xs font-semibold">Choose rate plans</p>
        {plans.map((plan) => (
          <label
            key={plan}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
          >
            <Checkbox checked={selected.includes(plan)} onCheckedChange={() => toggle(plan)} />
            {plan}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function SecretControl({
  state,
  stateClass,
  disabled,
  invalid,
}: {
  state: FieldState;
  stateClass: string;
  disabled: boolean;
  invalid: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const hasSecret = state === 'Filled';
  return (
    <div className="relative">
      <Input
        aria-label={`${state} provider secret`}
        aria-invalid={invalid || undefined}
        className={`pr-10 ${stateClass}`}
        disabled={disabled}
        placeholder="Enter API secret"
        type={visible ? 'text' : 'password'}
        defaultValue={hasSecret ? 'demo-secret' : undefined}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={visible ? 'Hide provider secret' : 'Show provider secret'}
        aria-pressed={visible}
        disabled={disabled}
        onClick={() => setVisible((current) => !current)}
        className="absolute top-1/2 right-1 -translate-y-1/2"
      >
        {visible ? <EyeOff /> : <Eye />}
      </Button>
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

function CalendarExamples() {
  const [checkIn, setCheckIn] = useState<CalendarSelection>({ start: '2026-10-14', end: null });
  const [stayRange, setStayRange] = useState<CalendarSelection>({
    start: '2026-10-30',
    end: '2026-11-03',
  });
  const [appliedRange, setAppliedRange] = useState(stayRange);

  return (
    <div className="grid gap-3 @lg/design-preview:grid-cols-[minmax(0,0.8fr)_minmax(0,1.7fr)]">
      <Card className="gap-4 p-4">
        <h3 className="text-sm font-bold">13 · Check-in date</h3>
        <Input
          aria-label="Selected check-in date"
          readOnly
          value={formatCalendarSelection(checkIn, 'single')}
        />
        <DemoCalendar selection={checkIn} mode="single" onChange={setCheckIn} />
      </Card>
      <Card className="gap-4 p-4">
        <h3 className="text-sm font-bold">14 · Stay date range</h3>
        <Input
          aria-label="Selected stay date range"
          readOnly
          value={formatCalendarSelection(stayRange, 'range')}
        />
        <DemoCalendar selection={stayRange} mode="range" months={2} onChange={setStayRange} />
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const cleared = { start: null, end: null };
              setStayRange(cleared);
              setAppliedRange(cleared);
            }}
          >
            Clear
          </Button>
          <Button size="sm" onClick={() => setAppliedRange(stayRange)}>
            Apply
          </Button>
        </div>
        <p aria-live="polite" className="text-[11px] text-muted-foreground">
          Applied: {formatCalendarSelection(appliedRange, 'range') || 'No dates selected'}
        </p>
      </Card>
    </div>
  );
}

function UtilityFields() {
  const [time, setTime] = useState('10:30');
  const [files, setFiles] = useState([{ name: 'guest_document.pdf', size: 1_200_000 }]);
  const [fileMessage, setFileMessage] = useState('');

  function addFiles(list: FileList | null) {
    if (!list) return;
    const candidates = Array.from(list);
    const next = candidates
      .filter((file) => /\.(pdf|jpe?g|png)$/i.test(file.name) && file.size <= 10_000_000)
      .map((file) => ({ name: file.name, size: file.size }));
    setFiles((current) => [...current, ...next]);
    setFileMessage(
      candidates.length === next.length
        ? ''
        : 'Only PDF, JPG, and PNG files up to 10 MB are accepted.',
    );
  }

  function formatSize(size: number) {
    return size < 1_000_000
      ? `${Math.max(0.1, size / 1_000).toFixed(0)} KB`
      : `${(size / 1_000_000).toFixed(1)} MB`;
  }

  return (
    <div className="grid gap-3 @md/design-preview:grid-cols-2 @xl/design-preview:grid-cols-5">
      <Card className="gap-3 p-4">
        <h3 className="text-sm font-bold">15 · Check-in time</h3>
        <Input
          aria-label="Check-in time"
          type="time"
          step={900}
          value={time}
          onChange={(event) => setTime(event.currentTarget.value)}
        />
        <p aria-live="polite" className="text-xs text-muted-foreground">
          Selected local time: {time || 'Not set'} · 24-hour clock
        </p>
      </Card>
      <Card className="gap-3 p-4">
        <h3 className="text-sm font-bold">16 · Booking attachment</h3>
        <label
          htmlFor="demo-booking-files"
          onDragOver={(event: DragEvent<HTMLLabelElement>) => event.preventDefault()}
          onDrop={(event: DragEvent<HTMLLabelElement>) => {
            event.preventDefault();
            addFiles(event.dataTransfer.files);
          }}
          className="grid min-h-24 cursor-pointer place-content-center justify-items-center rounded-md border border-dashed bg-muted/20 p-3 text-center text-xs text-muted-foreground hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring"
        >
          <input
            id="demo-booking-files"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            multiple
            className="sr-only"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              addFiles(event.currentTarget.files);
              event.currentTarget.value = '';
            }}
          />
          <FileUp className="mb-2 size-5 text-primary" />
          <strong className="text-foreground">Drop booking files here</strong>
          <span>or click to browse · PDF, JPG, PNG · Max 10MB</span>
        </label>
        {fileMessage ? (
          <p role="status" className="text-xs text-destructive">
            {fileMessage}
          </p>
        ) : null}
        <div className="space-y-2">
          {files.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs"
            >
              <span className="min-w-0 truncate">
                {file.name} <span className="text-muted-foreground">· {formatSize(file.size)}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${file.name}`}
                onClick={() =>
                  setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))
                }
              >
                <X />
              </Button>
            </div>
          ))}
          {files.length === 0 ? (
            <p className="text-xs text-muted-foreground">No files selected.</p>
          ) : null}
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
  selectedValue,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  selectedValue?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <Label className="text-[11px]">{label}</Label>
      <Select
        value={selectedValue}
        defaultValue={selectedValue === undefined ? value : undefined}
        onValueChange={onChange}
      >
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
  const [draft, setDraft] = useState({
    status: 'Confirmed',
    hotel: 'Empire Beach Resort',
    source: 'All sources',
    payment: 'Paid',
    search: '',
  });
  const [dateRange, setDateRange] = useState<CalendarSelection>({
    start: '2026-10-30',
    end: '2026-11-03',
  });
  const [active, setActive] = useState([
    { id: 'status', label: 'Booking: Confirmed' },
    { id: 'payment', label: 'Payment: Paid' },
    { id: 'hotel', label: 'Hotel: Empire Beach Resort' },
  ]);
  const [addOpen, setAddOpen] = useState(false);

  function clearFilters() {
    setDraft({
      status: 'All statuses',
      hotel: 'All hotels',
      source: 'All sources',
      payment: 'All payments',
      search: '',
    });
    setDateRange({ start: null, end: null });
    setActive([]);
  }

  function applyFilters() {
    const next = [
      draft.status !== 'All statuses' ? { id: 'status', label: `Booking: ${draft.status}` } : null,
      draft.payment !== 'All payments'
        ? { id: 'payment', label: `Payment: ${draft.payment}` }
        : null,
      draft.hotel !== 'All hotels' ? { id: 'hotel', label: `Hotel: ${draft.hotel}` } : null,
      draft.source !== 'All sources' ? { id: 'source', label: `Source: ${draft.source}` } : null,
      draft.search ? { id: 'search', label: `Search: ${draft.search}` } : null,
      dateRange.start && dateRange.end
        ? { id: 'dates', label: `Stay: ${formatCalendarSelection(dateRange, 'range')}` }
        : null,
    ].filter((filter): filter is { id: string; label: string } => filter !== null);
    setActive(next);
  }

  function removeFilter(id: string) {
    setActive((current) => current.filter((filter) => filter.id !== id));
    if (id === 'status') setDraft((current) => ({ ...current, status: 'All statuses' }));
    if (id === 'payment') setDraft((current) => ({ ...current, payment: 'All payments' }));
    if (id === 'hotel') setDraft((current) => ({ ...current, hotel: 'All hotels' }));
    if (id === 'source') setDraft((current) => ({ ...current, source: 'All sources' }));
    if (id === 'search') setDraft((current) => ({ ...current, search: '' }));
    if (id === 'dates') setDateRange({ start: null, end: null });
  }

  function addQuickFilter(id: string) {
    const options: Record<string, { label: string; update: () => void }> = {
      source: {
        label: 'Source: Website',
        update: () => setDraft((current) => ({ ...current, source: 'Website' })),
      },
      status: {
        label: 'Booking: Manual review',
        update: () => setDraft((current) => ({ ...current, status: 'Manual review' })),
      },
      payment: {
        label: 'Payment: Payment pending',
        update: () => setDraft((current) => ({ ...current, payment: 'Payment pending' })),
      },
      hotel: {
        label: 'Hotel: Marina Bay Hotel',
        update: () => setDraft((current) => ({ ...current, hotel: 'Marina Bay Hotel' })),
      },
    };
    const option = options[id];
    if (!option) return;
    option.update();
    setActive((current) => [
      ...current.filter((filter) => filter.id !== id),
      { id, label: option.label },
    ]);
    setAddOpen(false);
  }

  function removeAll() {
    clearFilters();
  }

  function filterBadgeVariant(id: string, label: string) {
    if (id === 'status') {
      const tone = bookingStatusOptions.find(
        (option) => option.label === label.slice('Booking: '.length),
      )?.tone;
      return tone ?? 'muted';
    }
    if (id === 'payment') {
      return (
        paymentStatusMeta[label.slice('Payment: '.length) as keyof typeof paymentStatusMeta]
          ?.tone ?? 'muted'
      );
    }
    return id === 'hotel' ? 'secondary' : 'info';
  }

  function ActiveChips() {
    return active.map((filter) => (
      <Badge
        key={filter.id}
        variant={filterBadgeVariant(filter.id, filter.label)}
        className="max-w-full gap-1 px-1.5 py-0 text-[10px] font-medium transition-colors"
      >
        {filter.label}
        <button
          type="button"
          aria-label={`Remove filter ${filter.label}`}
          onClick={() => removeFilter(filter.id)}
          className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden="true" className="size-2.5" />
        </button>
      </Badge>
    ));
  }

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
          <Badge variant="muted">{active.length} filters applied</Badge>
        </div>
        <div className="grid gap-3 @md/design-preview:grid-cols-2 @xl/design-preview:grid-cols-6">
          <div className="space-y-1">
            <Label htmlFor="filter-search" className="text-[11px]">
              Search
            </Label>
            <div className="relative">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="filter-search"
                className="pl-9 text-xs"
                placeholder="Booking or guest…"
                value={draft.search}
                onChange={(event) => {
                  const search = event.currentTarget.value;
                  setDraft((current) => ({ ...current, search }));
                }}
              />
            </div>
          </div>
          <FilterSelect
            label="Booking status"
            value="All statuses"
            options={['All statuses', ...bookingStatusOptions.map((option) => option.label)]}
            selectedValue={draft.status}
            onChange={(status) => setDraft((current) => ({ ...current, status }))}
          />
          <FilterSelect
            label="Hotel"
            value="All hotels"
            options={['All hotels', ...demoHotelOptions]}
            selectedValue={draft.hotel}
            onChange={(hotel) => setDraft((current) => ({ ...current, hotel }))}
          />
          <div className="space-y-1">
            <Label className="text-[11px]">Stay dates</Label>
            <CalendarPicker
              label="Select stay dates"
              mode="range"
              value={dateRange}
              onChange={setDateRange}
              className="h-9 w-full text-xs"
            />
          </div>
          <FilterSelect
            label="Source"
            value="All sources"
            options={['All sources', ...demoBookingSourceOptions]}
            selectedValue={draft.source}
            onChange={(source) => setDraft((current) => ({ ...current, source }))}
          />
          <FilterSelect
            label="Payment status"
            value="All payments"
            options={['All payments', ...paymentStatusOptions]}
            selectedValue={draft.payment}
            onChange={(payment) => setDraft((current) => ({ ...current, payment }))}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button onClick={applyFilters}>
            <Filter aria-hidden="true" />
            Apply filters
          </Button>
          <Button variant="outline" onClick={removeAll}>
            <X aria-hidden="true" />
            Reset
          </Button>
        </div>
      </Card>
      <div className="grid gap-3 @md/design-preview:grid-cols-2 @xl/design-preview:grid-cols-3">
        <Card className="gap-3 p-4">
          <h3 className="text-sm font-bold">21 · Filter chips</h3>
          <div className="flex flex-wrap items-center gap-2">
            <ActiveChips />
            <Popover open={addOpen} onOpenChange={setAddOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[10px]">
                  <Plus className="size-2.5" />
                  Add filter
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-52 p-2">
                <p className="px-2 py-1 text-xs font-semibold">Add a demo filter</p>
                {[
                  ['source', 'Source: Website'],
                  ['status', 'Booking: Manual review'],
                  ['payment', 'Payment: Payment pending'],
                  ['hotel', 'Hotel: Marina Bay Hotel'],
                ].map(([id, label]) => (
                  <Button
                    key={id}
                    variant="ghost"
                    className="h-auto w-full justify-start px-2 py-2 text-xs"
                    onClick={() => addQuickFilter(id)}
                  >
                    {label}
                  </Button>
                ))}
              </PopoverContent>
            </Popover>
          </div>
        </Card>
        <Card className="gap-3 p-4">
          <h3 className="text-sm font-bold">22 · Active filter summary</h3>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <SlidersHorizontal className="size-3 text-muted-foreground" />
            <span aria-live="polite" className="text-muted-foreground">
              {active.length} filters applied
            </span>
            <ActiveChips />
          </div>
        </Card>
        <Card className="gap-3 p-4">
          <h3 className="text-sm font-bold">23 · Clear filters</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={removeAll}>
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
  const [childCount, setChildCount] = useState('1');
  const [childAges, setChildAges] = useState(['7 years']);
  const ageOptions = Array.from({ length: 18 }, (_, age) => `${age} years`);

  function updateChildCount(value: string) {
    setChildCount(value);
    setChildAges((current) =>
      Array.from({ length: Number(value) }, (_, index) => current[index] ?? '7 years'),
    );
  }

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
          <div
            className={`grid gap-3 @sm/design-preview:grid-cols-3 ${
              Number(childCount) >= 2 ? 'pt-36' : ''
            }`}
          >
            <div>
              <Label>Adults</Label>
              <Input className="mt-1" defaultValue="2" />
            </div>
            <div>
              <FilterSelect
                label="Children"
                value="1"
                selectedValue={childCount}
                onChange={updateChildCount}
                options={['0', '1', '2', '3', '4']}
              />
            </div>
            <div>
              <div className="relative">
                {Number(childCount) >= 2 ? (
                  <div
                    role="region"
                    aria-label="Child ages"
                    className="absolute right-0 bottom-[calc(100%+0.5rem)] z-20 w-64 space-y-2 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
                  >
                    <div className="space-y-1">
                      <Label htmlFor="child-count-bubble" className="text-xs">
                        Number of children
                      </Label>
                      <Select value={childCount} onValueChange={updateChildCount}>
                        <SelectTrigger
                          id="child-count-bubble"
                          aria-label="Number of children"
                          className="h-8 w-full"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {['0', '1', '2', '3', '4'].map((count) => (
                            <SelectItem key={count} value={count}>
                              {count}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {childAges.map((age, index) => (
                        <div key={index} className="space-y-1">
                          <Label className="text-[11px]">Child {index + 1} age</Label>
                          <Select
                            value={age}
                            onValueChange={(nextAge) =>
                              setChildAges((current) =>
                                current.map((item, ageIndex) =>
                                  ageIndex === index ? nextAge : item,
                                ),
                              )
                            }
                          >
                            <SelectTrigger
                              aria-label={`Child ${index + 1} age`}
                              className="h-8 w-full"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ageOptions.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <Label>Child age</Label>
                {Number(childCount) === 0 ? (
                  <Input className="mt-1" disabled placeholder="No children" />
                ) : (
                  <Select
                    value={childAges[0]}
                    onValueChange={(age) =>
                      setChildAges((current) =>
                        current.map((value, index) => (index === 0 ? age : value)),
                      )
                    }
                  >
                    <SelectTrigger aria-label="Child 1 age" className="mt-1 h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ageOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
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
              value="Empire Beach Resort"
              options={[...demoHotelOptions]}
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
            <Badge variant="muted">Clock PMS+ · demo</Badge>
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
            <FilterSelect label="Provider" value="Clock PMS+" options={['Clock PMS+', 'PokPay']} />
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
