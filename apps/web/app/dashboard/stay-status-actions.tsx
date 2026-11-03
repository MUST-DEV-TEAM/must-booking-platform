'use client';

import { useQueryClient } from '@tanstack/react-query';
import { LogIn, LogOut, Undo2, UserX } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';

type StayStatus = 'expected' | 'checked_in' | 'checked_out' | 'no_show';

type StayBooking = {
  id: string;
  status: string;
  startsOn: string;
  pmsStayStatus: string | null;
  externalBookingId: string | null;
};

type OpenBalance = { outstanding: string; currency: string | null };

const KNOWN: StayStatus[] = ['expected', 'checked_in', 'checked_out', 'no_show'];

/**
 * Check in, check out and no-show for stays the hotel manages in MUST itself. A stay held by a PMS such as
 * Clock is recorded there, so nothing is shown. Each step has an undo, in case of a mis-click.
 *
 * Checking out with money still owed asks for a written reason first. A check-out before the booked
 * departure day tells staff, and `onEarlyDeparture` lets the page offer the reviewed date change that
 * puts the remaining nights back on sale.
 */
export function StayStatusActions({
  tenantId,
  propertyId,
  booking,
  today = new Date().toLocaleDateString('en-CA'),
  onEarlyDeparture,
}: {
  tenantId: string;
  propertyId: string;
  booking: StayBooking;
  today?: string;
  onEarlyDeparture?: (info: { plannedEndsOn: string; departedOn: string }) => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [openBalance, setOpenBalance] = useState<OpenBalance | null>(null);
  if (booking.status !== 'CONFIRMED' || booking.externalBookingId) return null;
  const current: StayStatus = KNOWN.includes(booking.pmsStayStatus as StayStatus)
    ? (booking.pmsStayStatus as StayStatus)
    : 'expected';
  const arrivalDayCame = booking.startsOn <= today;

  type Reply = {
    message?: string;
    code?: string;
    outstanding?: string;
    currency?: string | null;
    earlyDeparture?: boolean;
    plannedEndsOn?: string;
    departedOn?: string;
  };

  const send = async (
    to: StayStatus,
    extra: { acknowledgeBalance?: boolean; note?: string } = {},
  ) => {
    const response = await fetch(
      `/api/tenants/${tenantId}/properties/${propertyId}/bookings/${booking.id}/stay-status`,
      {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: to, expectedFrom: current, ...extra }),
      },
    );
    const body = (await response.json().catch(() => null)) as Reply | null;
    return { ok: response.ok, body: body ?? {} };
  };

  const finish = async (done: string, body: Reply) => {
    if (body.earlyDeparture && body.plannedEndsOn && body.departedOn) {
      toast.success(
        `${done} The booked stay runs to ${body.plannedEndsOn}: change the dates to put the remaining nights back on sale.`,
      );
      onEarlyDeparture?.({ plannedEndsOn: body.plannedEndsOn, departedOn: body.departedOn });
    } else toast.success(done);
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const move = async (to: StayStatus, done: string) => {
    setBusy(true);
    try {
      const { ok, body } = await send(to);
      if (!ok) {
        if (body.code === 'BALANCE_OUTSTANDING') {
          setOpenBalance({ outstanding: body.outstanding ?? '', currency: body.currency ?? null });
          return;
        }
        throw new Error(body.message ?? 'The arrival status could not be changed.');
      }
      await finish(done, body);
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
      <ConfirmDialog
        open={openBalance !== null}
        onOpenChange={(open) => {
          if (!open) setOpenBalance(null);
        }}
        title="Check out with a balance open?"
        description={`This guest still owes ${openBalance?.outstanding ?? ''} ${openBalance?.currency ?? ''}. Settle it first if you can. If the guest leaves with it open, say why; the reason is saved in the stay history.`}
        confirmLabel="Check out anyway"
        cancelLabel="Go back"
        reasonLabel="Why is the balance left open?"
        reasonRequired
        reasonPlaceholder="For example: paid by bank transfer tomorrow"
        onConfirm={async (reason) => {
          const { ok, body } = await send('checked_out', {
            acknowledgeBalance: true,
            note: reason,
          });
          if (!ok) throw new Error(body.message ?? 'The check-out could not be saved.');
          setOpenBalance(null);
          await finish('Guest checked out.', body);
        }}
      />
    </>
  );
}
