'use client';

import {
  BedDouble,
  CalendarCheck,
  Check,
  CircleHelp,
  Info,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
  Wallet,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Alert, AlertDescription, AlertTitle } from './_ui/alert';
import { Avatar, AvatarFallback } from './_ui/avatar';
import { Badge } from './_ui/badge';
import { Button } from './_ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from './_ui/card';
import { Checkbox } from './_ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './_ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './_ui/dropdown-menu';
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
import { Input, Textarea } from './_ui/input';
import { Label } from './_ui/label';
import { Popover, PopoverContent, PopoverTrigger } from './_ui/popover';
import { Progress } from './_ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './_ui/select';
import { Separator } from './_ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './_ui/sheet';
import { Skeleton } from './_ui/skeleton';
import { Switch } from './_ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './_ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './_ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from './_ui/tooltip';

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
  ['responsive', 'Responsive behavior'],
  ['badges', 'Badges and statuses'],
  ['forms', 'Form controls'],
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
      'text-2xl leading-8 font-bold tracking-tight sm:text-[28px] sm:leading-9 lg:text-[32px] lg:leading-10',
    sample: '€12,480.00 this week',
    use: 'Hero numbers, empty-state headlines',
  },
  {
    name: 'Page title',
    spec: '24 / 32 → 26 / 34 → 28 / 36 · mobile / tablet / desktop',
    className:
      'text-2xl leading-8 font-extrabold tracking-tight sm:text-[26px] sm:leading-[34px] lg:text-[28px] lg:leading-9',
    sample: 'Reservations',
    use: 'One per page',
  },
  {
    name: 'Section title',
    spec: '20 / 28 → 22 / 30 → 24 / 32 · mobile / tablet / desktop',
    className:
      'text-xl leading-7 font-extrabold tracking-tight sm:text-[22px] sm:leading-[30px] lg:text-2xl lg:leading-8',
    sample: 'Arrivals today',
    use: 'Major blocks inside a page',
  },
  {
    name: 'Panel title',
    spec: '18 / 24 → 19 / 27 → 20 / 28 · mobile / tablet / desktop',
    className:
      'text-lg leading-6 font-semibold sm:text-[19px] sm:leading-[27px] lg:text-xl lg:leading-7',
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
  ['Primary', 'bg-primary', 'Buttons, links, active items'],
  ['Primary hover', 'bg-primary-hover', 'Hover on primary'],
  ['Selected', 'bg-secondary', 'Selected rows and nav'],
  ['Canvas', 'bg-background', 'Page background'],
  ['Surface', 'bg-card', 'Cards and panels'],
  ['Accent', 'bg-brass', 'Charts, highlights'],
  ['Success', 'bg-success', 'Confirmed, paid'],
  ['Warning', 'bg-warning', 'Pending, unpaid'],
  ['Danger', 'bg-destructive', 'Cancelled, errors'],
  ['Info', 'bg-info', 'Notes, deposits'],
] as const;

const themePreviews = [
  { name: 'Neutral', theme: 'neutral' },
  { name: 'Pine', theme: 'pine' },
  { name: 'Ocean', theme: 'ocean' },
  { name: 'Terracotta', theme: 'terracotta' },
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
          Compare the same semantic tokens across the neutral, pine, ocean, and terracotta themes.
          Each preview uses the page&apos;s swappable color tokens.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          {themePreviews.map(({ name, theme }) => (
            <Card
              key={theme}
              data-theme-preview={theme}
              className="design-color-variant gap-4 px-4 py-4"
            >
              <div>
                <h3 className="font-bold">{name}</h3>
                <p className="text-xs text-muted-foreground">Semantic color tokens</p>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                {swatches.map(([token, swatch, use]) => (
                  <div key={token} className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`size-5 shrink-0 rounded border border-border ${swatch}`}
                    />
                    <span className="truncate text-xs" title={use}>
                      {token}
                    </span>
                  </div>
                ))}
              </div>
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
              className="grid items-baseline gap-x-6 gap-y-1 px-6 py-4 md:grid-cols-[170px_minmax(0,1fr)_220px]"
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

      <Section id="responsive" title="Responsive behavior">
        <p className="text-sm text-muted-foreground">
          Resize the preview to see typography, navigation, and content reflow at mobile
          (&lt;640px), tablet (640–1023px), and desktop (≥1024px) widths.
        </p>
        <Card className="gap-5 px-5 py-5">
          <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-muted-foreground">Responsive page header</p>
              <h3 className="text-xl leading-7 font-bold tracking-tight sm:text-2xl sm:leading-8 lg:text-[28px] lg:leading-9">
                Reservations
              </h3>
            </div>
            <p className="text-sm text-muted-foreground">MH-1042 · 12–15 Oct</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Arrivals', '8'],
              ['In house', '38'],
              ['Departures', '5'],
              ['Rooms to clean', '7'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border bg-background p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
            <nav
              aria-label="Responsive navigation example"
              className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1"
            >
              {['Overview', 'Reservations', 'Availability'].map((item) => (
                <span key={item} className="rounded-md bg-secondary px-3 py-2 text-sm font-medium">
                  {item}
                </span>
              ))}
            </nav>
            <div className="min-w-0 rounded-lg border p-3 text-sm">
              <p className="font-semibold">Reservation list</p>
              <p className="mt-1 text-muted-foreground">
                Content stacks on narrow screens, then uses columns and a side navigation as space
                allows.
              </p>
            </div>
          </div>
        </Card>
      </Section>

      <Section id="badges" title="Badges and statuses">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
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
      </Section>

      <Section id="forms" title="Form controls">
        <Card className="px-6">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="demo-guest">Guest name</Label>
              <Input id="demo-guest" placeholder="e.g. Elira Hoxha" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="demo-search">Search</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="demo-search" className="pl-9" placeholder="Name, email or MH- ref" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="demo-email">Email (with error)</Label>
              <Input id="demo-email" aria-invalid defaultValue="elira@" />
              <p className="text-xs text-destructive">Enter a full email address.</p>
            </div>
            <div className="grid gap-2">
              <Label>Room type</Label>
              <Select defaultValue="deluxe">
                <SelectTrigger className="w-full" aria-label="Room type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard Double</SelectItem>
                  <SelectItem value="deluxe">Deluxe Sea View</SelectItem>
                  <SelectItem value="suite">Family Suite</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="demo-notes">Internal note</Label>
              <Textarea id="demo-notes" placeholder="Late arrival, baby cot requested…" />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="demo-email-guest" defaultChecked />
              <Label htmlFor="demo-email-guest">Email confirmation to guest</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="demo-sync" defaultChecked />
              <Label htmlFor="demo-sync">Sync this room type to Clock</Label>
            </div>
          </div>
        </Card>
      </Section>

      <Section id="cards" title="Cards and stats">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Arrivals today" value="8" icon={CalendarCheck} hint="3 checked in" />
          <StatCard label="Occupancy" value="76%" icon={BedDouble} change={4} hint="vs last week" />
          <StatCard label="Revenue (Oct)" value="€18,240" icon={Wallet} change={12} />
          <StatCard label="Unpaid balance" value="€1,130" icon={TriangleAlert} change={-8} />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

      <Section id="alerts" title="Alerts">
        <div className="grid gap-3">
          <Alert variant="info">
            <Info />
            <AlertTitle>Clock sync runs every 5 minutes</AlertTitle>
            <AlertDescription>Changes made in Clock appear here shortly after.</AlertDescription>
          </Alert>
          <Alert variant="success">
            <CalendarCheck />
            <AlertTitle>Booking confirmed</AlertTitle>
            <AlertDescription>
              MH-1042 was sent to Clock and the guest was emailed.
            </AlertDescription>
          </Alert>
          <Alert variant="warning">
            <TriangleAlert />
            <AlertTitle>Deposit not received</AlertTitle>
            <AlertDescription>The payment link for MH-1039 expires in 2 hours.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>Clock rejected the booking</AlertTitle>
            <AlertDescription>The room is no longer available for these dates.</AlertDescription>
          </Alert>
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

      <Section id="states" title="Loading and empty states">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className="px-6">
            <div className="space-y-3">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </Card>
          <EmptyState
            icon={CalendarCheck}
            title="No arrivals today"
            description="New bookings from the website and Clock show up here."
            action={
              <Button size="sm">
                <Plus /> New booking
              </Button>
            }
          />
        </div>
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
