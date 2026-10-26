'use client';

import { Columns3, Rows3 } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from './button';
import { Checkbox } from './checkbox';
import { IconButton } from './icon-button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

/** Lets the person choose which optional columns a table shows. */
export function ColumnChooser<K extends string>({
  labels,
  visible,
  onToggle,
}: {
  labels: Record<K, string>;
  visible: Record<K, boolean>;
  onToggle: (column: K) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label="Columns">
          <Columns3 aria-hidden="true" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-2">
        <p className="m-0 px-2 py-1 text-xs font-semibold">Show columns</p>
        {(Object.keys(labels) as K[]).map((column) => (
          <label
            key={column}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"
          >
            <Checkbox checked={visible[column]} onCheckedChange={() => onToggle(column)} />
            {labels[column]}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Switches between rows with a second line of detail and one-line rows. */
export function DensityToggle({ compact, onToggle }: { compact: boolean; onToggle: () => void }) {
  return (
    <IconButton
      label={compact ? 'Comfortable rows' : 'Compact rows'}
      hint={compact ? 'Showing one line per row' : 'Showing details under each name'}
      aria-pressed={compact}
      onClick={onToggle}
    >
      <Rows3 aria-hidden="true" />
    </IconButton>
  );
}

/** Appears above a table while rows are ticked: how many, what can be done with them, and clear. */
export function BulkBar({
  count,
  noun = 'selected',
  onClear,
  children,
}: {
  count: number;
  noun?: string;
  onClear: () => void;
  children?: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-2 text-xs">
      <span className="font-semibold">
        {count} {noun}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {children}
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear selection
        </Button>
      </div>
    </div>
  );
}
