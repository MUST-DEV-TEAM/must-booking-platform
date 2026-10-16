import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';

/** Neat "label: value" rows for detail pages. Rows with no value are skipped. */
export function DetailList({
  items,
  className,
}: {
  items: ReadonlyArray<{ label: string; value: ReactNode | null | undefined }>;
  className?: string;
}) {
  const visible = items.filter(
    (item) => item.value !== null && item.value !== undefined && item.value !== '',
  );
  return (
    <dl className={cn('divide-y', className)}>
      {visible.map((item) => (
        <div key={item.label} className="flex items-start justify-between gap-4 py-2 text-sm">
          <dt className="shrink-0 text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 text-right font-medium break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
