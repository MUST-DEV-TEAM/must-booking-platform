'use client';

import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Badge } from './badge';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

export type MultiSelectOption = {
  value: string;
  label: string;
  description?: string;
  group?: string;
  disabled?: boolean;
  disabledReason?: string;
  icon?: ReactNode;
};

/** A searchable, grouped multi-select with removable chips and checkbox options. */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Choose options',
  label,
  error,
  disabled = false,
  searchable,
  emptyText = 'No options match your search.',
  onCreateOption,
  footer,
}: {
  options: readonly MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  /** Accessible name of the control. */
  label: string;
  error?: string | boolean;
  disabled?: boolean;
  /** Defaults to true when there are more than eight options. */
  searchable?: boolean;
  emptyText?: string;
  onCreateOption?: (name: string) => Promise<void>;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();
  const controlId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const selected = new Set(value);
  const optionByValue = new Map(options.map((option) => [option.value, option]));
  const selectedOptions = value.map(
    (selectedValue) =>
      optionByValue.get(selectedValue) ?? { value: selectedValue, label: selectedValue },
  );
  const showSearch = searchable ?? options.length > 8;
  const isInvalid = Boolean(error);
  const errorMessage = typeof error === 'string' ? error : undefined;
  const optionIsDisabled = (option: MultiSelectOption) =>
    disabled || Boolean(option.disabled || option.disabledReason);

  const visibleOptions = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return options;
    return options.filter((option) =>
      `${option.label} ${option.description ?? ''} ${option.group ?? ''}`
        .toLocaleLowerCase()
        .includes(term),
    );
  }, [options, query]);

  const visibleGroups = new Map<string, MultiSelectOption[]>();
  for (const option of visibleOptions) {
    if (!option.group) continue;
    const groupOptions = visibleGroups.get(option.group) ?? [];
    groupOptions.push(option);
    visibleGroups.set(option.group, groupOptions);
  }

  const setOpenAndResetSearch = (next: boolean) => {
    setOpen(next);
    if (next) setQuery('');
  };

  const toggle = (option: MultiSelectOption) => {
    if (optionIsDisabled(option)) return;
    if (selected.has(option.value)) {
      onChange(value.filter((item) => item !== option.value));
    } else {
      onChange([...value, option.value]);
    }
  };

  const removeLast = () => {
    if (disabled) return;
    const index = [...value].reverse().findIndex((item) => !optionByValue.get(item)?.disabled);
    if (index < 0) return;
    const actualIndex = value.length - index - 1;
    onChange(value.filter((_, itemIndex) => itemIndex !== actualIndex));
  };

  const changeGroup = (group: string, clear: boolean) => {
    if (disabled) return;
    const enabled = options.filter((option) => option.group === group && !optionIsDisabled(option));
    const groupValues = new Set(enabled.map((option) => option.value));
    if (clear) onChange(value.filter((item) => !groupValues.has(item)));
    else
      onChange([
        ...value,
        ...enabled.map((option) => option.value).filter((item) => !selected.has(item)),
      ]);
  };

  const focusOption = (from: Element | null, direction: -1 | 1) => {
    const rows = Array.from(
      contentRef.current?.querySelectorAll<HTMLButtonElement>('[data-multi-select-option]') ?? [],
    );
    if (!rows.length) return;
    const currentIndex = from ? rows.indexOf(from as HTMLButtonElement) : -1;
    const nextIndex =
      currentIndex < 0
        ? direction === 1
          ? 0
          : rows.length - 1
        : (currentIndex + direction + rows.length) % rows.length;
    rows[nextIndex]?.focus();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || event.target !== event.currentTarget) return;
    if (event.key === 'Backspace' && value.length > 0) {
      event.preventDefault();
      removeLast();
    } else if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpenAndResetSearch(true);
    }
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(null, 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(null, -1);
    } else if (event.key === 'Backspace' && query.length === 0 && value.length > 0) {
      event.preventDefault();
      removeLast();
    }
  };

  const renderOption = (option: MultiSelectOption) => {
    const checked = selected.has(option.value);
    const optionDisabled = optionIsDisabled(option);
    const button = (
      <button
        key={option.value}
        type="button"
        role="checkbox"
        aria-label={option.label}
        aria-checked={checked}
        aria-disabled={optionDisabled || undefined}
        title={option.disabledReason}
        data-multi-select-option
        onClick={() => toggle(option)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            focusOption(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
          } else if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            if (!optionDisabled) toggle(option);
          }
        }}
        className={`flex w-full items-start gap-2 rounded-md bg-transparent p-2 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 ${optionDisabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent'}`}
      >
        <span
          aria-hidden="true"
          className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border ${checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card'}`}
        >
          {checked ? <Check className="size-3 stroke-[3]" /> : null}
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            {option.icon}
            {option.label}
          </span>
          {option.description ? (
            <span className="block text-xs text-muted-foreground">{option.description}</span>
          ) : null}
        </span>
      </button>
    );

    return option.disabledReason ? (
      <Tooltip key={option.value}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{option.disabledReason}</TooltipContent>
      </Tooltip>
    ) : (
      button
    );
  };

  return (
    <div className="min-w-0 space-y-1">
      <Popover open={open} onOpenChange={setOpenAndResetSearch}>
        <PopoverTrigger asChild>
          <div
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-controls={`${controlId}-options`}
            aria-invalid={isInvalid || undefined}
            aria-describedby={errorMessage ? `${controlId}-error` : undefined}
            aria-disabled={disabled || undefined}
            aria-haspopup="dialog"
            tabIndex={disabled ? -1 : 0}
            data-slot="multi-select"
            onKeyDown={onTriggerKeyDown}
            className={`flex min-h-10 min-w-0 flex-wrap items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 ${isInvalid ? 'border-destructive' : 'border-input'} ${disabled ? 'cursor-not-allowed bg-muted text-muted-foreground opacity-60' : 'cursor-pointer'}`}
          >
            {selectedOptions.length ? (
              selectedOptions.map((option) => (
                <Badge
                  key={option.value}
                  variant="secondary"
                  className="max-w-full min-w-0 shrink gap-1 px-1.5 py-0.5 text-[10px] font-medium"
                >
                  {option.icon}
                  <span className="min-w-0 truncate">{option.label}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${option.label}`}
                    disabled={disabled || Boolean(option.disabled)}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!disabled && !option.disabled) {
                        onChange(value.filter((item) => item !== option.value));
                      }
                    }}
                    className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-transparent p-0 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
                  >
                    <X aria-hidden="true" className="size-3" />
                  </button>
                </Badge>
              ))
            ) : (
              <span className="min-w-0 flex-1 px-1 text-muted-foreground">{placeholder}</span>
            )}
            <span aria-hidden="true" className="ml-auto flex h-7 shrink-0 items-center px-1">
              <ChevronDown className="size-4 text-muted-foreground" />
            </span>
          </div>
        </PopoverTrigger>
        <PopoverContent
          id={`${controlId}-options`}
          align="start"
          className="w-[min(24rem,calc(100vw-2rem))] p-2"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpenAndResetSearch(false);
            }
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (showSearch) searchRef.current?.focus();
            else
              contentRef.current
                ?.querySelector<HTMLButtonElement>('[data-multi-select-option]')
                ?.focus();
          }}
        >
          <div ref={contentRef} className="space-y-2">
            <h3 data-slot="multi-select-heading" className="m-0 px-2 text-sm font-semibold">
              Choose {label.toLocaleLowerCase()}
            </h3>
            {showSearch ? (
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  ref={searchRef}
                  aria-label={`Search ${label.toLocaleLowerCase()}`}
                  placeholder={`Search ${label.toLocaleLowerCase()}`}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onSearchKeyDown}
                  className="h-9 w-full rounded-md border border-input bg-transparent pr-3 pl-9 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
            ) : null}
            {visibleOptions.length === 0 ? (
              <p className="m-0 px-2 py-3 text-sm text-muted-foreground">{emptyText}</p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto" role="group" aria-label={label}>
                {visibleOptions.some((option) => !option.group)
                  ? visibleOptions.filter((option) => !option.group).map(renderOption)
                  : null}
                {[...visibleGroups.entries()].map(([group, groupOptions]) => {
                  const enabled = options.filter(
                    (option) => option.group === group && !optionIsDisabled(option),
                  );
                  const groupValues = enabled.map((option) => option.value);
                  const canEditGroup = !disabled && enabled.length > 0;
                  return (
                    <section key={group} aria-label={group} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 border-b px-2 pb-1">
                        <h3 className="m-0 text-xs font-semibold text-muted-foreground">{group}</h3>
                        <div className="flex shrink-0 items-center gap-2 text-xs">
                          <button
                            type="button"
                            aria-label={`Select all ${group}`}
                            disabled={!canEditGroup}
                            onClick={() => changeGroup(group, false)}
                            className="bg-transparent p-0 font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
                          >
                            Select all
                          </button>
                          <button
                            type="button"
                            aria-label={`Clear ${group}`}
                            disabled={
                              !canEditGroup || !groupValues.some((item) => selected.has(item))
                            }
                            onClick={() => changeGroup(group, true)}
                            className="bg-transparent p-0 font-medium text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      {groupOptions.map(renderOption)}
                    </section>
                  );
                })}
              </div>
            )}
            {onCreateOption &&
            query.trim() &&
            !options.some(
              (option) => option.label.toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
            ) ? (
              <button
                type="button"
                disabled={creating || disabled}
                className="w-full rounded-md bg-transparent p-2 text-left text-sm font-medium text-primary hover:bg-accent disabled:opacity-50"
                onClick={async () => {
                  setCreating(true);
                  setCreateError(undefined);
                  try {
                    await onCreateOption(query.trim());
                    setQuery('');
                  } catch (error) {
                    setCreateError(
                      error instanceof Error ? error.message : 'Unable to create option.',
                    );
                  } finally {
                    setCreating(false);
                  }
                }}
              >
                {creating ? 'Creating…' : `Create '${query.trim()}'`}
              </button>
            ) : null}
            {createError ? (
              <p role="alert" className="m-0 px-2 text-xs text-destructive">
                {createError}
              </p>
            ) : null}
            {!query.trim() ? footer : null}
          </div>
        </PopoverContent>
      </Popover>
      {errorMessage ? (
        <p id={`${controlId}-error`} role="alert" className="m-0 text-xs text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
