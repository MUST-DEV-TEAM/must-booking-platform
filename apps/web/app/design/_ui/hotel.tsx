import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../_lib/utils';
import { Badge } from './badge';
import { Card } from './card';

/** Hotel-specific building blocks layered on the shadcn primitives. */

export type BookingStatus =
  'pending' | 'confirmed' | 'checked-in' | 'checked-out' | 'cancelled' | 'no-show';
export type PaymentStatus = 'paid' | 'partial' | 'unpaid' | 'refunded' | 'failed';
export type Channel = 'website' | 'clock' | 'booking' | 'airbnb' | 'walk-in';

const bookingStatus: Record<
  BookingStatus,
  { label: string; variant: 'success' | 'warning' | 'danger' | 'secondary' | 'muted' }
> = {
  pending: { label: 'Pending', variant: 'warning' },
  confirmed: { label: 'Confirmed', variant: 'success' },
  'checked-in': { label: 'Checked in', variant: 'secondary' },
  'checked-out': { label: 'Checked out', variant: 'muted' },
  cancelled: { label: 'Cancelled', variant: 'danger' },
  'no-show': { label: 'No-show', variant: 'warning' },
};

const paymentStatus: Record<
  PaymentStatus,
  { label: string; variant: 'success' | 'warning' | 'danger' | 'info' }
> = {
  paid: { label: 'Paid', variant: 'success' },
  partial: { label: 'Deposit paid', variant: 'info' },
  unpaid: { label: 'Unpaid', variant: 'warning' },
  refunded: { label: 'Refunded', variant: 'warning' },
  failed: { label: 'Failed', variant: 'danger' },
};

const channels: Record<Channel, { label: string; dot: string }> = {
  website: { label: 'Website', dot: 'bg-primary' },
  clock: { label: 'Clock PMS', dot: 'bg-brass' },
  booking: { label: 'Booking.com', dot: 'bg-info' },
  airbnb: { label: 'Airbnb', dot: 'bg-destructive' },
  'walk-in': { label: 'Walk-in', dot: 'bg-muted-foreground' },
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const { label, variant } = bookingStatus[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { label, variant } = paymentStatus[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export function ChannelBadge({ channel }: { channel: Channel }) {
  const { label, dot } = channels[channel];
  return (
    <Badge variant="outline" className="gap-1.5 font-medium">
      <span aria-hidden className={cn('size-2 rounded-full', dot)} />
      {label}
    </Badge>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  change,
  hint,
}: {
  label: string;
  value: string;
  icon?: LucideIcon;
  /** Percentage change versus the previous period; positive is shown as good. */
  change?: number;
  hint?: string;
}) {
  const up = (change ?? 0) >= 0;
  return (
    <Card className="gap-3 px-5 py-5">
      <div className="flex items-center justify-between text-sm font-semibold text-muted-foreground">
        {label}
        {Icon ? (
          <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-primary">
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>
      <div className="text-2xl font-extrabold tracking-tight">{value}</div>
      {change !== undefined || hint ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {change !== undefined ? (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-semibold',
                up ? 'text-success' : 'text-destructive',
              )}
            >
              {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
              {Math.abs(change)}%
            </span>
          ) : null}
          {hint}
        </div>
      ) : null}
    </Card>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-secondary text-primary">
        <Icon className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="font-bold">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
