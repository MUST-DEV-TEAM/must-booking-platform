'use client';
import { Checkbox } from './checkbox';
import { Label } from './label';
/** Accessible labelled boolean setting, reused by configuration forms. */
export function SettingToggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Label className="flex items-center gap-2">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      {label}
    </Label>
  );
}
