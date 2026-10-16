'use client';

import { Input } from './input';

/** Keeps digits and one decimal point, with at most two decimals. */
export function cleanMoney(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, '');
  const [whole = '', ...rest] = cleaned.split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
}

/** An amount of money with the currency shown inside the field. */
export function MoneyInput({
  value,
  onChange,
  currency,
  id,
  invalid = false,
  placeholder = '0.00',
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  currency: string;
  id?: string;
  invalid?: boolean;
  placeholder?: string;
  'aria-label'?: string;
}) {
  const symbol = new Intl.NumberFormat(undefined, { style: 'currency', currency })
    .formatToParts(0)
    .find((part) => part.type === 'currency')?.value;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
        {symbol ?? currency}
      </span>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        className="pl-8"
        value={value}
        onChange={(event) => onChange(cleanMoney(event.target.value))}
      />
    </div>
  );
}
