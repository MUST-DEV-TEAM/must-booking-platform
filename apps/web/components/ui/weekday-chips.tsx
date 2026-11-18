'use client';

import { WEEKDAYS } from '@must/domain-contracts';

import { cn } from '../../lib/utils';

/** Seven day buttons (Monday to Sunday) to switch weekdays on or off. Values are ISO numbers 1 to 7. */
export function WeekdayChips({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: readonly number[];
  onChange: (value: number[]) => void;
  /** Accessible name of the group. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {WEEKDAYS.map((day) => {
        const on = value.includes(day.value);
        return (
          <button
            key={day.value}
            type="button"
            aria-pressed={on}
            aria-label={`${label}: ${day.label}`}
            disabled={disabled}
            onClick={() =>
              onChange(on ? value.filter((v) => v !== day.value) : [...value, day.value].sort())
            }
            className={cn(
              'h-9 min-w-12 rounded-md border px-3 text-sm font-semibold transition-colors disabled:opacity-60',
              on
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:bg-accent',
            )}
          >
            {day.label}
          </button>
        );
      })}
    </div>
  );
}
