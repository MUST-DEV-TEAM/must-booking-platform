'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

import { DateField } from '../../components/ui/date-field';
import { FormField } from '../../components/ui/form-field';
import { FormSection } from '../../components/ui/form-section';
import { NumberStepper } from '../../components/ui/number-stepper';
import { useBookingRulesEvaluation } from './booking-rules';
import { describeBookingRules } from './booking-rules-summary';
import type { Property } from './settings-areas';

/** The rules in plain words, and a box to try a booking against the saved rules. */
export function BookingRulesOverview({
  tenantId,
  property,
}: {
  tenantId: string;
  property: Property;
}) {
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const ready = Boolean(startsOn && endsOn && endsOn > startsOn);
  const check = useBookingRulesEvaluation(
    tenantId,
    property.id,
    { channel: 'guest', startsOn, endsOn, adults, children },
    ready,
  );
  const result = ready ? check.data?.booking : undefined;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <FormSection
          title="Your rules in short"
          description="What guests are told, from the saved settings."
        >
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-sm">
            {describeBookingRules(property).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </FormSection>
        <FormSection
          title="Try a booking"
          description="Pick dates and guests to see whether the saved rules allow it. Rooms are not checked."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Check-in" htmlFor="try-in">
              <DateField
                id="try-in"
                value={startsOn}
                onChange={setStartsOn}
                aria-label="Check-in date"
              />
            </FormField>
            <FormField label="Check-out" htmlFor="try-out">
              <DateField
                id="try-out"
                value={endsOn}
                min={startsOn || undefined}
                onChange={setEndsOn}
                aria-label="Check-out date"
              />
            </FormField>
            <FormField label="Adults">
              <NumberStepper label="Adults" value={adults} min={1} max={50} onChange={setAdults} />
            </FormField>
            <FormField label="Children">
              <NumberStepper
                label="Children"
                value={children}
                min={0}
                max={50}
                onChange={setChildren}
              />
            </FormField>
          </div>
          <div role="status" aria-live="polite" className="text-sm">
            {!ready ? (
              <p className="m-0 text-muted-foreground">
                Choose a check-in and a later check-out date.
              </p>
            ) : check.isPending ? (
              <p className="m-0 text-muted-foreground">Checking…</p>
            ) : check.isError ? (
              <p className="m-0 text-destructive">The rules could not be checked. Try again.</p>
            ) : result?.valid ? (
              <p className="m-0 flex items-center gap-2 font-semibold text-success">
                <CheckCircle2 aria-hidden="true" className="size-4" /> Allowed. A guest could book
                this.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                <p className="m-0 flex items-center gap-2 font-semibold text-destructive">
                  <XCircle aria-hidden="true" className="size-4" /> Not allowed
                </p>
                <ul className="m-0 list-disc pl-5">
                  {(result?.errors ?? []).map((error) => (
                    <li key={error.code}>{error.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </FormSection>
      </div>
      <p className="m-0 text-sm text-muted-foreground">
        These are the rules for the whole hotel. Dates and rates with their own limits are set in{' '}
        <a
          className="font-semibold text-foreground underline"
          href={`/dashboard/${tenantId}?propertyId=${encodeURIComponent(property.id)}&section=rates-pricing`}
        >
          Rates &amp; Pricing
        </a>
        .
      </p>
    </div>
  );
}
