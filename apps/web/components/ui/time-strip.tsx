'use client';

import { useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { Button } from './button';

export type TimeColumn = { value: number; label: string; group: string; end?: number };

/** Accessible multi-selection of time columns, using the same modifiers with mouse and keyboard. */
export function TimeStrip({
  columns,
  selected,
  onChange,
  initialAnchor = null,
  onAnchorChange,
}: {
  columns: readonly TimeColumn[];
  selected: readonly number[];
  onChange: (values: number[]) => void;
  initialAnchor?: number | null;
  onAnchorChange?: (value: number) => void;
}) {
  const initialIndex = columns.findIndex((column) => column.value === initialAnchor);
  const anchor = useRef<number | null>(initialIndex < 0 ? null : initialIndex);
  const select = (index: number, event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>) => {
    if (event.shiftKey && anchor.current !== null) {
      onChange(
        columns
          .slice(Math.min(anchor.current, index), Math.max(anchor.current, index) + 1)
          .map((c) => c.value),
      );
    } else if (event.ctrlKey || event.metaKey) {
      const value = columns[index].value;
      onChange(
        selected.includes(value)
          ? selected.filter((v) => v !== value)
          : [...selected, value].sort((a, b) => a - b),
      );
      anchor.current = index;
      onAnchorChange?.(columns[index].value);
    } else {
      onChange([columns[index].value]);
      anchor.current = index;
      onAnchorChange?.(columns[index].value);
    }
  };
  const key = (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      select(index, event);
    }
    const next =
      event.key === 'ArrowRight'
        ? Math.min(index + 1, columns.length - 1)
        : event.key === 'ArrowLeft'
          ? Math.max(index - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? columns.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
    if (event.shiftKey) {
      if (anchor.current === null) {
        anchor.current = index;
        onAnchorChange?.(columns[index].value);
      }
      select(next, event);
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Choose a time. Ctrl or Cmd adds times; Shift selects a range. Arrow keys move between times.
      </p>
      <div
        role="group"
        aria-label="Floor times"
        className="flex overflow-x-auto rounded-lg border p-1"
      >
        {columns.map((column, index) => (
          <Button
            key={column.value}
            variant={selected.includes(column.value) ? 'default' : 'ghost'}
            className="h-auto min-w-20 shrink-0 flex-col rounded-none py-2"
            aria-label={`${column.group} ${column.label}`}
            aria-pressed={selected.includes(column.value)}
            onClick={(e) => select(index, e)}
            onKeyDown={(e) => key(index, e)}
          >
            <span className="text-[10px]">{column.group}</span>
            <span>{column.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
