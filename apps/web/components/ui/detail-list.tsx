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

/** One labelled value in a grid of facts. An empty value shows a dash. */
export function Field({ label, value }: { label: string; value: ReactNode | null | undefined }) {
  return (
    <div className="space-y-1">
      <p className="m-0 text-xs text-muted-foreground">{label}</p>
      <p className="m-0 text-sm font-semibold break-words">
        {value === null || value === undefined || value === '' ? '—' : value}
      </p>
    </div>
  );
}

/** Small capitalised heading used above a block inside a card. */
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="m-0 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">{children}</p>
      {action}
    </div>
  );
}
