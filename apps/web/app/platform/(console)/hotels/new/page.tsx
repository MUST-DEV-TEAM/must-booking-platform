'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '../../../../../components/ui/alert';
import { Button } from '../../../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../components/ui/card';
import { Combobox } from '../../../../../components/ui/combobox';
import { CountrySelect } from '../../../../../components/ui/country-select';
import { FormField } from '../../../../../components/ui/form-field';
import { Input } from '../../../../../components/ui/input';
import { OptionCard } from '../../../../../components/ui/option-card';
import { PageHeader } from '../../../../../components/ui/page-header';
import { PermissionPanel } from '../../../../../components/ui/permission-panel';
import {
  ConsoleApiError,
  consolePost,
  type HotelMode,
  MODE_LABELS,
} from '../../../../../lib/platform-api';
import { useConsoleSession } from '../../console-frame';

const CURRENCIES = ['EUR', 'ALL', 'USD', 'GBP', 'CHF', 'MKD', 'RSD', 'BAM', 'TRY'];
const FALLBACK_ZONES = ['Europe/Tirane', 'Europe/Rome', 'Europe/Athens', 'Europe/London', 'UTC'];

function timeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf?.('timeZone') ?? FALLBACK_ZONES;
  } catch {
    return FALLBACK_ZONES;
  }
}

type Errors = Partial<
  Record<'hotelName' | 'ownerName' | 'ownerEmail' | 'country' | 'timeZone', string>
>;

export default function NewHotelPage() {
  const { can } = useConsoleSession();
  const router = useRouter();
  const [hotelName, setHotelName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [country, setCountry] = useState<string | null>('AL');
  const [timeZone, setTimeZone] = useState('Europe/Tirane');
  const [currency, setCurrency] = useState('EUR');
  const [mode, setMode] = useState<HotelMode>('MUST_SOURCE');
  const [errors, setErrors] = useState<Errors>({});
  const zoneOptions = useMemo(() => timeZones().map((zone) => ({ value: zone, label: zone })), []);

  const create = useMutation({
    mutationFn: () =>
      consolePost<{ tenantId: string }>('/hotels', {
        hotelName: hotelName.trim(),
        ownerName: ownerName.trim(),
        ownerEmail: ownerEmail.trim(),
        country,
        timeZone,
        currency,
        mode,
      }),
    onSuccess: (result) => router.push(`/platform/hotels/${result.tenantId}`),
  });

  if (!can('platform.hotels.create')) return <PermissionPanel />;

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Errors = {};
    if (hotelName.trim().length < 2) next.hotelName = 'Enter the hotel’s name.';
    if (ownerName.trim().length < 2) next.ownerName = 'Enter the owner’s name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim()))
      next.ownerEmail = 'Enter a valid email.';
    if (!country) next.country = 'Choose a country.';
    if (!timeZone) next.timeZone = 'Choose a time zone.';
    setErrors(next);
    if (Object.keys(next).length === 0) create.mutate();
  }

  const failure = create.error instanceof ConsoleApiError ? create.error : null;

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <PageHeader
        title="Add a hotel"
        description="Create the hotel in Trial and invite its owner. The owner gets an email to set a password."
        actions={
          <Button variant="outline" asChild>
            <a href="/platform/hotels">Cancel</a>
          </Button>
        }
      />
      {failure ? (
        <Alert variant="destructive">
          <AlertTitle>The hotel was not created</AlertTitle>
          <AlertDescription>
            {failure.message}
            {failure.reference ? ` Reference: ${failure.reference}` : ''}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Hotel</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FormField label="Hotel name" htmlFor="hotel-name" required error={errors.hotelName}>
              <Input
                id="hotel-name"
                value={hotelName}
                onChange={(e) => setHotelName(e.target.value)}
              />
            </FormField>
            <FormField label="Country" required error={errors.country}>
              <CountrySelect value={country} onChange={setCountry} label="Country" />
            </FormField>
            <FormField label="Time zone" required error={errors.timeZone}>
              <Combobox
                label="Time zone"
                options={zoneOptions}
                value={timeZone}
                onChange={setTimeZone}
              />
            </FormField>
            <FormField label="Currency" required>
              <Combobox
                label="Currency"
                options={CURRENCIES.map((code) => ({ value: code, label: code }))}
                value={currency}
                onChange={setCurrency}
              />
            </FormField>
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Owner</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FormField label="Owner name" htmlFor="owner-name" required error={errors.ownerName}>
                <Input
                  id="owner-name"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                />
              </FormField>
              <FormField
                label="Owner email"
                htmlFor="owner-email"
                required
                error={errors.ownerEmail}
                hint="The invitation link is sent here."
              >
                <Input
                  id="owner-email"
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                />
              </FormField>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>How will the hotel take bookings?</CardTitle>
            </CardHeader>
            <CardContent>
              <div role="radiogroup" aria-label="Booking mode" className="flex flex-col gap-3">
                <OptionCard
                  title={MODE_LABELS.CLOCK}
                  description="Availability, rates and reservations live in the hotel’s Clock PMS+."
                  selected={mode === 'CLOCK'}
                  onSelect={() => setMode('CLOCK')}
                />
                <OptionCard
                  title={MODE_LABELS.MUST_SOURCE}
                  description="MUST holds the rooms, rates and reservations itself."
                  selected={mode === 'MUST_SOURCE'}
                  onSelect={() => setMode('MUST_SOURCE')}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild>
          <a href="/platform/hotels">Cancel</a>
        </Button>
        <Button type="submit" loading={create.isPending}>
          Create hotel and invite owner
        </Button>
      </div>
    </form>
  );
}
