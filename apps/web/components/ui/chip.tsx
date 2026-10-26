import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';

/** A small read-only label with an icon, sized like the header controls (for example the hotel name). */
export function Chip({
  icon: Icon,
  children,
  className,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-10 max-w-60 items-center gap-2 rounded-md border bg-card px-3 text-sm font-semibold',
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
