'use client';
import { Input } from './input';
/** Optional six-digit hex colour with a native picker; invalid drafts stay editable. */
export function ColourField({
  id,
  value,
  disabled,
  invalid,
  onChange,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  const colour = /^#[0-9a-f]{6}$/i.test(value) ? value : '#141414';
  return (
    <div className="flex max-w-sm items-center gap-2">
      <span
        aria-hidden="true"
        className="size-8 shrink-0 rounded-md border"
        style={{ backgroundColor: colour }}
      />
      <Input
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={invalid}
        placeholder="#123ABC"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        id={`${id}-picker`}
        type="color"
        aria-label="Pick brand colour"
        value={colour}
        disabled={disabled}
        className="h-9 w-10 shrink-0 cursor-pointer rounded border bg-card p-1 disabled:cursor-not-allowed disabled:opacity-50"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
