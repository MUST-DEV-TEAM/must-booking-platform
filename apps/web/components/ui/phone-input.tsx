'use client';

import { useMemo } from 'react';

import { dialCountries, findDialCountry } from '../../lib/dial-codes';
import { cleanDigits, LIMITS } from '../../lib/input-rules';
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

/** Splits a saved phone like "+355 686720021" back into country and number (longest prefix wins). */
export function parsePhone(stored: string | null | undefined, fallbackIso = 'AL'): PhoneValue {
  const text = (stored ?? '').trim();
  if (!text.startsWith('+')) return { iso: fallbackIso, number: cleanDigits(text) };
  const digits = cleanDigits(text);
  const match = dialCountries()
    .filter((country) => digits.startsWith(country.prefix.replace('+', '')))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (!match) return { iso: fallbackIso, number: digits };
  // Where several countries share a prefix, keep the default country when it is one of them.
  const sameLength = dialCountries().filter(
    (country) =>
      country.prefix === match.prefix && digits.startsWith(country.prefix.replace('+', '')),
  );
  const chosen = sameLength.find((country) => country.iso === fallbackIso) ?? match;
  return { iso: chosen.iso, number: digits.slice(chosen.prefix.length - 1) };
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
  const prefixDigits = (findDialCountry(value.iso)?.prefix ?? '').replace('+', '').length;
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
        inputMode="numeric"
        autoComplete="tel-national"
        aria-invalid={invalid || undefined}
        disabled={disabled}
        value={value.number}
        onChange={(event) =>
          onChange({
            ...value,
            number: cleanDigits(event.target.value).slice(0, LIMITS.phoneDigits - prefixDigits),
          })
        }
        className="h-full border-0 shadow-none focus-visible:ring-0"
      />
    </div>
  );
}
