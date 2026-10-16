'use client';

import { Minus, Plus } from 'lucide-react';

import { cn } from '../../lib/utils';
import { Button } from './button';

/** A whole number with minus and plus buttons, for guest counts. Stays within min and max. */
export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 99,
  label,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Accessible name of the group, such as "Adults". */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('flex h-9 items-center justify-between rounded-md border bg-card', className)}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Fewer ${label.toLowerCase()}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <Minus aria-hidden="true" />
      </Button>
      <output aria-live="polite" className="min-w-8 text-center text-sm font-semibold">
        {value}
      </output>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  );
}
