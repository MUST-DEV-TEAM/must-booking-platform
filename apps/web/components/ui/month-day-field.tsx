'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** A yearly date without a year ("15 June"): a month and a day. The value is "MM-DD" or empty. */
export function MonthDayField({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name of the control. */
  label: string;
  disabled?: boolean;
}) {
  const [month = '', day = ''] = value ? value.split('-') : [];
  const days = month ? DAYS_IN_MONTH[Number(month) - 1]! : 31;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <div className="flex gap-2">
      <Select
        value={month || '__none__'}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === '__none__') return onChange('');
          const clamped = Math.min(Number(day || 1), DAYS_IN_MONTH[Number(next) - 1]!);
          onChange(`${next}-${pad(clamped)}`);
        }}
      >
        <SelectTrigger aria-label={`${label} month`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Not set</SelectItem>
          {MONTHS.map((name, index) => (
            <SelectItem key={name} value={pad(index + 1)}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={day || '__none__'}
        disabled={disabled || !month}
        onValueChange={(next) => onChange(`${month}-${next}`)}
      >
        <SelectTrigger aria-label={`${label} day`} className="w-24 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {!day ? <SelectItem value="__none__">Day</SelectItem> : null}
          {Array.from({ length: days }, (_, index) => pad(index + 1)).map((d) => (
            <SelectItem key={d} value={d}>
              {Number(d)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
