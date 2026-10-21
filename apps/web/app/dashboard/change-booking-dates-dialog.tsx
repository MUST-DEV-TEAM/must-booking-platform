'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [choice, setChoice] = useState<{ outcome?: string; outcomeReason: string }>({
    outcomeReason: '',
  });
  const [window, setWindow] = useState<{ edge: 'start' | 'end'; from: string; to: string } | null>(
    null,
  );
  const [calendar, setCalendar] = useState<{
    key: string;
    days: Record<string, string | null>;
  } | null>(null);
  const [calendarError, setCalendarError] = useState('');
  const startWindow = useCallback(
    (from: string, to: string) => setWindow({ edge: 'start', from, to }),
    [],
  );
  const endWindow = useCallback(
    (from: string, to: string) => setWindow({ edge: 'end', from, to }),
    [],
  );
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
          const response = await fetch(
            `${base}/amend-preview?${new URLSearchParams({ ...dates, ...(choice.outcome ? { outcome: choice.outcome } : {}), outcomeReason: choice.outcomeReason })}`,
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
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    base,
    dates.startsOn,
    dates.endsOn,
    managedInClock,
    startsOn,
    endsOn,
    refresh,
    choice.outcome,
    choice.outcomeReason,
  ]);
  const calendarKey = JSON.stringify({ window, dates });
  useEffect(() => {
    if (
      !window ||
      managedInClock ||
      !dates.startsOn ||
      !dates.endsOn ||
      dates.endsOn <= dates.startsOn
    )
      return;
    const controller = new AbortController();
    setCalendarError('');
    void (async () => {
      try {
        const response = await fetch(
          `${base}/amend-calendar?${new URLSearchParams({ ...dates, ...window })}`,
          { credentials: 'include', signal: controller.signal },
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? 'Could not load date availability.');
        if (!controller.signal.aborted)
          setCalendar({
            key: calendarKey,
            days: Object.fromEntries(
              result.days.map((d: { date: string; disabled: boolean; reason: string | null }) => [
                d.date,
                d.disabled ? d.reason || 'Unavailable' : null,
              ]),
            ),
          });
      } catch (e) {
        if (!controller.signal.aborted)
          setCalendarError(e instanceof Error ? e.message : 'Could not load date availability.');
      }
    })();
    return () => controller.abort();
  }, [base, calendarKey, managedInClock, refresh]);
  const dateReason = (edge: 'start' | 'end', day: string) =>
    calendar?.key === calendarKey && window?.edge === edge && Object.hasOwn(calendar.days, day)
      ? (calendar.days[day] ?? undefined)
      : calendarError || 'Checking availability...';
  // Match the preview to the current fields even before the effect invalidates an old response.
  const current =
    preview?.startsOn === dates.startsOn &&
    preview?.endsOn === dates.endsOn &&
    (!choice.outcome || preview.outcome === choice.outcome) &&
    (preview.outcomeReason ?? '') === choice.outcomeReason.trim()
      ? preview
      : null;
  async function confirm() {
    if (
      !current?.available ||
      (['waive', 'no_refund'].includes(current.outcome ?? '') && !choice.outcomeReason.trim()) ||
      !reason.trim() ||
      reason.length > 2000 ||
      busy ||
      managedInClock
    )
      return;
    const body = JSON.stringify({
      ...dates,
      expectedVersion: current.version,
      previewHash: current.previewHash,
      reason: reason.trim(),
      notifyGuest: notify,
      outcome: current.outcome,
      outcomeReason: choice.outcomeReason.trim(),
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
            <CalendarPicker
              label={key === 'startsOn' ? 'Check-in date' : 'Check-out date'}
              mode="single"
              disabled={busy || managedInClock}
              value={{ start: dates[key], end: null }}
              dateReason={(day) => dateReason(key === 'startsOn' ? 'start' : 'end', day)}
              onVisibleWindowChange={key === 'startsOn' ? startWindow : endWindow}
              onChange={(selection) => {
                if (!selection.start) return;
                const next = { ...dates, [key]: selection.start };
                if (key === 'startsOn' && next.endsOn <= next.startsOn) {
                  const nights = (Date.parse(dates.endsOn) - Date.parse(dates.startsOn)) / 86400000;
                  next.endsOn = new Date(
                    Date.parse(next.startsOn + 'T00:00:00Z') + nights * 86400000,
                  )
                    .toISOString()
                    .slice(0, 10);
                }
                setDates(next);
                setChoice({ outcomeReason: '' });
              }}
            />
          </FormField>
        ))}
        {calendarError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {calendarError}
              <Button variant="outline" onClick={() => setRefresh((n) => n + 1)}>
                Retry availability
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {loading ? <p role="status">Checking dates and price...</p> : null}
        {current ? <StayChangePreview preview={current} /> : null}
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
              <SelectTrigger id="amend-outcome">
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
                        refund_due: 'Leave refund due for a manager',
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
              {preview.difference.startsWith('-')
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
          {!managedInClock ? (
            <Button
              loading={busy}
              disabled={
                !current?.available ||
                !reason.trim() ||
                reason.length > 2000 ||
                loading ||
                choice.outcomeReason.length > 2000 ||
                (['waive', 'no_refund'].includes(choice.outcome ?? '') &&
                  !choice.outcomeReason.trim())
              }
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
