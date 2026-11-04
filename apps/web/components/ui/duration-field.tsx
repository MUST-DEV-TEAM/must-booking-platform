'use client';

import { Button } from './button';
import { NumberStepper } from './number-stepper';

export function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '', rest ? `${rest} min` : '']
    .filter(Boolean)
    .join(' ');
}

/** Common dining stays, with quarter-hour adjustments for a custom duration. */
export function DurationField({
  value,
  onChange,
  defaultMinutes,
}: {
  value: number;
  onChange: (value: number) => void;
  defaultMinutes: number;
}) {
  const presets = [...new Set([60, 90, 120, 150, 180, defaultMinutes])].sort((a, b) => a - b);
  return (
    <div className="space-y-4">
      <div role="group" aria-label="Suggested dining durations" className="flex flex-wrap gap-2">
        {presets.map((minutes) => (
          <Button
            key={minutes}
            variant={minutes === value ? 'default' : 'outline'}
            aria-pressed={minutes === value}
            onClick={() => onChange(minutes)}
          >
            {durationLabel(minutes)}
            {minutes === defaultMinutes ? ' · usual stay' : ''}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-4">
        <div>
          <p className="font-medium" aria-live="polite">
            {durationLabel(value)}
          </p>
          <p className="text-sm text-muted-foreground">Adjust in 15-minute steps</p>
        </div>
        <NumberStepper
          className="w-40"
          label="Duration in minutes"
          min={30}
          max={480}
          step={15}
          value={value}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
