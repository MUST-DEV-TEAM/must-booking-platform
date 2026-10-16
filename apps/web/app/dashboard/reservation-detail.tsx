'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { DetailList } from '../../components/ui/detail-list';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { BookingStatusBadge, PaymentStatusBadge, SourceBadge } from '../../components/ui/status-badge';
import { Timeline, type TimelineItem } from '../../components/ui/timeline';
import { balanceDue, nightsBetween } from '../../lib/reservation-display';

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

const CANCELLED_LIKE = new Set(['CANCELLED', 'EXPIRED']);

function href(tenantId: string, propertyId: string, extra: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&${extra}`;
}

/** One reservation in full: summary, stay, guest, money, Clock and what happened to it. */
export function ReservationDetail({
  tenantId,
  propertyId,
  bookingId,
}: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
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

  return (
    <div className="space-y-6">
      {back}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h2 className="text-2xl font-extrabold tracking-tight">{booking.externalReference}</h2>
          <p className="text-sm text-muted-foreground">
            {guest} · created {dateTime(booking.createdAt)}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <BookingStatusBadge status={booking.status} />
            <PaymentStatusBadge
              status={booking.status}
              paymentMethod={booking.paymentMethod}
              total={booking.total.amount}
              paid={booking.paidAmount}
              refunded={booking.refundedAmount}
            />
            <SourceBadge source={booking.source} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {booking.guestId ? (
            <Button variant="outline" asChild>
              <a href={href(tenantId, propertyId, `section=guests&guest=${booking.guestId}`)}>Open guest</a>
            </Button>
          ) : null}
          <Button variant="outline" asChild>
            <a href={href(tenantId, propertyId, `section=payments&payment=${booking.id}`)}>Open payment</a>
          </Button>
          {canCancel ? (
            <Button variant="destructive" onClick={() => setCancelling(true)}>
              <Ban aria-hidden="true" /> Cancel reservation
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: 'Stay',
            value: `${longDate(booking.startsOn)} – ${longDate(booking.endsOn)}`,
            sub: `${nightsBetween(booking.startsOn, booking.endsOn)} nights`,
          },
          {
            label: 'Room',
            value: booking.roomName ?? 'Not assigned',
            sub: booking.roomTypeName,
          },
          {
            label: 'Guests',
            value: `${booking.adults} adult${booking.adults === 1 ? '' : 's'}${booking.children ? ` · ${booking.children} child${booking.children === 1 ? '' : 'ren'}` : ''}`,
            sub: booking.ratePlanName,
          },
          {
            label: 'Total',
            value: money(booking.total.amount, currency),
            sub: due > 0 ? `${money(String(due), currency)} still due` : 'Nothing due',
          },
        ].map((tile) => (
          <Card key={tile.label}>
            <CardContent className="space-y-1 p-4">
              <p className="text-xs font-semibold text-muted-foreground">{tile.label}</p>
              <p className="text-base font-bold">{tile.value}</p>
              <p className="text-xs text-muted-foreground">{tile.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Guest</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: 'Name', value: guest },
                { label: 'Email', value: booking.guestEmail },
                { label: 'Phone', value: booking.guestPhone },
                { label: 'Address', value: address },
              ]}
            />
            {booking.specialRequests ? (
              <div className="mt-3 rounded-lg border p-3 text-sm">
                <p className="mb-1 text-xs font-semibold text-muted-foreground">Special requests</p>
                {booking.specialRequests}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <DetailList
              items={[
                { label: 'Total', value: money(booking.total.amount, currency) },
                { label: 'Paid', value: money(booking.paidAmount, currency) },
                Number(booking.refundedAmount) > 0
                  ? { label: 'Refunded', value: money(booking.refundedAmount, currency) }
                  : { label: 'Refunded', value: null },
                { label: 'Balance due', value: money(String(due), currency) },
                { label: 'Method', value: booking.paymentMethod.toLowerCase().replaceAll('_', ' ') },
                {
                  label: 'Cancellation',
                  value:
                    cancellation.isFree === null
                      ? null
                      : cancellation.isFree
                        ? cancellation.cutoffAt
                          ? `Free until ${dateTime(cancellation.cutoffAt)}`
                          : 'Free cancellation'
                        : 'Not refundable',
                },
              ]}
            />
            {ledger.data && ledger.data.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">Payments and refunds</p>
                <ul className="divide-y rounded-lg border px-3 text-sm">
                  {ledger.data.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
                      <span>
                        {entry.kind === 'REFUND' ? 'Refund' : 'Payment'} · {entry.provider.toLowerCase()} ·{' '}
                        <span className="text-muted-foreground">{dateTime(entry.createdAt)}</span>
                      </span>
                      <span className="font-medium">
                        {entry.kind === 'REFUND' ? '−' : ''}
                        {money(entry.amount, entry.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {booking.nightlyRates && booking.nightlyRates.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Nightly rates</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={booking.nightlyRates.map((night) => ({
                  label: longDate(night.date),
                  value: money(night.amount, currency),
                }))}
              />
            </CardContent>
          </Card>
        ) : null}

        {booking.clockFolios.length > 0 || booking.externalBookingId ? (
          <Card>
            <CardHeader>
              <CardTitle>Clock PMS</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  { label: 'Clock booking', value: booking.externalBookingId },
                  ...booking.clockFolios.map((folio) => ({
                    label: `${folio.isDeposit ? 'Deposit folio' : 'Folio'} ${folio.id}`,
                    value: `${folio.balance ?? '—'}${folio.closedAt ? ' · closed' : ''}`,
                  })),
                ]}
              />
            </CardContent>
          </Card>
        ) : null}

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <Timeline items={timeline} empty="No activity has been recorded for this reservation." />
          </CardContent>
        </Card>
      </div>

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
