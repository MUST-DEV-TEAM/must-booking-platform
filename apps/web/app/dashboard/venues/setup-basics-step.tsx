'use client';

import { useState } from 'react';

import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { FormField } from '../../../components/ui/form-field';
import { Combobox } from '../../../components/ui/combobox';
import { PhoneInput, parsePhone, phoneToString } from '../../../components/ui/phone-input';
import { currencyOptions } from '../../../lib/currencies';
import { Input, Textarea } from '../../../components/ui/input';
import type { Venue, VenueUpdate } from './venue-api';

type Errors = Partial<Record<'name' | 'currency' | 'contactEmail', string>>;

/** Step 1: what guests see and where the restaurant is. The hotel supplies time zone and initial currency. */
export function SetupBasicsStep({
  venue,
  saving,
  error,
  onSubmit,
}: {
  venue: Venue;
  saving: boolean;
  error?: string | null;
  onSubmit: (update: VenueUpdate) => void;
}) {
  const [name, setName] = useState(venue.name);
  const [phone, setPhone] = useState(() => parsePhone(venue.phone));
  const [email, setEmail] = useState(venue.contactEmail ?? '');
  const [description, setDescription] = useState(venue.description ?? '');
  const timezone = venue.timezone || 'UTC';
  const [currency, setCurrency] = useState(venue.currency || 'EUR');
  const [errors, setErrors] = useState<Errors>({});

  function submit() {
    const next: Errors = {};
    if (!name.trim()) next.name = 'Enter a name for the restaurant.';
    if (!/^[A-Za-z]{3}$/.test(currency.trim()))
      next.currency = 'Enter a three-letter currency, for example ALL.';
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      next.contactEmail = 'That email address does not look right.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    onSubmit({
      name: name.trim(),
      phone: phoneToString(phone),
      contactEmail: email.trim(),
      description: description.trim(),
      timezone,
      currency: currency.trim().toUpperCase(),
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        These details are used on your booking page and in confirmation emails.
      </p>
      <FormField label="Restaurant name" htmlFor="setup-name" required error={errors.name}>
        <Input id="setup-name" value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Phone" htmlFor="setup-phone">
          <PhoneInput id="setup-phone" value={phone} onChange={setPhone} />
        </FormField>
        <FormField
          label="Reservations email"
          htmlFor="setup-email"
          error={errors.contactEmail}
          hint="Where guests can reach you."
        >
          <Input id="setup-email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
      </div>
      <FormField
        label="Short description"
        htmlFor="setup-description"
        hint="A sentence or two for your website, for example the kind of food you serve."
      >
        <Textarea
          id="setup-description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </FormField>
      <FormField
        label="Currency"
        required
        error={errors.currency}
        hint="Starts with your hotel's currency."
      >
        <Combobox
          label="Currency"
          options={currencyOptions}
          value={currency}
          onChange={setCurrency}
        />
      </FormField>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button onClick={submit} disabled={saving}>
        Save and continue
      </Button>
    </div>
  );
}
