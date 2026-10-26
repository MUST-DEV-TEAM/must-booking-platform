'use client';

import {
  BedDouble,
  CalendarCheck,
  Check,
  CircleHelp,
  Info,
  Minus,
  MoreHorizontal,
  RefreshCw,
  Search,
  TriangleAlert,
  Wallet,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import {
  BookingStatusBadge,
  type BookingStatus,
  type Channel,
  ChannelBadge,
  EmptyState,
  PageHeader,
  PaymentStatusBadge,
  type PaymentStatus,
  StatCard,
} from './_ui/hotel';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { Progress } from '../../components/ui/progress';
import { Separator } from '../../components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../../components/ui/sheet';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';

/** Fake data only. Nothing on this page reads or writes real bookings. */
const demoBookings: Array<{
  ref: string;
  guest: string;
  room: string;
  dates: string;
  channel: Channel;
  status: BookingStatus;
  payment: PaymentStatus;
  total: string;
}> = [
  {
    ref: 'MH-1042',
    guest: 'Elira Hoxha',
    room: 'Deluxe Sea View',
    dates: '12 – 15 Oct',
    channel: 'website',
    status: 'confirmed',
    payment: 'partial',
    total: '€420.00',
  },
  {
    ref: 'MH-1041',
    guest: 'Marco Rossi',
    room: 'Family Suite',
    dates: '10 – 14 Oct',
    channel: 'clock',
    status: 'checked-in',
    payment: 'paid',
    total: '€780.00',
  },
  {
    ref: 'MH-1039',
    guest: 'Anna Schmidt',
    room: 'Standard Double',
    dates: '9 – 11 Oct',
    channel: 'booking',
    status: 'pending',
    payment: 'unpaid',
    total: '€190.00',
  },
  {
    ref: 'MH-1036',
    guest: 'James Carter',
    room: 'Deluxe Sea View',
    dates: '2 – 5 Oct',
    channel: 'website',
    status: 'cancelled',
    payment: 'refunded',
    total: '€360.00',
  },
];

const sections = [
  ['colors', 'Colors'],
  ['type', 'Typography'],
  ['badges', 'Badges and statuses'],
  ['cards', 'Cards and stats'],
  ['alerts', 'Alerts'],
  ['table', 'Table'],
  ['tabs', 'Tabs'],
  ['overlays', 'Dialogs and menus'],
  ['states', 'Loading and empty states'],
] as const;

const typeScale = [
  {
    name: 'Display',
    spec: '24 / 32 → 28 / 36 → 32 / 40 · mobile / tablet / desktop',
    className:
      'text-2xl leading-8 font-bold tracking-tight @sm/design-preview:text-[28px] @sm/design-preview:leading-9 @lg/design-preview:text-[32px] @lg/design-preview:leading-10',
    sample: '€12,480.00 this week',
    use: 'Hero numbers, empty-state headlines',
  },
  {
    name: 'Page title',
    spec: '24 / 32 → 26 / 34 → 28 / 36 · mobile / tablet / desktop',
    className:
      'text-2xl leading-8 font-extrabold tracking-tight @sm/design-preview:text-[26px] @sm/design-preview:leading-[34px] @lg/design-preview:text-[28px] @lg/design-preview:leading-9',
    sample: 'Reservations',
    use: 'One per page',
  },
  {
    name: 'Section title',
    spec: '20 / 28 → 22 / 30 → 24 / 32 · mobile / tablet / desktop',
    className:
      'text-xl leading-7 font-extrabold tracking-tight @sm/design-preview:text-[22px] @sm/design-preview:leading-[30px] @lg/design-preview:text-2xl @lg/design-preview:leading-8',
    sample: 'Arrivals today',
    use: 'Major blocks inside a page',
  },
  {
    name: 'Panel title',
    spec: '18 / 24 → 19 / 27 → 20 / 28 · mobile / tablet / desktop',
    className:
      'text-lg leading-6 font-semibold @sm/design-preview:text-[19px] @sm/design-preview:leading-[27px] @lg/design-preview:text-xl @lg/design-preview:leading-7',
    sample: 'Guest details',
    use: 'Cards, dialogs, side panels',
  },
  {
    name: 'Body',
    spec: '14 / 20 · Regular',
    className: 'text-sm leading-5',
    sample: 'Two adults, one child, breakfast included. Arrives 14 Oct.',
    use: 'Default text, table cells',
  },
  {
    name: 'Small',
    spec: '13 / 18 · Regular',
    className: 'text-[13px] leading-[18px]',
    sample: 'Last synced with Clock 2 minutes ago',
    use: 'Secondary lines, help text',
  },
  {
    name: 'Label',
    spec: '12 / 16 · Semibold',
    className: 'text-xs leading-4 font-semibold',
    sample: 'Check-in date',
    use: 'Form labels, table headers',
  },
  {
    name: 'Caption',
    spec: '11 / 16 · Medium',
    className: 'text-[11px] leading-4 font-medium',
    sample: 'Prices include tax',
    use: 'Footnotes, badges, chart axes',
  },
] as const;

const swatches = [
  { name: 'Primary', token: '--primary', value: '#18181b', swatch: 'bg-primary' },
  { name: 'Primary hover', token: '--primary-hover', value: '#3f3f46', swatch: 'bg-primary-hover' },
  { name: 'Selected', token: '--secondary', value: '#efeff1', swatch: 'bg-secondary' },
  { name: 'Canvas', token: '--background', value: '#f6f6f7', swatch: 'bg-background' },
  { name: 'Surface', token: '--card', value: '#ffffff', swatch: 'bg-card' },
  { name: 'Accent', token: '--brass', value: '#8b8b94', swatch: 'bg-brass' },
  { name: 'Success', token: '--success', value: '#027a48', swatch: 'bg-success' },
  { name: 'Warning', token: '--warning', value: '#b54708', swatch: 'bg-warning' },
  { name: 'Danger', token: '--destructive', value: '#b42318', swatch: 'bg-destructive' },
  { name: 'Info', token: '--info', value: '#0369a1', swatch: 'bg-info' },
] as const;

const statusGroups = [
  {
    name: 'Inventory',
    statuses: [
      { label: 'Available', variant: 'success', icon: Check },
      { label: 'Low availability', variant: 'warning', icon: TriangleAlert },
      { label: 'Blocked', variant: 'muted', icon: Minus },
      { label: 'Maintenance', variant: 'warning', icon: TriangleAlert },
      { label: 'Sold out', variant: 'muted', icon: Minus },
      { label: 'Inventory conflict', variant: 'danger', icon: X },
    ],
  },
  {
    name: 'Booking',
    statuses: [
      { label: 'Confirmed', variant: 'success', icon: Check },
      { label: 'Pending review', variant: 'warning', icon: TriangleAlert },
      { label: 'Cancelled', variant: 'danger', icon: X },
      { label: 'Completed', variant: 'muted', icon: Minus },
      { label: 'On request', variant: 'info', icon: Info },
      { label: 'Pending confirmation', variant: 'warning', icon: TriangleAlert },
    ],
  },
  {
    name: 'Payment',
    statuses: [
      { label: 'Paid', variant: 'success', icon: Check },
      { label: 'Pending', variant: 'warning', icon: TriangleAlert },
      { label: 'Failed', variant: 'danger', icon: X },
      { label: 'Refunded', variant: 'info', icon: Info },
      { label: 'Partially refunded', variant: 'info', icon: Info },
      { label: 'Unpaid', variant: 'muted', icon: Minus },
    ],
  },
  {
    name: 'Stay',
    statuses: [
      { label: 'Checked-in', variant: 'success', icon: Check },
      { label: 'Checked-out', variant: 'muted', icon: Minus },
      { label: 'Due in', variant: 'info', icon: Info },
      { label: 'No-show', variant: 'danger', icon: X },
      { label: 'Due out', variant: 'warning', icon: TriangleAlert },
    ],
  },
  {
    name: 'Provider / PMS',
    statuses: [
      { label: 'Verified', variant: 'success', icon: Check },
      { label: 'Degraded', variant: 'warning', icon: TriangleAlert },
      { label: 'Failed', variant: 'danger', icon: X },
      { label: 'Syncing', variant: 'info', icon: RefreshCw },
      { label: 'Disconnected', variant: 'muted', icon: CircleHelp },
      { label: 'Source conflict', variant: 'danger', icon: X },
    ],
  },
] as const satisfies ReadonlyArray<{
  name: string;
  statuses: ReadonlyArray<{
    label: string;
    variant: 'success' | 'warning' | 'danger' | 'info' | 'muted';
    icon: LucideIcon;
  }>;
}>;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 space-y-4">
      <h2 id={`${id}-title`} className="text-lg font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

export default function DesignShowcasePage() {
  return <DesignShowcaseContent />;
}

export function DesignShowcaseContent() {
  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <PageHeader
        title="Components"
        description="The building blocks for the new MUST dashboard. Demo data only."
        actions={<Badge variant="secondary">shadcn/ui · light mode</Badge>}
      />

      <nav aria-label="Sections" className="flex flex-wrap gap-2">
        {sections.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-full border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            {label}
          </a>
        ))}
      </nav>

      <Section id="colors" title="Colors">
        <p className="text-sm text-muted-foreground">
          Neutral palette. Each swatch shows the CSS token and its value; themes can still swap the
          tokens across the preview.
        </p>
        <div className="grid gap-3 @sm/design-preview:grid-cols-2 @xl/design-preview:grid-cols-5">
          {swatches.map(({ name, token, value, swatch }) => (
            <Card key={token} className="gap-3 px-4 py-4">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className={`size-9 shrink-0 rounded-md border border-border ${swatch}`}
                />
                <div className="min-w-0">
                  <h3 className="text-sm font-bold">{name}</h3>
                  <code className="text-xs text-muted-foreground">{token}</code>
                </div>
              </div>
              <code className="rounded bg-muted px-2 py-1 text-xs font-semibold">{value}</code>
            </Card>
          ))}
        </div>
      </Section>

      <Section id="type" title="Typography">
        <p className="text-sm text-muted-foreground">
          One family (Manrope), eight sizes. Titles scale at mobile, tablet, and desktop widths.
        </p>
        <Card className="gap-0 divide-y px-0 py-0">
          {typeScale.map(({ name, spec, className, sample, use }) => (
            <div
              key={name}
              className="grid items-baseline gap-x-6 gap-y-1 px-6 py-4 @md/design-preview:grid-cols-[170px_minmax(0,1fr)_220px]"
            >
              <div>
                <div className="text-sm font-bold">{name}</div>
                <div className="text-xs text-muted-foreground">{spec}</div>
              </div>
              <p className={className}>{sample}</p>
              <p className="text-xs text-muted-foreground">{use}</p>
            </div>
          ))}
        </Card>
        <div className="grid grid-cols-1 gap-4 @md/design-preview:grid-cols-2">
          <Card className="gap-3 px-6">
            <p className="text-sm font-bold">Weights</p>
            <p className="text-sm font-normal">Regular 400 · body and descriptions</p>
            <p className="text-sm font-medium">Medium 500 · inputs and table cells</p>
            <p className="text-sm font-semibold">Semibold 600 · buttons, labels, tabs</p>
            <p className="text-sm font-bold">Bold 700 · card and panel titles</p>
            <p className="text-sm font-extrabold">Extra bold 800 · page titles and brand</p>
          </Card>
          <Card className="gap-3 px-6">
            <p className="text-sm font-bold">Colors for text</p>
            <p className="text-sm text-foreground">Primary text · main content</p>
            <p className="text-sm text-muted-foreground">
              Secondary text · help, meta, placeholders
            </p>
            <p className="text-sm font-semibold text-primary">Link and active text</p>
            <p className="text-sm font-semibold text-destructive">Error text · cancelled, failed</p>
            <p className="text-sm font-semibold text-success">Success text · paid, confirmed</p>
          </Card>
          <Card className="gap-3 px-6">
            <p className="text-sm font-bold">Numbers and references</p>
            <p className="text-sm tabular-nums">Money lines up: €1,240.00 · €86.50 · €9.90</p>
            <p className="font-mono text-sm">MH-1042 · MH-1043 · reference codes</p>
            <p className="text-2xl font-extrabold tracking-tight tabular-nums">€12,480.00</p>
          </Card>
          <Card className="gap-3 px-6">
            <p className="text-sm font-bold">Reading width</p>
            <p className="max-w-prose text-sm">
              Long text stays at about 65 characters per line. Guests who arrive after 22:00 are
              asked to confirm with the front desk before travelling, so the room is held.
            </p>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Table header · 12 caps
            </p>
          </Card>
        </div>
      </Section>

      <Section id="badges" title="Badges and statuses">
        <div className="grid gap-4 @sm/design-preview:grid-cols-2 @xl/design-preview:grid-cols-5">
          {statusGroups.map(({ name, statuses }) => (
            <Card key={name} className="gap-3 px-4 py-4">
              <h3 className="text-sm font-bold">{name}</h3>
              <div className="flex flex-col items-start gap-2">
                {statuses.map(({ label, variant, icon: Icon }) => (
                  <Badge key={label} variant={variant}>
                    <Icon aria-hidden="true" />
                    {label}
                  </Badge>
                ))}
              </div>
            </Card>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm text-muted-foreground">Channel</span>
          {(['website', 'clock', 'booking', 'airbnb', 'walk-in'] as const).map((channel) => (
            <ChannelBadge key={channel} channel={channel} />
          ))}
        </div>

        <div id="alerts" className="scroll-mt-6 space-y-8 pt-3">
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold">Alert banners and inline alerts</h3>
              <p className="text-sm text-muted-foreground">
                Clear outcomes, short explanations, and a recovery action where one is useful.
              </p>
            </div>
            <div className="grid gap-5 @xl/design-preview:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Alert banner</h4>
                {[
                  {
                    variant: 'info',
                    icon: Info,
                    title: 'Payment required',
                    description: 'No confirmation until payment is verified.',
                    action: 'View booking',
                  },
                  {
                    variant: 'success',
                    icon: Check,
                    title: 'Payment verified',
                    description: 'Payment recorded; booking confirmed in this demo.',
                    action: 'View booking',
                  },
                  {
                    variant: 'warning',
                    icon: TriangleAlert,
                    title: 'Source-of-truth conflict',
                    description: 'Local and provider inventory are both enabled.',
                    action: 'Resolve',
                  },
                  {
                    variant: 'destructive',
                    icon: X,
                    title: 'Integrity mismatch',
                    description: 'Reservation exists without verified payment.',
                    action: 'Investigate',
                  },
                ].map(({ variant, icon: Icon, title, description, action }) => (
                  <Alert
                    key={title}
                    variant={variant as 'info' | 'success' | 'warning' | 'destructive'}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2"
                  >
                    <Icon aria-hidden="true" />
                    <div className="min-w-[180px] flex-1">
                      <AlertTitle>{title}</AlertTitle>
                      <AlertDescription>{description}</AlertDescription>
                    </div>
                    <Button variant="outline" size="sm">
                      {action}
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Dismiss ${title}`}>
                      <X />
                    </Button>
                  </Alert>
                ))}
              </div>
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Inline alert</h4>
                {[
                  {
                    variant: 'info',
                    icon: Info,
                    text: 'Price and availability revalidate before payment.',
                  },
                  { variant: 'success', icon: Check, text: 'Payment verified; booking confirmed.' },
                  {
                    variant: 'warning',
                    icon: TriangleAlert,
                    text: 'Enter every child age before requesting a quote.',
                  },
                  {
                    variant: 'destructive',
                    icon: X,
                    text: 'Provider write failed; no external change assumed.',
                  },
                  {
                    variant: 'default',
                    icon: Info,
                    text: 'Read-only access: changes are disabled.',
                  },
                ].map(({ variant, icon: Icon, text }) => (
                  <Alert
                    key={text}
                    variant={variant as 'default' | 'info' | 'success' | 'warning' | 'destructive'}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <Icon aria-hidden="true" />
                    <div className="min-w-0 flex-1 text-sm">{text}</div>
                    <Button variant="ghost" size="icon-sm" aria-label={`Dismiss: ${text}`}>
                      <X />
                    </Button>
                  </Alert>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold">Message components</h3>
              <p className="text-sm text-muted-foreground">
                Success, review, failure, and information with next steps.
              </p>
            </div>
            <div className="grid gap-3 @sm/design-preview:grid-cols-2 @2xl/design-preview:grid-cols-4">
              {[
                {
                  title: 'Booking confirmed',
                  detail: 'Payment verified and reservation confirmed.',
                  action: 'View',
                  icon: Check,
                  tone: 'border-success/30 bg-success-surface text-success',
                },
                {
                  title: 'Review required',
                  detail: 'Resolve the inventory or source-of-truth conflict.',
                  action: 'Review',
                  icon: TriangleAlert,
                  tone: 'border-warning/30 bg-warning-surface text-warning',
                },
                {
                  title: 'Operation failed',
                  detail: 'No payment or provider write was assumed successful.',
                  action: 'Retry',
                  icon: X,
                  tone: 'border-destructive/30 bg-destructive-surface text-destructive',
                },
                {
                  title: 'Payment pending',
                  detail: 'Keep booking and payment statuses separate.',
                  action: 'Got it',
                  icon: Info,
                  tone: 'border-info/30 bg-info-surface text-info',
                },
              ].map(({ title, detail, action, icon: Icon, tone }) => (
                <Card key={title} className={`flex min-h-48 flex-col gap-3 px-4 py-4 ${tone}`}>
                  <Icon aria-hidden="true" className="size-5" />
                  <h4 className="text-sm font-bold">{title}</h4>
                  <p className="flex-1 text-xs leading-5 opacity-80">{detail}</p>
                  <Button variant="outline" size="sm" className="border-current bg-card">
                    {action}
                  </Button>
                </Card>
              ))}
            </div>
          </div>

          <div className="grid gap-6 @xl/design-preview:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
            <div className="space-y-3">
              <h3 className="text-base font-bold">Toast notifications</h3>
              {[
                {
                  variant: 'success',
                  icon: Check,
                  title: 'Booking confirmed',
                  detail: 'Payment verified for MH-1042.',
                },
                {
                  variant: 'info',
                  icon: Info,
                  title: 'PMS connected',
                  detail: 'Provider status refreshed in the demo.',
                },
                {
                  variant: 'warning',
                  icon: TriangleAlert,
                  title: 'Low availability',
                  detail: 'Deluxe Sea View has 1 room left.',
                },
                {
                  variant: 'destructive',
                  icon: X,
                  title: 'Payment failed',
                  detail: 'No booking confirmation was issued.',
                },
              ].map(({ variant, icon: Icon, title, detail }) => (
                <Alert
                  key={title}
                  variant={variant as 'info' | 'success' | 'warning' | 'destructive'}
                  className="flex items-center gap-3 shadow-sm"
                >
                  <Icon aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <AlertTitle>{title}</AlertTitle>
                    <AlertDescription>{detail}</AlertDescription>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label={`Dismiss ${title}`}>
                    <X />
                  </Button>
                </Alert>
              ))}
            </div>

            <div id="states" className="scroll-mt-6 space-y-5">
              <div className="space-y-3">
                <h3 className="text-base font-bold">Progress bars</h3>
                {[
                  { label: 'Availability refresh', value: 45, tone: '[&>div]:bg-primary' },
                  { label: 'Payment reconciliation', value: 75, tone: '[&>div]:bg-success' },
                  { label: 'PMS reservation sync', value: 60, tone: '[&>div]:bg-warning' },
                  { label: 'Provider retry', value: 30, tone: '[&>div]:bg-destructive' },
                ].map(({ label, value, tone }) => (
                  <div key={label} className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-semibold tabular-nums">{value}%</span>
                    </div>
                    <Progress aria-label={label} value={value} className={tone} />
                  </div>
                ))}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Verifying provider operation</span>
                    <span className="font-semibold">Working</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="Verifying provider operation"
                    className="h-2 overflow-hidden rounded-full bg-secondary"
                  >
                    <div
                      className="ui-progress-indeterminate h-full w-full rounded-full"
                      style={{
                        background:
                          'repeating-linear-gradient(135deg, var(--primary) 0 8px, transparent 8px 16px)',
                        backgroundSize: '32px 32px',
                      }}
                    />
                  </div>
                </div>
              </div>

              <Card className="gap-4 px-4 py-4">
                <h3 className="text-base font-bold">Loading and processing</h3>
                <div className="grid gap-4 @md/design-preview:grid-cols-2">
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold">Sizes</h4>
                    <div className="flex items-end justify-between">
                      {[
                        ['XS', 'size-3'],
                        ['S', 'size-4'],
                        ['M', 'size-5'],
                        ['L', 'size-6'],
                      ].map(([size, className]) => (
                        <div
                          key={size}
                          className="grid justify-items-center gap-2 text-xs text-muted-foreground"
                        >
                          <RefreshCw
                            aria-hidden="true"
                            className={`${className} animate-spin text-primary`}
                          />
                          {size}
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">12 · 16 · 20 · 24 px</p>
                  </div>
                  <div className="space-y-2 border-t pt-3 @md/design-preview:border-t-0 @md/design-preview:border-l @md/design-preview:pt-0 @md/design-preview:pl-4">
                    <h4 className="text-sm font-semibold">Inline usage</h4>
                    <Button variant="outline" loading className="w-full justify-between">
                      Loading bookings…
                    </Button>
                    <Button variant="outline" loading className="w-full justify-between">
                      Saving booking…
                    </Button>
                    <Button loading className="w-full">
                      Sync PMS
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold">Booking skeletons</h3>
              <p className="text-sm text-muted-foreground">
                Loading layouts for the card, table, and detail panel.
              </p>
            </div>
            <div className="grid gap-3 @xl/design-preview:grid-cols-3">
              <Card
                role="status"
                aria-label="Loading booking card"
                aria-busy="true"
                className="gap-3 px-4 py-4"
              >
                <h4 className="text-xs font-semibold">Booking card</h4>
                <div className="flex gap-3">
                  <div className="w-24 shrink-0 space-y-2">
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-3/4" />
                    <div className="flex justify-between border-t pt-2">
                      <Skeleton className="h-3 w-14" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                  </div>
                </div>
              </Card>
              <Card
                role="status"
                aria-label="Loading booking table"
                aria-busy="true"
                className="gap-3 px-4 py-4"
              >
                <h4 className="text-xs font-semibold">Booking table</h4>
                <div className="overflow-hidden rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {[0, 1, 2, 3].map((column) => (
                          <TableHead key={column} className="h-9 px-2">
                            <Skeleton className="h-3 w-4/5" />
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[0, 1, 2].map((row) => (
                        <TableRow key={row}>
                          {[0, 1, 2, 3].map((column) => (
                            <TableCell key={column} className="px-2 py-3">
                              <Skeleton className={column === 0 ? 'h-3 w-3/4' : 'h-3 w-full'} />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>
              <Card
                role="status"
                aria-label="Loading booking detail panel"
                aria-busy="true"
                className="gap-3 px-4 py-4"
              >
                <h4 className="text-xs font-semibold">Booking detail panel</h4>
                <div className="flex gap-3">
                  <Skeleton className="size-20 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-3 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-5/6" />
                    <div className="grid grid-cols-2 gap-3 border-t pt-3">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-base font-bold">Empty and recovery states</h3>
            <div className="grid gap-3 @sm/design-preview:grid-cols-2 @xl/design-preview:grid-cols-4">
              <EmptyState
                icon={CalendarCheck}
                title="No bookings yet"
                description="Create the first staff booking or wait for a paid public booking."
                action={<Button size="sm">Create booking</Button>}
              />
              <EmptyState
                icon={Search}
                title="No bookings match"
                description="Adjust hotel, dates, booking status, or payment status."
                action={
                  <Button size="sm" variant="secondary">
                    Reset filters
                  </Button>
                }
              />
              <EmptyState
                icon={RefreshCw}
                title="Provider temporarily unavailable"
                description="The demo provider could not be reached; no external write was assumed successful."
                action={<Button size="sm">Retry PMS</Button>}
              />
              <EmptyState
                icon={Wallet}
                title="You cannot manage payments"
                description="Your role cannot refund, reconcile, or change payment state."
                action={
                  <Button size="sm" variant="secondary">
                    Contact admin
                  </Button>
                }
              />
            </div>
          </div>

          <div className="grid gap-3 rounded-xl border bg-muted/60 p-4 @sm/design-preview:grid-cols-2 @xl/design-preview:grid-cols-5">
            {[
              [
                'Separate status domains',
                'Booking, payment, stay, inventory, and provider states stay distinct.',
              ],
              ['Canonical icons', 'Pair one clear icon with a readable status label.'],
              ['Explicit outcomes', 'Say what failed and what the next step does.'],
              ['Payment integrity', 'A reservation never proves that payment was verified.'],
              ['Accessible feedback', 'Use color with labels and recovery actions.'],
            ].map(([title, detail]) => (
              <div key={title} className="space-y-1">
                <h4 className="text-xs font-bold">{title}</h4>
                <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section id="cards" title="Cards and stats">
        <div className="grid grid-cols-1 gap-4 @sm/design-preview:grid-cols-2 @lg/design-preview:grid-cols-4">
          <StatCard label="Arrivals today" value="8" icon={CalendarCheck} hint="3 checked in" />
          <StatCard label="Occupancy" value="76%" icon={BedDouble} change={4} hint="vs last week" />
          <StatCard label="Revenue (Oct)" value="€18,240" icon={Wallet} change={12} />
          <StatCard label="Unpaid balance" value="€1,130" icon={TriangleAlert} change={-8} />
        </div>
        <div className="grid grid-cols-1 gap-4 @md/design-preview:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Today at a glance</CardTitle>
              <CardDescription>Friday, 9 October</CardDescription>
              <CardAction>
                <Button variant="ghost" size="icon" aria-label="More">
                  <MoreHorizontal />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span>Rooms occupied</span>
                  <span className="font-semibold">38 / 50</span>
                </div>
                <Progress value={76} />
              </div>
              <Separator />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Departures</span>
                <span className="font-semibold">5</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Rooms to clean</span>
                <span className="font-semibold">7</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Guest</CardTitle>
              <CardDescription>Card with an avatar and details</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-4">
              <Avatar className="size-12">
                <AvatarFallback>EH</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="font-bold">Elira Hoxha</div>
                <div className="truncate text-sm text-muted-foreground">
                  elira@example.com · +355 69 000 0000
                </div>
              </div>
              <BookingStatusBadge status="confirmed" />
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section id="table" title="Table">
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox aria-label="Select all" />
                </TableHead>
                <TableHead>Ref</TableHead>
                <TableHead>Guest</TableHead>
                <TableHead>Room</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {demoBookings.map((booking) => (
                <TableRow key={booking.ref}>
                  <TableCell>
                    <Checkbox aria-label={`Select ${booking.ref}`} />
                  </TableCell>
                  <TableCell className="font-semibold text-primary">{booking.ref}</TableCell>
                  <TableCell>{booking.guest}</TableCell>
                  <TableCell className="text-muted-foreground">{booking.room}</TableCell>
                  <TableCell>{booking.dates}</TableCell>
                  <TableCell>
                    <ChannelBadge channel={booking.channel} />
                  </TableCell>
                  <TableCell>
                    <BookingStatusBadge status={booking.status} />
                  </TableCell>
                  <TableCell>
                    <PaymentStatusBadge status={booking.payment} />
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {booking.total}
                  </TableCell>
                  <TableCell>
                    <BookingMenu reference={booking.ref} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Section>

      <Section id="tabs" title="Tabs">
        <Tabs defaultValue="arrivals">
          <TabsList>
            <TabsTrigger value="arrivals">Arrivals</TabsTrigger>
            <TabsTrigger value="in-house">In house</TabsTrigger>
            <TabsTrigger value="departures">Departures</TabsTrigger>
          </TabsList>
          <TabsContent value="arrivals">
            <Card className="px-6 text-sm">8 guests arriving today.</Card>
          </TabsContent>
          <TabsContent value="in-house">
            <Card className="px-6 text-sm">38 rooms occupied.</Card>
          </TabsContent>
          <TabsContent value="departures">
            <Card className="px-6 text-sm">5 guests leaving today.</Card>
          </TabsContent>
        </Tabs>
      </Section>

      <Section id="overlays" title="Dialogs and menus">
        <Row>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="destructive">Cancel booking…</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Cancel MH-1042?</DialogTitle>
                <DialogDescription>
                  The booking is cancelled in Clock and the guest gets an email. This can&apos;t be
                  undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Keep booking</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="destructive">Cancel booking</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Open side panel</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>MH-1041 · Marco Rossi</SheetTitle>
                <SheetDescription>Quick look without leaving the list.</SheetDescription>
              </SheetHeader>
              <div className="space-y-3 px-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Room</span>
                  <span>Family Suite</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Dates</span>
                  <span>10 – 14 Oct</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <BookingStatusBadge status="checked-in" />
                </div>
              </div>
            </SheetContent>
          </Sheet>

          <BookingMenu reference="MH-1042" label="Actions menu" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Hover for tooltip</Button>
            </TooltipTrigger>
            <TooltipContent>Last synced with Clock 2 minutes ago</TooltipContent>
          </Tooltip>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">Popover</Button>
            </PopoverTrigger>
            <PopoverContent className="space-y-2 text-sm">
              <div className="font-bold">Price breakdown</div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">3 nights × €140</span>
                <span>€420.00</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Deposit paid</span>
                <span>−€126.00</span>
              </div>
            </PopoverContent>
          </Popover>
        </Row>
      </Section>
    </div>
  );
}

function BookingMenu({ reference, label }: { reference: string; label?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {label ? (
          <Button variant="outline">{label}</Button>
        ) : (
          <Button variant="ghost" size="icon" aria-label={`Actions for ${reference}`}>
            <MoreHorizontal />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{reference}</DropdownMenuLabel>
        <DropdownMenuItem>Open booking</DropdownMenuItem>
        <DropdownMenuItem>Send payment link</DropdownMenuItem>
        <DropdownMenuItem>Resend confirmation</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">Cancel booking</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
