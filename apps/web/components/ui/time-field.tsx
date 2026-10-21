'use client';

import { Clock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '../../lib/utils';
import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

const ROW = 36;
const VISIBLE_ROWS = 5;
const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));

/** One scrolling column of a wheel: the row in the middle band is the chosen one. */
function Wheel({
  items,
  value,
  unit,
  onPick,
  label,
}: {
  items: readonly string[];
  value: string;
  unit: string;
  onPick: (item: string) => void;
  label: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const settle = useRef<number | undefined>(undefined);

  // Start with the chosen row in the middle band.
  useEffect(() => {
    const index = Math.max(0, items.indexOf(value));
    if (list.current) list.current.scrollTop = index * ROW;
    // Only on first show; later changes come from scrolling or clicking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pad = ((VISIBLE_ROWS - 1) / 2) * ROW;
  return (
    <div className="relative min-w-0 flex-1" style={{ height: ROW * VISIBLE_ROWS }}>
      <div
        ref={list}
        role="listbox"
        aria-label={label}
        tabIndex={0}
        className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ paddingBlock: pad }}
        onScroll={(event) => {
          const element = event.currentTarget;
          window.clearTimeout(settle.current);
          settle.current = window.setTimeout(() => {
            const item =
              items[Math.min(items.length - 1, Math.max(0, Math.round(element.scrollTop / ROW)))];
            if (item && item !== value) onPick(item);
          }, 80);
        }}
        onKeyDown={(event) => {
          const index = items.indexOf(value);
          const next =
            event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 : index;
          if (next !== index && items[next]) {
            event.preventDefault();
            onPick(items[next]!);
            list.current?.scrollTo({ top: next * ROW, behavior: 'smooth' });
          }
        }}
      >
        {items.map((item, index) => (
          <button
            key={item}
            type="button"
            role="option"
            aria-selected={item === value}
            tabIndex={-1}
            onClick={() => {
              onPick(item);
              list.current?.scrollTo({ top: index * ROW, behavior: 'smooth' });
            }}
            className={cn(
              'flex w-full snap-center items-center justify-center bg-transparent text-base text-muted-foreground outline-none transition-colors',
              item === value && 'font-bold text-foreground',
            )}
            style={{ height: ROW }}
          >
            {item}
          </button>
        ))}
      </div>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs font-semibold text-muted-foreground"
      >
        {unit}
      </span>
    </div>
  );
}

/**
 * A time of day (24-hour, "HH:MM") picked from two scrolling wheels, hours on one half and minutes
 * on the other, with the chosen time in the highlighted middle band. `defaultValue` adds a
 * one-click shortcut (for example the hotel check-in time).
 */
export function TimeField({
  value,
  onChange,
  label,
  id,
  placeholder = 'Select a time',
  defaultValue,
  defaultLabel = 'Use default',
  min,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  id?: string;
  placeholder?: string;
  defaultValue?: string;
  defaultLabel?: string;
  min?: string;
}) {
  const [open, setOpen] = useState(false);
  const pick = (next: string) => onChange(min && next && next < min ? min : next);
  const [hour = '12', minute = '00'] = value ? value.split(':') : [];
  // Remount the wheels when a shortcut changes the value from outside so they jump to it.
  const [wheelKey, setWheelKey] = useState(0);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && !value) pick(min || '12:00');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          aria-label={label}
          className="w-full justify-between font-normal"
        >
          <span className={value ? '' : 'text-muted-foreground'}>{value || placeholder}</span>
          <Clock aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3 p-3">
        <div className="relative">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-1/2 z-0 -translate-y-1/2 rounded-lg bg-muted"
            style={{ height: ROW }}
          />
          <div className="relative z-10 flex gap-1">
            <Wheel
              key={`h-${wheelKey}`}
              label="Hours"
              unit="hours"
              items={min ? hours.filter((h) => h >= min.slice(0, 2)) : hours}
              value={hour}
              onPick={(next) => pick(`${next}:${minute}`)}
            />
            <Wheel
              key={`m-${wheelKey}`}
              label="Minutes"
              unit="min"
              items={
                min && hour === min.slice(0, 2)
                  ? minutes.filter((m) => m >= min.slice(3, 5))
                  : minutes
              }
              value={minute}
              onPick={(next) => pick(`${hour}:${next}`)}
            />
          </div>
        </div>
        <div className="space-y-2 border-t pt-2">
          {defaultValue ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                onChange(defaultValue);
                setWheelKey((key) => key + 1);
              }}
            >
              {defaultLabel} ({defaultValue})
            </Button>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              Clear
            </Button>
            <Button size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
