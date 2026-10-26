'use client';

import { CalendarPicker } from './calendar-picker';

/**
 * A single date, chosen with the hotel's shared calendar. This is the one way to ask for a date in a form:
 * a plain browser date box looks different on every device and does not follow the hotel's date format, so
 * the lint rule refuses it. The value is a `YYYY-MM-DD` string, empty when no date is chosen.
 */
export function DateField({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Earliest date that can be chosen (`YYYY-MM-DD`). */
  min?: string;
  /** Latest date that can be chosen (`YYYY-MM-DD`). */
  max?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <CalendarPicker
      id={id}
      label={ariaLabel ?? 'Choose a date'}
      mode="single"
      value={{ start: value || null, end: null }}
      onChange={(selection) => onChange(selection.start ?? '')}
      minDate={min || undefined}
      dateReason={
        max ? (date) => (date > max ? 'After the latest allowed date' : undefined) : undefined
      }
      disabled={disabled}
      yearNavigation
      className={className ?? 'w-full justify-between'}
    />
  );
}
