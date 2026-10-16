'use client';

import { Clock } from 'lucide-react';
import { useState } from 'react';

import { cn } from '../../lib/utils';
import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const minutes = ['00', '15', '30', '45'];

/**
 * A time of day (24-hour, "HH:MM") chosen from an hour list and a minute list in a small
 * popover. `defaultValue` adds a one-click "Use …" shortcut (for example the hotel check-in time).
 */
export function TimeField({
  value,
  onChange,
  label,
  id,
  placeholder = 'Select a time',
  defaultValue,
  defaultLabel = 'Use default',
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  id?: string;
  placeholder?: string;
  defaultValue?: string;
  defaultLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hour, minute] = value ? value.split(':') : ['', ''];

  const set = (nextHour: string, nextMinute: string) => onChange(`${nextHour || '12'}:${nextMinute || '00'}`);
  const column = (items: string[], current: string | undefined, pick: (item: string) => void, name: string) => (
    <div role="listbox" aria-label={name} className="relative flex max-h-56 flex-col gap-0.5 overflow-y-auto pr-1">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          role="option"
          aria-selected={item === current}
          ref={
            item === current
              ? (element) => {
                  // Open the list with the chosen time in view.
                  const list = element?.parentElement;
                  if (element && list) list.scrollTop = element.offsetTop - list.clientHeight / 2 + element.clientHeight / 2;
                }
              : undefined
          }
          onClick={() => pick(item)}
          className={cn(
            'w-12 rounded-md bg-transparent py-1.5 text-center text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
            item === current && 'bg-primary text-primary-foreground hover:bg-primary',
          )}
        >
          {item}
        </button>
      ))}
    </div>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" aria-label={label} className="w-full justify-between font-normal">
          <span className={value ? '' : 'text-muted-foreground'}>{value || placeholder}</span>
          <Clock aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto space-y-3 p-3">
        <div className="flex items-start gap-2">
          {column(hours, hour, (item) => set(item, minute ?? ''), 'Hour')}
          <span aria-hidden="true" className="pt-1.5 text-sm font-semibold">
            :
          </span>
          {column(minutes, minute, (item) => set(hour ?? '', item), 'Minute')}
        </div>
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          {defaultValue ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange(defaultValue);
                setOpen(false);
              }}
            >
              {defaultLabel} ({defaultValue})
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-1">
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
