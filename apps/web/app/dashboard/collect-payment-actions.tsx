'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { useClockFinancial } from './clock-financial';
import { minorUnits } from './payment-status';
export function CollectPaymentActions({
  tenantId,
  propertyId,
  booking,
}: {
  tenantId: string;
  propertyId: string;
  booking: {
    id: string;
    status: string;
    total: { amount: string; currency: string };
    paidAmount: string;
    balanceBasis?: 'CLOCK' | 'MUST';
    guestEmail?: string | null;
  };
}) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const client = useQueryClient();
  const [manual, setManual] = useState(false),
    [method, setMethod] = useState('cash'),
    [message, setMessage] = useState('');
  const [reference, setReference] = useState(''),
    [payerName, setPayerName] = useState(''),
    [terminalId, setTerminalId] = useState(''),
    [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10)),
    [qr, setQr] = useState('');
  const paymentTab = useRef<Window | null>(null);
  const [waiting, setWaiting] = useState(false);
  const attempt = useRef<string | null>(null);
  const busy = useRef(false);
  const caps = useQuery({
    queryKey: ['dashboard', 'collection-capabilities', tenantId, propertyId],
    queryFn: async () => {
      const r = await fetch(`${base}/capabilities/mine`, { credentials: 'include' });
      if (!r.ok) throw Error('Could not check payment permissions.');
      return (await r.json()) as string[];
    },
  });
  const clockFinancial = useClockFinancial(
    tenantId,
    propertyId,
    booking.id,
    booking.balanceBasis === 'CLOCK',
  );
  const verifiedClock = clockFinancial.data?.data;
  const eligible =
    booking.status === 'CONFIRMED' &&
    (booking.balanceBasis === 'CLOCK'
      ? !!verifiedClock && Number(verifiedClock.balance.amount) > 0
      : minorUnits(booking.total.amount) > minorUnits(booking.paidAmount)) &&
    !!caps.data?.includes('payments.record');
  const options = useQuery({
    queryKey: ['dashboard', 'collection-options', tenantId, propertyId, booking.id],
    enabled: eligible,
    queryFn: async () => {
      const r = await fetch(`${base}/bookings/${booking.id}/collection-options`, {
        credentials: 'include',
      });
      if (!r.ok) throw Error('Could not check payment options.');
      return (await r.json()) as { pokpay: boolean };
    },
  });
  const post = async (action: string, body?: unknown) => {
    const r = await fetch(`${base}/bookings/${booking.id}/${action}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': attempt.current ?? (attempt.current = crypto.randomUUID()),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const d = await r.json();
    if (!r.ok || d.ok === false)
      throw Error(d.error?.message || d.message || 'Payment action could not finish.');
    return d;
  };
  const pay = useMutation({
    mutationFn: async (action: 'open' | 'send' | 'copy' | 'qr') => {
      if (busy.current) return;
      busy.current = true;
      let tab: Window | null = null;
      try {
        if (action === 'open') tab = window.open('about:blank', '_blank');
        const result = await post(action === 'send' ? 'send-pokpay-link' : 'collect-pokpay');
        if (action === 'send')
          setMessage('Payment email queued. Check Emails for delivery status.');
        else if (action === 'copy') {
          await navigator.clipboard.writeText(result.checkoutUrl);
          setMessage('');
          toast.success('Link copied');
          setWaiting(true);
        } else if (action === 'qr') {
          setQr(
            await QRCode.toDataURL(result.checkoutUrl, {
              width: 280,
              margin: 2,
              errorCorrectionLevel: 'M',
            }),
          );
          setWaiting(true);
        } else if (tab) {
          paymentTab.current = tab;
          tab.location.href = result.checkoutUrl;
          setWaiting(true);
        } else setMessage('Your browser blocked the payment tab. Allow pop-ups and retry.');
        attempt.current = null;
      } catch (e) {
        tab?.close();
        throw e;
      } finally {
        busy.current = false;
      }
    },
  });
  useEffect(() => {
    if (!eligible || !waiting) return;
    let stopped = false,
      polling = false;
    const check = async () => {
      if (polling) return;
      polling = true;
      try {
        const r = await fetch(`${base}/bookings/${booking.id}/check-collection`, {
          method: 'POST',
          credentials: 'include',
        });
        if (r.ok) {
          const d = await r.json();
          if (d.paid && !stopped) {
            paymentTab.current?.close();
            setQr('');
            setWaiting(false);
            await client.invalidateQueries({ queryKey: ['dashboard'] });
          }
        }
      } catch {
        if (!stopped)
          setMessage('Payment confirmation is delayed. Keep this page open; we will check again.');
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => void check(), 3000);
    const focus = () => void check();
    window.addEventListener('focus', focus);
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel('must-payment');
      channel.onmessage = (e) => {
        if (e.data?.bookingId === booking.id) void check();
      };
    } catch {
      /* Optional browser capability unavailable; keep the normal UI path. */
    }
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      channel?.close();
    };
  }, [eligible, waiting, base, booking.id, client]);
  if (!eligible) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Collect payment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          Collect the outstanding balance for this confirmed reservation. A recorded cash, card or
          bank payment means you have already received the money.
        </p>
        <div className="flex flex-wrap gap-2">
          {options.data?.pokpay ? (
            <>
              <Button disabled={pay.isPending} onClick={() => pay.mutate('open')}>
                Pay with PokPay
              </Button>
              <Button
                variant="outline"
                disabled={pay.isPending || !booking.guestEmail}
                onClick={() => pay.mutate('send')}
              >
                Send payment link
              </Button>
              <Button variant="outline" disabled={pay.isPending} onClick={() => pay.mutate('copy')}>
                Copy PokPay link
              </Button>
              <Button variant="outline" disabled={pay.isPending} onClick={() => pay.mutate('qr')}>
                Show payment QR code
              </Button>
            </>
          ) : null}
          <Button
            variant="outline"
            disabled={pay.isPending}
            onClick={() => {
              attempt.current = null;
              setManual(true);
            }}
          >
            Record payment received
          </Button>
        </div>
        {pay.error || options.error ? (
          <p role="alert">{pay.error?.message || options.error?.message}</p>
        ) : null}
        {message ? <p role="status">{message}</p> : null}
        <Dialog
          open={!!qr}
          onOpenChange={(open) => {
            if (!open) setQr('');
          }}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogTitle>Pay with PokPay</DialogTitle>
            <DialogDescription>
              Scan to pay this booking's outstanding balance in {booking.total.currency}. The
              booking updates after payment is confirmed.
            </DialogDescription>
            {qr ? (
              <img
                className="mx-auto block max-w-full"
                src={qr}
                alt="QR code for this booking's PokPay checkout"
                width={280}
                height={280}
              />
            ) : null}
          </DialogContent>
        </Dialog>
        <ConfirmDialog
          open={manual}
          onOpenChange={setManual}
          title="Record money already received"
          description={`Record the remaining balance in ${booking.total.currency}. This does not charge a card.`}
          confirmLabel="Record payment"
          cancelLabel="Go back"
          reasonLabel="Additional payment note"
          confirmDisabled={
            !receivedOn ||
            receivedOn > new Date().toISOString().slice(0, 10) ||
            (method !== 'cash' && !reference.trim())
          }
          onConfirm={async (note) => {
            await post('manual-payment', {
              method,
              note,
              evidence: {
                receivedOn,
                reference,
                payerName: method === 'bank_transfer' ? payerName : undefined,
                terminalId: method === 'card_in_person' ? terminalId : undefined,
              },
            });
            attempt.current = null;
            await client.invalidateQueries({ queryKey: ['dashboard'] });
          }}
        >
          <Select
            value={method}
            onValueChange={(value) => {
              attempt.current = null;
              setMethod(value);
            }}
          >
            <SelectTrigger aria-label="Payment received by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="card_in_person">Card / POS</SelectItem>
              <SelectItem value="bank_transfer">Bank transfer</SelectItem>
            </SelectContent>
          </Select>
          <label className="grid gap-1 text-sm">
            Date received
            <Input
              type="date"
              value={receivedOn}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => {
                attempt.current = null;
                setReceivedOn(e.target.value);
              }}
            />
          </label>
          <label className="grid gap-1 text-sm">
            {method === 'bank_transfer'
              ? 'Bank transaction reference'
              : method === 'card_in_person'
                ? 'POS transaction / receipt reference'
                : 'Receipt reference (optional)'}
            <Input
              maxLength={120}
              value={reference}
              onChange={(e) => {
                attempt.current = null;
                setReference(e.target.value);
              }}
            />
          </label>
          {method === 'bank_transfer' ? (
            <label className="grid gap-1 text-sm">
              Payer name (optional)
              <Input
                maxLength={120}
                value={payerName}
                onChange={(e) => {
                  attempt.current = null;
                  setPayerName(e.target.value);
                }}
              />
            </label>
          ) : null}
          {method === 'card_in_person' ? (
            <label className="grid gap-1 text-sm">
              Terminal identifier (optional)
              <Input
                maxLength={120}
                value={terminalId}
                onChange={(e) => {
                  attempt.current = null;
                  setTerminalId(e.target.value);
                }}
              />
            </label>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Confirm the money has arrived before recording it. Never enter a full card number, PIN
            or security code.
          </p>
        </ConfirmDialog>
      </CardContent>
    </Card>
  );
}
