'use client';

import {
  Archive,
  BedDouble,
  Ban,
  Check,
  ChevronDown,
  CreditCard,
  Download,
  Ellipsis,
  Eye,
  FileText,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  Stethoscope,
  Trash2,
  Undo2,
  UserPlus,
  X,
  ArrowLeftRight,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../_lib/utils';
import { Alert, AlertDescription } from '../_ui/alert';
import { Badge } from '../_ui/badge';
import { Button } from '../_ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../_ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../_ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../_ui/dropdown-menu';
import { PageHeader } from '../_ui/hotel';
import { Input } from '../_ui/input';
import { Label } from '../_ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../_ui/table';

type Variant = 'default' | 'secondary' | 'ghost' | 'destructive' | 'success';
type ButtonState = 'default' | 'hover' | 'pressed' | 'focus' | 'disabled' | 'loading';

const variants: ReadonlyArray<{ id: Variant; label: string; use: string }> = [
  { id: 'default', label: 'Primary', use: 'The one main action on a surface' },
  { id: 'secondary', label: 'Secondary', use: 'Supporting actions' },
  { id: 'ghost', label: 'Ghost', use: 'Quiet, repeated, in tables' },
  { id: 'destructive', label: 'Destructive', use: 'Cancel, refund, delete' },
  { id: 'success', label: 'Success', use: 'Confirm, check in, finish' },
];

const states: readonly ButtonState[] = [
  'default',
  'hover',
  'pressed',
  'focus',
  'disabled',
  'loading',
];

/** Classes that freeze a hover, pressed or focus look so every state can be shown side by side. */
const forced: Record<Variant, Partial<Record<ButtonState, string>>> = {
  default: { hover: 'bg-primary-hover', pressed: 'bg-primary-hover brightness-90' },
  secondary: { hover: 'bg-secondary/80', pressed: 'bg-secondary/80 brightness-95' },
  ghost: { hover: 'bg-accent', pressed: 'bg-accent/70' },
  destructive: { hover: 'bg-destructive/90', pressed: 'bg-destructive/90 brightness-90' },
  success: { hover: 'bg-success/90', pressed: 'bg-success/90 brightness-90' },
};

const focusRing = 'ring-[3px] ring-ring/50';

function stateProps(variant: Variant, state: ButtonState) {
  return {
    variant,
    disabled: state === 'disabled',
    loading: state === 'loading',
    className: cn(
      state === 'focus' ? focusRing : forced[variant][state],
      state === 'disabled' && 'opacity-50',
    ),
  };
}

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Rule({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border bg-muted px-4 py-3 text-sm text-muted-foreground">{children}</p>
  );
}

/* ---------- 1. Button matrix ---------- */

const sizeRows = [
  { size: 'lg', label: 'Large · 40px' },
  { size: 'default', label: 'Medium · 36px' },
  { size: 'sm', label: 'Small · 32px' },
] as const;

function ButtonMatrix() {
  return (
    <div className="space-y-6 overflow-x-auto">
      {sizeRows.map(({ size, label }) => (
        <div key={size} className="min-w-[760px] space-y-2">
          <p className="text-sm font-bold">{label}</p>
          <div className="grid grid-cols-[88px_repeat(5,minmax(0,1fr))] items-center gap-x-4 gap-y-3 rounded-xl border bg-card p-4">
            <span />
            {variants.map((v) => (
              <span key={v.id} className="text-xs font-semibold text-muted-foreground">
                {v.label}
              </span>
            ))}
            {states.map((state) => (
              <Row key={state} state={state} size={size} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({ state, size }: { state: ButtonState; size: 'lg' | 'default' | 'sm' }) {
  return (
    <>
      <span className="text-xs text-muted-foreground capitalize">{state}</span>
      {variants.map((v) => (
        <div key={v.id}>
          <Button {...stateProps(v.id, state)} size={size}>
            {state === 'loading' ? 'Loading' : 'Button'}
          </Button>
        </div>
      ))}
    </>
  );
}

/* ---------- 2. Icon buttons ---------- */

const iconFor: Record<Variant, LucideIcon> = {
  default: Plus,
  secondary: Eye,
  ghost: Ellipsis,
  destructive: Trash2,
  success: Check,
};

function IconButtonMatrix() {
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[560px] grid-cols-[88px_repeat(5,minmax(0,1fr))] items-center gap-x-4 gap-y-3 rounded-xl border bg-card p-4">
        <span />
        {variants.map((v) => (
          <span key={v.id} className="text-xs font-semibold text-muted-foreground">
            {v.label}
          </span>
        ))}
        {states.map((state) => (
          <IconRow key={state} state={state} />
        ))}
      </div>
    </div>
  );
}

function IconRow({ state }: { state: ButtonState }) {
  return (
    <>
      <span className="text-xs text-muted-foreground capitalize">{state}</span>
      {variants.map((v) => {
        const Icon = iconFor[v.id];
        return (
          <div key={v.id}>
            <Button {...stateProps(v.id, state)} size="icon" aria-label={`${v.label} ${state}`}>
              <Icon />
            </Button>
          </div>
        );
      })}
    </>
  );
}

/* ---------- 3. Action patterns ---------- */

const commonActions: ReadonlyArray<{
  label: string;
  note: string;
  variant: Variant;
  icon: LucideIcon;
}> = [
  { label: 'Manual booking', note: 'Primary action', variant: 'default', icon: Plus },
  { label: 'View booking', note: 'Supporting action', variant: 'secondary', icon: Eye },
  { label: 'More actions', note: 'Quiet action', variant: 'ghost', icon: Ellipsis },
  { label: 'Cancel booking', note: 'Destructive action', variant: 'destructive', icon: X },
  { label: 'Confirm booking', note: 'Successful action', variant: 'success', icon: Check },
  { label: 'Processing', note: 'Temporary state', variant: 'default', icon: RefreshCw },
];

function ActionPatterns() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {commonActions.map(({ label, note, variant, icon: Icon }) => (
        <div key={label} className="flex items-center gap-3 rounded-xl border bg-card p-3">
          <Button
            variant={variant}
            size="icon"
            aria-label={label}
            loading={label === 'Processing'}
            tabIndex={-1}
          >
            <Icon />
          </Button>
          <div className="leading-tight">
            <div className="text-sm font-semibold">{label}</div>
            <div className="text-xs text-muted-foreground">{note}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- 4. Split button ---------- */

function SplitButton({
  state = 'default',
  className,
}: {
  state?: ButtonState;
  className?: string;
}) {
  const props = stateProps('success', state);
  const loading = state === 'loading';
  return (
    <div className={cn('inline-flex', className)}>
      <Button {...props} className={cn(props.className, 'rounded-r-none')}>
        {loading ? (
          'Processing'
        ) : (
          <>
            <FileText /> Create booking
          </>
        )}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="success"
            size="icon"
            aria-label="More booking actions"
            disabled={state === 'disabled' || loading}
            className={cn(
              'rounded-l-none border-l border-white/30',
              state === 'focus' && focusRing,
            )}
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem>
            <Plus /> Create and add payment
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Send /> Create and send confirmation
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Save /> Save as draft
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* ---------- 5. Dropdown items ---------- */

function MenuRow({
  icon: Icon,
  label,
  hint,
  tone = 'default',
  state = 'default',
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  tone?: 'default' | 'danger';
  state?: 'default' | 'hover' | 'disabled';
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm',
        tone === 'danger' ? 'text-destructive' : 'text-foreground',
        state === 'hover' && (tone === 'danger' ? 'bg-destructive-surface' : 'bg-accent'),
        state === 'disabled' && 'opacity-45',
      )}
    >
      <Icon className="size-4" />
      <span className="flex-1 font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

/* ---------- 6. Bulk toolbar ---------- */

type BulkAction = { label: string; icon: LucideIcon; variant: Variant | 'outline' };

const bulkRoles: ReadonlyArray<{
  role: string;
  selected: string;
  actions: BulkAction[];
}> = [
  {
    role: 'Platform admin',
    selected: '3 bookings selected',
    actions: [
      { label: 'Confirm', icon: Check, variant: 'success' },
      { label: 'Assign room', icon: BedDouble, variant: 'secondary' },
      { label: 'Cancel', icon: X, variant: 'destructive' },
    ],
  },
  {
    role: 'Hotel staff',
    selected: '3 bookings selected',
    actions: [
      { label: 'Check-in', icon: LogIn, variant: 'success' },
      { label: 'Check-out', icon: LogOut, variant: 'secondary' },
      { label: 'No-show', icon: Ban, variant: 'destructive' },
    ],
  },
  {
    role: 'Finance staff',
    selected: '3 bookings selected',
    actions: [
      { label: 'Reconcile', icon: ArrowLeftRight, variant: 'default' },
      { label: 'Export', icon: Download, variant: 'secondary' },
      { label: 'Refund', icon: Undo2, variant: 'destructive' },
    ],
  },
  {
    role: 'Booking agent',
    selected: '3 bookings selected',
    actions: [
      { label: 'Confirm', icon: Check, variant: 'success' },
      { label: 'Assign room', icon: BedDouble, variant: 'secondary' },
      { label: 'Export', icon: Download, variant: 'secondary' },
    ],
  },
];

function BulkToolbar({
  role,
  selected,
  actions,
  empty,
}: {
  role: string;
  selected: string;
  actions: BulkAction[];
  empty?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3',
        empty ? 'bg-muted/60' : 'bg-card',
      )}
    >
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-sm font-bold">{empty ? '0 bookings selected' : selected}</div>
        <div className="text-xs text-muted-foreground">{role}</div>
      </div>
      {actions.map(({ label, icon: Icon, variant }) => (
        <Button
          key={label}
          size="sm"
          variant={variant}
          disabled={empty}
          title={empty ? 'Select at least one booking' : undefined}
        >
          <Icon /> {label}
        </Button>
      ))}
    </div>
  );
}

/* ---------- 7. Reservation pattern groups ---------- */

const patternGroups: ReadonlyArray<{
  title: string;
  note: string;
  actions: ReadonlyArray<{ label: string; icon: LucideIcon; variant: Variant }>;
  rule: string;
}> = [
  {
    title: 'Booking lifecycle',
    note: 'Create locally, then progress only through valid, payment-aware transitions.',
    actions: [
      { label: 'Manual booking', icon: Plus, variant: 'default' },
      { label: 'Confirm', icon: Check, variant: 'success' },
      { label: 'Complete', icon: Check, variant: 'secondary' },
      { label: 'Cancel', icon: X, variant: 'destructive' },
    ],
    rule: 'Paid online bookings confirm only after authoritative payment verification.',
  },
  {
    title: 'Stay operations',
    note: 'Operational actions for an already confirmed reservation and assigned room.',
    actions: [
      { label: 'Check-in', icon: LogIn, variant: 'success' },
      { label: 'Check-out', icon: LogOut, variant: 'secondary' },
      { label: 'Room move', icon: ArrowLeftRight, variant: 'secondary' },
      { label: 'No-show', icon: Ban, variant: 'destructive' },
    ],
    rule: 'No-show, move and upgrade require current status validation and an audit entry.',
  },
  {
    title: 'Availability and pricing',
    note: 'Control inventory and price rules without creating ambiguous hidden state.',
    actions: [
      { label: 'Block dates', icon: Ban, variant: 'secondary' },
      { label: 'Rate plan', icon: Pencil, variant: 'default' },
      { label: 'Pricing rule', icon: Pencil, variant: 'ghost' },
    ],
    rule: 'A hotel has one selected source of truth. Conflicting inventory changes are never applied silently.',
  },
  {
    title: 'Payments and invoices',
    note: 'Keep booking lifecycle and payment truth separate at every step.',
    actions: [
      { label: 'Capture payment', icon: CreditCard, variant: 'success' },
      { label: 'Refund', icon: Undo2, variant: 'destructive' },
      { label: 'Reconcile', icon: ArrowLeftRight, variant: 'secondary' },
      { label: 'Invoice', icon: FileText, variant: 'ghost' },
    ],
    rule: 'Refunds require an exact amount and an authoritative payment state.',
  },
  {
    title: 'Provider / PMS',
    note: 'External operations must expose execution state, environment and retry intent.',
    actions: [
      { label: 'Sync PMS', icon: RefreshCw, variant: 'default' },
      { label: 'Retry operation', icon: RefreshCw, variant: 'secondary' },
      { label: 'View diagnostics', icon: Stethoscope, variant: 'ghost' },
    ],
    rule: 'Provider actions stay disabled unless connection, environment and capability are valid.',
  },
  {
    title: 'Management and reports',
    note: 'Create managed records, preserve history and make exports explicit.',
    actions: [
      { label: 'Add hotel', icon: Plus, variant: 'default' },
      { label: 'Add room', icon: Plus, variant: 'secondary' },
      { label: 'Add guest', icon: UserPlus, variant: 'secondary' },
      { label: 'Export report', icon: Download, variant: 'ghost' },
      { label: 'Archive', icon: Archive, variant: 'ghost' },
    ],
    rule: 'Archive is preferred over deletion when history, payments or audit records depend on the entity.',
  },
];

/* ---------- 8. Permission table ---------- */

type Access = 'allowed' | 'scoped' | 'no';

const accessRows: ReadonlyArray<{
  area: string;
  admin: Access;
  staff: Access;
  finance: Access;
  agent: Access;
  safeguard: string;
}> = [
  {
    area: 'Confirm / cancel booking',
    admin: 'allowed',
    staff: 'scoped',
    finance: 'no',
    agent: 'scoped',
    safeguard: 'Payment-aware transition validation, explicit outcome and audit log',
  },
  {
    area: 'Check-in / check-out / no-show',
    admin: 'allowed',
    staff: 'scoped',
    finance: 'no',
    agent: 'no',
    safeguard: 'Confirmed booking, assigned room and current-state check',
  },
  {
    area: 'Availability / pricing / inventory',
    admin: 'allowed',
    staff: 'scoped',
    finance: 'no',
    agent: 'no',
    safeguard: 'Selected source of truth and conflict-free inventory',
  },
  {
    area: 'Refund / reconciliation',
    admin: 'allowed',
    staff: 'no',
    finance: 'scoped',
    agent: 'no',
    safeguard: 'Exact amount, authoritative payment state and confirmation',
  },
  {
    area: 'Provider sync / retry',
    admin: 'allowed',
    staff: 'scoped',
    finance: 'no',
    agent: 'no',
    safeguard: 'Valid environment, capability and connection binding',
  },
  {
    area: 'Invoice / report export',
    admin: 'allowed',
    staff: 'scoped',
    finance: 'scoped',
    agent: 'scoped',
    safeguard: 'Scoped records only, no hidden personal or secret data',
  },
];

const accessBadge: Record<Access, { label: string; variant: 'success' | 'warning' | 'muted' }> = {
  allowed: { label: 'Allowed', variant: 'success' },
  scoped: { label: 'Scoped', variant: 'warning' },
  no: { label: 'No', variant: 'muted' },
};

const confirmLevels = [
  {
    title: '1 · Read-only',
    body: 'View, preview, open, download. No confirmation. Preserve data scope and never expose secrets or personal fields.',
    tone: 'border-info/30 bg-info-surface',
  },
  {
    title: '2 · Controlled local',
    body: 'Save, edit, archive, restore. Validate current state; confirm destructive local changes and show an activity log.',
    tone: 'border bg-muted',
  },
  {
    title: '3 · Provider communication',
    body: 'Sync, PMS, retry, provider operations. Require valid connection, environment and capability; show execution state.',
    tone: 'border-warning/30 bg-warning-surface',
  },
  {
    title: '4 · Financial / lifecycle',
    body: 'Refund, cancel, confirm, no-show. Show the exact amount and outcome, require confirmation, reveal the truth and audit every change.',
    tone: 'border-destructive/30 bg-destructive-surface',
  },
] as const;

/* ---------- 9. In context ---------- */

const demoRows = [
  { ref: 'MH-1042', guest: 'Mira Kola', status: 'Confirmed' },
  { ref: 'MH-1041', guest: 'Lucas Meyer', status: 'Checked in' },
  { ref: 'MH-1039', guest: 'Anna Schmidt', status: 'Pending' },
];

export default function ActionsDesignPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <PageHeader
        title="Actions"
        description="Buttons in every variant, state and size, then the places they live: toolbars, tables, dialogs, forms and by role. Demo data only."
        actions={<Badge variant="secondary">Icons: lucide</Badge>}
      />

      <Block
        title="Buttons"
        note="Five variants in six states and three sizes. Hover, pressed and focus are frozen here so you can compare them; in the app they happen on interaction."
      >
        <ButtonMatrix />
      </Block>

      <Block
        title="Icon buttons"
        note="Same variants and states, square. Always give an icon button an accessible name."
      >
        <IconButtonMatrix />
      </Block>

      <Block
        title="Common hotel actions"
        note="Choose the semantic type from the real outcome, then use the standard variant."
      >
        <ActionPatterns />
      </Block>

      <Block
        title="Buttons with icons"
        note="Icon first, short verb, sentence case. One primary action per surface."
      >
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
          <Button>
            <Save /> Save changes
          </Button>
          <Button variant="secondary">
            <Eye /> View booking
          </Button>
          <Button variant="ghost">
            <X /> Close
          </Button>
          <Button variant="destructive">
            <X /> Cancel booking
          </Button>
          <Button variant="success">
            <Check /> Confirm booking
          </Button>
          <Button variant="secondary">
            <Plus /> Manual booking
          </Button>
          <Button variant="secondary">
            <RefreshCw /> Retry provider
          </Button>
          <Button loading>Processing</Button>
        </div>
      </Block>

      <Block
        title="Split button"
        note="Use when one primary action has closely related alternatives. The main segment executes immediately, the chevron opens a short action menu."
      >
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center gap-4">
            <SplitButton />
            <SplitButton state="hover" />
            <SplitButton state="focus" />
            <SplitButton state="disabled" />
            <SplitButton state="loading" />
          </div>
        </div>
        <Rule>
          Do not hide dangerous or financial actions behind the primary segment. Refund,
          cancellation and provider-write alternatives require explicit labels and confirmation.
        </Rule>
      </Block>

      <Block
        title="Dropdown item"
        note="Explicit verbs and outcomes. Destructive, lifecycle and financial choices stay visible, permission-gated and confirmation-gated."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className="gap-1 px-3">
            <MenuRow icon={Eye} label="View booking" hint="Open" />
            <MenuRow icon={Eye} label="View booking" hint="Open" state="hover" />
            <MenuRow icon={Eye} label="View booking" hint="Open" state="disabled" />
            <MenuRow icon={X} label="Cancel booking" hint="Confirm" tone="danger" />
            <MenuRow icon={X} label="Cancel booking" hint="Confirm" tone="danger" state="hover" />
            <MenuRow
              icon={X}
              label="Cancel booking"
              hint="Confirm"
              tone="danger"
              state="disabled"
            />
          </Card>
          <Card className="items-start gap-3 px-6">
            <p className="text-sm font-bold">Live menu</p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Ellipsis /> More actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                <DropdownMenuItem>
                  <Eye /> View booking
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Pencil /> Edit guest details
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <ArrowLeftRight /> Move to another room
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">
                  <X /> Cancel booking…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-xs text-muted-foreground">
              Destructive items sit last, behind a separator, and end with an ellipsis because they
              open a confirmation.
            </p>
          </Card>
        </div>
        <Alert variant="warning">
          <AlertDescription>
            Never offer customer-side cancellation. Staff cancellation, refund and provider-write
            actions require the correct permission, current-state validation and a confirmation
            step.
          </AlertDescription>
        </Alert>
      </Block>

      <Block
        title="Bulk toolbar"
        note="Actions are scoped per role. Hide unsupported modules entirely; disable actions only when the selection or the current record state makes them temporarily unavailable."
      >
        <div className="space-y-2">
          {bulkRoles.map((r) => (
            <div key={r.role} className="space-y-2">
              <BulkToolbar {...r} />
              <BulkToolbar {...r} empty />
            </div>
          ))}
        </div>
        <Alert variant="info">
          <AlertDescription>
            Booking status and payment status remain separate. Confirming a booking never proves
            payment. Refund actions must show the exact amount or percentage and require
            authoritative provider and payment validation.
          </AlertDescription>
        </Alert>
      </Block>

      <Block
        title="In context"
        note="The same buttons where they live: a table row, a card header, a form footer and a confirmation dialog."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="gap-0 px-0 lg:col-span-2">
            <CardHeader className="flex-row items-center justify-between gap-3 border-b pb-4">
              <div>
                <CardTitle>Arrivals today</CardTitle>
                <CardDescription>3 bookings</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm">
                  <Download /> Export
                </Button>
                <Button size="sm">
                  <Plus /> New booking
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Guest</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {demoRows.map((row) => (
                    <TableRow key={row.ref}>
                      <TableCell className="font-mono text-sm">{row.ref}</TableCell>
                      <TableCell>{row.guest}</TableCell>
                      <TableCell>{row.status}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          <Button variant="secondary" size="sm">
                            <Eye /> View
                          </Button>
                          <Button variant="success" size="sm">
                            <LogIn /> Check in
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`More actions for ${row.ref}`}
                          >
                            <Ellipsis />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="px-6">
            <p className="text-sm font-bold">Form footer</p>
            <div className="space-y-1.5">
              <Label htmlFor="guest-note">Guest note</Label>
              <Input id="guest-note" defaultValue="Late arrival, after 22:00" />
            </div>
            <div className="flex items-center justify-between gap-2 border-t pt-4">
              <Button variant="ghost">Discard</Button>
              <div className="flex gap-2">
                <Button variant="secondary">Save draft</Button>
                <Button>
                  <Save /> Save changes
                </Button>
              </div>
            </div>
          </Card>

          <Card className="items-start gap-3 px-6">
            <p className="text-sm font-bold">Confirmation dialog</p>
            <p className="text-sm text-muted-foreground">
              Financial and lifecycle actions end in a dialog that states the exact outcome.
            </p>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive">
                  <Undo2 /> Refund €190.00
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Refund €190.00 to the guest?</DialogTitle>
                  <DialogDescription>
                    Booking MH-1039 will be marked refunded. The payment provider returns the money
                    in a few days. This cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="ghost">Keep booking</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button variant="destructive">Refund €190.00</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </Card>

          <Card className="px-6 lg:col-span-2">
            <p className="text-sm font-bold">Page footer on a phone</p>
            <div className="mx-auto w-full max-w-xs space-y-2 rounded-xl border bg-background p-3">
              <Button className="w-full" size="lg">
                <Check /> Confirm booking
              </Button>
              <Button className="w-full" variant="secondary" size="lg">
                <Eye /> View booking
              </Button>
              <Button className="w-full" variant="ghost">
                Close
              </Button>
            </div>
          </Card>
        </div>
      </Block>

      <Block
        title="Reservation action patterns"
        note="Backend permissions, current booking and payment state and provider capability remain authoritative."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {patternGroups.map((group) => (
            <Card key={group.title} className="gap-3 px-5">
              <div>
                <p className="text-sm font-bold">{group.title}</p>
                <p className="text-xs text-muted-foreground">{group.note}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {group.actions.map(({ label, icon: Icon, variant }) => (
                  <Button key={label} size="sm" variant={variant}>
                    <Icon /> {label}
                  </Button>
                ))}
              </div>
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                {group.rule}
              </p>
            </Card>
          ))}
        </div>
      </Block>

      <Block
        title="Permission and action safety"
        note="Role guidance describes the default design contract. Effective permissions, current record state and provider capability remain the source of truth."
      >
        <Card className="px-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action area</TableHead>
                <TableHead>Platform admin</TableHead>
                <TableHead>Hotel staff</TableHead>
                <TableHead>Finance staff</TableHead>
                <TableHead>Booking agent</TableHead>
                <TableHead>Required safeguard</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accessRows.map((row) => (
                <TableRow key={row.area}>
                  <TableCell className="font-semibold">{row.area}</TableCell>
                  {([row.admin, row.staff, row.finance, row.agent] as const).map((access, i) => (
                    <TableCell key={i}>
                      <Badge variant={accessBadge[access].variant}>
                        {accessBadge[access].label}
                      </Badge>
                    </TableCell>
                  ))}
                  <TableCell className="text-sm whitespace-normal text-muted-foreground">
                    {row.safeguard}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {confirmLevels.map((level) => (
            <div key={level.title} className={cn('space-y-1 rounded-xl border p-4', level.tone)}>
              <p className="text-sm font-bold">{level.title}</p>
              <p className="text-xs text-muted-foreground">{level.body}</p>
            </div>
          ))}
        </div>
        <Rule>
          Customer dashboard boundary: customers may view bookings, details and invoices, but no
          cancellation action is shown. They contact the company for cancellation or refund review.
        </Rule>
      </Block>
    </div>
  );
}
