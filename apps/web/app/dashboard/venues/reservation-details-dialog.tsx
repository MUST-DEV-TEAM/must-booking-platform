'use client';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Badge } from '../../../components/ui/badge';
import { reservationApi } from './reservation-api';
import {
  SOURCE_OPTIONS,
  STATUS_DISPLAY,
  timeInZone,
  dayLabel,
  dayOfInstant,
} from './reservation-display';
import { ReservationStatusActions } from './reservation-status-actions';
import { ReservationDepositPanel } from './reservation-deposit-panel';
export function ReservationDetailsDialog({
  tenantId,
  venueId,
  id,
  timezone,
  canManage,
  onOpenChange,
}: {
  tenantId: string;
  venueId: string;
  id: string;
  timezone: string;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const query = useQuery({
    queryKey: ['venue-reservation', tenantId, venueId, id],
    queryFn: () => reservationApi.get(tenantId, venueId, id),
  });
  const r = query.data;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogTitle>{r?.guestName ?? 'Booking details'}</DialogTitle>
        <DialogDescription>
          {r
            ? `${r.reference} - ${dayLabel(dayOfInstant(r.startsAt, timezone))}, ${timeInZone(r.startsAt, timezone)}-${timeInZone(r.endsAt, timezone)}`
            : 'Loading booking...'}
        </DialogDescription>
        {query.error ? (
          <Alert variant="destructive">
            <AlertDescription>{query.error.message}</AlertDescription>
          </Alert>
        ) : null}
        {r ? (
          <>
            <Badge variant={STATUS_DISPLAY[r.status].tone}>{STATUS_DISPLAY[r.status].label}</Badge>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['Guests', r.partySize],
                ['Tables', r.tables.map((t) => `${t.areaName}: ${t.label}`).join(', ')],
                ['Phone', r.guestPhone || 'Not provided'],
                ['Email', r.guestEmail || 'Not provided'],
                [
                  'Booked through',
                  SOURCE_OPTIONS.find((s) => s.value === r.source)?.label ?? r.source,
                ],
                ['Notes', r.notes || 'None'],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-words font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <ReservationDepositPanel tenantId={tenantId} venueId={venueId} reservation={r} />
            {canManage ? (
              <ReservationStatusActions
                tenantId={tenantId}
                venueId={venueId}
                reservation={r}
                timezone={timezone}
              />
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
