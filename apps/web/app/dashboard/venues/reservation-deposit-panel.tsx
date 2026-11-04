'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { CheckoutLinkActions } from '../checkout-link-actions';
import { reservationApi, type Reservation } from './reservation-api';
import { useVenueStaff } from './venue-access';

export function ReservationDepositPanel({
  tenantId,
  venueId,
  reservation: r,
}: {
  tenantId: string;
  venueId: string;
  reservation: Reservation;
}) {
  const client = useQueryClient();
  const manager = useVenueStaff(tenantId, venueId).isSuccess;
  const refund = useMutation({
    mutationFn: () => reservationApi.refund(tenantId, venueId, r.id),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ['venue-reservation', tenantId, venueId, r.id] }),
  });
  if (!r.depositTerms || r.depositTerms.amount === '0.00') return null;
  const live =
    r.status === 'pending_payment' &&
    !!r.paymentHoldExpiresAt &&
    Date.parse(r.paymentHoldExpiresAt) > Date.now();
  return (
    <section className="space-y-3 rounded-xl border p-4" aria-label="Booking deposit">
      <p className="font-medium">
        Deposit: {r.depositTerms.amount} {r.depositTerms.currency}
      </p>
      <p className="text-sm">
        Paid balance: {r.paidDeposit ?? '0.00'} {r.depositTerms.currency}. Deduct the paid balance
        from the final bill.
      </p>
      <p className="text-sm text-muted-foreground">
        Free cancellation until {r.depositTerms.freeCancelHours} hours before the booking.
      </p>
      {r.checkout?.state === 'UNCERTAIN' || r.checkout?.state === 'PREPARING' ? (
        <Alert variant="warning">
          <AlertDescription>
            The checkout result is uncertain. Review the payment before trying another charge.
          </AlertDescription>
        </Alert>
      ) : null}
      {r.refundState === 'UNCERTAIN' || r.refundState === 'PREPARING' ? (
        <Alert variant="warning">
          <AlertDescription>
            The refund needs payment review. Do not issue another refund until its result is
            verified.
          </AlertDescription>
        </Alert>
      ) : null}
      {r.requiresRefundReview ? (
        <Alert variant="warning">
          <AlertDescription>
            A payment arrived after the hold ended. The table has not been restored. Review the
            refund.
          </AlertDescription>
        </Alert>
      ) : null}
      {live && r.checkout?.state === 'READY' && r.checkout.url ? (
        <CheckoutLinkActions
          url={r.checkout.url}
          tenantId={tenantId}
          propertyId=""
          bookingId={r.id}
          canSend={!!r.guestEmail}
          sendPaymentLink={() => reservationApi.sendPaymentLink(tenantId, venueId, r.id)}
        />
      ) : null}
      {manager && r.requiresRefundReview && !r.refundState ? (
        <Button variant="outline" disabled={refund.isPending} onClick={() => refund.mutate()}>
          Refund late payment
        </Button>
      ) : null}
      {refund.data ? (
        <p role="status">Refund: {refund.data.state.toLowerCase().replace('_', ' ')}</p>
      ) : null}
      {refund.error ? <p role="alert">{refund.error.message}</p> : null}
    </section>
  );
}
