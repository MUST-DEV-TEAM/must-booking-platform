'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { ConfirmDialog } from '../../../components/ui/confirm-dialog';
import { EmptyPanel } from '../../../components/ui/state-panel';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { reservationApi, type Reservation, type SettableStatus } from './reservation-api';
import {
  dayLabel,
  dayOfInstant,
  nextActions,
  STATUS_DISPLAY,
  timeInZone,
} from './reservation-display';

/** Bookings as a table with the next-step buttons (Seat, Finish, No-show, Cancel). */
export function ReservationTable({
  tenantId,
  venueId,
  timezone,
  reservations,
  showDay,
  canManage,
  emptyTitle = 'No bookings',
}: {
  tenantId: string;
  venueId: string;
  timezone: string;
  reservations: readonly Reservation[];
  /** Show the date next to the time (for lists that span several days). */
  showDay?: boolean;
  canManage: boolean;
  emptyTitle?: string;
}) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<{ reservation: Reservation; status: SettableStatus } | null>(
    null,
  );
  const change = useMutation({
    mutationFn: (input: { id: string; status: SettableStatus }) =>
      reservationApi.setStatus(tenantId, venueId, input.id, input.status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['venue-reservations', tenantId, venueId] });
      await queryClient.invalidateQueries({ queryKey: ['venue-floor', tenantId, venueId] });
    },
  });

  if (reservations.length === 0) return <EmptyPanel title={emptyTitle} />;

  return (
    <div className="space-y-3">
      {change.error ? (
        <Alert variant="destructive">
          <AlertDescription>{change.error.message}</AlertDescription>
        </Alert>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Guest</TableHead>
            <TableHead>Guests</TableHead>
            <TableHead>Table</TableHead>
            <TableHead>Status</TableHead>
            {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {reservations.map((reservation) => {
            const display = STATUS_DISPLAY[reservation.status];
            return (
              <TableRow key={reservation.id}>
                <TableCell className="whitespace-nowrap font-semibold">
                  {showDay ? `${dayLabel(dayOfInstant(reservation.startsAt, timezone))} Â· ` : ''}
                  {timeInZone(reservation.startsAt, timezone)}
                </TableCell>
                <TableCell>
                  <div className="font-medium">{reservation.guestName}</div>
                  <div className="text-xs text-muted-foreground">
                    {[reservation.guestPhone, reservation.reference].filter(Boolean).join(' Â· ')}
                  </div>
                  {reservation.notes ? (
                    <div className="text-xs text-muted-foreground">{reservation.notes}</div>
                  ) : null}
                  {reservation.stay ? (
                    <Badge variant="info" className="mt-1">
                      Hotel guest{reservation.stay.room ? ` Â· room ${reservation.stay.room}` : ''}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>{reservation.partySize}</TableCell>
                <TableCell>{reservation.tables.map((t) => t.label).join(' + ') || 'â€”'}</TableCell>
                <TableCell>
                  <Badge variant={display.tone}>{display.label}</Badge>
                </TableCell>
                {canManage ? (
                  <TableCell className="text-right">
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
                            action.destructive
                              ? setAsking({ reservation, status: action.status })
                              : change.mutate({ id: reservation.id, status: action.status })
                          }
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {asking ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setAsking(null);
          }}
          title={asking.status === 'no_show' ? 'Mark as no-show?' : 'Cancel this booking?'}
          description={`${asking.reservation.guestName}, ${asking.reservation.partySize} guests at ${timeInZone(asking.reservation.startsAt, timezone)}. The table becomes free again.`}
          confirmLabel={asking.status === 'no_show' ? 'Mark no-show' : 'Cancel booking'}
          destructive
          onConfirm={async () => {
            await change.mutateAsync({ id: asking.reservation.id, status: asking.status });
          }}
        />
      ) : null}
    </div>
  );
}
