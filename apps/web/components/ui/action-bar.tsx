import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';

/** A tinted strip of related buttons at the bottom of a card. */
export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 rounded-xl bg-primary/5 p-2', className)}>
      {children}
    </div>
  );
}
