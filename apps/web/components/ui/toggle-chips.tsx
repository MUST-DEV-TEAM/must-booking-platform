'use client';

import { cn } from '../../lib/utils';

/** A row of buttons to switch several options on or off (for example the cards a hotel accepts at the reception). */
export function ToggleChips({
  options,
  value,
  onChange,
  label,
  disabled = false,
}: {
  options: ReadonlyArray<{ value: string; label: string }>;
  value: readonly string[];
  onChange: (value: string[]) => void;
  /** Accessible name of the group. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const on = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() =>
              onChange(
                on
                  ? value.filter((v) => v !== option.value)
                  : options
                      .map((o) => o.value)
                      .filter((v) => v === option.value || value.includes(v)),
              )
            }
            className={cn(
              'h-9 rounded-md border px-3 text-sm font-semibold transition-colors disabled:opacity-60',
              on
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:bg-accent',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
