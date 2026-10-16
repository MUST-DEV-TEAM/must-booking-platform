import {
  bookingStatusDisplay,
  paymentDisplay,
  sourceDisplay,
  type PaymentInput,
} from '../../lib/reservation-display';
import { Badge } from './badge';

/** Booking state badge, from the shared definitions in lib/reservation-display. */
export function BookingStatusBadge({ status }: { status: string }) {
  const { label, tone } = bookingStatusDisplay(status);
  return <Badge variant={tone}>{label}</Badge>;
}

/** Payment state badge derived from the booking's totals. */
export function PaymentStatusBadge(props: PaymentInput) {
  const { label, tone } = paymentDisplay(props);
  return <Badge variant={tone}>{label}</Badge>;
}

/** Where a booking came from; shows nothing for bookings made before the source was recorded. */
export function SourceBadge({ source }: { source: string | null | undefined }) {
  const label = sourceDisplay(source);
  return label ? <Badge variant="outline">{label}</Badge> : null;
}
