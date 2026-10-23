'use client';
import { useEffect, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Textarea } from '../../../components/ui/input';
import { FormField } from '../../../components/ui/form-field';
import { SettingToggle } from '../../../components/ui/setting-toggle';
type Booking = {
  reference: string;
  status: string;
  version: number;
  startsOn: string;
  endsOn: string;
  room: string;
  currency: string;
  cutoffAt: string | null;
  timezone: string | null;
  automaticAllowed: boolean;
  policyKnown: boolean;
  refundAmount: string | null;
  checkingMoney?: boolean;
};
export function GuestBookingManage() {
  const [booking, setBooking] = useState<Booking | null>(null),
    [error, setError] = useState(''),
    [details, setDetails] = useState(''),
    [requestRefund, setRequestRefund] = useState(true),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [outcome, setOutcome] = useState('');
  const target = useRef<{ base: string; token: string } | null>(null),
    attempt = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    let active = true;
    const q = new URLSearchParams(window.location.search);
    const tenant = q.get('tenant'),
      property = q.get('property'),
      id = q.get('booking'),
      token = q.get('token');
    if (!tenant || !property || !id || !token) {
      setError('This booking link is incomplete. Please use the link in your confirmation email.');
      return;
    }
    target.current = {
      base: `/api/tenants/${encodeURIComponent(tenant)}/properties/${encodeURIComponent(property)}/bookings/${encodeURIComponent(id)}/manage`,
      token,
    };
    void fetch(target.current.base + '?token=' + encodeURIComponent(token), {
      credentials: 'include',
      cache: 'no-store',
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw Error(body.message || 'Your booking could not be loaded.');
        if (active) {
          setBooking(body);
          setConfirmed(false);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!booking?.checkingMoney || !target.current) return;
    let stopped = false;
    let attempts = 0;
    const timer = setInterval(() => {
      if (++attempts > 7) {
        clearInterval(timer);
        setBooking((current) => (current ? { ...current, checkingMoney: false } : current));
        return;
      }
      void fetch(target.current!.base + '?token=' + encodeURIComponent(target.current!.token), {
        credentials: 'include',
        cache: 'no-store',
      })
        .then(async (r) => {
          if (!r.ok) return;
          const data = await r.json();
          if (!stopped) {
            setBooking(data);
            setConfirmed(false);
          }
        })
        .catch(() => {
          /* Keep the last safe state. */
        });
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [booking?.checkingMoney]);
  const submit = async () => {
    if (!target.current || !booking) return;
    setBusy(true);
    setError('');
    const body = JSON.stringify({
      token: target.current.token,
      version: booking.version,
      action: booking.automaticAllowed ? 'cancel' : 'request',
      details,
      requestRefund,
    });
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    try {
      const r = await fetch(target.current.base, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.current.key },
        body,
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.message || 'The request could not be completed.');
      setOutcome(
        data.requested
          ? 'Your request has been sent to the hotel. Your booking remains active until staff approve cancellation. Refunds require a separate confirmation.'
          : data.message || 'Your booking is cancelled. Any refund will be confirmed separately.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request could not be completed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10">
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Manage your booking</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {error ? (
            <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm">
              {error}
            </p>
          ) : null}
          {outcome ? (
            <p role="status" className="rounded-lg border p-4 leading-relaxed">
              {outcome}
            </p>
          ) : booking ? (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <dt>Booking reference</dt>
                <dd className="text-right font-semibold">{booking.reference}</dd>
                <dt>Room</dt>
                <dd className="text-right">{booking.room}</dd>
                <dt>Stay</dt>
                <dd className="text-right">
                  {booking.startsOn} to {booking.endsOn}
                </dd>
                <dt>Status</dt>
                <dd className="text-right">{booking.status.replaceAll('_', ' ')}</dd>
              </dl>
              {booking.status === 'CONFIRMED' ? (
                <>
                  <div className="space-y-2 rounded-lg bg-muted/50 p-4 text-sm leading-relaxed">
                    {booking.checkingMoney ? (
                      <p>
                        Checking your latest payment position before calculating the cancellation.
                        This usually takes a few seconds.
                      </p>
                    ) : booking.automaticAllowed ? (
                      <>
                        <p>You can cancel this booking before the free-cancellation deadline.</p>
                        <p>
                          Refund to issue:{' '}
                          <strong>
                            {booking.refundAmount ?? '0.00'} {booking.currency}
                          </strong>
                          . Any refund will be confirmed separately.
                        </p>
                      </>
                    ) : (
                      <p>
                        {booking.policyKnown
                          ? 'This cancellation requires hotel staff review.'
                          : 'Your original cancellation terms need hotel staff review.'}{' '}
                        You may send a request; your booking will remain active until the hotel
                        approves it.
                      </p>
                    )}
                    {booking.cutoffAt ? (
                      <p>
                        Free-cancellation deadline:{' '}
                        {new Date(booking.cutoffAt).toLocaleString('en-GB', {
                          timeZone: booking.timezone || 'UTC',
                        })}{' '}
                        ({booking.timezone}).
                      </p>
                    ) : null}
                  </div>
                  <FormField label="Reason for cancellation" htmlFor="guest-cancellation-reason">
                    <Textarea
                      id="guest-cancellation-reason"
                      value={details}
                      maxLength={2000}
                      onChange={(e) => setDetails(e.target.value)}
                      placeholder="Tell the hotel why you need to cancel"
                    />
                  </FormField>
                  {!booking.automaticAllowed ? (
                    <SettingToggle
                      label="Also request a refund"
                      checked={requestRefund}
                      onChange={setRequestRefund}
                    />
                  ) : null}
                  <SettingToggle
                    label={
                      booking.automaticAllowed
                        ? 'I confirm that I want to cancel this booking.'
                        : 'I understand this is a request and my booking remains active until approved.'
                    }
                    checked={confirmed}
                    onChange={setConfirmed}
                  />
                  <Button
                    variant={booking.automaticAllowed ? 'destructive' : 'default'}
                    disabled={
                      busy || booking.checkingMoney || !confirmed || details.trim().length < 3
                    }
                    onClick={() => void submit()}
                  >
                    {busy
                      ? 'Submitting...'
                      : booking.checkingMoney
                        ? 'Checking payments...'
                        : booking.automaticAllowed
                          ? 'Confirm cancellation'
                          : 'Send cancellation request'}
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This booking cannot be cancelled through this page in its current state.
                </p>
              )}
            </>
          ) : !error ? (
            <p role="status">Loading your booking...</p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
