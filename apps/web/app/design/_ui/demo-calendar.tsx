'use client';

import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from './button';
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
  onSelect,
}: {
  month: Date;
  selection: CalendarSelection;
  mode: 'single' | 'range';
  onSelect: (date: string) => void;
}) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const monthTitle = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
    month,
  );
  const start = parseDate(selection.start);
  const end = parseDate(selection.end);

  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
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
          const withinRange = mode === 'range' && start && end && date >= start && date <= end;
          return (
            <button
              key={key}
              type="button"
              aria-label={`Choose ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)}`}
              aria-pressed={selected}
              onClick={() => onSelect(key)}
              className={`flex aspect-square items-center justify-center rounded-full outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ${withinRange ? 'bg-secondary text-primary' : ''} ${selected ? 'bg-primary text-primary-foreground hover:bg-primary-hover' : ''}`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DemoCalendar({
  selection,
  mode,
  onChange,
  months = 1,
}: {
  selection: CalendarSelection;
  mode: 'single' | 'range';
  onChange: (selection: CalendarSelection) => void;
  months?: 1 | 2;
}) {
  const initial = parseDate(selection.start) ?? new Date(2026, 9, 1);
  const [visibleMonth, setVisibleMonth] = useState(
    new Date(initial.getFullYear(), initial.getMonth(), 1),
  );
  const displayedMonths = Array.from(
    { length: months },
    (_, offset) => new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1),
  );

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
            onSelect={selectDate}
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
  className,
}: {
  label: string;
  mode: 'single' | 'range';
  value: CalendarSelection;
  onChange: (value: CalendarSelection) => void;
  months?: 1 | 2;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const labelText = formatCalendarSelection(value, mode);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label={label}
          aria-haspopup="dialog"
          className={`justify-between ${className ?? ''}`}
        >
          <span className={labelText ? 'truncate' : 'text-muted-foreground'}>
            {labelText || (mode === 'range' ? 'Select stay dates' : 'Select a date')}
          </span>
          <CalendarDays aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={months === 2 ? 'w-[min(42rem,calc(100vw-2rem))]' : 'w-72'}
      >
        <DemoCalendar selection={draft} mode={mode} onChange={setDraft} months={months} />
        <div className="mt-3 flex justify-end gap-2 border-t pt-3">
          <Button
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
