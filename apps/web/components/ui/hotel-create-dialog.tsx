'use client';
import { useState, type FormEvent } from 'react';
import { Button } from './button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './dialog';
import { FormField } from './form-field';
import { Input } from './input';
export function HotelCreateDialog({
  open,
  onClose,
  onSubmit,
  busy,
  atCap,
  error,
  loading = false,
  unavailable = false,
  onRetry,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; address: string; timezone: string }) => Promise<void>;
  busy: boolean;
  atCap: boolean;
  error?: string;
  loading?: boolean;
  unavailable?: boolean;
  onRetry?: () => void;
}) {
  const [timezoneError, setTimezoneError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const data = {
      name: String(form.get('name') ?? '').trim(),
      address: String(form.get('address') ?? '').trim(),
      timezone: String(form.get('timezone') ?? '').trim(),
    };
    try {
      Intl.DateTimeFormat(undefined, { timeZone: data.timezone });
      setTimezoneError('');
    } catch {
      setTimezoneError('Choose a valid IANA time zone, such as Europe/Tirane.');
      return;
    }
    await onSubmit(data);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add hotel</DialogTitle>
          <DialogDescription>
            Set the hotel identity. You can complete booking and payment settings afterwards.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {loading ? <p role="status">Checking plan limits...</p> : null}
          {atCap ? (
            <p role="alert">
              Your plan hotel limit has been reached. Upgrade to add another hotel.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {unavailable && onRetry ? (
            <Button type="button" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          <fieldset
            disabled={busy || atCap || loading || unavailable}
            className="m-0 space-y-4 border-0 p-0"
          >
            <FormField label="Hotel name" htmlFor="create-hotel-name" required>
              <Input id="create-hotel-name" name="name" required maxLength={200} />
            </FormField>
            <FormField label="Address" htmlFor="create-hotel-address" required>
              <Input id="create-hotel-address" name="address" required maxLength={500} />
            </FormField>
            <FormField
              label="Time zone"
              htmlFor="create-hotel-timezone"
              required
              hint="Use an IANA time zone, such as Europe/Tirane."
              error={timezoneError}
            >
              <Input
                id="create-hotel-timezone"
                name="timezone"
                required
                maxLength={100}
                placeholder="Europe/Tirane"
              />
            </FormField>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || atCap || loading || unavailable}>
              Add hotel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
