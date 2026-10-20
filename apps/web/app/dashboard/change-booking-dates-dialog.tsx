'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog';
import { FormField } from '../../components/ui/form-field';
import { Input, Textarea } from '../../components/ui/input';
import { Switch } from '../../components/ui/switch';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import {
  StayChangePreview,
  type StayChangePreviewData,
} from '../../components/ui/stay-change-preview';
export function ChangeBookingDatesDialog({
  tenantId,
  propertyId,
  bookingId,
  startsOn,
  endsOn,
  managedInClock,
  onClose,
  onSaved,
}: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
  startsOn: string;
  endsOn: string;
  managedInClock: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [dates, setDates] = useState({ startsOn, endsOn }),
    [preview, setPreview] = useState<StayChangePreviewData | null>(null),
    [reason, setReason] = useState(''),
    [notify, setNotify] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const attempt = useRef({ body: '', key: '' });
  const base = `/api/tenants/${tenantId}/properties/${propertyId}/bookings/${bookingId}`;
  useEffect(() => {
    setPreview(null);
    setError('');
    if (
      managedInClock ||
      !dates.startsOn ||
      !dates.endsOn ||
      dates.endsOn <= dates.startsOn ||
      (dates.startsOn === startsOn && dates.endsOn === endsOn)
    ) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`${base}/amend-preview?${new URLSearchParams(dates)}`, {
            credentials: 'include',
            signal: controller.signal,
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.message ?? 'Could not check these dates.');
          if (!controller.signal.aborted) setPreview(result);
        } catch (e) {
          if (!controller.signal.aborted)
            setError(e instanceof Error ? e.message : 'Could not check these dates.');
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      })();
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [base, dates.startsOn, dates.endsOn, managedInClock, startsOn, endsOn, refresh]);
  // Match the preview to the current fields even before the effect invalidates an old response.
  const current =
    preview?.startsOn === dates.startsOn && preview?.endsOn === dates.endsOn ? preview : null;
  async function confirm() {
    if (!current?.available || !reason.trim() || reason.length > 2000 || busy || managedInClock)
      return;
    const body = JSON.stringify({
      ...dates,
      expectedVersion: current.version,
      previewHash: current.previewHash,
      reason: reason.trim(),
      notifyGuest: notify,
    });
    if (attempt.current.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${base}/amend`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.current.key },
        body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Could not change the dates.');
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the dates.');
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Change dates</DialogTitle>
          <DialogDescription>
            Keep the same room type, rate plan and assigned room. Review the price before
            confirming.
          </DialogDescription>
        </DialogHeader>
        {managedInClock ? (
          <Alert>
            <AlertDescription>Managed in Clock. Change dates there.</AlertDescription>
          </Alert>
        ) : null}
        {(['startsOn', 'endsOn'] as const).map((key) => (
          <FormField
            key={key}
            htmlFor={`amend-${key}`}
            label={key === 'startsOn' ? 'Check-in date' : 'Check-out date'}
            error={
              key === 'endsOn' && dates.endsOn <= dates.startsOn
                ? 'Choose a check-out date after check-in.'
                : null
            }
          >
            <Input
              id={`amend-${key}`}
              type="date"
              disabled={busy || managedInClock}
              value={dates[key]}
              onChange={(e) => setDates({ ...dates, [key]: e.target.value })}
            />
          </FormField>
        ))}
        {!managedInClock ? (
          <Button
            variant="outline"
            disabled={busy || loading}
            onClick={() => setRefresh((n) => n + 1)}
          >
            Check dates again
          </Button>
        ) : null}
        {loading ? <p role="status">Checking dates and price...</p> : null}
        {current ? <StayChangePreview preview={current} /> : null}
        <FormField
          label="Reason for change"
          htmlFor="amend-reason"
          required
          error={reason.length > 2000 ? 'Keep the reason to 2000 characters or fewer.' : null}
        >
          <Textarea
            id="amend-reason"
            disabled={busy || managedInClock}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>
        <FormField
          label="Email the guest about this change"
          htmlFor="amend-notify"
          hint="Uses the existing booking update email."
        >
          <Switch
            id="amend-notify"
            disabled={busy || managedInClock}
            checked={notify}
            onCheckedChange={setNotify}
          />
        </FormField>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Close
          </Button>
          {!managedInClock ? (
            <Button
              loading={busy}
              disabled={!current?.available || !reason.trim() || reason.length > 2000 || loading}
              onClick={() => void confirm()}
            >
              Confirm date change
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
