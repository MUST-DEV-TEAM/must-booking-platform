import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { TableHead } from './table';

/** A sortable table heading with an announced direction and visible sort icon. */
export function SortableTableHead({
  label,
  active,
  direction,
  onSort,
  align = 'left',
}: {
  label: string;
  active: boolean;
  direction: 'asc' | 'desc';
  onSort: () => void;
  align?: 'left' | 'right';
}) {
  const Icon = active ? (direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={align === 'right' ? 'px-2 py-2 text-right' : 'px-2 py-2'}
    >
      <button
        type="button"
        onClick={onSort}
        className={`inline-flex items-center gap-1 bg-transparent p-0 text-left normal-case tracking-normal outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${align === 'right' ? 'ml-auto' : ''}`}
      >
        {label}
        <Icon aria-hidden="true" className="size-3 shrink-0" />
      </button>
    </TableHead>
  );
}
