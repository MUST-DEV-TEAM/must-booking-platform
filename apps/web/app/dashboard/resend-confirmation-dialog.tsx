'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';

/**
 * Staff send the guest the booking confirmation again, to the address on the booking or to another one (G-96).
 * A confirmation marked delivered can still sit in a junk folder or go to an address nobody checks.
 */
export function ResendConfirmationDialog({
  tenantId,
  propertyId,
  bookingId,
  onClose,
}: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/bookings/${bookingId}/resend-confirmation`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(email.trim() ? { email: email.trim() } : {}),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        sentTo?: string;
      };
      setResult(
        response.ok
          ? { ok: true, text: `The confirmation was sent again to ${body.sentTo ?? 'the guest'}.` }
          : {
              ok: false,
              text: body.message ?? 'The confirmation could not be sent. Please try again.',
            },
      );
    } catch {
      setResult({ ok: false, text: 'The confirmation could not be sent. Please try again.' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send the confirmation again</DialogTitle>
          <DialogDescription>
            The guest gets the same confirmation email with a fresh link to manage the booking.
            Leave the address empty to use the one on the booking. At most 3 times a day.
          </DialogDescription>
        </DialogHeader>
        <FormField label="Another address (optional)" htmlFor="resend-confirmation-email">
          <Input
            id="resend-confirmation-email"
            type="email"
            autoComplete="off"
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>
        {result ? (
          <Alert variant={result.ok ? 'default' : 'destructive'} role="status">
            <AlertDescription>{result.text}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void send()} disabled={busy}>
            {busy ? 'Sending…' : 'Send confirmation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
