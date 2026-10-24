'use client';
import { useState } from 'react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../components/ui/dialog';
export function CheckoutLinkActions({
  url,
  tenantId,
  propertyId,
  bookingId,
  canSend = false,
  onOpened,
}: {
  url: string;
  tenantId: string;
  propertyId: string;
  bookingId: string;
  canSend?: boolean;
  onOpened?: (tab: Window) => void;
}) {
  const [qr, setQr] = useState(''),
    [fallback, setFallback] = useState(false),
    [sending, setSending] = useState(false);
  const send = async () => {
    setSending(true);
    try {
      const r = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/bookings/${bookingId}/send-pokpay-link`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        },
      );
      if (!r.ok) {
        const b = await r.json();
        throw Error(b.message || 'The payment email could not be queued.');
      }
      toast.success('Payment email queued');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The payment email could not be queued.');
    } finally {
      setSending(false);
    }
  };
  return (
    <>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          onClick={() => {
            const tab = window.open(url, '_blank');
            if (tab) {
              tab.opener = null;
              onOpened?.(tab);
            }
          }}
        >
          Pay with PokPay
        </Button>
        {canSend ? (
          <Button variant="outline" disabled={sending} onClick={() => void send()}>
            Send payment link
          </Button>
        ) : null}
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(url)
              .then(() => toast.success('Link copied'))
              .catch(() => setFallback(true));
            if (!navigator.clipboard) setFallback(true);
          }}
        >
          Copy PokPay link
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            void QRCode.toDataURL(url, { width: 288, margin: 2 })
              .then(setQr)
              .catch(() => toast.error('The QR code could not be displayed.'));
          }}
        >
          Show payment QR code
        </Button>
      </div>
      <Dialog
        open={!!qr}
        onOpenChange={(open) => {
          if (!open) setQr('');
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogTitle>Pay with PokPay</DialogTitle>
          <DialogDescription>
            Scan to pay this reservation. Confirmation follows the verified payment result.
          </DialogDescription>
          <img src={qr} alt="PokPay payment QR code" className="mx-auto h-auto w-full max-w-72" />
        </DialogContent>
      </Dialog>
      <Dialog open={fallback} onOpenChange={setFallback}>
        <DialogContent>
          <DialogTitle>Copy payment link</DialogTitle>
          <DialogDescription>Select and copy this secure payment link.</DialogDescription>
          <Input
            aria-label="Payment link"
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
