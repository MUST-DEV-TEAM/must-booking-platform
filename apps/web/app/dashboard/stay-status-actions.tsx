'use client';

import { useQueryClient } from '@tanstack/react-query';
import { LogIn, LogOut, Undo2, UserX } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../components/ui/button';

type StayStatus = 'expected' | 'checked_in' | 'checked_out' | 'no_show';

type StayBooking = {
  id: string;
  status: string;
  startsOn: string;
  pmsStayStatus: string | null;
  externalBookingId: string | null;
};

const KNOWN: StayStatus[] = ['expected', 'checked_in', 'checked_out', 'no_show'];

/**
 * Check in, check out and no-show for stays the hotel manages in MUST itself. A stay held by a PMS such as
 * Clock is recorded there, so nothing is shown. Each step has an undo, in case of a mis-click.
 */
export function StayStatusActions({
  tenantId,
  propertyId,
  booking,
  today = new Date().toLocaleDateString('en-CA'),
}: {
  tenantId: string;
  propertyId: string;
  booking: StayBooking;
  today?: string;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (booking.status !== 'CONFIRMED' || booking.externalBookingId) return null;
  const current: StayStatus = KNOWN.includes(booking.pmsStayStatus as StayStatus)
    ? (booking.pmsStayStatus as StayStatus)
    : 'expected';
  const arrivalDayCame = booking.startsOn <= today;

  const move = async (to: StayStatus, done: string) => {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/bookings/${booking.id}/stay-status`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: to, expectedFrom: current }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'The arrival status could not be changed.');
      }
      toast.success(done);
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'The arrival status could not be changed.',
      );
    } finally {
      setBusy(false);
    }
  };

  const early = arrivalDayCame ? undefined : 'The arrival day has not come yet.';

  return (
    <>
      {current === 'expected' ? (
        <>
          <Button
            disabled={busy || !arrivalDayCame}
            title={early}
            onClick={() => void move('checked_in', 'Guest checked in.')}
          >
            <LogIn aria-hidden="true" /> Check in
          </Button>
          <Button
            variant="outline"
            disabled={busy || !arrivalDayCame}
            title={early}
            onClick={() => void move('no_show', 'Marked as a no-show.')}
          >
            <UserX aria-hidden="true" /> No-show
          </Button>
        </>
      ) : null}
      {current === 'checked_in' ? (
        <>
          <Button disabled={busy} onClick={() => void move('checked_out', 'Guest checked out.')}>
            <LogOut aria-hidden="true" /> Check out
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void move('expected', 'Check-in undone.')}
          >
            <Undo2 aria-hidden="true" /> Undo check-in
          </Button>
        </>
      ) : null}
      {current === 'checked_out' ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void move('checked_in', 'Check-out undone.')}
        >
          <Undo2 aria-hidden="true" /> Undo check-out
        </Button>
      ) : null}
      {current === 'no_show' ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void move('expected', 'No-show undone.')}
        >
          <Undo2 aria-hidden="true" /> Undo no-show
        </Button>
      ) : null}
    </>
  );
}
