'use client';
import { useHotelDateFormat, formatHotelDate } from '../../lib/hotel-date-format';

import { useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';
import { Button } from './button';
import { IconButton } from './icon-button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export type CalendarSelection = { start: string | null; end: string | null };

const defaultSelection: CalendarSelection = { start: null, end: null };

function parseDate(value: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatShort(value: string | null) {
  const date = parseDate(value);
  return date
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date)
    : '';
}

export function formatCalendarSelection(selection: CalendarSelection, mode: 'single' | 'range') {
  const start = parseDate(selection.start);
  const end = parseDate(selection.end);
  if (!start) return '';
  if (mode === 'single' || !end) {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(start);
  }
  const sameMonth =
    start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  return sameMonth
    ? `${start.getDate()}–${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(end)}`
    : `${formatShort(selection.start)} – ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(end)}`;
}

function CalendarMonth({
  month,
  selection,
  mode,
  hoveredDate,
  onHover,
  onSelect,
  minDate,
  dateReason,
}: {
  month: Date;
  selection: CalendarSelection;
  mode: 'single' | 'range';
  hoveredDate: string | null;
  onHover: (date: string | null) => void;
  onSelect: (date: string) => void;
  minDate?: string;
  dateReason?: (date: string) => string | undefined;
}) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const monthTitle = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
    month,
  );
  const start = parseDate(selection.start);
  const end = parseDate(selection.end);

  return (
    <div className="min-w-0 rounded-lg border bg-card p-3" onPointerLeave={() => onHover(null)}>
      <h4 className="mb-2 text-center text-xs font-semibold">{monthTitle}</h4>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
          <span key={day} className="py-1">
            {day}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {Array.from({ length: firstDay }, (_, index) => (
          <span aria-hidden="true" key={`blank-${index}`} />
        ))}
        {Array.from({ length: days }, (_, index) => {
          const day = index + 1;
          const date = new Date(month.getFullYear(), month.getMonth(), day);
          const key = dateKey(date);
          const selected = key === selection.start || key === selection.end;
          const withinRange = Boolean(
            mode === 'range' && start && end && date >= start && date <= end,
          );
          const previewEnd = parseDate(hoveredDate);
          const previewRange = Boolean(
            mode === 'range' &&
            start &&
            !end &&
            previewEnd &&
            previewEnd >= start &&
            date >= start &&
            date <= previewEnd,
          );
          const previewEndpoint =
            mode === 'range' && !end && hoveredDate === key && key !== selection.start;
          const solidRangeDate = selected || withinRange || previewEndpoint;
          const softRangeDate = previewRange && !solidRangeDate;
          const reason =
            minDate !== undefined && key < minDate
              ? 'This date is in the past.'
              : dateReason?.(key);
          const disabled = !!reason;
          const button = (
            <button
              type="button"
              aria-label={`Choose ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)}`}
              aria-pressed={selected}
              aria-disabled={disabled}
              onPointerEnter={() => (disabled ? undefined : onHover(key))}
              onFocus={() => (disabled ? undefined : onHover(key))}
              onClick={() => {
                if (!disabled) onSelect(key);
              }}
              className={`flex w-full aspect-square items-center justify-center rounded-full outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:text-muted-foreground/40 disabled:line-through ${disabled ? 'text-muted-foreground/40 line-through cursor-not-allowed' : ''} ${softRangeDate ? 'bg-neutral-200 text-neutral-800 hover:bg-neutral-300' : ''} ${solidRangeDate && !disabled ? 'bg-neutral-900 text-white hover:bg-neutral-800' : ''}`}
            >
              {day}
            </button>
          );
          return reason ? (
            <Tooltip key={key}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent>{reason}</TooltipContent>
            </Tooltip>
          ) : (
            <span key={key}>{button}</span>
          );
        })}
      </div>
    </div>
  );
}

export function CalendarMonths({
  selection,
  mode,
  onChange,
  months = 1,
  yearNavigation = false,
  minDate,
  dateReason,
  onVisibleWindowChange,
}: {
  selection: CalendarSelection;
  mode: 'single' | 'range';
  onChange: (selection: CalendarSelection) => void;
  months?: 1 | 2;
  yearNavigation?: boolean;
  /** Days before this date (YYYY-MM-DD) cannot be chosen. */
  minDate?: string;
  dateReason?: (date: string) => string | undefined;
  onVisibleWindowChange?: (from: string, to: string) => void;
}) {
  const initial = parseDate(selection.start) ?? parseDate(minDate ?? null) ?? new Date();
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [visibleMonth, setVisibleMonth] = useState(
    new Date(initial.getFullYear(), initial.getMonth(), 1),
  );
  const displayedMonths = Array.from(
    { length: months },
    (_, offset) => new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1),
  );

  useEffect(() => {
    onVisibleWindowChange?.(
      dateKey(visibleMonth),
      dateKey(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + months, 1)),
    );
  }, [visibleMonth, months, onVisibleWindowChange]);

  function moveMonth(direction: -1 | 1) {
    setVisibleMonth(
      (current) => new Date(current.getFullYear(), current.getMonth() + direction, 1),
    );
  }

  function selectDate(value: string) {
    if (mode === 'single') {
      onChange({ start: value, end: null });
      return;
    }
    const currentStart = parseDate(selection.start);
    const currentEnd = parseDate(selection.end);
    const next = parseDate(value)!;
    if (!currentStart || currentEnd || next < currentStart) onChange({ start: value, end: null });
    else onChange({ start: selection.start, end: value });
  }

  return (
    <div className="space-y-2">
      {yearNavigation ? (
        <div className="mb-2 grid grid-cols-2 gap-2">
          <select
            aria-label="Birthday month"
            className="h-9 rounded-md border px-2"
            value={visibleMonth.getMonth()}
            onChange={(e) =>
              setVisibleMonth(new Date(visibleMonth.getFullYear(), Number(e.target.value), 1))
            }
          >
            {Array.from({ length: 12 }, (_, month) => (
              <option key={month} value={month}>
                {new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(
                  new Date(2000, month, 1),
                )}
              </option>
            ))}
          </select>
          <select
            aria-label="Birthday year"
            className="h-9 rounded-md border px-2"
            value={visibleMonth.getFullYear()}
            onChange={(e) =>
              setVisibleMonth(new Date(Number(e.target.value), visibleMonth.getMonth(), 1))
            }
          >
            {Array.from(
              { length: new Date().getFullYear() - 1899 },
              (_, offset) => new Date().getFullYear() - offset,
            ).map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous month"
          onClick={() => moveMonth(-1)}
        >
          <ChevronLeft />
        </Button>
        <span className="text-xs text-muted-foreground">
          {mode === 'range' ? 'Choose a stay date range' : 'Choose a date'}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => moveMonth(1)}>
          <ChevronRight />
        </Button>
      </div>
      <div className={`grid gap-3 ${months === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
        {displayedMonths.map((month) => (
          <CalendarMonth
            key={`${month.getFullYear()}-${month.getMonth()}`}
            month={month}
            selection={selection}
            mode={mode}
            hoveredDate={hoveredDate}
            onHover={setHoveredDate}
            onSelect={selectDate}
            minDate={minDate}
            dateReason={dateReason}
          />
        ))}
      </div>
    </div>
  );
}

export function CalendarPicker({
  label,
  mode,
  value,
  onChange,
  months = 1,
  yearNavigation = false,
  displayFormat,
  className,
  open: controlledOpen,
  onOpenChange,
  iconOnly = false,
  active = false,
  header,
  minDate,
  disabled = false,
  dateReason,
  onVisibleWindowChange,
}: {
  label: string;
  mode: 'single' | 'range';
  value: CalendarSelection;
  onChange: (value: CalendarSelection) => void;
  months?: 1 | 2;
  yearNavigation?: boolean;
  displayFormat?: string;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Show only the calendar icon (name and selection appear on hover), for toolbars. */
  iconOnly?: boolean;
  /** Marks the icon when a range is applied. */
  active?: boolean;
  /** Extra controls shown above the calendar in the popover. */
  header?: ReactNode;
  /** Days before this date (YYYY-MM-DD) cannot be chosen. */
  minDate?: string;
  disabled?: boolean;
  dateReason?: (date: string) => string | undefined;
  onVisibleWindowChange?: (from: string, to: string) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const hotelFormat = useHotelDateFormat();
  const dateFormat = displayFormat || hotelFormat;
  const labelText =
    mode === 'single' && value.start
      ? formatHotelDate(value.start, dateFormat)
      : formatCalendarSelection(value, mode);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        {iconOnly ? (
          <IconButton
            disabled={disabled}
            label={label}
            hint={labelText || undefined}
            aria-haspopup="dialog"
            className="relative"
          >
            <CalendarDays aria-hidden="true" />
            {active ? (
              <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />
            ) : null}
          </IconButton>
        ) : (
          <Button
            variant="outline"
            disabled={disabled}
            aria-label={label}
            aria-haspopup="dialog"
            className={`justify-between ${className ?? ''}`}
          >
            <span className={labelText ? 'truncate' : 'text-muted-foreground'}>
              {labelText || (mode === 'range' ? 'Select stay dates' : 'Select a date')}
            </span>
            <CalendarDays aria-hidden="true" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={months === 2 ? 'w-[min(42rem,calc(100vw-2rem))]' : 'w-72'}
      >
        {header ? <div className="mb-3">{header}</div> : null}
        <CalendarMonths
          selection={draft}
          mode={mode}
          onChange={setDraft}
          months={months}
          yearNavigation={yearNavigation}
          minDate={minDate}
          dateReason={dateReason}
          onVisibleWindowChange={onVisibleWindowChange}
        />
        <div className="mt-3 flex justify-end gap-2 border-t pt-3">
          <Button
            disabled={disabled}
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(defaultSelection);
              onChange(defaultSelection);
              setOpen(false);
            }}
          >
            Clear
          </Button>
          <Button
            size="sm"
            disabled={
              disabled ||
              !!(draft.start && dateReason?.(draft.start)) ||
              !!(draft.end && dateReason?.(draft.end))
            }
            onClick={() => {
              onChange(draft);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
