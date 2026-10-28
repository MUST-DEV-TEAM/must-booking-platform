'use client';
import { HotelMoney, LedgerAmount } from './approximate-money';
import { formatMoney } from '../../lib/money';
import { ClockFinancialCard, useClockFinancial } from './clock-financial';
import { CancellationDialog } from './cancellation-dialog';
import { BookingReviewCard } from './booking-review-card';
import { CollectPaymentActions } from './collect-payment-actions';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CircleDot, Landmark, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { ActivityFeed, type ActivityEntry } from '../../components/ui/activity-feed';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { DetailHeader } from '../../components/ui/detail-header';
import { DetailList } from '../../components/ui/detail-list';
import { StatTile } from '../../components/ui/stat-tile';
import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { BookingStatusBadge } from '../../components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { RefundDialog } from './payment-refund-dialog';
import {
  PAYMENT_BADGE_TONE,
  hasRefundableBalance,
  outstandingAmount,
  paymentMethodLabel,
  paymentStatus,
  remainingRefundable,
} from './payment-status';
import { fetchPropertyBookings, guestName, type Reservation } from './reservations';

export type LedgerEntry = {
  id: string;
  kind: 'CHARGE' | 'REFUND';
  provider: string;
  method: string | null;
  externalPaymentId: string;
  status: string;
  amount: string;
  currency: string;
  fxRate?: string | null;
  fxRateDate?: string | null;
  note: string | null;
  createdAt: string;
  actorEmail: string | null;
};

export type LedgerEvent = {
  action: string;
  createdAt: string;
  actorEmail: string | null;
  details: Record<string, unknown>;
};

export type Ledger = { bookingId: string; entries: LedgerEntry[]; events: LedgerEvent[] };

const EVENT_LABELS: Record<string, string> = {
  'booking.created': 'Booking created',
  'booking.clock_reservation_created': 'Reservation created in Clock',
  'booking.clock_deposit_posted': 'Deposit posted to Clock',
  'payment.refunded': 'Refund recorded',
};

function eventLabel(action: string) {
  if (EVENT_LABELS[action]) return EVENT_LABELS[action];
  const words = action.replaceAll('.', ' ').replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function eventDetail(event: LedgerEvent) {
  const parts: string[] = [];
  const amount = event.details.amount as { amount?: string; currency?: string } | undefined;
  if (amount?.amount) parts.push(`${amount.amount} ${amount.currency ?? ''}`.trim());
  if (typeof event.details.folioId === 'number' || typeof event.details.folioId === 'string')
    parts.push(`folio ${event.details.folioId}`);
  if (typeof event.details.note === 'string') parts.push(event.details.note);
  const evidence = event.details.evidence;
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
    const labels: Record<string, string> = {
      receivedOn: 'Received',
      reference: 'Reference',
      payerName: 'Payer',
      terminalId: 'Terminal',
    };
    for (const [key, label] of Object.entries(labels)) {
      const value = (evidence as Record<string, unknown>)[key];
      if (typeof value === 'string' && value) parts.push(`${label}: ${value}`);
    }
  }
  return parts.join(' · ');
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDay(value: string | undefined, withYear: boolean) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

function entryMethod(entry: LedgerEntry) {
  if (entry.provider === 'manual')
    return entry.method
      ? `Recorded by staff (${entry.method.replaceAll('_', ' ')})`
      : 'Recorded by staff';
  return paymentMethodLabel(entry.provider === 'pokpay' ? 'POKPAY' : entry.provider.toUpperCase());
}

export function listHref(tenantId: string, propertyId: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=payments`;
}

export function guestHref(tenantId: string, propertyId: string, guestId: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=guests&guest=${encodeURIComponent(guestId)}`;
}

export function paymentHref(tenantId: string, propertyId: string, bookingId: string) {
  return `${listHref(tenantId, propertyId)}&payment=${encodeURIComponent(bookingId)}`;
}

/** One booking's money: summary, every charge and refund, Clock's folios and the audit trail. */
export function PaymentDetail({
  tenantId,
  propertyId,
  bookingId,
}: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
}) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const [refunding, setRefunding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const financial = useClockFinancial(tenantId, propertyId, bookingId);
  const bookingsQuery = useQuery({
    queryKey: ['dashboard', 'payments-bookings', tenantId, propertyId],
    queryFn: () => fetchPropertyBookings(tenantId, propertyId),
  });
  const capabilitiesQuery = useQuery({
    queryKey: ['dashboard', 'payment-capabilities', tenantId, propertyId],
    queryFn: async () => {
      const response = await fetch(`${base}/capabilities/mine`, { credentials: 'include' });
      if (!response.ok) throw new Error('Unable to load payment permissions.');
      return (await response.json()) as string[];
    },
  });
  const ledgerQuery = useQuery({
    queryKey: ['dashboard', 'payment-ledger', tenantId, propertyId, bookingId],
    queryFn: async () => {
      const response = await fetch(`${base}/payments/bookings/${bookingId}`, {
        credentials: 'include',
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Unable to load the payment history.');
      return (await response.json()) as Ledger;
    },
  });

  const back = {
    backHref: listHref(tenantId, propertyId),
    backLabel: 'Back to payments',
  };

  if (bookingsQuery.isPending || capabilitiesQuery.isPending || ledgerQuery.isPending)
    return (
      <div className="space-y-5">
        <Button variant="link" size="sm" asChild className="h-auto !px-0 py-0 text-xs">
          <a href={back.backHref}>
            <ArrowLeft aria-hidden="true" className="size-3.5" /> {back.backLabel}
          </a>
        </Button>
        <ListSkeleton rows={4} />
      </div>
    );
  const loadError = bookingsQuery.error ?? capabilitiesQuery.error ?? ledgerQuery.error;
  if (loadError)
    return (
      <ErrorPanel
        title="This payment could not be loaded"
        description={loadError.message}
        onRetry={() => {
          void bookingsQuery.refetch();
          void capabilitiesQuery.refetch();
          void ledgerQuery.refetch();
        }}
      />
    );

  const booking: Reservation | undefined = bookingsQuery.data?.find((b) => b.id === bookingId);
  if (!booking || !ledgerQuery.data)
    return (
      <div className="space-y-5">
        <Button variant="link" size="sm" asChild className="h-auto !px-0 py-0 text-xs">
          <a href={back.backHref}>
            <ArrowLeft aria-hidden="true" className="size-3.5" /> {back.backLabel}
          </a>
        </Button>
        <EmptyPanel title="Payment not found" description="This booking is not in this property." />
      </div>
    );

  const ledger = ledgerQuery.data;
  const status = paymentStatus(booking);
  const currency = booking.total.currency;
  const hotelMoney = (amount: string, code = currency) => (
    <HotelMoney tenantId={tenantId} propertyId={propertyId} amount={amount} currency={code} />
  );
  const money = (amount: string, code = currency) => formatMoney(amount, code);
  const canRefund = (capabilitiesQuery.data ?? []).includes('payments.refund');
  const canCancel = (capabilitiesQuery.data ?? []).includes('bookings.cancel');
  const clockMoney = financial.data?.data;
  const refundable = remainingRefundable(booking);
  const folios = booking.clockFolios ?? [];
  const hasOpenDeposit = folios.some((folio) => folio.isDeposit && !folio.closedAt);
  const feed: ActivityEntry[] = [...ledger.events]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((event, index) => ({
      key: `${event.action}-${event.createdAt}-${index}`,
      title: eventLabel(event.action),
      detail: eventDetail(event) || undefined,
      at: event.createdAt,
      actor: event.actorEmail,
      icon:
        event.action === 'payment.refunded'
          ? Undo2
          : event.action.includes('clock')
            ? Landmark
            : CircleDot,
      tone: event.action === 'payment.refunded' ? ('danger' as const) : ('default' as const),
    }));

  return (
    <div className="space-y-5">
      <DetailHeader
        {...back}
        reference={booking.externalReference ?? booking.id}
        title={guestName(booking)}
        subtitle={
          <>
            {booking.startsOn && booking.endsOn
              ? `${formatDay(booking.startsOn, false)} → ${formatDay(booking.endsOn, true)}`
              : ''}
            {booking.roomTypeName ? ` · ${booking.roomTypeName}` : ''}
            {booking.guestId ? (
              <>
                {' · '}
                <a
                  className="font-semibold text-primary no-underline hover:underline"
                  href={guestHref(tenantId, propertyId, booking.guestId)}
                >
                  Open guest
                </a>
              </>
            ) : null}
          </>
        }
        badges={
          <>
            {booking.status ? <BookingStatusBadge status={booking.status} /> : null}
            <Badge
              variant={PAYMENT_BADGE_TONE[status.state]}
              className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
            >
              {status.label}
            </Badge>
          </>
        }
        actions={
          <>
            {canRefund && hasRefundableBalance(booking) ? (
              <Button variant="outline" onClick={() => setRefunding(true)}>
                Refund
              </Button>
            ) : null}
            {canCancel && booking.status === 'CONFIRMED' ? (
              <Button variant="outline" onClick={() => setCancelling(true)}>
                Cancel booking
              </Button>
            ) : null}
          </>
        }
      />
      {['PMS_UNKNOWN_RESULT', 'MANUAL_REVIEW'].includes(booking.status) ? (
        <BookingReviewCard
          tenantId={tenantId}
          propertyId={propertyId}
          bookingId={bookingId}
          canRunCheck={(capabilitiesQuery.data ?? []).includes('bookings.edit')}
        />
      ) : null}
      {booking.balanceBasis === 'CLOCK' || clockMoney ? (
        <ClockFinancialCard
          data={clockMoney}
          status={financial.data?.status}
          error={financial.error?.message || financial.data?.lastError}
          localPaid={booking.paidAmount}
          tenantId={tenantId}
          propertyId={propertyId}
        />
      ) : null}
      {['AVAILABILITY_FAILED', 'PMS_REJECTED', 'PAYMENT_FAILED'].includes(booking.status) ? (
        <Card>
          <CardHeader>
            <CardTitle>This booking attempt is closed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p>
              No payment is due because a reservation was not created. The original attempt remains
              in the history.
            </p>
            <Button asChild variant="outline">
              <a
                href={`/dashboard/${tenantId}?propertyId=${propertyId}&section=overview&tab=quick-booking`}
              >
                Search for a new booking
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <CollectPaymentActions tenantId={tenantId} propertyId={propertyId} booking={booking} />
      {cancelling ? (
        <CancellationDialog
          tenantId={tenantId}
          propertyId={propertyId}
          bookingId={bookingId}
          open
          onOpenChange={setCancelling}
          canCancel={canCancel}
          canRefund={canRefund}
        />
      ) : null}

      <div
        aria-label="Payment summary"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        role="group"
      >
        <StatTile label="Total" size="sm" value={hotelMoney(booking.total.amount)} />
        <StatTile label="Paid" size="sm" value={hotelMoney(booking.paidAmount)} />
        <StatTile label="Refunded" size="sm" value={hotelMoney(booking.refundedAmount)} />
        <StatTile label="Refundable" size="sm" value={hotelMoney(refundable.amount)} />
        <StatTile
          label={
            clockMoney?.balance.amount.startsWith('-') ? 'Guest credit in Clock' : 'Outstanding'
          }
          size="sm"
          value={
            booking.balanceBasis === 'CLOCK' || clockMoney
              ? clockMoney
                ? hotelMoney(
                    clockMoney.balance.amount.replace(/^-/, ''),
                    clockMoney.balance.currency,
                  )
                : 'Verifying Clock balance'
              : [
                    'PMS_UNKNOWN_RESULT',
                    'MANUAL_REVIEW',
                    'PMS_CREATION_PENDING',
                    'PMS_CONFIRMATION_PENDING',
                  ].includes(booking.status)
                ? 'Balance not confirmed'
                : ['AVAILABILITY_FAILED', 'PMS_REJECTED', 'PAYMENT_FAILED'].includes(booking.status)
                  ? 'No balance - booking was not created'
                  : hotelMoney(outstandingAmount(booking))
          }
          tone={Number(outstandingAmount(booking)) > 0 ? 'warning' : 'default'}
        />
      </div>

      <Card className="gap-0 overflow-clip p-0">
        <CardHeader className="border-b p-4">
          <CardTitle className="text-base">Payments and refunds</CardTitle>
        </CardHeader>
        {ledger.entries.length === 0 ? (
          <p className="m-0 p-4 text-sm text-muted-foreground">
            No payments have been recorded for this booking.
          </p>
        ) : (
          <Table>
            <TableHeader className="bg-muted">
              <TableRow className="hover:bg-muted">
                <TableHead className="px-3 py-2">When</TableHead>
                <TableHead className="px-2 py-2">Type</TableHead>
                <TableHead className="px-2 py-2 text-right">Amount</TableHead>
                <TableHead className="px-2 py-2">Method</TableHead>
                <TableHead className="px-2 py-2">Reference</TableHead>
                <TableHead className="px-2 py-2">Status</TableHead>
                <TableHead className="px-2 py-2">By</TableHead>
                <TableHead className="px-2 py-2">Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="px-3 py-2 whitespace-nowrap">
                    {formatTime(entry.createdAt)}
                  </TableCell>
                  <TableCell className="px-2 py-2">
                    {entry.kind === 'REFUND' ? 'Refund' : 'Payment'}
                  </TableCell>
                  <TableCell className="px-2 py-2 text-right font-semibold whitespace-nowrap">
                    {entry.kind === 'REFUND' ? '' : '+'}
                    <LedgerAmount
                      tenantId={tenantId}
                      propertyId={propertyId}
                      entry={entry}
                      bookingCurrency={currency}
                      negative={entry.kind === 'REFUND'}
                    />
                  </TableCell>
                  <TableCell className="px-2 py-2">{entryMethod(entry)}</TableCell>
                  <TableCell className="px-2 py-2">
                    <code title={entry.externalPaymentId}>
                      {entry.externalPaymentId.length > 14
                        ? `…${entry.externalPaymentId.slice(-12)}`
                        : entry.externalPaymentId}
                    </code>
                  </TableCell>
                  <TableCell className="px-2 py-2">{entry.status}</TableCell>
                  <TableCell className="px-2 py-2">{entry.actorEmail ?? '—'}</TableCell>
                  <TableCell className="px-2 py-2">{entry.note ?? ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <div className={folios.length > 0 ? 'grid gap-5 lg:grid-cols-2' : 'grid gap-5'}>
        {folios.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Clock accounting</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {folios.length === 0 ? (
                <p className="m-0 text-sm text-muted-foreground">
                  No Clock folios are recorded for this booking.
                </p>
              ) : (
                <DetailList
                  items={folios.map((folio) => ({
                    label: `Folio ${folio.id} · ${folio.isDeposit ? 'Deposit' : 'General'}`,
                    value: `${folio.closedAt ? `Closed ${formatTime(folio.closedAt)}` : 'Open'}${folio.balance !== null ? ` · balance ${folio.balance}` : ''}`,
                  }))}
                />
              )}
              {hasOpenDeposit ? (
                <p className="m-0 text-xs text-muted-foreground">
                  An open deposit folio counts toward the booking balance in Clock, so a fully paid
                  booking shows 0.00 there. When the hotel converts it to an advance in Clock, the
                  balance returns to the full stay amount until check-in.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityFeed entries={feed} empty="No activity has been recorded for this booking." />
          </CardContent>
        </Card>
      </div>

      {refunding ? (
        <RefundDialog
          base={base}
          booking={booking}
          onClose={() => setRefunding(false)}
          canCancel={canCancel}
          onRefunded={() => {
            void bookingsQuery.refetch();
            void ledgerQuery.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
