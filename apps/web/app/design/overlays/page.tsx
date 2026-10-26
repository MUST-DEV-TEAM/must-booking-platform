'use client';

import {
  AlertTriangle,
  ArrowRight,
  BedDouble,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileText,
  Hotel,
  Info,
  Keyboard,
  Layers,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  ShieldAlert,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { cn } from '../../../lib/utils';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../../components/ui/dialog';
import { Input, Textarea } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { PageHeader } from '../_ui/hotel';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../../../components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';

type SpecimenDefinition = {
  number: string;
  title: string;
  description: string;
  contract: ReadonlyArray<readonly [string, string]>;
};

const specimens: SpecimenDefinition[] = [
  {
    number: '01',
    title: 'Standard modal',
    description: 'Create or edit hotel data with validation and fixed actions.',
    contract: [
      ['Width', '400–520 px'],
      ['Header', 'Fixed'],
      ['Body', 'Scrollable'],
      ['Validation', 'Inline'],
      ['Footer', 'Sticky actions'],
      ['Dismiss', 'X + Escape'],
    ],
  },
  {
    number: '02',
    title: 'Confirmation modal',
    description: 'Confirm safe state changes, booking approval and provider retries.',
    contract: [
      ['Use', 'Safe state change'],
      ['Impact', 'Shown first'],
      ['Primary', 'Verb-specific'],
      ['Provider write', 'Idempotent'],
      ['Failure', 'Keep dialog open'],
      ['Dismiss', 'Cancel + Escape'],
    ],
  },
  {
    number: '03',
    title: 'Destructive confirmation',
    description: 'Cancel bookings or disconnect providers with explicit impact.',
    contract: [
      ['Use', 'Irreversible step'],
      ['Impact', 'Explicit list'],
      ['Payment', 'Separate flow'],
      ['Provider', 'Wait for result'],
      ['Primary', 'Danger verb'],
      ['Dismiss', 'Cancel only'],
    ],
  },
  {
    number: '04',
    title: 'Booking details drawer',
    description: 'Quick booking view with guest, dates, payment, Clock sync and notes.',
    contract: [
      ['Width', '360–440 px'],
      ['Side', 'Right'],
      ['Tabs', 'Context only'],
      ['Body', 'Independent scroll'],
      ['Footer', 'Persistent'],
      ['Route', 'Open full page'],
    ],
  },
  {
    number: '05',
    title: 'Action menu',
    description: 'One anchored menu for row actions, disabled items and destructive actions.',
    contract: [
      ['Width', '240–280 px'],
      ['Anchor', 'Visible trigger'],
      ['Rows', '40–48 px'],
      ['Disabled', 'Explain why'],
      ['Danger', 'Last group'],
      ['Dismiss', 'Click outside'],
    ],
  },
  {
    number: '06',
    title: 'Tooltip',
    description: 'Short explanations for statuses, financial fields and provider health.',
    contract: [
      ['Content', '1–2 short lines'],
      ['Trigger', 'Hover + focus'],
      ['Position', 'Auto-flip'],
      ['Delay', '300–500 ms'],
      ['Interactive', 'No'],
      ['Critical info', 'Never tooltip-only'],
    ],
  },
  {
    number: '07',
    title: 'Date-range picker',
    description: 'Check-in/check-out and availability ranges with disabled dates and minimum stay.',
    contract: [
      ['Mode', 'Date range'],
      ['Blocked dates', 'Not selectable'],
      ['Navigation', 'Month retained'],
      ['Rules', 'Min/max stay'],
      ['Apply', 'Explicit'],
      ['Mobile', 'Full-screen sheet'],
    ],
  },
  {
    number: '08',
    title: 'Search / command overlay',
    description:
      'Global search across bookings, guests, hotels, room types and provider operations.',
    contract: [
      ['Open', 'Ctrl/Cmd K'],
      ['Search', 'Debounced'],
      ['Groups', 'By entity'],
      ['Keyboard', 'Full support'],
      ['Permissions', 'Filter results'],
      ['No result', 'Next action'],
    ],
  },
];

function Specimen({
  children,
  definition,
}: {
  children: ReactNode;
  definition: SpecimenDefinition;
}) {
  return (
    <article className="min-w-0 rounded-xl border bg-card p-3 shadow-xs @md/design-preview:p-4">
      <header className="mb-3">
        <div className="flex items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-[10px] font-bold text-primary">
            {definition.number}
          </span>
          <h2 className="font-bold tracking-tight">{definition.title}</h2>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {definition.description}
        </p>
      </header>
      <div className="grid min-w-0 gap-3 rounded-lg bg-muted p-3 @md/design-preview:grid-cols-[minmax(0,1.45fr)_minmax(138px,0.8fr)] @md/design-preview:p-3.5">
        <div className="flex min-w-0 items-center justify-center">{children}</div>
        <aside className="rounded-lg border bg-card p-3">
          <h3 className="mb-2 text-xs font-bold">Component contract</h3>
          <dl className="space-y-2">
            {definition.contract.map(([label, value]) => (
              <div
                key={label}
                className="flex items-start justify-between gap-2 text-[10px] leading-relaxed"
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 rounded-md bg-muted p-2 text-[10px] leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Usage</span>
            <p className="mt-1">
              Keep the action and impact clear. Preserve context when the overlay closes.
            </p>
          </div>
        </aside>
      </div>
    </article>
  );
}

function DemoFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'w-full min-w-0 rounded-lg bg-background/70 p-3 @md/design-preview:p-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

function DialogLauncher({
  children,
  title,
  description,
  action,
  destructive = false,
}: {
  children: ReactNode;
  title: string;
  description: string;
  action: string;
  destructive?: boolean;
}) {
  return (
    <Dialog>
      <div className="w-full min-w-0">
        <div className="mb-2 flex justify-end">
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Pencil aria-hidden="true" />
              Open live preview
            </Button>
          </DialogTrigger>
        </div>
        {children}
      </div>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 rounded-lg bg-muted p-3 text-sm">
          <p className="font-semibold">MHB-2026-1042 · Elira Hoxha</p>
          <p className="text-muted-foreground">
            Empire Beach Resort · Deluxe Sea View · Jul 20–23, 2026
          </p>
          {destructive ? (
            <Alert variant="warning">
              <AlertTriangle aria-hidden="true" />
              <AlertDescription>
                Payment refunds are handled separately. Cancellation may release room inventory.
              </AlertDescription>
            </Alert>
          ) : (
            <p className="font-semibold">€540.00 total · €180.00 deposit paid</p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Preview only. No booking or provider data is changed.
        </p>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant={destructive ? 'destructive' : 'default'}>{action}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DrawerLauncher({ children }: { children: ReactNode }) {
  return (
    <Sheet>
      <div className="w-full min-w-0">
        <div className="mb-2 flex justify-end">
          <SheetTrigger asChild>
            <Button size="sm" variant="outline">
              <ArrowRight aria-hidden="true" />
              Open live drawer
            </Button>
          </SheetTrigger>
        </div>
        {children}
      </div>
      <SheetContent className="w-[min(440px,92vw)] p-0">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>MHB-2026-1042</SheetTitle>
          <SheetDescription>Elira Hoxha · Website booking · Empire Beach Resort</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-3 overflow-auto p-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="success">Confirmed</Badge>
            <Badge variant="success">Paid</Badge>
            <Badge variant="secondary">Clock synced</Badge>
          </div>
          <DataLine label="Room type" value="Deluxe Sea View" />
          <DataLine label="Stay" value="Jul 20–23 · 3 nights" />
          <DataLine label="Guests" value="2 adults" />
          <DataLine label="Booking total" value="€540.00" />
          <DataLine label="Deposit paid" value="€180.00" />
          <DataLine label="Remaining balance" value="€360.00" tone="warning" />
          <div className="rounded-md bg-muted p-3 text-xs">
            <p className="font-semibold">Clock reservation synchronized</p>
            <p className="mt-1 text-muted-foreground">Last success 2 minutes ago</p>
          </div>
          <div className="rounded-md border p-3 text-xs">
            <p className="font-semibold">Internal note</p>
            <p className="mt-1 text-muted-foreground">
              Room assignment pending. Guest requested a quieter room.
            </p>
          </div>
        </div>
        <footer className="flex justify-between gap-2 border-t p-4">
          <Button variant="secondary">
            <MessageSquareText aria-hidden="true" />
            Add note
          </Button>
          <Button>
            Open booking
            <ArrowRight aria-hidden="true" />
          </Button>
        </footer>
      </SheetContent>
    </Sheet>
  );
}

function DateRangeLauncher({ children }: { children: ReactNode }) {
  const [applied, setApplied] = useState(false);
  return (
    <Popover>
      <div className="w-full min-w-0">
        <div className="mb-2 flex justify-end">
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline">
              <CalendarDays aria-hidden="true" />
              Open date picker
            </Button>
          </PopoverTrigger>
        </div>
        {children}
      </div>
      <PopoverContent align="end" className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Select stay dates</h3>
          <p className="text-xs text-muted-foreground">
            Choose check-in and checkout for Deluxe Sea View.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <MiniLabel>Check-in</MiniLabel>
            <Input type="date" defaultValue="2026-07-20" />
          </div>
          <div className="space-y-1">
            <MiniLabel>Check-out</MiniLabel>
            <Input type="date" defaultValue="2026-07-23" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Minimum stay: 2 nights · Jul 15 is unavailable
        </p>
        {applied ? (
          <p role="status" className="text-xs font-semibold text-success">
            Date range applied in this preview.
          </p>
        ) : null}
        <Button className="w-full" onClick={() => setApplied(true)}>
          Apply dates
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function MiniLabel({ children }: { children: ReactNode }) {
  return <Label className="text-[10px] font-medium text-muted-foreground">{children}</Label>;
}

function StandardModalPreview() {
  const [guest, setGuest] = useState('Elira Hoxha');
  const [note, setNote] = useState('Guest requested a quieter room away from the lift.');
  const [message, setMessage] = useState('');

  return (
    <DemoFrame>
      <div className="mx-auto max-w-[320px] overflow-hidden rounded-xl border bg-card shadow-lg">
        <div className="flex items-start justify-between border-b px-3 py-2.5">
          <div>
            <h3 className="text-xs font-bold">Edit booking</h3>
            <p className="mt-0.5 text-[9px] text-muted-foreground">
              MHB-2026-1042 · Empire Beach Resort
            </p>
          </div>
          <Button
            aria-label="Close booking editor"
            size="icon-sm"
            variant="ghost"
            onClick={() => setMessage('Editor dismissed')}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="space-y-2.5 p-3">
          <Alert variant="info" className="px-2.5 py-2 text-[9px]">
            <Info aria-hidden="true" />
            <AlertDescription>
              The paid amount stays unchanged when you edit the stay. Handle any charge or refund
              separately in Payments.
            </AlertDescription>
          </Alert>
          <div className="space-y-1">
            <MiniLabel>Guest name</MiniLabel>
            <Input
              aria-label="Guest name"
              value={guest}
              onChange={(event) => setGuest(event.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <MiniLabel>Check-in</MiniLabel>
              <Input
                aria-label="Check-in date"
                defaultValue="Jul 20, 2026"
                className="h-8 text-[10px]"
              />
            </div>
            <div className="space-y-1">
              <MiniLabel>Check-out</MiniLabel>
              <Input
                aria-label="Check-out date"
                defaultValue="Jul 23, 2026"
                className="h-8 text-[10px]"
              />
            </div>
          </div>
          <div className="space-y-1">
            <MiniLabel>Internal note</MiniLabel>
            <Textarea
              aria-label="Internal note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="min-h-14 text-[10px]"
            />
          </div>
          {message ? (
            <p role="status" className="text-[10px] font-semibold text-success">
              {message}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-1.5 border-t bg-card px-3 py-2.5">
          <Button size="sm" variant="secondary" onClick={() => setMessage('Changes discarded')}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => setMessage(`Changes saved for ${guest || 'guest'}`)}>
            <Check aria-hidden="true" />
            Save changes
          </Button>
        </div>
      </div>
    </DemoFrame>
  );
}

function ConfirmationPreview() {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <DemoFrame>
      <div className="mx-auto max-w-[320px] rounded-xl border bg-card p-3 text-center shadow-lg @md/design-preview:p-4">
        <span className="mx-auto flex size-9 items-center justify-center rounded-full bg-success-surface text-success">
          <CalendarDays className="size-4" />
        </span>
        <h3 className="mt-2 text-sm font-bold">
          {confirmed ? 'Booking confirmed' : 'Confirm booking?'}
        </h3>
        <p className="mx-auto mt-1 max-w-56 text-[10px] leading-relaxed text-muted-foreground">
          Confirm this paid booking and send the reservation to Clock PMS.
        </p>
        <div className="mt-3 rounded-lg bg-muted p-2.5 text-left">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold">MHB-2026-1042</span>
            <Badge variant="success">Paid</Badge>
          </div>
          <p className="mt-1 text-[9px] text-muted-foreground">Elira Hoxha</p>
          <p className="mt-1 text-[9px]">Empire Beach Resort · Deluxe Sea View</p>
          <p className="mt-1 text-[9px] text-muted-foreground">Jul 20–23 · 3 nights · 2 adults</p>
        </div>
        <Alert variant="warning" className="mt-2 px-2 py-1.5 text-left text-[9px]">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>
            Clock PMS has not confirmed the reservation. Check its status before retrying to avoid a
            duplicate.
          </AlertDescription>
        </Alert>
        {confirmed ? (
          <p role="status" className="mt-2 text-[10px] font-semibold text-success">
            Confirmed in this preview
          </p>
        ) : null}
        <div className="mt-3 flex justify-end gap-1.5 border-t pt-2.5">
          <Button size="sm" variant="secondary" onClick={() => setConfirmed(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => setConfirmed(true)}>
            <CheckCircle2 aria-hidden="true" />
            Confirm booking
          </Button>
        </div>
      </div>
    </DemoFrame>
  );
}

function DestructivePreview() {
  const [cancelled, setCancelled] = useState(false);
  return (
    <DemoFrame>
      <div className="mx-auto max-w-[320px] rounded-xl border border-destructive/35 bg-card p-3 text-center shadow-lg @md/design-preview:p-4">
        <span className="mx-auto flex size-9 items-center justify-center rounded-full bg-destructive-surface text-destructive">
          <ShieldAlert className="size-4" />
        </span>
        <h3 className="mt-2 text-sm font-bold">
          {cancelled ? 'Booking cancelled' : 'Cancel this confirmed booking?'}
        </h3>
        <p className="mx-auto mt-1 max-w-56 text-[10px] leading-relaxed text-muted-foreground">
          Room inventory is released only after the local and Clock PMS cancellations succeed.
        </p>
        <div className="mt-3 space-y-1 rounded-lg bg-destructive-surface/60 p-2.5 text-left">
          <ImpactRow icon={CreditCard} label="Payment" value="€180 deposit paid" />
          <ImpactRow icon={CalendarDays} label="Booking status" value="Confirmed → Cancelled" />
          <ImpactRow icon={RefreshCw} label="Clock PMS" value="Cancellation required" />
        </div>
        <div className="mt-2 space-y-1 text-left">
          <MiniLabel>Cancellation reason</MiniLabel>
          <select
            aria-label="Cancellation reason"
            className="h-8 w-full rounded-md border bg-card px-2 text-[10px]"
          >
            <option>Duplicate booking</option>
            <option>Guest request</option>
            <option>Property unable to host</option>
          </select>
        </div>
        <Alert variant="warning" className="mt-2 px-2 py-1.5 text-left text-[9px]">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>
            Cancellation does not issue a refund. Review the cancellation policy in Payments.
          </AlertDescription>
        </Alert>
        {cancelled ? (
          <p role="status" className="mt-2 text-[10px] font-semibold text-destructive">
            Preview state only · no provider request made
          </p>
        ) : null}
        <div className="mt-3 flex justify-end gap-1.5 border-t pt-2.5">
          <Button size="sm" variant="secondary" onClick={() => setCancelled(false)}>
            Keep booking
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setCancelled(true)}>
            Cancel booking
          </Button>
        </div>
      </div>
    </DemoFrame>
  );
}

function ImpactRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[9px]">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3" aria-hidden="true" />
        {label}
      </span>
      <span className="text-right font-semibold text-destructive">{value}</span>
    </div>
  );
}

function BookingDrawerPreview() {
  const [tab, setTab] = useState('Overview');
  const [noteAdded, setNoteAdded] = useState(false);
  return (
    <DemoFrame className="min-h-[310px] p-0">
      <div className="flex min-h-[310px] overflow-hidden rounded-lg border bg-muted/60">
        <div className="w-8 shrink-0 bg-foreground/25" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col border bg-card shadow-lg">
          <header className="flex items-center justify-between border-b px-3 py-2.5">
            <div>
              <h3 className="text-xs font-bold">MHB-2026-1042</h3>
              <p className="text-[9px] text-muted-foreground">Elira Hoxha · Website booking</p>
              <p className="mt-0.5 text-[8px] text-muted-foreground">Booked 18 Jul 2026 · 14:32</p>
            </div>
            <Button size="icon-sm" variant="ghost" aria-label="Close booking preview">
              <X aria-hidden="true" />
            </Button>
          </header>
          <nav aria-label="Booking detail tabs" className="flex gap-3 border-b px-3 text-[9px]">
            {['Overview', 'Payment', 'Sync', 'Notes'].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                aria-current={tab === item ? 'page' : undefined}
                className={cn(
                  'border-b-2 py-2 transition-colors hover:text-primary',
                  tab === item
                    ? 'border-primary font-semibold text-primary'
                    : 'border-transparent text-muted-foreground',
                )}
              >
                {item}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
            {tab === 'Overview' ? (
              <>
                <div
                  className="flex flex-wrap gap-1"
                  aria-label="Booking, payment, and provider statuses"
                >
                  <Badge variant="success">Booking · Confirmed</Badge>
                  <Badge variant="success">Payment · Paid</Badge>
                  <Badge variant="secondary">Clock · Synced</Badge>
                </div>
                <p className="text-[8px] text-muted-foreground">
                  Booking, payment, and provider states are tracked separately.
                </p>
                <DataLine label="Booked" value="18 Jul 2026 · 14:32" />
                <DataLine label="Hotel" value="Empire Beach Resort" />
                <DataLine label="Room" value="Deluxe Sea View · Room 204" />
                <DataLine label="Check-in" value="20 Jul 2026" />
                <DataLine label="Check-out" value="23 Jul 2026 · 3 nights" />
                <DataLine label="Guests" value="2 adults" />
                <DataLine label="Booking total" value="€540.00" />
                <DataLine label="Deposit paid" value="€180.00" />
                <DataLine label="Remaining balance" value="€360.00" tone="warning" />
                <div className="rounded-md bg-muted p-2 text-[9px]">
                  <p className="font-semibold">Clock reservation synchronized</p>
                  <p className="mt-0.5 text-muted-foreground">Last success 2 minutes ago</p>
                </div>
              </>
            ) : tab === 'Payment' ? (
              <>
                <h4 className="text-xs font-semibold">Payment summary</h4>
                <DataLine label="Status" value="Paid" />
                <DataLine label="Deposit" value="€180.00" />
                <DataLine label="Balance" value="€360.00" />
              </>
            ) : tab === 'Sync' ? (
              <>
                <h4 className="text-xs font-semibold">Provider activity</h4>
                <DataLine label="Provider" value="Clock PMS+" />
                <DataLine label="Environment" value="Sandbox" />
                <DataLine label="Last sync" value="2 minutes ago" />
                <Badge variant="success">Synchronized</Badge>
              </>
            ) : (
              <>
                <h4 className="text-xs font-semibold">Internal notes</h4>
                <p className="text-[10px] text-muted-foreground">
                  Room assignment pending. Guest requested a quieter room.
                </p>
                {noteAdded ? (
                  <p role="status" className="text-[10px] font-semibold text-success">
                    Follow-up note added in this preview.
                  </p>
                ) : null}
              </>
            )}
          </div>
          <footer className="flex justify-between gap-2 border-t p-2.5">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setTab('Notes');
                setNoteAdded(true);
              }}
            >
              <MessageSquareText aria-hidden="true" />
              Add note
            </Button>
            <Button size="sm" onClick={() => setTab('Overview')}>
              Open booking
              <ArrowRight aria-hidden="true" />
            </Button>
          </footer>
        </div>
      </div>
    </DemoFrame>
  );
}

function DataLine({ label, value, tone }: { label: string; value: string; tone?: 'warning' }) {
  return (
    <div className="flex justify-between gap-2 border-b py-1.5 text-[9px] last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('text-right font-semibold', tone === 'warning' && 'text-warning')}>
        {value}
      </span>
    </div>
  );
}

function ActionMenuPreview() {
  const [action, setAction] = useState('');
  return (
    <DemoFrame className="min-h-[310px]">
      <div className="mx-auto flex min-h-[270px] max-w-[320px] flex-col justify-center">
        <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 shadow-xs">
          <div>
            <p className="text-[10px] font-semibold">MHB-2026-1042</p>
            <p className="text-[9px] text-muted-foreground">Elira Hoxha · Confirmed · Paid</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary">
                Actions
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]">
              <DropdownMenuLabel>Booking actions</DropdownMenuLabel>
              <DropdownMenuItem
                className="whitespace-nowrap"
                onSelect={() => setAction('Booking opened')}
              >
                <Hotel aria-hidden="true" />
                Open booking
              </DropdownMenuItem>
              <DropdownMenuItem
                className="whitespace-nowrap"
                onSelect={() => setAction('Guest details opened')}
              >
                <Pencil aria-hidden="true" />
                Edit guest details
              </DropdownMenuItem>
              <DropdownMenuItem
                className="whitespace-nowrap"
                onSelect={() => setAction('Internal note started')}
              >
                <FileText aria-hidden="true" />
                Add internal note
              </DropdownMenuItem>
              <DropdownMenuItem
                className="whitespace-nowrap"
                onSelect={() => setAction('Clock sync retry queued in preview')}
              >
                <RefreshCw aria-hidden="true" />
                Retry Clock sync
              </DropdownMenuItem>
              <DropdownMenuItem
                className="whitespace-nowrap"
                disabled
                title="A refund is not available for this booking"
              >
                <CreditCard aria-hidden="true" />
                Refund payment · unavailable
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="whitespace-nowrap"
                variant="destructive"
                onSelect={() => setAction('Cancellation confirmation opened')}
              >
                <X aria-hidden="true" />
                Cancel booking
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mt-3 rounded-lg border bg-card p-3">
          <p className="text-[10px] font-semibold">Permission-aware action menu</p>
          <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
            Unavailable actions explain why they cannot be used. Destructive actions stay grouped at
            the end.
          </p>
          {action ? (
            <p role="status" className="mt-2 text-[10px] font-semibold text-primary">
              {action}
            </p>
          ) : null}
        </div>
      </div>
    </DemoFrame>
  );
}

function TooltipPreview() {
  return (
    <DemoFrame className="min-h-[310px]">
      <div className="mx-auto max-w-[330px] space-y-2 py-2">
        <div className="rounded-lg bg-foreground px-3 py-2 text-[9px] text-background shadow-md">
          Amount still due at the property. Deposit paid is tracked separately.
        </div>
        <div className="rounded-lg bg-foreground px-3 py-2 text-[9px] text-background shadow-md">
          The booking and latest reservation payload match in Clock PMS.
        </div>
        <div className="space-y-2 rounded-lg bg-card p-2.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md border px-2.5 py-2 text-left hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span>
                  <span className="block text-[10px] font-semibold">Remaining balance</span>
                  <span className="text-[9px] text-muted-foreground">€360.00 due at property</span>
                </span>
                <span className="text-xs font-bold">€360.00</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              Amount still due at the property. Deposit paid is tracked separately.
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md border px-2.5 py-2 text-left hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span>
                  <span className="block text-[10px] font-semibold">Clock sync</span>
                  <span className="text-[9px] text-muted-foreground">
                    Last synchronized 2 minutes ago
                  </span>
                </span>
                <Badge variant="success">Synced</Badge>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              The booking and latest reservation payload match in Clock PMS.
            </TooltipContent>
          </Tooltip>
          <p className="flex items-start gap-2 rounded-md bg-muted p-2 text-[9px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            Tooltips explain meaning; required actions and critical warnings stay visible.
          </p>
        </div>
      </div>
    </DemoFrame>
  );
}

const calendarDays = Array.from({ length: 35 }, (_, index) => index);

function DateRangePreview() {
  const [start, setStart] = useState(20);
  const [end, setEnd] = useState(23);
  const [applied, setApplied] = useState(false);
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const monthName =
    monthOffset === 0 ? 'July 2026' : monthOffset === 1 ? 'August 2026' : 'June 2026';
  const dayCount = monthOffset === 1 ? 31 : monthOffset === -1 ? 30 : 31;
  const firstWeekday = monthOffset === 0 ? 3 : monthOffset === 1 ? 6 : 1;
  const unavailableRange = monthOffset === 0 && start > 0 && end > 0 && start < 15 && end > 15;
  const shift = (offset: number) => {
    setMonthOffset((current) => Math.max(-1, Math.min(1, current + offset)));
    setStart(0);
    setEnd(0);
    setApplied(false);
  };
  const selectDay = (day: number) => {
    setApplied(false);
    if (!start || end || day <= start) {
      setStart(day);
      setEnd(0);
    } else setEnd(day);
  };

  return (
    <DemoFrame className="min-h-[310px]">
      <div className="mx-auto max-w-[330px] rounded-lg border bg-card shadow-xs">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-primary" aria-hidden="true" />
            <div>
              <h3 className="text-[10px] font-semibold">Select stay dates</h3>
              <p className="text-[9px] text-muted-foreground">Availability for Deluxe Sea View</p>
            </div>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Clear selected dates"
            onClick={() => {
              setStart(0);
              setEnd(0);
              setApplied(false);
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 p-2.5">
          <div className="rounded-md border px-2 py-1.5">
            <p className="text-[8px] text-muted-foreground">Check-in</p>
            <p className="mt-0.5 text-[9px] font-semibold">
              {start
                ? `${monthOffset === 0 ? 'Jul' : monthOffset > 0 ? 'Aug' : 'Jun'} ${start}, 2026`
                : 'Choose date'}
            </p>
          </div>
          <div className="rounded-md border px-2 py-1.5">
            <p className="text-[8px] text-muted-foreground">Check-out</p>
            <p className="mt-0.5 text-[9px] font-semibold">
              {end
                ? `${monthOffset === 0 ? 'Jul' : monthOffset > 0 ? 'Aug' : 'Jun'} ${end}, 2026`
                : 'Choose date'}
            </p>
          </div>
        </div>
        <div className="px-2.5 pb-2.5">
          <div className="flex items-center justify-between px-1 pb-1.5">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Previous month"
              onClick={() => shift(-1)}
              disabled={monthOffset <= -1}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span className="text-[10px] font-semibold">{monthName}</span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Next month"
              onClick={() => shift(1)}
              disabled={monthOffset >= 1}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
          <div className="grid grid-cols-7 text-center text-[8px] text-muted-foreground">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
              <span key={day} className="py-1">
                {day}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-1 text-center">
            {calendarDays.map((rawDay, index) => {
              const day = rawDay - firstWeekday + 1;
              const valid = day >= 1 && day <= dayCount;
              const blocked = valid && monthOffset === 0 && day === 15;
              const selected = valid && (day === start || day === end);
              const inRange = valid && start && end && day > start && day < end;
              const previewRange =
                valid &&
                !end &&
                start > 0 &&
                hoveredDay !== null &&
                hoveredDay > start &&
                day > start &&
                day < hoveredDay;
              const previewEndpoint =
                valid && !end && hoveredDay !== null && hoveredDay > start && day === hoveredDay;
              return valid ? (
                <button
                  key={index}
                  type="button"
                  disabled={blocked}
                  aria-label={`${monthName} ${day}${blocked ? ', unavailable' : ''}`}
                  aria-pressed={selected}
                  onPointerEnter={() => setHoveredDay(blocked ? null : day)}
                  onFocus={() => setHoveredDay(blocked ? null : day)}
                  onClick={() => selectDay(day)}
                  className={cn(
                    'mx-auto flex size-7 items-center justify-center rounded-full text-[9px] transition-colors hover:bg-primary/15 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:text-muted-foreground/40 disabled:line-through',
                    selected && 'bg-neutral-900 font-semibold text-white hover:bg-neutral-800',
                    (inRange || previewRange) &&
                      'bg-neutral-200 text-neutral-800 hover:bg-neutral-300',
                    previewEndpoint &&
                      'bg-neutral-900 font-semibold text-white hover:bg-neutral-800',
                  )}
                >
                  {day}
                </button>
              ) : (
                <span key={index} className="size-7" />
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <Badge variant="secondary">
              {start && end ? `${end - start} nights` : 'Select check-in and checkout'}
            </Badge>
            <span className="text-[8px] text-muted-foreground">Min stay: 2 nights</span>
          </div>
          {unavailableRange ? (
            <p role="alert" className="mt-1 text-[8px] font-medium text-destructive">
              This stay includes Jul 15, which is unavailable.
            </p>
          ) : null}
        </div>
        {applied ? (
          <p role="status" className="px-3 pb-2 text-[9px] font-semibold text-success">
            Dates applied in this preview.
          </p>
        ) : null}
        <footer className="flex justify-end gap-1.5 border-t p-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setStart(0);
              setEnd(0);
            }}
          >
            Clear
          </Button>
          <Button
            size="sm"
            disabled={!start || !end || end - start < 2 || unavailableRange}
            onClick={() => setApplied(true)}
          >
            Apply dates
          </Button>
        </footer>
      </div>
    </DemoFrame>
  );
}

const searchRecords = [
  {
    group: 'Bookings',
    title: 'MHB-2026-1042',
    subtitle: 'Elira Hoxha · Jul 20–23 · Empire Beach Resort',
    status: 'Confirmed',
    icon: Hotel,
    tone: 'success' as const,
  },
  {
    group: 'Bookings',
    title: 'MHB-2026-1038',
    subtitle: 'Ardit Kola · Jul 18–21 · Deluxe Garden',
    status: 'Paid',
    icon: BedDouble,
    tone: 'success' as const,
  },
  {
    group: 'Guests',
    title: 'Elira Hoxha',
    subtitle: 'Guest · 3 bookings · last stay Jul 2026',
    status: '',
    icon: UserRound,
    tone: 'muted' as const,
  },
  {
    group: 'Provider operations',
    title: 'Clock operation #8921',
    subtitle: 'Reservation synchronization retry available',
    status: 'Failed',
    icon: RefreshCw,
    tone: 'danger' as const,
  },
];

function SearchOverlayPreview() {
  const [query, setQuery] = useState('MHB-2026');
  const [selected, setSelected] = useState('');
  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    return searchRecords.filter(
      (record) =>
        !term || `${record.title} ${record.subtitle} ${record.group}`.toLowerCase().includes(term),
    );
  }, [query]);
  const grouped = useMemo(() => [...new Set(results.map((item) => item.group))], [results]);
  return (
    <DemoFrame className="min-h-[310px]">
      <div className="mx-auto max-w-[340px] overflow-hidden rounded-xl border bg-card shadow-lg">
        <div className="border-b p-2.5">
          <div className="relative">
            <Search
              className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              aria-label="Search bookings, guests, hotels, and provider operations"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 pl-8 pr-14 text-xs"
              placeholder="Search bookings, guests, hotels..."
            />
            <kbd className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-[8px] text-muted-foreground">
              Ctrl K
            </kbd>
          </div>
          <p className="mt-1.5 text-[9px] text-muted-foreground">
            Search bookings, guests, hotels, room types and provider operations
          </p>
        </div>
        <div className="max-h-48 overflow-auto p-1.5">
          {results.length ? (
            grouped.map((group) => (
              <section key={group} className="mb-1">
                <h3 className="px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </h3>
                {results
                  .filter((item) => item.group === group)
                  .map(({ title, subtitle, status, icon: Icon, tone }) => (
                    <button
                      key={title}
                      type="button"
                      onClick={() => setSelected(title)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                        selected === title && 'bg-secondary',
                      )}
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Icon className="size-3.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[10px] font-semibold">{title}</span>
                        <span className="block truncate text-[8px] text-muted-foreground">
                          {subtitle}
                        </span>
                      </span>
                      {status ? (
                        <Badge variant={tone === 'danger' ? 'danger' : 'success'}>{status}</Badge>
                      ) : (
                        <ChevronRight className="size-3 text-muted-foreground" />
                      )}
                    </button>
                  ))}
              </section>
            ))
          ) : (
            <div className="p-5 text-center">
              <Search className="mx-auto size-4 text-muted-foreground" />
              <p className="mt-2 text-[10px] font-semibold">No results</p>
              <p className="mt-1 text-[9px] text-muted-foreground">
                Try a booking ID, guest or hotel name.
              </p>
            </div>
          )}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-2.5 py-2 text-[8px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Keyboard className="size-3" aria-hidden="true" />
            ↑↓ navigate · Enter open · Esc close
          </span>
          <span>{results.length} results</span>
        </footer>
        {selected ? (
          <p role="status" className="border-t px-2.5 py-2 text-[9px] font-semibold text-primary">
            {selected} selected in this preview.
          </p>
        ) : null}
      </div>
    </DemoFrame>
  );
}

function OverlayPrinciples() {
  const principles = [
    {
      title: 'Backdrop',
      body: '45% neutral overlay',
      detail: 'Only for blocking modal and drawer flows.',
      icon: Layers,
    },
    {
      title: 'Focus',
      body: 'Trap and restore',
      detail: 'Keep focus inside; return it to the opening control.',
      icon: ShieldAlert,
    },
    {
      title: 'Dismissal',
      body: 'Escape when safe',
      detail: 'Critical flows close only through explicit cancel or completion.',
      icon: X,
    },
    {
      title: 'Layering',
      body: 'One active surface',
      detail: 'Menus and tooltips stay above their parent overlay only.',
      icon: ArrowRight,
    },
    {
      title: 'Actions',
      body: 'Verb-based labels',
      detail: 'Secondary first; primary or danger action remains on the right.',
      icon: Check,
    },
  ];
  return (
    <section
      aria-label="Overlay design principles"
      className="grid gap-2 rounded-xl border bg-card p-3 @sm/design-preview:grid-cols-2 @lg/design-preview:grid-cols-5"
    >
      {principles.map(({ title, body, detail, icon: Icon }) => (
        <article key={title} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted p-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-primary">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[10px] font-semibold">{title}</h2>
            <p className="text-[9px] font-medium">{body}</p>
            <p className="text-[8px] leading-relaxed text-muted-foreground">{detail}</p>
          </div>
        </article>
      ))}
    </section>
  );
}

export default function OverlaysPage() {
  return (
    <div className="mx-auto space-y-5 @2xl/design-preview:max-w-[1600px]">
      <PageHeader
        title="Overlays & contextual UI"
        description="Focused hotel operations patterns for booking changes, payment safeguards, availability, provider operations and global search."
        actions={<Badge variant="muted">8 patterns</Badge>}
      />
      <Alert variant="info" className="py-2 text-xs">
        <Info aria-hidden="true" />
        <AlertDescription>
          Illustrative demo only. Controls change local preview state and do not modify hotel or
          provider data.
        </AlertDescription>
      </Alert>
      <div className="grid min-w-0 gap-3 @lg/design-preview:grid-cols-2">
        <Specimen definition={specimens[0]}>
          <DialogLauncher
            title="Edit booking"
            description="Change a booking detail while preserving payment and provider context."
            action="Save changes"
          >
            <StandardModalPreview />
          </DialogLauncher>
        </Specimen>
        <Specimen definition={specimens[1]}>
          <DialogLauncher
            title="Confirm booking?"
            description="Confirm this paid reservation and send it to Clock PMS."
            action="Confirm booking"
          >
            <ConfirmationPreview />
          </DialogLauncher>
        </Specimen>
        <Specimen definition={specimens[2]}>
          <DialogLauncher
            title="Cancel confirmed booking?"
            description="This action releases room inventory after the hotel and provider steps succeed."
            action="Cancel booking"
            destructive
          >
            <DestructivePreview />
          </DialogLauncher>
        </Specimen>
        <Specimen definition={specimens[3]}>
          <DrawerLauncher>
            <BookingDrawerPreview />
          </DrawerLauncher>
        </Specimen>
        <Specimen definition={specimens[4]}>
          <ActionMenuPreview />
        </Specimen>
        <Specimen definition={specimens[5]}>
          <TooltipPreview />
        </Specimen>
        <Specimen definition={specimens[6]}>
          <DateRangeLauncher>
            <DateRangePreview />
          </DateRangeLauncher>
        </Specimen>
        <Specimen definition={specimens[7]}>
          <SearchOverlayPreview />
        </Specimen>
      </div>
      <OverlayPrinciples />
    </div>
  );
}
