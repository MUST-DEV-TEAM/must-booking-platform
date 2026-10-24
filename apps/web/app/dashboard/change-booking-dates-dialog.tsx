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
import { CalendarPicker } from '../../components/ui/calendar-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Textarea } from '../../components/ui/input';
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
  roomTypeId: originalRoomTypeId,
  roomTypeName,
  onClose,
  onSaved,
  onReviewRefund,
  onCollectPayment,
}: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
  startsOn: string;
  endsOn: string;
  managedInClock: boolean;
  roomTypeId?: string;
  roomTypeName?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onReviewRefund?: (amount: string) => void;
  onCollectPayment?: () => void;
}) {
  const [dates, setDates] = useState({ startsOn, endsOn }),
    [preview, setPreview] = useState<StayChangePreviewData | null>(null),
    [reason, setReason] = useState(''),
    [notify, setNotify] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [roomTypeId, setRoomTypeId] = useState(originalRoomTypeId || '');
  const [roomTypes, setRoomTypes] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    if (!managedInClock || !originalRoomTypeId) return;
    const abort = new AbortController();
    void fetch(`/api/tenants/${tenantId}/properties/${propertyId}/room-types`, {
      credentials: 'include',
      signal: abort.signal,
    })
      .then(async (r) => {
        if (r.ok) {
          const types = await r.json();
          if (Array.isArray(types)) setRoomTypes(types);
        }
      })
      .catch(() => {});
    return () => abort.abort();
  }, [tenantId, propertyId, managedInClock, originalRoomTypeId]);
  const [termsReviewed, setTermsReviewed] = useState(false);
  const [pending, setPending] = useState<boolean | null>(managedInClock ? null : false);
  const [choice, setChoice] = useState<{ outcome?: string; outcomeReason: string }>({
    outcomeReason: '',
  });
  const attempt = useRef({ body: '', key: '' });
  const base = `/api/tenants/${tenantId}/properties/${propertyId}/bookings/${bookingId}`;
  useEffect(() => {
    if (!managedInClock) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const r = await fetch(base + '/amend-status', {
          credentials: 'include',
          signal: controller.signal,
        });
        const result = await r.json();
        if (!r.ok) throw Error(result.message || 'Could not check pending amendments.');
        setPending(!!result.pending);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Could not check pending amendments.');
      }
    })();
    return () => controller.abort();
  }, [managedInClock, base, refresh]);
  async function checkProvider() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch(base + '/amend-check', { method: 'POST', credentials: 'include' });
      const result = await r.json();
      if (!r.ok || result.ok === false)
        throw Error(
          result.error?.message || result.message || 'The date change is not verified yet.',
        );
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The date change is not verified yet.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setPreview(null);
    setError('');
    if (
      (managedInClock && pending !== false) ||
      !dates.startsOn ||
      !dates.endsOn ||
      dates.endsOn <= dates.startsOn ||
      (dates.startsOn === startsOn &&
        dates.endsOn === endsOn &&
        roomTypeId === (originalRoomTypeId || ''))
    ) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(
      () => {
        void (async () => {
          try {
            const response = await fetch(
              `${base}/amend-preview?${new URLSearchParams({ ...dates, ...(roomTypeId ? { roomTypeId } : {}), ...(choice.outcome ? { outcome: choice.outcome } : {}), outcomeReason: choice.outcomeReason })}`,
              {
                credentials: 'include',
                signal: controller.signal,
              },
            );
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
      },
      managedInClock ? 800 : 250,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    base,
    roomTypeId,
    originalRoomTypeId,
    dates.startsOn,
    dates.endsOn,
    managedInClock,
    startsOn,
    endsOn,
    refresh,
    choice.outcome,
    choice.outcomeReason,
    pending,
  ]);
  // Match the preview to the current fields even before the effect invalidates an old response.
  const current =
    (!preview?.roomTypeId || preview.roomTypeId === roomTypeId) &&
    preview?.startsOn === dates.startsOn &&
    preview?.endsOn === dates.endsOn &&
    (!choice.outcome || preview.outcome === choice.outcome) &&
    (preview.outcomeReason ?? '') === choice.outcomeReason.trim()
      ? preview
      : null;
  async function confirm(followUp: 'none' | 'refund' | 'payment' = 'none') {
    if (
      !current?.available ||
      current.confirmationAvailable === false ||
      (['waive', 'no_refund'].includes(current.outcome ?? '') && !choice.outcomeReason.trim()) ||
      !reason.trim() ||
      reason.length > 2000 ||
      busy ||
      (managedInClock && (!termsReviewed || pending !== false))
    )
      return;
    const body = JSON.stringify({
      ...dates,
      ...(roomTypeId ? { roomTypeId } : {}),
      expectedVersion: current.version,
      previewHash: current.previewHash,
      reason: reason.trim(),
      notifyGuest: notify,
      outcome: current.outcome,
      outcomeReason: choice.outcomeReason.trim(),
      ...(managedInClock ? { termsReviewed } : {}),
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
      if (!response.ok || result.ok === false)
        throw new Error(result.error?.message ?? result.message ?? 'Could not change the dates.');
      await onSaved();
      onClose();
      if (followUp === 'refund' && current?.balanceState === 'refund_due' && current.balance)
        onReviewRefund?.(current.balance.replace(/^-/, ''));
      if (followUp === 'payment') onCollectPayment?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the dates.');
    } finally {
      setBusy(false);
    }
  }
  const confirmDisabled =
    busy ||
    !current?.available ||
    current.confirmationAvailable === false ||
    (managedInClock && !termsReviewed) ||
    !reason.trim() ||
    reason.length > 2000 ||
    loading ||
    choice.outcomeReason.length > 2000 ||
    (['waive', 'no_refund'].includes(choice.outcome ?? '') && !choice.outcomeReason.trim());
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl [&_[data-slot=dialog-footer]]:sticky [&_[data-slot=dialog-footer]]:bottom-0 [&_[data-slot=dialog-footer]]:bg-card [&_[data-slot=dialog-footer]]:pt-4">
        <DialogHeader>
          <DialogTitle>Change stay</DialogTitle>
          <DialogDescription>
            Review new dates or a different room type and compare the updated price. Payments and
            refunds are handled separately after staff confirmation.
          </DialogDescription>
        </DialogHeader>
        {managedInClock ? (
          <Alert>
            <AlertDescription>
              {roomTypeId && roomTypeId !== originalRoomTypeId
                ? 'Clock checks available rates for the new room type and dates. The previous room assignment will be cleared.'
                : 'Clock rechecks the original rate, room and price before applying the dates.'}{' '}
              Payments and refunds remain separate.
            </AlertDescription>
          </Alert>
        ) : null}
        {managedInClock && originalRoomTypeId ? (
          <FormField label="Room type">
            <Select
              value={roomTypeId}
              onValueChange={(v) => {
                setRoomTypeId(v);
                setTermsReviewed(false);
                setChoice({ outcomeReason: '' });
              }}
            >
              <SelectTrigger aria-label="Room type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(roomTypes.length
                  ? roomTypes
                  : [{ id: originalRoomTypeId, name: roomTypeName || 'Current room type' }]
                ).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        ) : null}
        <FormField
          label="Stay dates"
          error={dates.endsOn <= dates.startsOn ? 'Choose check-out after check-in.' : null}
        >
          <CalendarPicker
            label="Stay dates"
            mode="range"
            disabled={busy || (managedInClock && pending !== false)}
            value={{ start: dates.startsOn, end: dates.endsOn }}
            onChange={(selection) => {
              if (!selection.start || !selection.end) return;
              setTermsReviewed(false);
              setDates({ startsOn: selection.start, endsOn: selection.end });
              setChoice({ outcomeReason: '' });
            }}
          />
        </FormField>
        {managedInClock && pending ? (
          <Alert>
            <AlertDescription>
              A previous date change needs provider confirmation.{' '}
              <Button variant="outline" disabled={busy} onClick={() => void checkProvider()}>
                Check provider result
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {loading ? <p role="status">Checking dates and price...</p> : null}
        {current?.roomTypeName ? (
          <p className="text-sm font-medium">New accommodation: {current.roomTypeName}</p>
        ) : null}
        {current ? <StayChangePreview preview={current} /> : null}
        {current?.confirmationAvailable === false ? (
          <Alert>
            <AlertDescription>
              The new room-type price can be reviewed here. Applying the room-type change is waiting
              for dedicated Clock sandbox verification.
            </AlertDescription>
          </Alert>
        ) : null}
        {preview?.available &&
        preview.startsOn === dates.startsOn &&
        preview.endsOn === dates.endsOn &&
        (preview.availableOutcomes?.length ?? 0) > 1 ? (
          <FormField label="Price decision" htmlFor="amend-outcome">
            <Select
              value={choice.outcome ?? preview.outcome}
              disabled={busy}
              onValueChange={(outcome) => setChoice({ outcome, outcomeReason: '' })}
            >
              <SelectTrigger id="amend-outcome" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {preview.availableOutcomes?.map((outcome) => (
                  <SelectItem key={outcome} value={outcome}>
                    {
                      {
                        charge: 'Charge the difference',
                        waive: 'Waive the difference',
                        refund: 'Refund the difference',
                        no_refund: "Don't refund",
                        refund_due: 'Update price; review refund separately',
                        equal: 'Keep price',
                      }[outcome]
                    }
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        ) : null}
        {preview && !preview.canRefund && preview.difference && preview.difference !== '0.00' ? (
          <Alert>
            <AlertDescription>
              {managedInClock
                ? 'The stay update does not move money. Any refund is reviewed separately after the new dates are confirmed.'
                : preview.difference.startsWith('-')
                  ? 'Refund permission is required to issue a refund or keep the old price. Any amount owed stays as Refund due for a manager.'
                  : 'Refund permission is required to waive the price increase. Collect the balance through manual payment or the existing PokPay payment link.'}
            </AlertDescription>
          </Alert>
        ) : null}
        {['waive', 'no_refund'].includes(choice.outcome ?? '') ? (
          <FormField
            label="Reason for price decision"
            htmlFor="amend-outcome-reason"
            required
            error={
              choice.outcomeReason.length > 2000
                ? 'Keep the reason to 2000 characters or fewer.'
                : null
            }
          >
            <Textarea
              id="amend-outcome-reason"
              value={choice.outcomeReason}
              disabled={busy}
              onChange={(e) => setChoice({ ...choice, outcomeReason: e.target.value })}
            />
          </FormField>
        ) : null}
        <FormField
          label="Reason for change"
          htmlFor="amend-reason"
          required
          error={reason.length > 2000 ? 'Keep the reason to 2000 characters or fewer.' : null}
        >
          <Textarea
            id="amend-reason"
            disabled={busy || (managedInClock && pending !== false)}
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
            disabled={busy || (managedInClock && pending !== false)}
            checked={notify}
            onCheckedChange={setNotify}
          />
        </FormField>
        {managedInClock ? (
          <FormField
            label="I reviewed the original cancellation terms for this date change"
            htmlFor="amend-terms"
            hint="Original terms are retained; a changed arrival or imported policy may require staff review for cancellation."
          >
            <Switch
              id="amend-terms"
              checked={termsReviewed}
              onCheckedChange={setTermsReviewed}
              disabled={busy}
            />
          </FormField>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>
              {error}
              <Button
                variant="outline"
                disabled={loading || busy}
                onClick={() => setRefresh((n) => n + 1)}
              >
                Retry preview
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Close
          </Button>
          {!managedInClock || pending === false ? (
            managedInClock && current?.balanceState === 'refund_due' && onReviewRefund ? (
              <>
                <Button variant="outline" disabled={confirmDisabled} onClick={() => void confirm()}>
                  Confirm & refund later
                </Button>
                <Button disabled={confirmDisabled} onClick={() => void confirm('refund')}>
                  Confirm & review refund
                </Button>
              </>
            ) : managedInClock && current?.balanceState === 'due' && onCollectPayment ? (
              <>
                <Button variant="outline" disabled={confirmDisabled} onClick={() => void confirm()}>
                  Confirm & collect later
                </Button>
                <Button disabled={confirmDisabled} onClick={() => void confirm('payment')}>
                  Confirm & choose payment
                </Button>
              </>
            ) : (
              <Button loading={busy} disabled={confirmDisabled} onClick={() => void confirm()}>
                Confirm date change
              </Button>
            )
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
