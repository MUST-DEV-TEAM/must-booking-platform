'use client';

import { cn } from '../../lib/utils';

export type SegmentedOption<T extends string> = { value: T; label: string; hint?: string };

/** A short row of mutually exclusive choices shown as joined buttons (for example Cash, Card, Bank). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1', className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md border-0 bg-transparent px-3 py-1.5 text-sm font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
              active && 'bg-card text-foreground shadow-xs',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
