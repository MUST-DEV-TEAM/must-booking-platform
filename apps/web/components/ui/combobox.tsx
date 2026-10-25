'use client';

import { Check, ChevronDown, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export type ComboboxOption = {
  value: string;
  label: string;
  /** Extra text that also matches the search (for example a prefix). */
  keywords?: string;
  /** Shown on the right of the row. */
  hint?: string;
};

/**
 * A select with a search box, for long lists such as countries. Type to narrow the list, use
 * the arrow keys and Enter, or click. `renderTrigger` lets the caller decide what the closed
 * control shows.
 */
export function Combobox({
  options,
  value,
  onChange,
  label,
  placeholder = 'Search…',
  renderTrigger,
  triggerClassName,
  contentClassName,
  emptyText = 'No match',
  disabled = false,
}: {
  options: readonly ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  /** Accessible name of the control. */
  label: string;
  placeholder?: string;
  renderTrigger?: (selected: ComboboxOption | undefined) => ReactNode;
  triggerClassName?: string;
  contentClassName?: string;
  emptyText?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const selected = options.find((option) => option.value === value);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options;
    return options.filter((option) =>
      `${option.label} ${option.keywords ?? ''} ${option.hint ?? ''}`.toLowerCase().includes(term),
    );
  }, [options, query]);

  const choose = (option: ComboboxOption) => {
    onChange(option.value);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery('');
          setActive(0);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
            triggerClassName,
          )}
        >
          {renderTrigger ? (
            renderTrigger(selected)
          ) : (
            <span className="truncate">{selected?.label ?? placeholder}</span>
          )}
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn('w-72 p-0', contentClassName)}>
        <div className="relative border-b">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            autoFocus
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder={placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, visible.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const option = visible[active];
                if (option) choose(option);
              }
            }}
            className="h-10 w-full bg-transparent pr-3 pl-9 text-sm outline-none"
          />
        </div>
        <ul
          role="listbox"
          aria-label={label}
          className="m-0 max-h-64 list-none overflow-y-auto p-1"
        >
          {visible.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</li>
          ) : (
            visible.map((option, index) => (
              <li key={option.value} role="option" aria-selected={option.value === value}>
                <button
                  type="button"
                  onClick={() => choose(option)}
                  onPointerEnter={() => setActive(index)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm bg-transparent px-2 py-1.5 text-left text-sm outline-none',
                    index === active && 'bg-accent',
                  )}
                >
                  <Check
                    aria-hidden="true"
                    className={cn(
                      'size-4 shrink-0',
                      option.value === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.hint ? (
                    <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
