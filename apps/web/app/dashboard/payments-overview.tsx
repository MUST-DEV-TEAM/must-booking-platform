'use client';

import { Badge } from '../../components/ui/badge';
import { ListCard, ListRow } from '../../components/ui/list-card';
import { bookingStatusDisplay } from '../../lib/reservation-display';
import { paymentHref } from './payment-detail';
import {
  PAYMENT_BADGE_TONE,
  isDead,
  needsAction,
  outstandingAmount,
  paymentStatus,
  minorUnits,
} from './payment-status';
import { guestName, type Reservation } from './reservations';

const SHOWN = 5;

const money = (amount: string, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount));

/** Why a booking is on the attention list, in words staff can act on. */
function attentionReason(booking: Reservation): string {
  if (isDead(booking) && minorUnits(booking.paidAmount) > minorUnits(booking.refundedAmount))
    return `${bookingStatusDisplay(booking.status).label} · money is still held and can be refunded`;
  return `${bookingStatusDisplay(booking.status).label} · needs a look`;
}

/**
 * The landing view of Payments: what needs action, what is still owed and what happened lately,
 * as short lists that open the payment. Built only from the booking totals the ledger already uses;
 * provider evidence and reconciliation are not shown until they exist.
 */
export function PaymentsOverview({
  bookings,
  tenantId,
  propertyId,
}: {
  bookings: Reservation[];
  tenantId: string;
  propertyId: string;
}) {
  const href = (booking: Reservation) => paymentHref(tenantId, propertyId, booking.id);
  const row = (booking: Reservation, subtitle: string, trailing: string) => (
    <ListRow
      key={booking.id}
      href={href(booking)}
      title={`${guestName(booking)} · ${booking.externalReference ?? ''}`}
      subtitle={subtitle}
      trailing={trailing}
    />
  );
  const attention = bookings.filter((booking) => needsAction(booking));
  const owed = bookings.filter(
    (booking) => !isDead(booking) && minorUnits(outstandingAmount(booking)) > 0n,
  );
  const paid = bookings.filter(
    (booking) => minorUnits(booking.paidAmount) > 0n && !isDead(booking),
  );
  const refunded = bookings.filter((booking) => minorUnits(booking.refundedAmount) > 0n);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <ListCard
        title="Needs action"
        count={attention.length}
        description="Money held for cancelled bookings, failed payments and bookings stuck in review."
        empty="Nothing needs action right now."
      >
        {attention
          .slice(0, SHOWN)
          .map((booking) =>
            row(
              booking,
              attentionReason(booking),
              money(
                String(Number(booking.paidAmount) - Number(booking.refundedAmount)),
                booking.total.currency,
              ),
            ),
          )}
      </ListCard>
      <ListCard
        title="Still owed"
        count={owed.length}
        description="Bookings with an unpaid balance, online or at the hotel."
        empty="Every live booking is settled."
      >
        {owed.slice(0, SHOWN).map((booking) => {
          const status = paymentStatus(booking);
          return (
            <ListRow
              key={booking.id}
              href={href(booking)}
              title={`${guestName(booking)} · ${booking.externalReference ?? ''}`}
              subtitle={`${booking.startsOn ?? ''} – ${booking.endsOn ?? ''}`}
              trailing={
                <span className="flex items-center gap-2">
                  <Badge
                    variant={PAYMENT_BADGE_TONE[status.state]}
                    className="rounded-full px-2 py-0 text-[10px]"
                  >
                    {status.label}
                  </Badge>
                  <span className="font-semibold text-foreground">
                    {money(outstandingAmount(booking), booking.total.currency)}
                  </span>
                </span>
              }
            />
          );
        })}
      </ListCard>
      <ListCard title="Recently paid" count={paid.length} empty="No payments yet.">
        {paid
          .slice(0, SHOWN)
          .map((booking) =>
            row(
              booking,
              paymentStatus(booking).label,
              money(booking.paidAmount, booking.total.currency),
            ),
          )}
      </ListCard>
      <ListCard title="Recent refunds" count={refunded.length} empty="No refunds yet.">
        {refunded
          .slice(0, SHOWN)
          .map((booking) =>
            row(
              booking,
              paymentStatus(booking).label,
              money(booking.refundedAmount, booking.total.currency),
            ),
          )}
      </ListCard>
    </div>
  );
}
