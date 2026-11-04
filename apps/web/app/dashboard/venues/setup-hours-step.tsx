'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { SettingToggle } from '../../../components/ui/setting-toggle';
import { TimeField } from '../../../components/ui/time-field';
import type { VenueService } from './venue-api';

const DAYS: Array<[number, string]> = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [7, 'Sun'],
];

const PRESET: VenueService = {
  name: 'Dinner',
  days: [1, 2, 3, 4, 5, 6, 7],
  opensAt: '19:00',
  closesAt: '23:00',
  slotMinutes: 30,
};

/** Step 2: when the restaurant is open. Each service (lunch, dinner, ...) has days and hours. */
export function SetupHoursStep({
  services,
  saving,
  error,
  onSubmit,
}: {
  services: VenueService[];
  saving: boolean;
  error?: string | null;
  onSubmit: (services: VenueService[]) => void;
}) {
  // A new restaurant starts with a sensible dinner service to change; nothing is saved until Continue.
  const [rows, setRows] = useState<VenueService[]>(services.length > 0 ? services : [PRESET]);
  const [problem, setProblem] = useState<string | null>(null);

  const change = (index: number, patch: Partial<VenueService>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  function submit() {
    if (rows.length === 0) return setProblem('Add at least one opening time.');
    for (const row of rows) {
      if (!row.name.trim()) return setProblem('Give every opening time a name, such as Lunch.');
      if (row.days.length === 0) return setProblem(`${row.name}: choose at least one day.`);
      if (row.closesAt <= row.opensAt)
        return setProblem(`${row.name}: it must close after it opens, on the same day.`);
    }
    setProblem(null);
    onSubmit(rows.map((row) => ({ ...row, name: row.name.trim() })));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Add each time you take bookings, such as lunch and dinner. Guests can book at the times
        shown, from opening until just before closing.
      </p>
      {rows.map((row, index) => (
        <div key={index} className="space-y-4 rounded-lg border p-4">
          <div className="flex items-end justify-between gap-3">
            <FormField label="Name" htmlFor={`hours-name-${index}`} className="flex-1">
              <Input
                id={`hours-name-${index}`}
                value={row.name}
                onChange={(e) => change(index, { name: e.target.value })}
              />
            </FormField>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Remove ${row.name || 'opening time'}`}
              onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
            >
              <Trash2 aria-hidden="true" className="size-4" />
            </Button>
          </div>
          <div role="group" aria-label={`${row.name} days`} className="flex flex-wrap gap-3">
            {DAYS.map(([day, label]) => (
              <SettingToggle
                key={day}
                label={label}
                checked={row.days.includes(day)}
                onChange={(checked) =>
                  change(index, {
                    days: checked
                      ? [...row.days, day].sort((a, b) => a - b)
                      : row.days.filter((d) => d !== day),
                  })
                }
              />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Opens" htmlFor={`hours-open-${index}`}>
              <TimeField
                id={`hours-open-${index}`}
                label={`${row.name} opens`}
                value={row.opensAt}
                onChange={(value) => change(index, { opensAt: value })}
              />
            </FormField>
            <FormField label="Closes" htmlFor={`hours-close-${index}`}>
              <TimeField
                id={`hours-close-${index}`}
                label={`${row.name} closes`}
                value={row.closesAt}
                onChange={(value) => change(index, { closesAt: value })}
              />
            </FormField>
            <FormField label="Booking times every" htmlFor={`hours-slot-${index}`}>
              <SegmentedControl
                label={`${row.name} booking interval`}
                value={String(row.slotMinutes)}
                onChange={(value) => change(index, { slotMinutes: Number(value) })}
                options={[
                  { value: '15', label: '15 min' },
                  { value: '30', label: '30 min' },
                  { value: '60', label: '1 hour' },
                ]}
              />
            </FormField>
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        onClick={() =>
          setRows((current) => [
            ...current,
            {
              name: current.length === 0 ? 'Dinner' : 'Lunch',
              days: [1, 2, 3, 4, 5, 6, 7],
              opensAt: '12:00',
              closesAt: '15:00',
              slotMinutes: 30,
            },
          ])
        }
      >
        <Plus aria-hidden="true" className="size-4" /> Add opening time
      </Button>
      {problem || error ? (
        <Alert variant="destructive">
          <AlertDescription>{problem ?? error}</AlertDescription>
        </Alert>
      ) : null}
      <div>
        <Button onClick={submit} disabled={saving}>
          Save and continue
        </Button>
      </div>
    </div>
  );
}
