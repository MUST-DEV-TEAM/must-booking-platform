'use client';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/input';
import { FormField } from '../../components/ui/form-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Alert, AlertDescription } from '../../components/ui/alert';
export function MoveRoomDialog({
  tenantId,
  propertyId,
  bookingId,
  onClose,
  onSaved,
}: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}/bookings/${bookingId}/room-move`;
  const [roomId, setRoomId] = useState(''),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const attempt = useRef({ body: '', key: '' });
  const options = useQuery({
    queryKey: ['dashboard', 'room-move', tenantId, propertyId, bookingId],
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const r = await fetch(base, { credentials: 'include' });
      const data = await r.json();
      if (!r.ok) throw Error(data.message || 'Could not load rooms.');
      return data as {
        version: number;
        roomId: string | null;
        eligible: boolean;
        pending: boolean;
        pendingChange?: 'stay' | 'room' | null;
        managedInClock: boolean;
        availability?: {
          source: string;
          lastSyncedAt: string | null;
          complete: boolean;
          stale: boolean;
        };
        rooms: Array<{ id: string; name: string }>;
      };
    },
  });
  async function save(check = false) {
    setBusy(true);
    setError('');
    try {
      const body = JSON.stringify({ roomId, reason, expectedVersion: options.data?.version });
      if (!check && body !== attempt.current.body)
        attempt.current = { body, key: crypto.randomUUID() };
      const checkUrl =
        options.data?.pendingChange === 'stay'
          ? base.slice(0, -'/room-move'.length) + '/amend-check'
          : base + '/check';
      const r = await fetch(check ? checkUrl : base, {
        method: check ? 'POST' : 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(!check ? { 'Idempotency-Key': attempt.current.key } : {}),
        },
        ...(!check ? { body } : {}),
      });
      const data = await r.json();
      if (!r.ok || !data.ok)
        throw Error(data.error?.message || data.message || 'The room move could not be confirmed.');
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The room move could not be confirmed.');
      await options.refetch();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Move room</DialogTitle>
          <DialogDescription>
            Assign another room within the booked room type. The dates, price, payments and
            cancellation terms stay the same.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-3">
          {options.isPending ? <p role="status">Loading saved rooms...</p> : null}
          {options.error || error ? (
            <Alert variant="destructive">
              <AlertDescription>{error || options.error?.message}</AlertDescription>
            </Alert>
          ) : null}
          {options.data?.pending ? (
            <Alert>
              <AlertDescription>
                A previous {options.data.pendingChange === 'stay' ? 'stay change' : 'room move'}{' '}
                needs confirmation. Verify the saved result before choosing another room.
              </AlertDescription>
            </Alert>
          ) : options.data && !options.data.eligible ? (
            <Alert>
              <AlertDescription>
                Room moves here are available for upcoming, confirmed stays.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {options.data && options.data.rooms.length === 0 ? (
                <p role="status">No other rooms are shown as free in the saved bookings.</p>
              ) : null}
              {options.data?.availability?.source === 'CLOCK_SNAPSHOT' ? (
                <Alert>
                  <AlertDescription>
                    {options.data.availability.lastSyncedAt
                      ? 'Saved bookings last synchronized ' +
                        new Date(options.data.availability.lastSyncedAt).toLocaleString() +
                        '.'
                      : 'Initial booking synchronization is still in progress.'}
                    {!options.data.availability.complete || options.data.availability.stale
                      ? ' This list may be incomplete or out of date. Clock must verify the room before the move.'
                      : ' Clock verifies availability before applying a move.'}
                  </AlertDescription>
                </Alert>
              ) : null}
              <FormField label="New room" required>
                <Select
                  value={roomId}
                  onValueChange={setRoomId}
                  disabled={
                    busy || options.isPending || !!options.error || !options.data?.rooms.length
                  }
                >
                  <SelectTrigger className="w-full" aria-label="New room">
                    <SelectValue placeholder="Choose a room" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.data?.rooms
                      .filter((r) => r.id !== options.data.roomId)
                      .map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Saved bookings are checked for overlapping reservations throughout the stay. Clock
                  checks availability again when you confirm.
                  {options.data?.managedInClock
                    ? ' Check maintenance or out-of-service restrictions in Clock.'
                    : ''}
                </p>
              </FormField>
              <FormField label="Reason" required>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={2000}
                  disabled={busy}
                  placeholder="Visible in the reservation's activity"
                />
              </FormField>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Keep current room
          </Button>
          {options.data?.pending ? (
            <Button disabled={busy} onClick={() => void save(true)}>
              {busy
                ? 'Checking...'
                : options.data.pendingChange === 'stay'
                  ? 'Verify stay change'
                  : 'Verify room move'}
            </Button>
          ) : (
            <Button
              disabled={
                busy ||
                !!options.error ||
                !options.data?.eligible ||
                !options.data.rooms.some((room) => room.id === roomId) ||
                !reason.trim()
              }
              onClick={() => void save()}
            >
              {busy ? 'Moving...' : 'Confirm room move'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
