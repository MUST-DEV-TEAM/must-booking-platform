'use client';

import { useState } from 'react';

import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { FormField } from '../../../components/ui/form-field';
import { NumberStepper } from '../../../components/ui/number-stepper';
import type { Venue, VenueUpdate } from './venue-api';

type RuleKey =
  | 'advanceBookingDays'
  | 'maxOnlinePartySize'
  | 'diningMinutes'
  | 'lastBookingMinutesBeforeClose'
  | 'holdMinutes';

const RULES: Array<{
  key: RuleKey;
  label: string;
  hint: string;
  min: number;
  max: number;
  topic: string;
}> = [
  {
    key: 'advanceBookingDays',
    topic: 'Booking ahead',
    label: 'How far ahead can guests book? (days)',
    hint: 'For example 60 means up to two months ahead.',
    min: 1,
    max: 365,
  },
  {
    key: 'maxOnlinePartySize',
    topic: 'Online guests',
    label: 'Largest group that can book online',
    hint: 'Bigger groups are asked to call.',
    min: 1,
    max: 100,
  },
  {
    key: 'diningMinutes',
    topic: 'Time at the table',
    label: 'How long can guests stay? (minutes)',
    hint: 'Used to know when a table is free again.',
    min: 30,
    max: 480,
  },
  {
    key: 'lastBookingMinutesBeforeClose',
    topic: 'Closing time',
    label: 'Last booking before closing (minutes)',
    hint: 'For example 60 means the last table is booked an hour before closing.',
    min: 0,
    max: 240,
  },
  {
    key: 'holdMinutes',
    topic: 'Payment hold',
    label: 'How long is a table held while a guest pays? (minutes)',
    hint: 'If they do not finish paying in this time, the table is released.',
    min: 5,
    max: 60,
  },
];

/** Step 4: the booking rules. They have sensible defaults, so this step can simply be confirmed. */
export function SetupRulesStep({
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
  const [values, setValues] = useState<Record<RuleKey, number>>({
    advanceBookingDays: venue.advanceBookingDays,
    maxOnlinePartySize: venue.maxOnlinePartySize,
    diningMinutes: venue.diningMinutes,
    lastBookingMinutesBeforeClose: venue.lastBookingMinutesBeforeClose,
    holdMinutes: venue.holdMinutes,
  });
  const [problem, setProblem] = useState<string | null>(null);

  function submit() {
    const update: Partial<Record<RuleKey, number>> = {};
    for (const rule of RULES) {
      const value = Number(values[rule.key]);
      if (!Number.isInteger(value) || value < rule.min || value > rule.max)
        return setProblem(`${rule.label}: enter a whole number from ${rule.min} to ${rule.max}.`);
      update[rule.key] = value;
    }
    setProblem(null);
    onSubmit(update);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        These rules decide which times guests can book online. You can change them any time.
      </p>
      {RULES.map((rule) => (
        <fieldset key={rule.key} className="space-y-2 rounded-lg border p-4">
          <legend className="px-1 text-sm font-semibold">{rule.topic}</legend>
          <FormField label={rule.label} hint={rule.hint}>
            <NumberStepper
              label={rule.label}
              min={rule.min}
              max={rule.max}
              value={values[rule.key]}
              onChange={(value) => setValues((current) => ({ ...current, [rule.key]: value }))}
            />
          </FormField>
        </fieldset>
      ))}
      {problem || error ? (
        <Alert variant="destructive">
          <AlertDescription>{problem ?? error}</AlertDescription>
        </Alert>
      ) : null}
      <Button onClick={submit} disabled={saving}>
        Save and continue
      </Button>
    </div>
  );
}
