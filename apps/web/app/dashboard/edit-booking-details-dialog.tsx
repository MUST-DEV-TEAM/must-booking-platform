'use client';
import { useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog';
import { Input, Textarea } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Button } from '../../components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
export type EditableDetails = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  specialRequests: string;
  estimatedArrivalTime: string;
  adults: number;
  children: number;
};
export function EditBookingDetailsDialog({
  tenantId,
  propertyId,
  bookingId,
  version,
  initial,
  maxOccupancy,
  managedInClock,
  onClose,
  onSaved,
}: {
  tenantId: string;
  propertyId: string;
  bookingId: string;
  version: number;
  initial: EditableDetails;
  maxOccupancy: number;
  managedInClock: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [values, setValues] = useState(initial),
    [expectedVersion] = useState(version),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const attempt = useRef({ body: '', key: '' });
  const set = (field: keyof EditableDetails, value: string | number) =>
    setValues((current) => ({ ...current, [field]: value }));
  async function save() {
    const problems: Record<string, string> = {};
    for (const key of ['firstName', 'lastName'] as const)
      if (!values[key].trim() || values[key].length > 100)
        problems[key] =
          `Enter a ${key === 'firstName' ? 'first' : 'last'} name of up to 100 characters.`;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email.trim()) || values.email.length > 254)
      problems.email = 'Enter a valid guest email address.';
    if (values.phone.trim() && !/^\+?[0-9][0-9 ]{4,19}$/.test(values.phone.trim()))
      problems.phone = 'Use digits, spaces and an optional + prefix.';
    if (!Number.isInteger(values.adults) || values.adults < 1)
      problems.adults = 'Enter at least one adult.';
    if (!Number.isInteger(values.children) || values.children < 0)
      problems.children = 'Enter zero or more children.';
    if (values.adults + values.children > maxOccupancy)
      problems.children = `This room holds no more than ${maxOccupancy} guests.`;
    if (values.specialRequests.length > 2000)
      problems.specialRequests = 'Keep notes to 2000 characters or fewer.';
    if (
      values.estimatedArrivalTime &&
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(values.estimatedArrivalTime)
    )
      problems.estimatedArrivalTime = 'Enter HH:mm, for example 18:30.';
    setErrors(problems);
    if (Object.keys(problems).length || managedInClock) return;
    const body = JSON.stringify({ ...values, expectedVersion });
    if (body !== attempt.current.body) attempt.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/bookings/${bookingId}/details`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.current.key },
          body,
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message ?? 'Could not save the reservation details.');
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the reservation details.');
    } finally {
      setBusy(false);
    }
  }
  const field = (name: keyof EditableDetails, label: string, type = 'text') => (
    <div className="space-y-1.5" key={name}>
      <Label htmlFor={`edit-${name}`}>{label}</Label>
      <Input
        id={`edit-${name}`}
        type={type}
        value={values[name]}
        disabled={managedInClock || busy}
        min={type === 'number' ? (name === 'adults' ? 1 : 0) : undefined}
        aria-invalid={!!errors[name]}
        aria-describedby={errors[name] ? `edit-${name}-error` : undefined}
        onChange={(e) => set(name, type === 'number' ? Number(e.target.value) : e.target.value)}
      />
      {errors[name] ? (
        <p id={`edit-${name}-error`} className="text-sm text-destructive">
          {errors[name]}
        </p>
      ) : null}
    </div>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>
            Contact details apply to this reservation. Changing the email does not send a
            confirmation.
          </DialogDescription>
        </DialogHeader>
        {managedInClock ? (
          <Alert>
            <AlertTitle>Managed in Clock</AlertTitle>
            <AlertDescription>
              These reservation details are read-only here. Make changes in Clock.
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          {field('firstName', 'First name')}
          {field('lastName', 'Last name')}
          {field('email', 'Email', 'email')}
          {field('phone', 'Phone', 'tel')}
          {field('adults', 'Adults', 'number')}
          {field('children', 'Children', 'number')}
        </div>
        <p className="text-sm text-muted-foreground">
          Guest counts must fit the room and keep the price unchanged. Price changes need the future
          amend stay flow.
        </p>
        {field('estimatedArrivalTime', 'Estimated arrival (hotel local time)', 'time')}
        <div className="space-y-1.5">
          <Label htmlFor="edit-notes">Special requests / notes</Label>
          <p className="text-sm text-muted-foreground">Use guest-facing requests here; these can appear in booking emails.</p>
          <Textarea
            id="edit-notes"
            value={values.specialRequests}
            maxLength={2000}
            disabled={managedInClock || busy}
            onChange={(e) => set('specialRequests', e.target.value)}
          />
          {errors.specialRequests ? (
            <p className="text-sm text-destructive">{errors.specialRequests}</p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Close
          </Button>
          {!managedInClock ? (
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving...' : 'Save details'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
