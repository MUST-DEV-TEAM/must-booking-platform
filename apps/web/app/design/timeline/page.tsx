import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUpRight,
  BadgeCheck,
  BedDouble,
  Bell,
  CalendarCheck,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  CreditCard,
  FileClock,
  Info,
  Mail,
  RefreshCw,
  ShieldAlert,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '../_ui/badge';
import { Button } from '../_ui/button';
import { Card } from '../_ui/card';
import { PageHeader } from '../_ui/hotel';

type Tone = 'success' | 'info' | 'warning' | 'danger' | 'staff';

const domains = [
  { label: 'Booking', value: 'Confirmed', detail: '20:16', icon: BedDouble, tone: 'success' },
  {
    label: 'Payment',
    value: 'Paid · verified',
    detail: 'PokPay · 20:14',
    icon: CreditCard,
    tone: 'success',
  },
  {
    label: 'Provider',
    value: 'Reservation created',
    detail: 'Clock PMS+ · 20:15',
    icon: Workflow,
    tone: 'info',
  },
  {
    label: 'Accounting',
    value: 'Deposit recorded',
    detail: 'Clock folio · 20:17',
    icon: CircleDollarSign,
    tone: 'secondary',
  },
  { label: 'Notification', value: 'Email sent', detail: '20:18', icon: Bell, tone: 'success' },
] as const;

const stages = [
  ['Checkout validated', '20:11', Check],
  ['Inventory locked', '20:12', BedDouble],
  ['PokPay verified', '20:14', CreditCard],
  ['Room revalidated', '20:14', CalendarCheck],
  ['Clock created', '20:15', Workflow],
  ['Booking confirmed', '20:16', BadgeCheck],
  ['Deposit recorded', '20:17', CircleDollarSign],
  ['Email sent', '20:18', Mail],
] as const;

const history: {
  time: string;
  title: string;
  detail: string;
  source: string;
  status: string;
  tone: Tone;
  icon: LucideIcon;
}[] = [
  {
    time: '20:18',
    title: 'Confirmation email sent',
    detail: 'Guest confirmation sent after the booking reached its confirmed state.',
    source: 'MUST notifications · Confirmation MHB-2026-0716-EB7F287C',
    status: 'Sent',
    tone: 'success',
    icon: Mail,
  },
  {
    time: '20:17',
    title: 'Deposit posted to Clock folio',
    detail: '€450.00 recorded as a deposit; the reservation balance remains separate.',
    source: 'Post-confirmation accounting · Clock folio 8403',
    status: 'Recorded',
    tone: 'success',
    icon: CircleDollarSign,
  },
  {
    time: '20:16',
    title: 'Booking confirmed',
    detail: 'Local booking changed from payment pending after its confirmation gates completed.',
    source: 'Booking workflow · confirmed',
    status: 'Confirmed',
    tone: 'success',
    icon: BadgeCheck,
  },
  {
    time: '20:15',
    title: 'Clock PMS+ reservation created',
    detail: 'The idempotent provider operation returned an external reservation reference.',
    source: 'Clock PMS+ · reservation.create',
    status: 'Created',
    tone: 'info',
    icon: Workflow,
  },
  {
    time: '20:15',
    title: 'Exact room availability revalidated',
    detail: 'Physical room #21 remained available for the selected stay before fulfillment.',
    source: 'Availability engine · room 21',
    status: 'Available',
    tone: 'success',
    icon: CalendarCheck,
  },
  {
    time: '20:14',
    title: 'PokPay payment verified',
    detail: '€450.00 was marked paid after authoritative server-side order verification.',
    source: 'PokPay · verified payment event',
    status: 'Paid · verified',
    tone: 'success',
    icon: CreditCard,
  },
  {
    time: '20:12',
    title: 'Pending-payment booking and inventory lock created',
    detail: 'A local booking and exact-unit hold were created before redirecting to payment.',
    source: 'Booking workflow · payment pending',
    status: 'Created',
    tone: 'info',
    icon: BedDouble,
  },
  {
    time: '20:11',
    title: 'Checkout quote and initial availability validated',
    detail: 'Dates, guest count and selected room were checked before checkout.',
    source: 'Empire Beach Resort · Standard Rooms · Direct Pool',
    status: 'Validated',
    tone: 'info',
    icon: CheckCircle2,
  },
];

const examples: {
  domain: string;
  title: string;
  detail: string;
  source: string;
  status: string;
  tone: Tone;
  icon: LucideIcon;
}[] = [
  {
    domain: 'Booking',
    title: 'Booking confirmed',
    detail: 'All confirmation gates completed; local state changed to confirmed.',
    source: 'Booking workflow',
    status: 'Confirmed',
    tone: 'success',
    icon: BadgeCheck,
  },
  {
    domain: 'Payment',
    title: 'PokPay payment verified',
    detail: '€450.00 marked paid after authoritative server-side verification.',
    source: 'PokPay event',
    status: 'Paid · verified',
    tone: 'success',
    icon: CreditCard,
  },
  {
    domain: 'Provider',
    title: 'Clock reservation creation in progress',
    detail: 'An idempotent create operation is running; confirmation waits for its result.',
    source: 'Background workflow',
    status: 'Processing',
    tone: 'info',
    icon: Workflow,
  },
  {
    domain: 'Provider',
    title: 'Clock result is unconfirmed',
    detail: 'No authoritative reservation ID was stored; booking remains in manual review.',
    source: 'Clock PMS+',
    status: 'Review required',
    tone: 'warning',
    icon: ShieldAlert,
  },
  {
    domain: 'Availability',
    title: 'Exact room is no longer available',
    detail: 'Fulfillment revalidation failed; no provider write was performed.',
    source: 'Availability engine',
    status: 'Blocked',
    tone: 'warning',
    icon: CalendarCheck,
  },
  {
    domain: 'Post-confirmation',
    title: 'Deposit folio posting failed',
    detail: 'Booking remains confirmed; accounting retry or review is needed.',
    source: 'Clock accounting',
    status: 'Retry required',
    tone: 'danger',
    icon: CircleDollarSign,
  },
  {
    domain: 'Staff',
    title: 'Manual review opened',
    detail: 'A booking agent received the unresolved provider case for follow-up.',
    source: 'Staff dashboard',
    status: 'Assigned',
    tone: 'staff',
    icon: Activity,
  },
];

const toneClasses: Record<
  Tone,
  { border: string; icon: string; badge: 'success' | 'info' | 'warning' | 'danger' | 'secondary' }
> = {
  success: {
    border: 'border-l-success',
    icon: 'bg-success-surface text-success',
    badge: 'success',
  },
  info: { border: 'border-l-info', icon: 'bg-info-surface text-info', badge: 'info' },
  warning: {
    border: 'border-l-warning',
    icon: 'bg-warning-surface text-warning',
    badge: 'warning',
  },
  danger: {
    border: 'border-l-destructive',
    icon: 'bg-destructive-surface text-destructive',
    badge: 'danger',
  },
  staff: {
    border: 'border-l-violet-500',
    icon: 'bg-violet-100 text-violet-700',
    badge: 'secondary',
  },
};

function SectionHeading({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <h2 className="flex items-center gap-2 text-base font-bold">
        <span className="inline-flex size-6 items-center justify-center rounded-md bg-primary text-xs text-primary-foreground">
          {number}
        </span>
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function TimelineRow({ item }: { item: (typeof history)[number] }) {
  const Icon = item.icon;
  const tone = toneClasses[item.tone];
  return (
    <li
      className={`grid gap-3 border-l-2 py-3 pl-3 sm:grid-cols-[92px_minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:pl-4 ${tone.border}`}
    >
      <div className="flex items-baseline gap-2 sm:block">
        <p className="text-sm font-semibold tabular-nums">{item.time}</p>
        <p className="text-xs text-muted-foreground">16 Jul 2026</p>
      </div>
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${tone.icon}`}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-semibold">{item.title}</p>
          <p className="text-sm text-muted-foreground">{item.detail}</p>
          <p className="truncate text-xs text-muted-foreground">{item.source}</p>
        </div>
      </div>
      <Badge variant={tone.badge} className="sm:justify-self-end">
        {item.status}
      </Badge>
    </li>
  );
}

function StateCell({
  label,
  status,
  detail,
  variant,
}: {
  label: string;
  status: string;
  detail: string;
  variant: 'success' | 'warning' | 'secondary';
}) {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <Badge variant={variant}>{status}</Badge>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export default function TimelinePage() {
  return (
    <main className="px-4 py-6 lg:px-6">
      <div className="mx-auto max-w-[1440px] space-y-6">
        <PageHeader
          title="Booking lifecycle timeline"
          description="Booking, payment, provider and post-confirmation events in one operational view."
          actions={<Badge variant="info">Illustrative demo data</Badge>}
        />
        <div
          className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-surface px-3 py-2.5 text-sm text-info"
          role="note"
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Preview only. Events and provider operations below are examples; they do not read or
            change hotel or provider data.
          </p>
        </div>

        <section aria-labelledby="lifecycle-heading" className="space-y-3">
          <SectionHeading
            number="9.1"
            title="Booking lifecycle"
            description="Chronological booking detail with separate payment, provider and notification states."
          />
          <Card className="gap-0 overflow-hidden py-0">
            <div className="flex flex-col gap-4 border-b bg-muted/40 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-primary">Empire Beach Resort</p>
                <h2 id="lifecycle-heading" className="break-all text-lg font-bold">
                  MHB-2026-0716-EB7F287C
                </h2>
                <p className="text-sm text-muted-foreground">
                  Standard Rooms · Direct Pool · Room type #44 · Physical room #21
                </p>
                <p className="text-xs text-muted-foreground">
                  17–18 Jul 2026 · 1 night · 2 guests · €450.00
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="success">
                  <CheckCircle2 aria-hidden="true" />
                  Completed successfully
                </Badge>
                <Badge variant="secondary">Operational view</Badge>
                <a
                  href="#activity"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                >
                  View activity <ArrowDown className="size-4" aria-hidden="true" />
                </a>
              </div>
            </div>
            <div className="space-y-5 p-4 sm:p-5">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold">Current state by domain</h3>
                  <p className="text-xs text-muted-foreground">
                    Independent states · never collapsed into one badge
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  {domains.map(({ label, value, detail, icon: Icon, tone }) => (
                    <div
                      key={label}
                      className="flex min-w-0 items-center gap-3 rounded-xl border bg-card p-3"
                    >
                      <span
                        className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tone === 'info' ? 'bg-info-surface text-info' : tone === 'secondary' ? 'bg-secondary text-primary' : 'bg-success-surface text-success'}`}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className="truncate text-sm font-semibold">{value}</p>
                        <p className="truncate text-xs text-muted-foreground">{detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold">Lifecycle progress</h3>
                    <p className="text-xs text-muted-foreground">
                      Confirmation gates first · post-confirmation jobs continue afterward
                    </p>
                  </div>
                  <Badge variant="success">8 of 8 complete</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
                  {stages.map(([label, time, Icon], index) => (
                    <div
                      key={label}
                      className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-lg border bg-card p-2 text-center"
                    >
                      <span className="flex size-8 items-center justify-center rounded-full bg-success-surface text-success">
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="text-[10px] font-bold tracking-wide text-muted-foreground">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="text-xs font-semibold leading-tight">{label}</span>
                      <span className="text-[10px] text-muted-foreground">{time}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </section>

        <section id="activity" aria-labelledby="activity-heading" className="space-y-3">
          <SectionHeading
            number="9.2"
            title="Activity history"
            description="Newest first · operational detail expands only when a sanitized provider trace is needed."
          />
          <Card className="gap-0 py-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3 sm:px-5">
              <h2 id="activity-heading" className="text-sm font-bold">
                Booking activity
              </h2>
              <Badge variant="info">8 events</Badge>
            </div>
            <ol className="divide-y px-4 sm:px-5">
              {history.map((item) => (
                <TimelineRow key={`${item.time}-${item.title}`} item={item} />
              ))}
            </ol>
            <div className="flex flex-col gap-3 border-t bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <p className="text-sm font-semibold">
                  Healthy booking · normal operational actions
                </p>
                <p className="text-xs text-muted-foreground">
                  Diagnostic detail is only needed when a gate or post-confirmation job fails.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <a href="#provider-operation">
                    Provider operation <ArrowUpRight aria-hidden="true" />
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href="#event-variants">
                    Event variants <ArrowUpRight aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </div>
          </Card>
          <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Chronological lifecycle progress above · newest-first activity history below ·
            confirmation gates stay separate from post-confirmation jobs.
          </p>
        </section>

        <section id="event-variants" aria-labelledby="variants-heading" className="space-y-3">
          <SectionHeading
            number="9.3"
            title="Timeline event variants"
            description="Compact operational events with clear domain, outcome, source and follow-up."
          />
          <Card className="gap-3 p-3 sm:p-4">
            <h2 id="variants-heading" className="sr-only">
              Timeline event variants
            </h2>
            <div className="space-y-2">
              {examples.map((event) => {
                const Icon = event.icon;
                const tone = toneClasses[event.tone];
                return (
                  <article
                    key={event.title}
                    className={`grid gap-3 rounded-lg border border-l-[3px] bg-card p-3 sm:grid-cols-[minmax(0,1fr)_170px_auto] sm:items-center sm:gap-4 ${tone.border}`}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg ${tone.icon}`}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                          {event.domain}
                        </p>
                        <h3 className="text-sm font-semibold">{event.title}</h3>
                        <p className="text-sm text-muted-foreground">{event.detail}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground sm:text-right">
                      16 Jul 2026 · 20:15
                      <br />
                      {event.source}
                    </p>
                    <Badge variant={tone.badge}>{event.status}</Badge>
                  </article>
                );
              })}
            </div>
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Operational rows stay concise · technical IDs move to diagnostic detail · payment,
              booking and provider states remain separate.
            </p>
          </Card>
        </section>

        <section id="provider-operation" aria-labelledby="provider-heading" className="space-y-3">
          <SectionHeading
            number="9.4"
            title="Provider operation recovery"
            description="Show impact, current domain states and the safe next action before exposing sanitized diagnostics."
          />
          <Card className="gap-0 overflow-hidden py-0">
            <div className="flex flex-col gap-3 border-b bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning-surface text-warning">
                  <Workflow className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold">Clock PMS+ · Create reservation</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Paid booking fulfillment · MHB-2026-0716-EB7F287C
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Manual review</Badge>
                <Badge variant="warning">Provider unconfirmed</Badge>
              </div>
            </div>
            <div className="space-y-4 p-4 sm:p-5">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <StateCell
                  label="Payment"
                  status="Paid · verified"
                  detail="€450.00 · PokPay"
                  variant="success"
                />
                <StateCell
                  label="Booking"
                  status="Manual review"
                  detail="Not confirmed"
                  variant="warning"
                />
                <StateCell
                  label="Provider"
                  status="Unconfirmed"
                  detail="No Clock ID stored"
                  variant="warning"
                />
                <StateCell
                  label="Inventory"
                  status="Held for review"
                  detail="Exact room remains blocked"
                  variant="secondary"
                />
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-surface p-3 text-warning">
                <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-bold">
                    Payment succeeded, but the Clock reservation is not confirmed.
                  </p>
                  <p className="text-sm">
                    Keep the booking in manual review and inventory held. Check for an existing
                    reservation with the MUST reference before any safe retry.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
                <div className="rounded-lg border bg-success-surface/40 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-success">
                    Recommended next step
                  </p>
                  <h3 className="mt-1 text-sm font-bold">Run provider preflight before retry</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Check Clock for a reservation created with this MUST reference. Retry only when
                    preflight confirms no authoritative reservation exists.
                  </p>
                  <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-success">
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    Every preflight and retry is recorded in activity.
                  </p>
                </div>
                <details className="rounded-lg border bg-card p-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
                    <span className="flex items-center gap-2">
                      <FileClock className="size-4 text-muted-foreground" aria-hidden="true" />
                      Sanitized diagnostics
                    </span>
                    <span className="text-xs text-muted-foreground">Attempt 2 of 3</span>
                  </summary>
                  <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
                    <dt className="text-muted-foreground">Operation</dt>
                    <dd className="text-right font-medium">reservation.create</dd>
                    <dt className="text-muted-foreground">Trace ID</dt>
                    <dd className="text-right font-medium">trc_BFA2</dd>
                    <dt className="text-muted-foreground">Classification</dt>
                    <dd className="text-right font-semibold text-destructive">
                      provider_unconfirmed
                    </dd>
                    <dt className="text-muted-foreground">Next action</dt>
                    <dd className="text-right font-medium text-success">
                      Idempotent retry after preflight
                    </dd>
                  </dl>
                  <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                    Raw credentials, tokens and guest payloads are never shown here.
                  </p>
                </details>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-3 text-xs text-muted-foreground sm:px-5">
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="size-3.5" aria-hidden="true" />
                Preview operation · no provider request was made
              </span>
              <a
                href="#activity"
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              >
                Back to activity <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </a>
            </div>
          </Card>
        </section>
      </div>
    </main>
  );
}
