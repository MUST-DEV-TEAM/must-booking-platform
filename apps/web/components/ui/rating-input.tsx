'use client';

import { Star } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';

import { cn } from '../../lib/utils';

/** The words shown under a 1 to 5 score. */
export const RATING_WORDS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'] as const;

/**
 * A 1 to 5 star score the guest taps or moves through with the arrow keys. Tapping the chosen star again
 * clears it, which lets an optional aspect be left unrated.
 */
export function RatingInput({
  label,
  value,
  onChange,
  size = 'md',
  showWord = false,
  className,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  size?: 'md' | 'lg';
  showWord?: boolean;
  className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  const move = (event: KeyboardEvent, step: number) => {
    event.preventDefault();
    onChange(Math.min(5, Math.max(1, (value ?? (step > 0 ? 0 : 6)) + step)));
  };
  return (
    <div className={cn('flex flex-col items-start gap-1.5', className)}>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex gap-1"
        onMouseLeave={() => setHover(null)}
      >
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            key={score}
            type="button"
            role="radio"
            aria-checked={value === score}
            aria-label={`${score} out of 5, ${RATING_WORDS[score - 1]}`}
            tabIndex={value === score || (value === null && score === 1) ? 0 : -1}
            onMouseEnter={() => setHover(score)}
            onClick={() => onChange(value === score ? null : score)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowUp') move(event, 1);
              else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') move(event, -1);
            }}
            className="rounded-md border-0 bg-transparent p-0.5 outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Star
              aria-hidden="true"
              className={cn(
                size === 'lg' ? 'size-10 sm:size-11' : 'size-7',
                score <= shown
                  ? 'fill-amber-400 stroke-amber-500'
                  : 'fill-transparent stroke-muted-foreground/50',
              )}
            />
          </button>
        ))}
      </div>
      {showWord ? (
        <p className="m-0 h-5 text-sm font-semibold text-muted-foreground" aria-live="polite">
          {shown ? RATING_WORDS[shown - 1] : 'Tap a star'}
        </p>
      ) : null}
    </div>
  );
}

/** A score shown as stars, for reading rather than choosing. */
export function RatingDisplay({ value, className }: { value: number | null; className?: string }) {
  return (
    <span
      role="img"
      aria-label={value ? `${value} out of 5` : 'Not rated'}
      className={cn('inline-flex items-center gap-0.5', className)}
    >
      {[1, 2, 3, 4, 5].map((score) => (
        <Star
          key={score}
          aria-hidden="true"
          className={cn(
            'size-4',
            value && score <= Math.round(value)
              ? 'fill-amber-400 stroke-amber-500'
              : 'fill-transparent stroke-muted-foreground/40',
          )}
        />
      ))}
    </span>
  );
}
