'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, CircleAlert, CircleCheck, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { BookingStatusBadge } from '../../components/ui/status-badge';
import { bookingStatusDisplay } from '../../lib/reservation-display';

const POLL_STATUS_MS = 3_000;
const POLL_PAYMENT_MS = 6_000;

/**
 * Shown after a card-payment reservation is created. The reservation stays unconfirmed until the
 * payment provider itself says it was paid: this panel never trusts the guest's browser. It
 * watches the reservation, asks the server to re-read the provider's order every few seconds,
 * and only shows "confirmed" once the reservation really is.
 */
export function AwaitingPayment({
  tenantId,
  propertyId,
  bookingId,
  reference,
  checkoutUrl,
  providerName,
  reservationHref,
  canCheckPayment = true,
  canViewBooking = true,
  onStartOver,
}: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
  reference: string;
  checkoutUrl?: string;
  providerName: string;
  reservationHref: string;
  canCheckPayment?: boolean;
  canViewBooking?: boolean;
  onStartOver: () => void;
}) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const [waited, setWaited] = useState(0);

  const status = useQuery({
    queryKey: ['dashboard', 'awaiting-payment', tenantId, propertyId, bookingId],
    enabled: canViewBooking,
    queryFn: async (): Promise<string> => {
      const response = await fetch(`${base}/bookings/${bookingId}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Could not read the reservation.');
      return ((await response.json()) as { status: string }).status;
    },
    refetchInterval: (query) => (query.state.data === 'PAYMENT_PENDING' || !query.state.data ? POLL_STATUS_MS : false),
  });
  const current = status.data;
  const pending = current === undefined || current === 'PAYMENT_PENDING';

  const check = useMutation({
    mutationFn: async () => {
      await fetch(`${base}/bookings/${bookingId}/check-payment`, { method: 'POST', credentials: 'include' });
      await status.refetch();
    },
  });

  // The payment tab tells this one when the guest comes back from paying: check straight away.
  useEffect(() => {
    if (!pending || !canCheckPayment || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('must-payment');
    channel.onmessage = (event: MessageEvent<{ bookingId?: string }>) => {
      if (event.data?.bookingId === bookingId) {
        check.mutate();
        window.focus();
      }
    };
    return () => channel.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, bookingId]);

  useEffect(() => {
    if (!pending || !canCheckPayment) return;
    const clock = window.setInterval(() => setWaited((seconds) => seconds + 1), 1_000);
    const sweep = window.setInterval(() => check.mutate(), POLL_PAYMENT_MS);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(sweep);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  if (current === 'CONFIRMED')
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-success-surface text-success">
            <CircleCheck aria-hidden="true" className="size-6" />
          </span>
          <h3 className="m-0 text-xl font-extrabold">Payment received</h3>
          <p className="m-0 max-w-md text-sm text-muted-foreground">
            {providerName} confirmed the payment, so reservation {reference} is now confirmed.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <a href={reservationHref}>
                Open reservation <ArrowRight aria-hidden="true" />
              </a>
            </Button>
            <Button variant="outline" onClick={onStartOver}>
              Add another
            </Button>
          </div>
        </CardContent>
      </Card>
    );

  if (!pending)
    return (
      <Card>
        <CardContent className="space-y-4 py-8">
          <Alert variant="destructive">
            <AlertTitle className="flex items-center gap-2">
              <CircleAlert aria-hidden="true" /> The payment did not complete
            </AlertTitle>
            <AlertDescription>
              Reservation {reference} is now <BookingStatusBadge status={current!} /> ({bookingStatusDisplay(current!).label}).
              No room is held for it. Open the reservation to decide what to do, or start a new one.
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={reservationHref}>Open reservation</a>
            </Button>
            <Button variant="outline" onClick={onStartOver}>
              Start a new reservation
            </Button>
          </div>
        </CardContent>
      </Card>
    );

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-info-surface text-info">
          <Loader2 aria-hidden="true" className="size-6 animate-spin" />
        </span>
        <h3 className="m-0 text-xl font-extrabold">Waiting for the payment</h3>
        <p className="m-0 max-w-md text-sm text-muted-foreground">
          Reservation {reference} is held but not confirmed. Complete the payment in the {providerName} window. It
          confirms by itself as soon as {providerName} reports the payment as paid. Do not close this page.
          {!canViewBooking ? ' Your role cannot view the payment status for this reservation.' : ''}
        </p>
        <p aria-live="polite" className="m-0 text-xs text-muted-foreground">
          Waiting {Math.floor(waited / 60)}:{String(waited % 60).padStart(2, '0')}
          {waited > 600 ? ' · The hold may expire soon; if the guest has not paid, start again.' : ''}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {checkoutUrl ? (
            <Button
              variant="outline"
              onClick={() => {
                const reopened = window.open(checkoutUrl, '_blank');
                if (reopened) reopened.opener = null;
              }}
            >
              Reopen payment window <ExternalLink aria-hidden="true" />
            </Button>
          ) : null}
          {canCheckPayment ? (
            <Button variant="outline" onClick={() => check.mutate()} loading={check.isPending}>
              <RefreshCw aria-hidden="true" /> Check payment now
            </Button>
          ) : null}
          {canViewBooking ? (
            <Button variant="ghost" asChild>
              <a href={reservationHref}>Open reservation</a>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
