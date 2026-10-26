'use client';
import { toast } from 'sonner';
import { MoveRoomDialog } from './move-room-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { CollectPaymentActions } from './collect-payment-actions';
import { ChangeBookingDatesDialog } from './change-booking-dates-dialog';
import { minorUnits as paymentMinor, money as decimalMoney } from './payment-status';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
import { EditBookingDetailsDialog } from './edit-booking-details-dialog';
import { CancellationDialog } from './cancellation-dialog';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowLeftRight,
  Ban,
  BedDouble,
  CalendarDays,
  CircleCheck,
  CirclePlus,
  CreditCard,
  Pencil,
  Plug,
  RefreshCw,
  Undo2,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useUnseenBookings } from './unseen-bookings';
import { BookingReviewCard } from './booking-review-card';
import { ActionBar } from '../../components/ui/action-bar';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { DetailHeader } from '../../components/ui/detail-header';
import { RowList } from '../../components/ui/row-list';
import {
  noRefund,
  RefundChoice,
  refundRequestBody,
  refundChoiceError,
  type RefundChoiceValue,
} from './refund-choice';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { ActivityFeed, type ActivityEntry } from '../../components/ui/activity-feed';
import { DetailList, Field, SectionLabel } from '../../components/ui/detail-list';
import { StatTile } from '../../components/ui/stat-tile';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import {
  BookingStatusBadge,
  PaymentStatusBadge,
  SourceBadge,
} from '../../components/ui/status-badge';
import {
  balanceDue,
  bookingWasNotCreated,
  NO_BOOKING_BALANCE,
  bookingStatusDisplay,
  nightsBetween,
  paymentDisplay,
  sourceDisplay,
} from '../../lib/reservation-display';

type Detail = {
  cancellationPending?: boolean;
  detailsManagedInClock?: boolean;
  maxOccupancy: number;
  estimatedArrivalTime: string | null;
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
  childrenAges?: number[] | null;
  specialRequests: string | null;
  roomName: string | null;
  roomTypeId?: string;
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
  promo?: {
    code: string;
    discount: { amount: string; currency: string };
    originalTotal: { amount: string; currency: string };
  } | null;
  cancellation: { isFree: boolean | null; freeUntilHours: number | null; cutoffAt: string | null };
  guestAddress: {
    street: string | null;
    line2: string | null;
    city: string | null;
    county: string | null;
    postcode: string | null;
  };
  clockFolios: Array<{
    id: string;
    isDeposit: boolean;
    balance: string | null;
    closedAt: string | null;
  }>;
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
  'booking.dates_amended': 'Reservation dates changed',
  'booking.details_edited': 'Reservation details edited',
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

function activityIcon(action: string): { icon: LucideIcon; tone: ActivityEntry['tone'] } {
  if (action.includes('cancel')) return { icon: Ban, tone: 'danger' };
  if (action.includes('refund')) return { icon: Undo2, tone: 'danger' };
  if (action.startsWith('payment') || action.includes('deposit'))
    return { icon: Wallet, tone: 'success' };
  if (action.includes('clock')) return { icon: RefreshCw, tone: 'info' };
  if (action.includes('created')) return { icon: CirclePlus, tone: 'default' };
  return { icon: CircleCheck, tone: 'default' };
}

function activityDetail(details: Record<string, unknown>) {
  const parts: string[] = [];
  if (details.changes && typeof details.changes === 'object') {
    const labels: Record<string, string> = {
      firstName: 'First name',
      lastName: 'Last name',
      email: 'Email',
      phone: 'Phone',
      specialRequests: 'Notes',
      estimatedArrivalTime: 'Estimated arrival',
      adults: 'Adults',
      children: 'Children',
      startsOn: 'Check-in date',
      endsOn: 'Check-out date',
      total: 'Total',
    };
    for (const [key, value] of Object.entries(details.changes)) {
      const change = value as { old?: unknown; new?: unknown };
      parts.push(`${labels[key] ?? key}: ${change.old ?? '(empty)'} -> ${change.new ?? '(empty)'}`);
    }
  }
  const amount = details.amount as { amount?: string; currency?: string } | string | undefined;
  if (typeof amount === 'string') parts.push(amount);
  else if (amount?.amount) parts.push(`${amount.amount} ${amount.currency ?? ''}`.trim());
  for (const key of ['reason', 'note', 'reference'] as const)
    if (typeof details[key] === 'string') parts.push(details[key] as string);
  return parts.join(' · ');
}

// Shown when the hotel has not set its own check-in and check-out times in Settings.
const DEFAULT_CHECK_IN = '15:00';
const DEFAULT_CHECK_OUT = '11:00';

/** Ids of the reservations on the list page the user came from, for the previous / next arrows. */
export const NEIGHBOURS_KEY = 'must.reservations.neighbours';

function readNeighbours(): string[] {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(NEIGHBOURS_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

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
  checkInTime,
  checkOutTime,
  canCancelBooking = false,
  canRefundPayment = false,
  canEditBooking = false,
}: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
  propertyName?: string;
  bookingMode?: string;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  canCancelBooking?: boolean;
  canRefundPayment?: boolean;
  canEditBooking?: boolean;
}) {
  const CHECK_IN = /^\d{2}:\d{2}/.test(checkInTime ?? '')
    ? checkInTime!.slice(0, 5)
    : DEFAULT_CHECK_IN;
  const CHECK_OUT = /^\d{2}:\d{2}/.test(checkOutTime ?? '')
    ? checkOutTime!.slice(0, 5)
    : DEFAULT_CHECK_OUT;
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [movingRoom, setMovingRoom] = useState(false);
  const [providerReview, setProviderReview] = useState(false);
  const [changingDates, setChangingDates] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const unseen = useUnseenBookings(tenantId, propertyId);
  const wasNew = unseen.ids.has(bookingId);
  // Opening a reservation clears its "new" dot and lowers the count on the Bookings item.
  useEffect(() => {
    if (wasNew) unseen.markSeen(bookingId);
  }, [wasNew, bookingId]);
  const [refunding, setRefunding] = useState(false);
  const refundAttempt = useRef({ body: '', key: '' });
  const [refundOnlyPick, setRefundOnlyPick] = useState<RefundChoiceValue>({
    ...noRefund,
    mode: 'full',
  });

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
    status: booking.status,
    total: booking.total.amount,
    paid: booking.paidAmount,
    refunded: booking.refundedAmount,
  });
  const guest =
    [booking.guestFirstName, booking.guestLastName].filter(Boolean).join(' ') || 'Unknown guest';
  const address = [
    booking.guestAddress.street,
    booking.guestAddress.line2,
    booking.guestAddress.city,
    booking.guestAddress.county,
    booking.guestAddress.postcode,
  ]
    .filter(Boolean)
    .join(', ');
  const cancellation = booking.cancellation;
  const canCancel =
    !booking.cancellationPending &&
    ['PAYMENT_PENDING', 'PMS_CONFIRMATION_PENDING', 'CONFIRMED'].includes(booking.status);
  const neighbours = readNeighbours();
  const at = neighbours.indexOf(booking.id);
  const pageHref = (id: string) =>
    href(tenantId, propertyId, `section=reservations&reservation=${id}`);
  const pager =
    at >= 0
      ? {
          position: at + 1,
          total: neighbours.length,
          previousHref: at > 0 ? pageHref(neighbours[at - 1]!) : undefined,
          nextHref: at < neighbours.length - 1 ? pageHref(neighbours[at + 1]!) : undefined,
        }
      : undefined;
  const feed: ActivityEntry[] = booking.activity.map((event, index) => ({
    key: `${event.action}-${event.createdAt}-${index}`,
    title: activityLabel(event.action),
    detail: activityDetail(event.details) || undefined,
    at: event.createdAt,
    actor: event.actorEmail,
    ...activityIcon(event.action),
  }));

  // Money still refundable: offer a refund, and start from "full" when the guest cancels for free.
  const refundable = Number(booking.paidAmount) - Number(booking.refundedAmount) > 0;
  // A cancelled reservation can be refunded from here for 24 hours after it was cancelled.
  const cancelledEvent = booking.activity.find((event) => event.action === 'booking.cancelled');
  const refundWindowClosed =
    booking.status === 'CANCELLED' &&
    cancelledEvent !== undefined &&
    Date.now() - new Date(cancelledEvent.createdAt).getTime() > 24 * 60 * 60 * 1000;
  const canRefundHere =
    canRefundPayment && refundable && !refundWindowClosed && booking.status !== 'EXPIRED';

  const refundOnly = async (note: string) => {
    const body = refundRequestBody(refundOnlyPick, booking);
    if (!body) throw new Error('Choose how much to refund.');
    const payload = JSON.stringify({ bookingId: booking.id, ...body, note: note.slice(0, 500) });
    if (refundAttempt.current.body !== payload)
      refundAttempt.current = { body: payload, key: crypto.randomUUID() };
    const response = await fetch(`${base}/payments/refunds`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': refundAttempt.current.key },
      body: payload,
    });
    const result = (await response.json().catch(() => null)) as {
      ok?: boolean;
      value?: { status?: string };
      error?: { message?: string };
      message?: string;
    } | null;
    if (!response.ok || result?.ok === false)
      throw new Error(result?.error?.message ?? result?.message ?? 'The refund could not be made.');
    if (result?.value?.status === 'REFUND_PENDING')
      toast.info('Refund submitted. Provider confirmation is pending; review it before retrying.');
    else refundAttempt.current = { body: '', key: '' };
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const hasClock = booking.clockFolios.length > 0 || !!booking.externalBookingId;
  const firstCharge = ledger.data?.find((entry) => entry.kind === 'CHARGE');
  const received = Number(booking.paidAmount) - Number(booking.refundedAmount);
  const amendmentRefundDue =
    paymentMinor(booking.paidAmount) -
    paymentMinor(booking.refundedAmount) -
    paymentMinor(booking.total.amount);
  const lastClock = booking.activity.find((event) => event.action.startsWith('booking.clock'));
  const methodLabel = booking.paymentMethod.toLowerCase().replaceAll('_', ' ');
  const methodTitle = methodLabel.charAt(0).toUpperCase() + methodLabel.slice(1);
  const statusLabel = booking.cancellationPending
    ? 'Cancellation requested'
    : bookingStatusDisplay(booking.status).label;
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
  const sourceText = sourceDisplay(booking.source);
  const field = (label: string, value: ReactNode) => <Field label={label} value={value} />;

  return (
    <div className="space-y-4">
      <DetailHeader
        backHref={href(tenantId, propertyId, 'section=reservations')}
        backLabel="Back to reservations"
        reference={booking.externalReference}
        title={guest}
        subtitle={`${statusLabel} reservation${sourceText ? ` · Created from ${sourceText.toLowerCase()}` : ''} · ${dateTime(booking.createdAt)}`}
        pager={pager}
        badges={
          <>
            {booking.cancellationPending ? (
              <Badge variant="warning">Cancellation requested</Badge>
            ) : (
              <BookingStatusBadge status={booking.status} />
            )}
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
          </>
        }
        actions={
          <>
            {canEditBooking ? (
              <Button onClick={() => setEditingDetails(true)}>
                <Pencil aria-hidden="true" /> Edit details
              </Button>
            ) : null}
            {canEditBooking ? (
              <Button variant="outline" onClick={() => setChangingDates(true)}>
                <CalendarDays aria-hidden="true" /> Change dates
              </Button>
            ) : null}
            {canRefundPayment && refundable ? (
              <Button
                variant="outline"
                disabled={!canRefundHere}
                title={
                  canRefundHere
                    ? undefined
                    : 'A cancelled reservation can only be refunded for 24 hours after it was cancelled.'
                }
                onClick={() => setRefunding(true)}
              >
                <Undo2 aria-hidden="true" /> Refund
              </Button>
            ) : null}
            {canCancel ? (
              <Button variant="destructive" onClick={() => setCancelling(true)}>
                <Ban aria-hidden="true" />{' '}
                {canCancelBooking ? 'Cancel reservation' : 'Request cancellation'}
              </Button>
            ) : null}
          </>
        }
      />
      <CollectPaymentActions tenantId={tenantId} propertyId={propertyId} booking={booking} />
      {editingDetails ? (
        <EditBookingDetailsDialog
          tenantId={tenantId}
          propertyId={propertyId}
          bookingId={booking.id}
          version={booking.version}
          initial={{
            firstName: booking.guestFirstName ?? '',
            lastName: booking.guestLastName ?? '',
            email: booking.guestEmail ?? '',
            phone: booking.guestPhone ?? '',
            specialRequests: booking.specialRequests ?? '',
            estimatedArrivalTime: booking.estimatedArrivalTime ?? '',
            adults: booking.adults,
            children: booking.children,
          }}
          maxOccupancy={booking.maxOccupancy}
          managedInClock={booking.detailsManagedInClock ?? !!booking.externalBookingId}
          onClose={() => setEditingDetails(false)}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          }}
        />
      ) : null}
      {movingRoom ? (
        <MoveRoomDialog
          tenantId={tenantId}
          propertyId={propertyId}
          bookingId={bookingId}
          onClose={() => setMovingRoom(false)}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          }}
        />
      ) : null}
      <Dialog open={providerReview} onOpenChange={setProviderReview}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Provider review</DialogTitle>
            <DialogDescription>
              Review the Clock link and any synchronization issues for this reservation.
            </DialogDescription>
          </DialogHeader>
          <DetailList
            items={[
              { label: 'Clock reservation', value: booking.externalBookingId || 'Not linked' },
              { label: 'Booking status', value: bookingStatusDisplay(booking.status).label },
            ]}
          />
          <BookingReviewCard
            tenantId={tenantId}
            propertyId={propertyId}
            bookingId={bookingId}
            canRunCheck={canEditBooking}
            alwaysShow
          />
        </DialogContent>
      </Dialog>
      {changingDates ? (
        <ChangeBookingDatesDialog
          tenantId={tenantId}
          propertyId={propertyId}
          bookingId={booking.id}
          startsOn={booking.startsOn}
          endsOn={booking.endsOn}
          managedInClock={booking.detailsManagedInClock ?? !!booking.externalBookingId}
          roomTypeId={booking.roomTypeId}
          roomTypeName={booking.roomTypeName}
          onReviewRefund={
            canRefundHere
              ? (amount) => {
                  setRefundOnlyPick({ mode: 'fixed', percentage: '', amount });
                  setRefunding(true);
                }
              : undefined
          }
          onCollectPayment={() =>
            document
              .getElementById('booking-collection')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
          onClose={() => setChangingDates(false)}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          }}
        />
      ) : null}
      {amendmentRefundDue > 0n ? (
        <Alert variant="warning">
          <AlertTitle>Refund due</AlertTitle>
          <AlertDescription>
            {booking.total.currency} {decimalMoney(amendmentRefundDue)} is owed to the guest.{' '}
            {canRefundPayment
              ? 'Use Refund to issue it separately.'
              : 'Ask someone with refund permission to issue it.'}{' '}
            No refund has been issued automatically.
          </AlertDescription>
        </Alert>
      ) : null}
      <BookingReviewCard
        tenantId={tenantId}
        propertyId={propertyId}
        bookingId={bookingId}
        canRunCheck={canEditBooking}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          size="sm"
          label="Stay"
          icon={CalendarDays}
          value={`${longDate(booking.startsOn)} – ${longDate(booking.endsOn)}`}
          note={`${nights} night${nights === 1 ? '' : 's'} · Check-in from ${CHECK_IN}`}
        />
        <StatTile
          size="sm"
          label="Accommodation"
          icon={BedDouble}
          value={propertyName ?? booking.roomTypeName}
          note={`${booking.roomTypeName} · ${booking.roomName ?? 'Room not assigned'}`}
        />
        <StatTile
          size="sm"
          label="Guests"
          icon={Users}
          value={`${booking.adults} adult${booking.adults === 1 ? '' : 's'}${booking.children ? ` · ${booking.children} child${booking.children === 1 ? '' : 'ren'}${booking.childrenAges?.length ? ` (ages ${booking.childrenAges.join(', ')})` : ''}` : ''}`}
          note={`Primary guest: ${guest}`}
        />
        <StatTile
          size="sm"
          label="Total & payment"
          icon={CreditCard}
          value={money(booking.total.amount, currency)}
          note={`${methodTitle} · ${paymentLabel}`}
        />
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
                  (booking.detailsManagedInClock ?? !!booking.externalBookingId)
                    ? 'Cancellation terms are managed in Clock'
                    : cancellation.isFree === null
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
              {booking.estimatedArrivalTime
                ? field('Estimated arrival (hotel local time)', booking.estimatedArrivalTime)
                : null}
              {booking.specialRequests ? (
                <div className="rounded-lg border p-3 text-sm">
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">
                    Special requests
                  </p>
                  {booking.specialRequests}
                </div>
              ) : null}
              <ActionBar>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!canEditBooking || booking.status !== 'CONFIRMED'}
                  onClick={() => setMovingRoom(true)}
                >
                  <ArrowLeftRight aria-hidden="true" /> Move room
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!hasClock}
                  onClick={() => setProviderReview(true)}
                >
                  <Plug aria-hidden="true" /> Provider review
                </Button>
              </ActionBar>
            </CardContent>
          </Card>

          {booking.promo ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Promo code</CardTitle>
              </CardHeader>
              <CardContent>
                <DetailList
                  items={[
                    { label: 'Code', value: booking.promo.code },
                    {
                      label: 'Price before the code',
                      value: money(booking.promo.originalTotal.amount, currency),
                    },
                    {
                      label: 'Discount',
                      value: `-${money(booking.promo.discount.amount, currency)}`,
                    },
                    { label: 'Guest pays', value: money(booking.total.amount, currency) },
                  ]}
                />
                <p className="m-0 mt-3 text-xs text-muted-foreground">
                  Clock keeps the price before the code and shows this explanation in the
                  reservation note.
                </p>
              </CardContent>
            </Card>
          ) : null}

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
                <SectionLabel>Payment</SectionLabel>
                <PaymentStatusBadge
                  status={booking.status}
                  paymentMethod={booking.paymentMethod}
                  total={booking.total.amount}
                  paid={booking.paidAmount}
                  refunded={booking.refundedAmount}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                {field(
                  firstCharge
                    ? `${firstCharge.provider === 'pokpay' ? 'PokPay' : firstCharge.provider === 'stripe' ? 'Card' : 'Recorded payment'} transaction`
                    : 'Payment transaction',
                  firstCharge?.externalPaymentId ?? 'No online payment',
                )}
                {field('Amount received', money(String(received), currency))}
                {field(
                  'Balance due',
                  bookingWasNotCreated(booking.status)
                    ? NO_BOOKING_BALANCE
                    : money(String(due), currency),
                )}
                {Number(booking.refundedAmount) > 0
                  ? field('Refunded', money(booking.refundedAmount, currency))
                  : null}
              </div>
              {ledger.data && ledger.data.length > 0 ? (
                <RowList
                  items={ledger.data.map((entry) => ({
                    key: entry.id,
                    label: (
                      <>
                        {entry.kind === 'REFUND' ? 'Refund' : 'Payment'} ·{' '}
                        <span className="text-muted-foreground">{dateTime(entry.createdAt)}</span>
                      </>
                    ),
                    value: `${entry.kind === 'REFUND' ? '−' : ''}${money(entry.amount, entry.currency)}`,
                  }))}
                />
              ) : null}
            </section>

            {hasClock ? (
              <section className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between">
                  <SectionLabel>Clock Pms</SectionLabel>
                  <Badge
                    variant="info"
                    className="rounded-full px-2 py-0 text-[10px] font-semibold"
                  >
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
              <SectionLabel
                action={
                  booking.activity.length > 5 ? (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => setShowAllActivity((value) => !value)}
                    >
                      {showAllActivity ? 'Show less' : `Show all ${booking.activity.length}`}
                    </Button>
                  ) : null
                }
              >
                Latest activity
              </SectionLabel>
              <ActivityFeed
                entries={showAllActivity ? feed : feed.slice(0, 5)}
                empty="No activity has been recorded for this reservation."
              />
            </section>

            <ActionBar>
              <Button variant="ghost" size="sm" asChild>
                <a href={href(tenantId, propertyId, `section=payments&payment=${booking.id}`)}>
                  <CreditCard aria-hidden="true" /> Open payment
                </a>
              </Button>
              {booking.guestId ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={href(tenantId, propertyId, `section=guests&guest=${booking.guestId}`)}>
                    Open guest
                  </a>
                </Button>
              ) : null}
            </ActionBar>
          </CardContent>
        </Card>
      </div>

      {booking.cancellationPending ? (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
          Cancellation requested: this reservation is still active until the request is approved.{' '}
          <a
            className="font-semibold underline"
            href={href(tenantId, propertyId, 'section=overview&tab=approvals')}
          >
            Review cancellation request
          </a>
        </div>
      ) : null}
      <CancellationDialog
        tenantId={tenantId}
        propertyId={propertyId}
        bookingId={booking.id}
        open={cancelling}
        onOpenChange={setCancelling}
        canCancel={canCancelBooking}
        canRefund={canRefundPayment}
      />

      <ConfirmDialog
        open={canRefundPayment && refunding}
        onOpenChange={setRefunding}
        title={`Refund ${booking.externalReference}`}
        description={`${guest}. Review the amount and original payment method before confirming. The stay remains booked.`}
        confirmLabel="Make refund"
        reasonLabel="Note"
        confirmDisabled={!!refundChoiceError(refundOnlyPick, booking)}
        onConfirm={refundOnly}
      >
        {canCancelBooking && booking.status === 'CONFIRMED' ? (
          <Button
            variant="outline"
            className="w-fit"
            onClick={() => {
              setRefunding(false);
              setCancelling(true);
            }}
          >
            Also cancel booking
          </Button>
        ) : null}
        <RefundChoice
          booking={booking}
          heading="How much"
          allowNone={false}
          value={refundOnlyPick}
          onChange={setRefundOnlyPick}
          policyNote={
            booking.status === 'CANCELLED'
              ? 'This reservation is cancelled, so it can be refunded from here for 24 hours after it was cancelled.'
              : 'The reservation stays as it is. You can refund again later, up to what was paid.'
          }
        />
      </ConfirmDialog>
    </div>
  );
}
