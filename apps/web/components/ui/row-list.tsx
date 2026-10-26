import type { ReactNode } from 'react';

export type RowListItem = { key: string; label: ReactNode; value: ReactNode };

/** A bordered list of "what" on the left and "how much" on the right, such as payments. */
export function RowList({ items }: { items: readonly RowListItem[] }) {
  return (
    <ul className="m-0 list-none divide-y rounded-lg border p-0 px-3 text-sm">
      {items.map((item) => (
        <li key={item.key} className="flex items-center justify-between gap-3 py-2">
          <span className="min-w-0">{item.label}</span>
          <span className="shrink-0 font-medium">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}
