import { Check, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';

/**
 * One choice in a list of options (a room type with its price, a payment method). Shows a
 * tick and a strong border when selected; `disabled` greys it out for choices that cannot be
 * taken. The whole card is the button, so it works with a keyboard.
 */
export function OptionCard({
  title,
  badges,
  description,
  aside,
  selected = false,
  disabled = false,
  icon: Icon,
  onSelect,
}: {
  title: ReactNode;
  badges?: ReactNode;
  description?: ReactNode;
  /** Shown on the right: a price, or the reason it cannot be chosen. */
  aside?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  /** A larger icon at the start of the card (for example a payment method). */
  icon?: LucideIcon;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border bg-card p-4 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        selected && 'border-primary bg-secondary/40',
      )}
    >
      {Icon ? (
        <span
          aria-hidden="true"
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground',
            selected && 'bg-primary text-primary-foreground',
          )}
        >
          <Icon className="size-5" />
        </span>
      ) : null}
      {Icon ? null : (
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
            selected && 'border-primary bg-primary text-primary-foreground',
          )}
        >
          {selected ? <Check className="size-3.5" /> : null}
        </span>
      )}
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-bold">
          {title}
          {badges}
        </span>
        {description ? (
          <span className="block text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
      {aside ? <span className="shrink-0 text-right">{aside}</span> : null}
    </button>
  );
}
