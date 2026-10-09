'use client';

import {
  BedDouble,
  CalendarCheck,
  Info,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
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
  ['buttons', 'Buttons'],
  ['badges', 'Badges and statuses'],
  ['forms', 'Form controls'],
  ['cards', 'Cards and stats'],
  ['alerts', 'Alerts'],
  ['table', 'Table'],
  ['tabs', 'Tabs'],
  ['overlays', 'Dialogs and menus'],
  ['states', 'Loading and empty states'],
] as const;

const swatches = [
  ['Primary', 'bg-primary', 'Buttons, links, active items'],
  ['Primary hover', 'bg-primary-hover', 'Hover on primary'],
  ['Selected', 'bg-secondary', 'Selected rows and nav'],
  ['Canvas', 'bg-background', 'Page background'],
  ['Surface', 'bg-card', 'Cards and panels'],
  ['Brass', 'bg-brass', 'Focus ring, Clock channel'],
  ['Success', 'bg-success', 'Confirmed, paid'],
  ['Warning', 'bg-warning', 'Pending, unpaid'],
  ['Danger', 'bg-destructive', 'Cancelled, errors'],
  ['Info', 'bg-info', 'Notes, deposits'],
] as const;

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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {swatches.map(([name, swatch, use]) => (
            <div key={name} className="overflow-hidden rounded-lg border bg-card">
              <div className={`h-14 border-b ${swatch}`} />
              <div className="space-y-0.5 p-3">
                <div className="text-sm font-bold">{name}</div>
                <div className="text-xs text-muted-foreground">{use}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="type" title="Typography">
        <Card className="gap-3 px-6">
          <p className="text-3xl font-extrabold tracking-tight">Page title · 30 extra bold</p>
          <p className="text-2xl font-extrabold tracking-tight">Section title · 24 extra bold</p>
          <p className="text-lg font-bold">Card title · 18 bold</p>
          <p className="text-sm">Body text · 14 regular. Guests arriving today are listed first.</p>
          <p className="text-sm text-muted-foreground">Secondary text · 14 muted</p>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Table header · 12 caps
          </p>
        </Card>
      </Section>

      <Section id="buttons" title="Buttons">
        <Row>
          <Button>
            <Plus /> New booking
          </Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button variant="destructive">Cancel booking</Button>
        </Row>
        <Row>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" variant="outline" aria-label="Refresh">
            <RefreshCw />
          </Button>
          <Button disabled>Disabled</Button>
          <Button disabled>
            <RefreshCw className="animate-spin" /> Syncing with Clock
          </Button>
        </Row>
      </Section>

      <Section id="badges" title="Badges and statuses">
        <Row>
          <span className="w-20 text-sm text-muted-foreground">Booking</span>
          {(
            ['pending', 'confirmed', 'checked-in', 'checked-out', 'cancelled', 'no-show'] as const
          ).map((status) => (
            <BookingStatusBadge key={status} status={status} />
          ))}
        </Row>
        <Row>
          <span className="w-20 text-sm text-muted-foreground">Payment</span>
          {(['paid', 'partial', 'unpaid', 'refunded', 'failed'] as const).map((status) => (
            <PaymentStatusBadge key={status} status={status} />
          ))}
        </Row>
        <Row>
          <span className="w-20 text-sm text-muted-foreground">Channel</span>
          {(['website', 'clock', 'booking', 'airbnb', 'walk-in'] as const).map((channel) => (
            <ChannelBadge key={channel} channel={channel} />
          ))}
        </Row>
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
