'use client';
import { COUNTRY_CODES } from '@must/domain-contracts';
import { Combobox } from './combobox';
/** Optional assigned-country picker; never derives origin from a telephone prefix or nationality. */
export function CountrySelect({
  value,
  onChange,
  disabled = false,
  label = 'Country',
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const options = COUNTRY_CODES.map((code) => ({
    value: code,
    label: names.of(code) ?? code,
  })).sort((a, b) => a.label.localeCompare(b.label));
  return (
    <Combobox
      label={label}
      value={value || ''}
      onChange={(v) => onChange(v || null)}
      disabled={disabled}
      options={[{ value: '', label: 'Not recorded' }, ...options]}
    />
  );
}
