import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
/** Full-width responsive filter rows with consistent control sizing and mobile stacking. */
export function FilterGrid({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="filter-grid"
      className={cn(
        'grid min-w-0 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 items-end gap-4 [&>div]:min-w-0 [&_input]:w-full [&_[role=combobox]]:w-full',
        className,
      )}
      {...props}
    />
  );
}
