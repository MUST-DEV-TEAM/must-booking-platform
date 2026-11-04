'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/ui/button';
import { ConfirmDialog } from '../../../components/ui/confirm-dialog';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { reservationApi, type Reservation, type SettableStatus } from './reservation-api';
import { nextActions, timeInZone } from './reservation-display';
export function ReservationStatusActions({
  tenantId,
  venueId,
  reservation,
  timezone,
}: {
  tenantId: string;
  venueId: string;
  reservation: Reservation;
  timezone: string;
}) {
  const client = useQueryClient();
  const [asking, setAsking] = useState<SettableStatus | null>(null);
  const change = useMutation({
    mutationFn: (status: SettableStatus) =>
      reservationApi.setStatus(tenantId, venueId, reservation.id, status),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['venue-reservations', tenantId, venueId] });
      await client.invalidateQueries({ queryKey: ['venue-floor', tenantId, venueId] });
      await client.invalidateQueries({
        queryKey: ['venue-reservation', tenantId, venueId, reservation.id],
      });
    },
  });
  return (
    <div onClick={(e) => e.stopPropagation()} className="space-y-2">
      {change.error ? (
        <Alert variant="destructive">
          <AlertDescription>{change.error.message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {nextActions(
          reservation.status,
          !!reservation.depositTerms && reservation.depositTerms.amount !== '0.00',
        ).map((action) => (
          <Button
            key={action.status}
            size="sm"
            variant={action.destructive ? 'outline' : 'default'}
            disabled={change.isPending}
            onClick={() =>
              action.destructive ? setAsking(action.status) : change.mutate(action.status)
            }
          >
            {action.label}
          </Button>
        ))}
      </div>
      {asking ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setAsking(null);
          }}
          title={asking === 'no_show' ? 'Mark as no-show?' : 'Cancel this booking?'}
          description={`${reservation.guestName}, ${reservation.partySize} guests at ${timeInZone(reservation.startsAt, timezone)}. The table becomes free again.`}
          confirmLabel={asking === 'no_show' ? 'Mark no-show' : 'Cancel booking'}
          destructive
          onConfirm={async () => {
            await change.mutateAsync(asking);
            setAsking(null);
          }}
        />
      ) : null}
    </div>
  );
}
