'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowLeftRight, Ban, CreditCard, Pencil, Plug } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { DetailList } from '../../components/ui/detail-list';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { BookingStatusBadge, PaymentStatusBadge, SourceBadge } from '../../components/ui/status-badge';
import { Timeline, type TimelineItem } from '../../components/ui/timeline';
import {
  balanceDue,
  bookingStatusDisplay,
  nightsBetween,
  paymentDisplay,
  sourceDisplay,
} from '../../lib/reservation-display';

type Detail = {
  id: string;
  externalReference: string;
  status: string;
  paymentMethod: string;
  source: string | null;
  startsOn: string;
  endsOn: string;
  createdAt: string;
  adults: number;
  children: number;
  specialRequests: string | null;
  roomName: string | null;
  roomTypeName: string;
  ratePlanName: string;
  guestId: string | null;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  total: { amount: string; currency: string };
  paidAmount: string;
  refundedAmount: string;
  version: number;
  updatedAt: string;
  externalBookingId: string | null;
  nightlyRates: Array<{ date: string; amount: string }> | null;
  cancellation: { isFree: boolean | null; freeUntilHours: number | null; cutoffAt: string | null };
  guestAddress: {
    street: string | null;
    line2: string | null;
    city: string | null;
    county: string | null;
    postcode: string | null;
  };
  clockFolios: Array<{ id: string; isDeposit: boolean; balance: string | null; closedAt: string | null }>;
  activity: Array<{
    action: string;
    createdAt: string;
    actorEmail: string | null;
    details: Record<string, unknown>;
  }>;
};

type LedgerEntry = {
  id: string;
  kind: 'CHARGE' | 'REFUND';
  provider: string;
  externalPaymentId: string;
  status: string;
  amount: string;
  currency: string;
  createdAt: string;
};

const money = (amount: string, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount));
const longDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${iso}T00:00:00`),
  );
const dateTime = (value: string) =>
  new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

const ACTIVITY_LABELS: Record<string, string> = {
  'booking.created': 'Reservation created',
  'booking.cancelled': 'Reservation cancelled',
  'booking.clock_reservation_created': 'Reservation created in Clock',
  'booking.clock_deposit_posted': 'Deposit posted to Clock',
  'payment.refunded': 'Refund recorded',
};

function activityLabel(action: string) {
  if (ACTIVITY_LABELS[action]) return ACTIVITY_LABELS[action];
  const words = action.replaceAll('.', ' ').replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function activityDetail(details: Record<string, unknown>) {
  const parts: string[] = [];
  const amount = details.amount as { amount?: string; currency?: string } | string | undefined;
  if (typeof amount === 'string') parts.push(amount);
  else if (amount?.amount) parts.push(`${amount.amount} ${amount.currency ?? ''}`.trim());
  for (const key of ['reason', 'note', 'reference'] as const)
    if (typeof details[key] === 'string') parts.push(details[key] as string);
  return parts.join(' · ');
}

// Hotels have no check-in / check-out times of their own yet (Milestone 24 gap); these standard
// defaults are shown until they do.
const CHECK_IN = '15:00';
const CHECK_OUT = '11:00';

const CANCELLED_LIKE = new Set(['CANCELLED', 'EXPIRED']);

function href(tenantId: string, propertyId: string, extra: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&${extra}`;
}

/** One reservation in full: summary, stay, guest, money, Clock and what happened to it. */
export function ReservationDetail({
  tenantId,
  propertyId,
  bookingId,
  propertyName,
  bookingMode,
}: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
  propertyName?: string;
  bookingMode?: string;
}) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);

  const query = useQuery({
    queryKey: ['dashboard', 'reservation-detail', tenantId, propertyId, bookingId],
    queryFn: async (): Promise<Detail | null> => {
      const response = await fetch(`${base}/bookings/${bookingId}`, { credentials: 'include' });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Unable to load the reservation (${response.status}).`);
      return (await response.json()) as Detail;
    },
  });

  // Payments are optional: a role without refund rights simply sees no payment history.
  const ledger = useQuery({
    queryKey: ['dashboard', 'reservation-ledger', tenantId, propertyId, bookingId],
    queryFn: async (): Promise<LedgerEntry[] | null> => {
      const response = await fetch(`${base}/payments/bookings/${bookingId}`, {
        credentials: 'include',
      });
      if (!response.ok) return null;
      return ((await response.json()) as { entries: LedgerEntry[] }).entries;
    },
  });

  const back = (
    <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit">
      <a href={href(tenantId, propertyId, 'section=reservations')}>
        <ArrowLeft aria-hidden="true" /> All reservations
      </a>
    </Button>
  );

  if (query.isPending)
    return (
      <div className="space-y-4">
        {back}
        <ListSkeleton rows={4} />
      </div>
    );
  if (query.isError)
    return (
      <div className="space-y-4">
        {back}
        <ErrorPanel title="Couldn't load this reservation" onRetry={() => void query.refetch()} />
      </div>
    );
  const booking = query.data;
  if (!booking)
    return (
      <div className="space-y-4">
        {back}
        <ErrorPanel
          title="Reservation not found"
          description="It may belong to another hotel, or the link is wrong."
        />
      </div>
    );

  const currency = booking.total.currency;
  const due = balanceDue({
    total: booking.total.amount,
    paid: booking.paidAmount,
    refunded: booking.refundedAmount,
  });
  const guest = [booking.guestFirstName, booking.guestLastName].filter(Boolean).join(' ') || 'Unknown guest';
  const address = [
    booking.guestAddress.street,
    booking.guestAddress.line2,
    booking.guestAddress.city,
    booking.guestAddress.county,
    booking.guestAddress.postcode,
  ]
    .filter(Boolean)
    .join(', ');
  const canCancel = !CANCELLED_LIKE.has(booking.status);
  const cancellation = booking.cancellation;

  const timeline: TimelineItem[] = booking.activity.map((event, index) => ({
    key: `${event.action}-${event.createdAt}-${index}`,
    title: activityLabel(event.action),
    meta: `${dateTime(event.createdAt)}${event.actorEmail ? ` · ${event.actorEmail}` : ''}`,
    detail: activityDetail(event.details) || undefined,
  }));

  const cancelReservation = async (reason: string) => {
    const response = await fetch(`${base}/staff-bookings/${booking.id}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ expectedVersion: booking.version, reason }),
    });
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: { message?: string };
      message?: string;
    } | null;
    if (!response.ok || body?.ok === false)
      throw new Error(
        body?.error?.message ?? body?.message ?? 'The reservation could not be cancelled. Nothing was changed.',
      );
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const hasClock = booking.clockFolios.length > 0 || !!booking.externalBookingId;
  const firstCharge = ledger.data?.find((entry) => entry.kind === 'CHARGE');
  const received = Number(booking.paidAmount) - Number(booking.refundedAmount);
  const lastClock = booking.activity.find((event) => event.action.startsWith('booking.clock'));
  const methodLabel = booking.paymentMethod.toLowerCase().replaceAll('_', ' ');
  const methodTitle = methodLabel.charAt(0).toUpperCase() + methodLabel.slice(1);
  const statusLabel = bookingStatusDisplay(booking.status).label;
  const paymentLabel = paymentDisplay({
    status: booking.status,
    paymentMethod: booking.paymentMethod,
    total: booking.total.amount,
    paid: booking.paidAmount,
    refunded: booking.refundedAmount,
  }).label;
  const modeLabel =
    bookingMode === 'ROOM_TYPE_ONLY'
      ? 'Room type only'
      : bookingMode === 'ROOM_ASSIGNED'
        ? 'Room assigned'
        : bookingMode
          ? bookingMode.toLowerCase().replaceAll('_', ' ')
          : null;
  const nights = nightsBetween(booking.startsOn, booking.endsOn);
  const clock = (value: string) =>
    new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const sourceText = sourceDisplay(booking.source);

  const field = (label: string, value: ReactNode) => (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold break-words">{value || '—'}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <a
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary no-underline"
                href={href(tenantId, propertyId, 'section=reservations')}
              >
                <ArrowLeft aria-hidden="true" className="size-3.5" /> Back to reservations
              </a>
              <p className="text-xs font-semibold text-muted-foreground">{booking.externalReference}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <BookingStatusBadge status={booking.status} />
              <PaymentStatusBadge
                status={booking.status}
                paymentMethod={booking.paymentMethod}
                total={booking.total.amount}
                paid={booking.paidAmount}
                refunded={booking.refundedAmount}
              />
              {hasClock ? (
                <Badge variant="info" className="rounded-full px-2 py-0 text-[10px] font-semibold">
                  Clock synced
                </Badge>
              ) : null}
              <SourceBadge source={booking.source} />
            </div>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-3xl font-extrabold tracking-tight">{guest}</h2>
              <p className="text-sm text-muted-foreground">
                {statusLabel} reservation
                {sourceText ? ` · Created from ${sourceText.toLowerCase()}` : ''} · {dateTime(booking.createdAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled title="Editing a reservation is planned, not built yet">
                <Pencil aria-hidden="true" /> Edit reservation
              </Button>
              {canCancel ? (
                <Button variant="destructive" onClick={() => setCancelling(true)}>
                  <Ban aria-hidden="true" /> Cancel reservation
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: 'STAY',
            value: `${longDate(booking.startsOn)} – ${longDate(booking.endsOn)}`,
            sub: `${nights} night${nights === 1 ? '' : 's'} · Check-in from ${CHECK_IN}`,
          },
          {
            label: 'ACCOMMODATION',
            value: propertyName ?? booking.roomTypeName,
            sub: `${booking.roomTypeName} · ${booking.roomName ?? 'Room not assigned'}`,
          },
          {
            label: 'GUESTS',
            value: `${booking.adults} adult${booking.adults === 1 ? '' : 's'}${booking.children ? ` · ${booking.children} child${booking.children === 1 ? '' : 'ren'}` : ''}`,
            sub: `Primary guest: ${guest}`,
          },
          {
            label: 'TOTAL & PAYMENT',
            value: money(booking.total.amount, currency),
            sub: `${methodTitle} · ${paymentLabel}`,
          },
        ].map((tile) => (
          <Card key={tile.label}>
            <CardContent className="space-y-1 p-4">
              <p className="text-[10px] font-bold tracking-wide text-muted-foreground">{tile.label}</p>
              <p className="text-lg font-bold">{tile.value}</p>
              <p className="text-xs text-muted-foreground">{tile.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Reservation and stay</CardTitle>
              <p className="text-xs text-muted-foreground">
                Operational information used by staff, payments and provider synchronization.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-x-8 gap-y-5 border-t pt-5 sm:grid-cols-2">
                {field('Booking source', sourceText ?? 'Not recorded')}
                {field('Booking mode', modeLabel)}
                {field('Check-in', `${longDate(booking.startsOn)} · ${CHECK_IN}`)}
                {field('Check-out', `${longDate(booking.endsOn)} · ${CHECK_OUT}`)}
                {field('Room type', booking.roomTypeName)}
                {field('Assigned unit', booking.roomName ?? 'Not assigned')}
                {field(
                  'Occupancy',
                  `${booking.adults} adult${booking.adults === 1 ? '' : 's'} · ${booking.children} child${booking.children === 1 ? '' : 'ren'}`,
                )}
                {field('Rate plan', booking.ratePlanName)}
                {field(
                  'Cancellation policy',
                  cancellation.isFree === null
                    ? null
                    : cancellation.isFree
                      ? cancellation.cutoffAt
                        ? `Free until ${dateTime(cancellation.cutoffAt)} · Non-refundable after`
                        : 'Free cancellation'
                      : 'Non-refundable',
                )}
                {field('Internal status', statusLabel)}
                {field('Guest email', booking.guestEmail)}
                {field('Guest phone', booking.guestPhone)}
                {address ? field('Guest address', address) : null}
                {field('Last updated', dateTime(booking.updatedAt))}
              </div>
              {booking.specialRequests ? (
                <div className="rounded-lg border p-3 text-sm">
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">Special requests</p>
                  {booking.specialRequests}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2 rounded-xl bg-primary/5 p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled
                  title="Moving a reservation to another room is planned, not built yet"
                >
                  <ArrowLeftRight aria-hidden="true" /> Move room
                </Button>
                <Button variant="ghost" size="sm" disabled title="Provider review is planned, not built yet">
                  <Plug aria-hidden="true" /> Provider review
                </Button>
              </div>
            </CardContent>
          </Card>

          {booking.nightlyRates && booking.nightlyRates.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Nightly rates</CardTitle>
              </CardHeader>
              <CardContent>
                <DetailList
                  items={[
                    ...booking.nightlyRates.map((night) => ({
                      label: longDate(night.date),
                      value: money(night.amount, currency),
                    })),
                    { label: 'Total', value: money(booking.total.amount, currency) },
                  ]}
                />
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Payment and provider</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold tracking-wide text-muted-foreground">PAYMENT</p>
                <PaymentStatusBadge
                  status={booking.status}
                  paymentMethod={booking.paymentMethod}
                  total={booking.total.amount}
                  paid={booking.paidAmount}
                  refunded={booking.refundedAmount}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                {field(`${methodTitle} transaction`, firstCharge?.externalPaymentId ?? 'No online payment')}
                {field('Amount received', money(String(received), currency))}
                {field('Balance due', money(String(due), currency))}
                {Number(booking.refundedAmount) > 0
                  ? field('Refunded', money(booking.refundedAmount, currency))
                  : null}
              </div>
              {ledger.data && ledger.data.length > 0 ? (
                <ul className="divide-y rounded-lg border px-3 text-sm">
                  {ledger.data.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
                      <span>
                        {entry.kind === 'REFUND' ? 'Refund' : 'Payment'} ·{' '}
                        <span className="text-muted-foreground">{dateTime(entry.createdAt)}</span>
                      </span>
                      <span className="font-medium">
                        {entry.kind === 'REFUND' ? '−' : ''}
                        {money(entry.amount, entry.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            {hasClock ? (
              <section className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold tracking-wide text-muted-foreground">CLOCK PMS</p>
                  <Badge variant="info" className="rounded-full px-2 py-0 text-[10px] font-semibold">
                    Synced
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {field('Reservation ID', booking.externalBookingId)}
                  {field('Last confirmation', lastClock ? dateTime(lastClock.createdAt) : null)}
                </div>
                {booking.clockFolios.length > 0 ? (
                  <DetailList
                    items={booking.clockFolios.map((folio) => ({
                      label: `${folio.isDeposit ? 'Deposit folio' : 'Folio'} ${folio.id}`,
                      value: `${folio.balance ?? '—'}${folio.closedAt ? ' · closed' : ''}`,
                    }))}
                  />
                ) : null}
              </section>
            ) : null}

            <section className="space-y-3 border-t pt-4">
              <p className="text-[10px] font-bold tracking-wide text-muted-foreground">LATEST ACTIVITY</p>
              {booking.activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No activity has been recorded for this reservation.
                </p>
              ) : (
                <ul className="list-none space-y-2">
                  {booking.activity.slice(0, 8).map((event, index) => (
                    <li
                      key={`${event.action}-${event.createdAt}-${index}`}
                      className="flex items-start gap-3 text-sm"
                    >
                      <span className="shrink-0 rounded-md border bg-card px-2 py-1 text-xs font-semibold">
                        {clock(event.createdAt)}
                      </span>
                      <span className="pt-0.5">
                        {activityLabel(event.action)}
                        {activityDetail(event.details) ? (
                          <span className="block text-xs text-muted-foreground">
                            {activityDetail(event.details)}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="flex flex-wrap gap-2 rounded-xl bg-primary/5 p-2">
              <Button variant="ghost" size="sm" asChild>
                <a href={href(tenantId, propertyId, `section=payments&payment=${booking.id}`)}>
                  <CreditCard aria-hidden="true" /> Open payment
                </a>
              </Button>
              {booking.guestId ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={href(tenantId, propertyId, `section=guests&guest=${booking.guestId}`)}>Open guest</a>
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Full activity history</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline items={timeline} empty="No activity has been recorded for this reservation." />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Cancel ${booking.externalReference}?`}
        description={
          <>
            {guest}, {longDate(booking.startsOn)} – {longDate(booking.endsOn)}. The room goes back on sale.
            {Number(booking.paidAmount) > 0
              ? ' Money already paid is not returned automatically; refund it from the payment page.'
              : ''}
          </>
        }
        confirmLabel="Cancel reservation"
        destructive
        reasonLabel="Reason"
        reasonRequired
        onConfirm={cancelReservation}
      />
    </div>
  );
}
