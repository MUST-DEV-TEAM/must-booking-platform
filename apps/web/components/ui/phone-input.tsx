'use client';

import { Input } from './input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

export type PhoneValue = { prefix: string; number: string };

const prefixes: ReadonlyArray<{ prefix: string; label: string }> = [
  { prefix: '+355', label: '+355 · AL' },
  { prefix: '+383', label: '+383 · XK' },
  { prefix: '+389', label: '+389 · MK' },
  { prefix: '+382', label: '+382 · ME' },
  { prefix: '+381', label: '+381 · RS' },
  { prefix: '+385', label: '+385 · HR' },
  { prefix: '+30', label: '+30 · GR' },
  { prefix: '+39', label: '+39 · IT' },
  { prefix: '+49', label: '+49 · DE' },
  { prefix: '+43', label: '+43 · AT' },
  { prefix: '+41', label: '+41 · CH' },
  { prefix: '+33', label: '+33 · FR' },
  { prefix: '+34', label: '+34 · ES' },
  { prefix: '+31', label: '+31 · NL' },
  { prefix: '+44', label: '+44 · UK' },
  { prefix: '+1', label: '+1 · US/CA' },
  { prefix: '+90', label: '+90 · TR' },
];

/** The phone text as it is stored: prefix and number joined, or nothing when the number is empty. */
export function phoneToString(value: PhoneValue): string {
  const number = value.number.trim();
  return number ? `${value.prefix} ${number}` : '';
}

/** A phone number with a country-prefix choice joined to the front of the field. */
export function PhoneInput({
  value,
  onChange,
  id,
  invalid = false,
  disabled = false,
}: {
  value: PhoneValue;
  onChange: (value: PhoneValue) => void;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className={
        invalid
          ? 'flex h-9 overflow-hidden rounded-md border border-destructive bg-card'
          : 'flex h-9 overflow-hidden rounded-md border border-input bg-card'
      }
    >
      <Select
        value={value.prefix}
        onValueChange={(prefix) => onChange({ ...value, prefix })}
        disabled={disabled}
      >
        <SelectTrigger
          aria-label="Phone prefix"
          className="h-full w-[6.5rem] shrink-0 rounded-none border-0 border-r bg-transparent px-2 text-xs shadow-none focus-visible:ring-0"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {prefixes.map((entry) => (
            <SelectItem key={entry.prefix} value={entry.prefix}>
              {entry.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        aria-invalid={invalid || undefined}
        disabled={disabled}
        value={value.number}
        onChange={(event) => onChange({ ...value, number: event.target.value })}
        className="h-full border-0 shadow-none focus-visible:ring-0"
      />
    </div>
  );
}
