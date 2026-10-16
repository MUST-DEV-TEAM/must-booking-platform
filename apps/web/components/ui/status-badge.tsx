import {
  bookingStatusDisplay,
  paymentDisplay,
  sourceDisplay,
  type PaymentInput,
} from '../../lib/reservation-display';
import { cn } from '../../lib/utils';
import { Badge } from './badge';

/** Small pill used in tables; the size matches the data-table reference design. */
const pill = 'max-w-full truncate rounded-full px-2 py-0 text-[10px] font-semibold';

/** Booking state badge, from the shared definitions in lib/reservation-display. */
export function BookingStatusBadge({ status, className }: { status: string; className?: string }) {
  const { label, tone } = bookingStatusDisplay(status);
  return (
    <Badge variant={tone} title={label} className={cn(pill, className)}>
      {label}
    </Badge>
  );
}

/** Payment state badge derived from the booking's totals. */
export function PaymentStatusBadge({ className, ...props }: PaymentInput & { className?: string }) {
  const { label, tone } = paymentDisplay(props);
  return (
    <Badge variant={tone} title={label} className={cn(pill, className)}>
      {label}
    </Badge>
  );
}

/** Where a booking came from; shows nothing for bookings made before the source was recorded. */
export function SourceBadge({
  source,
  className,
}: {
  source: string | null | undefined;
  className?: string;
}) {
  const label = sourceDisplay(source);
  return label ? (
    <Badge variant="outline" className={cn(pill, className)}>
      {label}
    </Badge>
  ) : null;
}
