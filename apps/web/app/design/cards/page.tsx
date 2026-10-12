'use client';

import {
  Activity,
  AlertCircle,
  ArrowRight,
  BedDouble,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  FileText,
  Hotel,
  Info,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  Wallet,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { cn } from '../_lib/utils';
import { Alert, AlertDescription, AlertTitle } from '../_ui/alert';
import { Badge, type badgeVariants } from '../_ui/badge';
import { Button } from '../_ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../_ui/card';
import { PageHeader } from '../_ui/hotel';
import { Switch } from '../_ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '../_ui/tooltip';

type BadgeTone = NonNullable<Parameters<typeof badgeVariants>[0]>['variant'];

const badgeTone: Record<string, BadgeTone> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  muted: 'muted',
  neutral: 'outline',
};

function Status({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <Badge variant={badgeTone[tone] ?? 'muted'}>{children}</Badge>;
}

const textTones: Record<string, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
};

function Specimen({
  number,
  title,
  description,
  contract,
  children,
}: {
  number: string;
  title: string;
  description: string;
  contract: ReadonlyArray<readonly [string, string]>;
  children: ReactNode;
}) {
  return (
    <article className="min-w-0 rounded-xl border bg-card p-3 shadow-xs @md/design-preview:p-4">
      <header className="mb-3">
        <div className="flex items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-bold text-primary">
            {number}
          </span>
          <h2 className="font-bold tracking-tight">{title}</h2>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </header>
      <div className="grid min-w-0 gap-3 rounded-lg bg-muted p-3 @md/design-preview:grid-cols-[minmax(0,1.45fr)_minmax(145px,0.8fr)] @md/design-preview:p-4">
        <div className="min-w-0">{children}</div>
        <aside className="rounded-lg border bg-card p-3">
          <h3 className="mb-2 text-xs font-bold">Component contract</h3>
          <dl className="space-y-2">
            {contract.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-3 text-[11px]">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </article>
  );
}

function DataRow({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: string;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b py-2 last:border-0 last:pb-0">
      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
        <span className="truncate">{label}</span>
      </span>
      {typeof value === 'string' ? (
        <span className={cn('shrink-0 text-right text-xs font-semibold', tone && textTones[tone])}>
          {value}
        </span>
      ) : (
        <span className="shrink-0">{value}</span>
      )}
    </div>
  );
}

function MiniMetric({
  label,
  value,
  hint,
  tone = 'muted',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-extrabold tracking-tight">{value}</p>
      {hint ? <Status tone={tone}>{hint}</Status> : null}
    </div>
  );
}

function InventoryMetric({
  label,
  count,
  total,
  percent,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  percent: number;
  tone: 'success' | 'warning' | 'danger';
}) {
  const styles = {
    success: {
      surface: 'border-success/25 bg-success-surface/50',
      value: 'text-success',
      bar: 'bg-success',
    },
    warning: {
      surface: 'border-warning/25 bg-warning-surface/50',
      value: 'text-warning',
      bar: 'bg-warning',
    },
    danger: {
      surface: 'border-destructive/25 bg-destructive-surface/50',
      value: 'text-destructive',
      bar: 'bg-destructive',
    },
  }[tone];

  return (
    <div className={cn('min-w-0 rounded-lg border p-3', styles.surface)}>
      <div className="flex items-center justify-between gap-1">
        <p className="min-w-0 truncate text-[10px] font-semibold">{label}</p>
        <span className="shrink-0 text-[9px] font-semibold text-muted-foreground">{percent}%</span>
      </div>
      <p className={cn('mt-1 text-2xl font-extrabold tracking-tight', styles.value)}>{count}</p>
      <p className="text-[10px] text-muted-foreground">of {total} room units</p>
      <div
        role="progressbar"
        aria-label={`${label} inventory share`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-background/80"
      >
        <span
          className={cn('block h-full rounded-full', styles.bar)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

const attentionQueues = [
  {
    label: 'Awaiting review',
    hint: 'Oldest 12 min',
    count: 3,
    tone: 'warning' as const,
    icon: Clock3,
  },
  {
    label: 'On-request approval',
    hint: 'Needs hotel response',
    count: 2,
    tone: 'warning' as const,
    icon: CalendarDays,
  },
  {
    label: 'Payment verification',
    hint: 'Provider confirmation',
    count: 1,
    tone: 'danger' as const,
    icon: CreditCard,
  },
  {
    label: 'Expiring inventory holds',
    hint: 'Release in next hour',
    count: 2,
    tone: 'warning' as const,
    icon: BedDouble,
  },
  {
    label: 'Failed provider operations',
    hint: 'Safe retry available',
    count: 1,
    tone: 'danger' as const,
    icon: RefreshCw,
  },
];

function AttentionPreview() {
  const [activeQueue, setActiveQueue] = useState<string | null>(null);

  return (
    <Card className="gap-3 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold">Needs attention</p>
          <p className="text-[11px] text-muted-foreground">
            Queues requiring a staff decision or safe retry
          </p>
        </div>
        <Status tone="warning">9 open</Status>
      </div>
      <div className="space-y-2">
        {attentionQueues.map(({ label, hint, count, tone, icon: Icon }) => (
          <button
            key={label}
            type="button"
            aria-pressed={activeQueue === label}
            onClick={() => setActiveQueue(label)}
            className={cn(
              'flex w-full items-center justify-between gap-3 rounded-lg border bg-card px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
              activeQueue === label && 'border-primary/50 bg-primary/5',
            )}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-md',
                  tone === 'danger'
                    ? 'bg-destructive-surface text-destructive'
                    : 'bg-warning-surface text-warning',
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold">{label}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{hint}</span>
              </span>
            </span>
            <Badge variant={tone} aria-label={`${count} ${label.toLowerCase()}`}>
              {count}
            </Badge>
          </button>
        ))}
      </div>
      <p role="status" aria-live="polite" className="min-h-4 text-[11px] text-muted-foreground">
        {activeQueue
          ? `${activeQueue} queue selected in this preview.`
          : 'Select a queue to preview its filtered work list.'}
      </p>
      <div className="border-t pt-2 text-xs font-semibold text-primary">
        Open operations queue <ArrowRight className="ml-1 inline size-3" />
      </div>
    </Card>
  );
}

function AlertPreview() {
  const [infoVisible, setInfoVisible] = useState(true);
  const [message, setMessage] = useState('');

  return (
    <div className="space-y-2.5">
      {infoVisible ? (
        <Alert variant="info" className="px-3 py-3">
          <Info aria-hidden="true" />
          <AlertTitle className="flex items-center justify-between gap-2 text-xs">
            <span>Synchronization completed</span>
            <span className="flex shrink-0 items-center gap-1">
              <Status tone="info">Information</Status>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Dismiss information alert"
                onClick={() => setInfoVisible(false)}
              >
                <X aria-hidden="true" />
              </Button>
            </span>
          </AlertTitle>
          <AlertDescription className="text-xs leading-relaxed">
            <span>16 reservations refreshed successfully.</span>
            <span className="text-[10px] text-muted-foreground">Last checked at 14:30</span>
          </AlertDescription>
        </Alert>
      ) : null}
      <Alert variant="warning" className="px-3 py-3">
        <TriangleAlert aria-hidden="true" />
        <AlertTitle className="flex items-center justify-between gap-2 text-xs">
          <span>Clock synchronization delayed</span>
          <Status tone="warning">Warning</Status>
        </AlertTitle>
        <AlertDescription className="text-xs leading-relaxed">
          <span>Last successful sync was 12 minutes ago. A retry is available.</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1 w-fit"
            onClick={() => setMessage('Retry preview only; Clock PMS+ was not contacted.')}
          >
            <RefreshCw aria-hidden="true" /> Retry sync
          </Button>
        </AlertDescription>
      </Alert>
      <Alert variant="destructive" className="px-3 py-3">
        <AlertCircle aria-hidden="true" />
        <AlertTitle className="flex items-center justify-between gap-2 text-xs">
          <span>Inventory source conflict</span>
          <Status tone="danger">Critical · persistent</Status>
        </AlertTitle>
        <AlertDescription className="text-xs leading-relaxed">
          <span>
            Two inventory sources are active. Booking mutations are blocked for this selection.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1 w-fit"
            onClick={() =>
              setMessage('Diagnostics preview selected; no provider data was fetched.')
            }
          >
            View diagnostics <ArrowRight aria-hidden="true" />
          </Button>
        </AlertDescription>
      </Alert>
      <p role="status" aria-live="polite" className="min-h-4 text-[11px] text-muted-foreground">
        {message}
      </p>
    </div>
  );
}

function ActionPreview() {
  const [message, setMessage] = useState(
    'Actions are local previews; no booking or provider data is changed.',
  );
  const actions = [
    {
      label: 'Create internal booking',
      icon: FileText,
      tone: 'info',
      detail: 'Booking form preview opened.',
    },
    {
      label: 'Block availability',
      icon: CalendarDays,
      tone: 'warning',
      detail: 'Availability block preview opened.',
    },
    {
      label: 'Review payment issues',
      icon: CreditCard,
      tone: 'danger',
      detail: '3 payment issues in the sample queue.',
    },
    {
      label: 'Retry provider operation',
      icon: RefreshCw,
      tone: 'muted',
      detail: 'Retry preview only; Clock PMS was not contacted.',
    },
  ];

  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      {actions.map(({ label, icon: Icon, tone, detail }) => (
        <Button
          key={label}
          type="button"
          variant="outline"
          className="h-auto w-full justify-between px-3 py-2 text-left"
          onClick={() => setMessage(detail)}
        >
          <span className="flex items-center gap-2 text-xs">
            <Icon
              className={cn('size-4', tone === 'danger' ? 'text-destructive' : 'text-primary')}
            />
            {label}
          </span>
          <ChevronRight className="size-3.5 text-muted-foreground" />
        </Button>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled
        className="h-auto w-full justify-between px-3 py-2"
      >
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Settings2 className="size-4" /> Manage pricing
        </span>
        <LockKeyhole className="size-3.5 text-muted-foreground" />
      </Button>
      <p
        role="status"
        aria-live="polite"
        className="min-h-8 pt-1 text-[11px] text-muted-foreground"
      >
        {message}
      </p>
    </div>
  );
}

function SettingsPreview() {
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="space-y-3 rounded-lg border bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(true);
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold">Hotel provider settings</p>
          <p className="text-[11px] text-muted-foreground">Inventory authority and sync controls</p>
        </div>
        <Status tone="success">Editable</Status>
      </div>
      <label className="block space-y-1 text-xs font-medium">
        Source of truth
        <select
          defaultValue="clock"
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
        >
          <option value="clock">Clock PMS+</option>
          <option value="must">MUST inventory</option>
        </select>
      </label>
      <label className="block space-y-1 text-xs font-medium">
        Synchronization interval
        <select
          defaultValue="60"
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
        >
          <option value="15">15 minutes</option>
          <option value="30">30 minutes</option>
          <option value="60">60 minutes</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs">
        Provider failure alerts
        <Switch aria-label="Provider failure alerts" defaultChecked />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setSaved(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          <Save /> Save changes
        </Button>
        <span role="status" aria-live="polite" className="text-xs text-success">
          {saved ? 'Saved in this preview only.' : ''}
        </span>
      </div>
    </form>
  );
}

function StateExample({
  icon: Icon,
  title,
  description,
  action,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: string;
  tone: string;
}) {
  return (
    <div className="flex min-h-28 flex-col items-start rounded-lg border bg-card p-3">
      <span className={cn('mb-2 flex size-7 items-center justify-center rounded-full', tone)}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <p className="text-xs font-bold">{title}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
      {action ? (
        <span className="mt-auto pt-2 text-[11px] font-semibold text-primary">{action}</span>
      ) : null}
    </div>
  );
}

const specimens = [
  {
    number: '1',
    title: 'Base panel',
    description: 'Shared header, body, footer and surface variants for every panel family.',
    contract: [
      ['Width', 'Fluid / min 280'],
      ['Height', 'Hug content'],
      ['Padding', '20–24 px'],
      ['Radius', '16 px'],
      ['Footer', 'Optional'],
      ['States', 'Default · selected'],
    ],
  },
  {
    number: '2',
    title: 'KPI card',
    description:
      'Hotel metrics with explicit periods, comparison semantics and optional trend visuals.',
    contract: [
      ['Period', 'Always explicit'],
      ['Comparison', 'Like for like'],
      ['Chart', 'Optional'],
      ['Menu', 'Only if useful'],
      ['Loading', 'Skeleton state'],
      ['No data', 'Neutral state'],
    ],
  },
  {
    number: '3',
    title: 'Attention summary',
    description:
      'Operational queues for review, payment verification, inventory holds and provider work.',
    contract: [
      ['Rows', 'Clickable'],
      ['Sort', 'Severity → age'],
      ['Counts', 'Live'],
      ['History', 'Excluded'],
      ['Permission', 'Filter actions'],
      ['Refresh', 'Show timestamp'],
    ],
  },
  {
    number: '4',
    title: 'Entity card',
    description: 'Hotel, room type, room unit, guest and staff summaries built from structure.',
    contract: [
      ['Types', 'Shared anatomy'],
      ['Status', 'Separate fields'],
      ['Availability', 'Date-based'],
      ['Financials', 'Permission-aware'],
      ['Source', 'Visible for hotels'],
      ['Footer', 'Context action'],
    ],
  },
  {
    number: '5',
    title: 'Booking card',
    description:
      'Booking status, payment status, source and provider sync shown as separate facts.',
    contract: [
      ['Statuses', 'Separate badges'],
      ['Source', 'Always visible'],
      ['Provider', 'Sync state'],
      ['Dates', 'Check-in → out'],
      ['Amount', 'Booking value'],
      ['Attention', 'Optional banner'],
    ],
  },
  {
    number: '6',
    title: 'Payment card',
    description: 'Deposit, amount paid, balance, refunds, invoice and folio reconciliation.',
    contract: [
      ['Deposit', 'Separate'],
      ['Balance', 'Never auto-zero'],
      ['Refund', 'Explicit amount'],
      ['Provider ref', 'Provider ID'],
      ['Invoice', 'Linked'],
      ['Folio', 'Reconciled state'],
    ],
  },
  {
    number: '7',
    title: 'System health',
    description: 'Independent health rows for booking, payment, PMS and scheduled operations.',
    contract: [
      ['Overall', 'Worst active state'],
      ['Rows', 'Independent'],
      ['Unknown', 'Explicit'],
      ['Timestamp', 'Per check'],
      ['Failure', 'Short reason'],
      ['Action', 'Diagnostics'],
    ],
  },
  {
    number: '8',
    title: 'Alert panel',
    description:
      'Information, warning and blocking integrity alerts with severity-appropriate actions.',
    contract: [
      ['Information', 'Non-blocking'],
      ['Warning', 'Safe to continue'],
      ['Critical', 'Operations blocked'],
      ['Dismiss', 'Never critical'],
      ['Details', 'Link diagnostics'],
      ['Language', 'Severity-specific'],
    ],
  },
  {
    number: '9',
    title: 'Quick actions',
    description: 'Permission-aware internal booking, availability, payment and provider actions.',
    contract: [
      ['Visibility', 'Permission-aware'],
      ['Disabled', 'Explain why'],
      ['Dangerous', 'Confirm first'],
      ['Provider retry', 'Failed item only'],
      ['Generic sync', 'Avoid'],
      ['Audit', 'Log mutations'],
    ],
  },
  {
    number: '10',
    title: 'Provider connection',
    description:
      'Credentials, connection state, sync lag and failed operations for external providers.',
    contract: [
      ['Credentials', 'Owner state'],
      ['Connection', 'Own state'],
      ['Source role', 'Explicit'],
      ['Lag', 'Measured'],
      ['Failures', 'Live count'],
      ['Actions', 'Manage + operations'],
    ],
  },
  {
    number: '11',
    title: 'Settings section',
    description:
      'Full-width setting groups with clear help, validation, permissions and save state.',
    contract: [
      ['Layout', 'Full section'],
      ['Fields', 'Label + help'],
      ['Validation', 'Inline'],
      ['Dirty state', 'Persistent'],
      ['Permission', 'Editable / read-only'],
      ['Actions', 'Safe + cancel'],
    ],
  },
  {
    number: '12',
    title: 'State panels',
    description: 'Empty, loading, error and no-permission states for card and panel containers.',
    contract: [
      ['Empty', 'Explain next step'],
      ['Loading', 'Preserve layout'],
      ['Error', 'Safe retry'],
      ['Permission', 'No data leak'],
      ['Height', 'Contextual'],
      ['Action', 'Optional'],
    ],
  },
] as const;

export default function CardsPanelsPage() {
  const [providerMessage, setProviderMessage] = useState('');

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <PageHeader
        title="Cards & panels"
        description="Reusable hotel operations components for bookings, payments, inventory, providers, staff workflows, settings and system integrity."
        actions={<Status tone="muted">Preview patterns</Status>}
      />
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
        <Info className="size-4 shrink-0 text-info" aria-hidden="true" />
        <span>
          Illustrative demo data only. Actions and settings on this page do not change hotel or
          provider data.
        </span>
      </div>

      <div className="grid items-start gap-4 @lg/design-preview:grid-cols-2">
        <Specimen {...specimens[0]}>
          <div className="space-y-3">
            <Card className="gap-2 px-3 py-3">
              <CardHeader className="flex grid-cols-1 flex-row items-center justify-between gap-2 px-0">
                <CardTitle className="text-sm">Booking attention</CardTitle>
                <Status tone="warning">5 open</Status>
              </CardHeader>
              <CardContent className="space-y-1 px-0">
                <DataRow label="Payment verification" value="2" tone="warning" />
                <DataRow label="Provider retries" value="3" tone="warning" />
              </CardContent>
              <div className="border-t pt-2 text-xs font-semibold text-primary">
                Open queue <ArrowRight className="ml-1 inline size-3" />
              </div>
            </Card>
            <Card className="gap-2 px-3 py-3">
              <CardTitle className="text-sm">Inventory summary</CardTitle>
              <p className="text-[11px] text-muted-foreground">
                Availability for the selected dates
              </p>
              <div className="grid grid-cols-1 gap-2 @sm/design-preview:grid-cols-3">
                <InventoryMetric
                  label="Available"
                  count={24}
                  total={30}
                  percent={80}
                  tone="success"
                />
                <InventoryMetric label="Held" count={4} total={30} percent={13} tone="warning" />
                <InventoryMetric label="Blocked" count={2} total={30} percent={7} tone="danger" />
              </div>
            </Card>
          </div>
        </Specimen>

        <Specimen {...specimens[1]}>
          <div className="space-y-2">
            <Card className="gap-3 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Total bookings · 1–31 Jul</p>
                  <p className="mt-1 text-2xl font-extrabold">128</p>
                  <Status tone="success">+12.5% vs prior month</Status>
                </div>
                <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-primary">
                  <Hotel className="size-4" />
                </span>
              </div>
              <div
                role="group"
                aria-label="Bookings trend by week"
                className="flex h-14 items-end gap-1 rounded-md bg-muted p-2"
              >
                {[20, 26, 24, 32, 26].map((count, index) => {
                  const week = `Week ${index + 1}: ${count} bookings`;
                  return (
                    <Tooltip key={week}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={week}
                          title={week}
                          className="group flex min-w-0 flex-1 items-end rounded-t-sm focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          style={{ height: `${(count / 32) * 100}%` }}
                        >
                          <span
                            className={cn(
                              'block h-full w-full rounded-t-sm transition-colors duration-150 group-hover:bg-primary group-focus-visible:bg-primary',
                              index === 4 ? 'bg-primary' : 'bg-primary/25',
                            )}
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{week}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Confirmed and pending bookings. Weekly counts sum to 128.
              </p>
            </Card>
            <div className="grid grid-cols-2 gap-2">
              <MiniMetric label="Payments collected" value="€34.2k" hint="This month" tone="info" />
              <MiniMetric label="Failed payments" value="4" hint="+2 vs prior" tone="danger" />
            </div>
          </div>
        </Specimen>

        <Specimen {...specimens[2]}>
          <AttentionPreview />
        </Specimen>

        <Specimen {...specimens[3]}>
          <div className="space-y-2">
            <Card className="gap-2 px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-primary">
                  <Building2 className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">Empire Beach Resort</p>
                  <p className="text-[11px] text-muted-foreground">Sarandë, Albania</p>
                </div>
                <Status tone="success">Published</Status>
              </div>
              <DataRow label="Room types" value="6" />
              <DataRow label="Inventory source" value="Clock PMS+" />
              <DataRow label="Last successful sync" value="2m ago" tone="success" />
              <DataRow label="Booking mode" value="Instant" />
              <span className="text-xs font-semibold text-primary">Manage hotel</span>
            </Card>
            <Card className="gap-2 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-bold">
                  <BedDouble className="size-4 text-primary" /> Deluxe Sea View
                </span>
                <Status tone="success">Active</Status>
              </div>
              <DataRow label="Maximum occupancy" value="2 adults + 1 child" />
              <DataRow label="Physical units" value="10" />
              <DataRow label="Available tonight" value="4 of 10" tone="success" />
              <DataRow label="Base rate" value="€160 / night" />
            </Card>
          </div>
        </Specimen>

        <Specimen {...specimens[4]}>
          <Card className="gap-3 px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-bold">MHB-2026-1042</p>
                <p className="text-[11px] text-muted-foreground">Created 17 Jul 2026 · 14:32</p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Status tone="success">Confirmed</Status>
                <Status tone="success">Payment paid</Status>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              <Status tone="info">Website</Status>
              <Status tone="success">Clock synced</Status>
            </div>
            <div className="space-y-0.5 border-t">
              <DataRow label="Guest" value="Elira Hoxha" icon={UserRound} />
              <DataRow label="Hotel" value="Empire Beach Resort" icon={Hotel} />
              <DataRow label="Room type" value="Deluxe Sea View" icon={BedDouble} />
              <DataRow label="Stay" value="20 Jul – 23 Jul 2026" icon={CalendarDays} />
              <DataRow label="Guests" value="3 nights · 2 adults" />
              <DataRow label="Booking source" value="Website" />
              <DataRow label="Total value" value="€540.00" />
            </div>
            <div className="border-t pt-2 text-xs font-semibold text-primary">
              Open booking <ArrowRight className="ml-1 inline size-3" />
            </div>
          </Card>
        </Specimen>

        <Specimen {...specimens[5]}>
          <Card className="gap-3 px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold">Payment summary</p>
                <p className="text-[11px] text-muted-foreground">MHB-2026-1042</p>
              </div>
              <Status tone="info">Deposit paid</Status>
            </div>
            <div className="space-y-0.5">
              <DataRow label="Booking total" value="€540.00" />
              <DataRow label="Deposit required" value="€180.00" />
              <DataRow label="Deposit paid" value="€180.00" tone="success" />
              <DataRow label="Remaining balance" value="€360.00" tone="warning" />
            </div>
            <div className="space-y-0.5 border-t pt-1">
              <DataRow label="PokPay order" value="9d4f8d80…e296" />
              <DataRow label="Paid on" value="17 Jul 2026 · 14:31" />
              <DataRow label="Invoice" value="INV-2026-004218" icon={FileText} />
              <DataRow label="Refunded amount" value="€0.00" />
            </div>
            <div className="flex items-center gap-2 rounded-md bg-success-surface px-2 py-2 text-xs font-semibold text-success">
              <CheckCircle2 className="size-4" /> Clock deposit folio · Verified
            </div>
            <span className="text-xs font-semibold text-primary">View payment and invoice</span>
          </Card>
        </Specimen>

        <Specimen {...specimens[6]}>
          <Card className="gap-2 px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold">System health</p>
                <p className="text-[11px] text-muted-foreground">Last checked 2m ago</p>
              </div>
              <Status tone="warning">Degraded</Status>
            </div>
            <DataRow
              label="Public booking flow"
              value={<Status tone="success">Healthy</Status>}
              icon={FileText}
            />
            <DataRow
              label="PokPay API + callback"
              value={<Status tone="success">Healthy</Status>}
              icon={CreditCard}
            />
            <DataRow
              label="Clock PMS+ connection"
              value={<Status tone="success">Healthy</Status>}
              icon={Hotel}
            />
            <DataRow
              label="Reservation synchronization"
              value={<Status tone="warning">Delayed 12m</Status>}
              icon={RefreshCw}
            />
            <DataRow
              label="Payment → folio accounting"
              value={<Status tone="danger">1 failed</Status>}
              icon={Wallet}
            />
            <DataRow
              label="WordPress scheduled jobs"
              value={<Status tone="success">Healthy</Status>}
              icon={Activity}
            />
            <div className="border-t pt-2 text-xs font-semibold text-primary">View diagnostics</div>
          </Card>
        </Specimen>

        <Specimen {...specimens[7]}>
          <AlertPreview />
        </Specimen>

        <Specimen {...specimens[8]}>
          <ActionPreview />
        </Specimen>

        <Specimen {...specimens[9]}>
          <Card className="gap-3 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-primary">
                  <Hotel className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-bold">Clock PMS+</p>
                  <p className="text-[11px] text-muted-foreground">Sandbox environment</p>
                </div>
              </div>
              <Status tone="success">Connected · demo</Status>
            </div>
            <div className="flex flex-wrap gap-1">
              <Status tone="success">Credential valid</Status>
              <Status tone="success">Selected source</Status>
            </div>
            <DataRow label="Connection role" value="Inventory source" />
            <DataRow label="Last successful sync" value="2m ago" tone="success" />
            <DataRow label="Synchronization lag" value="1 minute" />
            <DataRow label="Failed operations" value="1" tone="danger" />
            <DataRow
              label="Reservation writes"
              value={<Status tone="success">Enabled · demo</Status>}
            />
            <div className="flex items-center justify-between gap-2 rounded-md bg-warning-surface px-2 py-2 text-xs text-warning">
              <span>1 folio accounting retry pending</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setProviderMessage(
                    'Provider operation preview only; no external request was made.',
                  )
                }
              >
                View
              </Button>
            </div>
            <div className="flex flex-wrap gap-4 border-t pt-2 text-xs font-semibold text-primary">
              <span>Manage connection</span>
              <span>View operations</span>
            </div>
            <p role="status" aria-live="polite" className="text-[11px] text-muted-foreground">
              {providerMessage}
            </p>
          </Card>
        </Specimen>

        <Specimen {...specimens[10]}>
          <SettingsPreview />
        </Specimen>

        <Specimen {...specimens[11]}>
          <div className="grid grid-cols-2 gap-2">
            <StateExample
              icon={Search}
              title="No bookings found"
              description="No bookings match these filters."
              action="Clear filters"
              tone="bg-info-surface text-info"
            />
            <StateExample
              icon={LoaderCircle}
              title="Loading bookings"
              description="Fetching current booking data."
              tone="bg-secondary text-primary"
            />
            <StateExample
              icon={XCircle}
              title="Could not load data"
              description="The provider request failed safely."
              action="Try again"
              tone="bg-destructive-surface text-destructive"
            />
            <StateExample
              icon={KeyRound}
              title="Access restricted"
              description="Your role cannot view financial details."
              action="Request access"
              tone="bg-warning-surface text-warning"
            />
          </div>
        </Specimen>
      </div>

      <section
        aria-label="Design rules and guidelines"
        className="grid gap-2 rounded-xl border bg-card p-3 @md/design-preview:grid-cols-3 @xl/design-preview:grid-cols-6"
      >
        <Foundation icon={BedDouble} title="Anatomy" detail="Header · Body · Footer" />
        <Foundation icon={Activity} title="Sizing" detail="Fluid width · hug height" />
        <Foundation icon={Building2} title="Surfaces" detail="Default · subtle · selected" />
        <Foundation icon={Check} title="Interaction" detail="16–20 px gaps · 36 px targets" />
        <Foundation icon={ShieldCheck} title="States" detail="Focus · disabled · loading · error" />
        <Foundation
          icon={CircleDollarSign}
          title="Semantics"
          detail="Brand actions + status colors"
        />
      </section>
    </div>
  );
}

function Foundation({
  icon: Icon,
  title,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-3 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-card text-primary">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-bold">{title}</p>
        <p className="text-[10px] text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
