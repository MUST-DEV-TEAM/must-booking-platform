'use client';

import { useMemo } from 'react';

import { dialCountries, findDialCountry } from '../../lib/dial-codes';
import { Combobox } from './combobox';
import { Input } from './input';

/** The chosen country (by ISO code, because several countries share +1 or +7) and the number. */
export type PhoneValue = { iso: string; number: string };

/** The phone text as it is stored: prefix and number joined, or nothing when the number is empty. */
export function phoneToString(value: PhoneValue): string {
  const number = value.number.trim();
  const prefix = findDialCountry(value.iso)?.prefix ?? '';
  return number ? `${prefix} ${number}`.trim() : '';
}

/** A phone number with a searchable country-prefix choice joined to the front of the field. */
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
  const options = useMemo(
    () =>
      dialCountries().map((country) => ({
        value: country.iso,
        label: country.name,
        hint: country.prefix,
        keywords: `${country.iso} ${country.prefix.replace('+', '')}`,
      })),
    [],
  );
  return (
    <div
      className={
        invalid
          ? 'flex h-9 overflow-hidden rounded-md border border-destructive bg-card'
          : 'flex h-9 overflow-hidden rounded-md border border-input bg-card'
      }
    >
      <Combobox
        label="Country prefix"
        placeholder="Search country or prefix"
        options={options}
        value={value.iso}
        onChange={(iso) => onChange({ ...value, iso })}
        disabled={disabled}
        triggerClassName="h-full w-[6.5rem] shrink-0 rounded-none border-0 border-r bg-transparent px-2 text-xs shadow-none"
        contentClassName="w-80"
        renderTrigger={(selected) => (
          <span className="truncate font-semibold">
            {selected ? `${selected.value} ${selected.hint}` : 'Prefix'}
          </span>
        )}
      />
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
