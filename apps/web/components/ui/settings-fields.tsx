'use client';
import { FormField } from './form-field';
import { FormSection } from './form-section';
import { Input, Textarea } from './input';
import { Switch } from './switch';
import { MultiSelect } from './multi-select';
import { CountrySelect } from './country-select';
import { Combobox } from './combobox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './select';
export type SettingValue = string | boolean | string[];
export type SettingField = {
  key: string;
  label: string;
  kind?:
    | 'text'
    | 'time'
    | 'number'
    | 'textarea'
    | 'boolean'
    | 'choice'
    | 'multi'
    | 'country'
    | 'currency';
  hint?: string;
  options?: readonly { value: string; label: string }[];
  max?: number;
  defaultValue?: SettingValue;
  when?: { key: string; value: string };
};
export type SettingGroup = { title: string; description: string; fields: SettingField[] };
/** Shared field composition for grouped property settings. The caller owns validation and saving. */
export function SettingsFields({
  groups,
  values,
  onChange,
  errors,
  disabled,
  currencyLocked,
}: {
  groups: SettingGroup[];
  values: Record<string, SettingValue>;
  onChange: (key: string, value: SettingValue) => void;
  errors: Record<string, string>;
  disabled: boolean;
  currencyLocked?: boolean;
}) {
  return (
    <>
      {groups.map((group) => (
        <FormSection key={group.title} title={group.title} description={group.description}>
          {group.fields
            .filter((f) => !f.when || values[f.when.key] === f.when.value)
            .map((f) => {
              const id = 'hotel-' + f.key,
                v = values[f.key] ?? '',
                locked = disabled || (f.kind === 'currency' && currencyLocked === true);
              return (
                <FormField
                  key={f.key}
                  htmlFor={id}
                  label={f.label}
                  hint={
                    f.kind === 'currency' && currencyLocked
                      ? 'Prices already exist. Their currencies stay on the rate plans.'
                      : f.hint
                  }
                  error={errors[f.key]}
                >
                  {f.kind === 'boolean' ? (
                    <Switch
                      id={id}
                      checked={v === true}
                      disabled={locked}
                      onCheckedChange={(value) => onChange(f.key, value)}
                    />
                  ) : f.kind === 'country' ? (
                    <CountrySelect
                      value={String(v)}
                      disabled={locked}
                      onChange={(value) => onChange(f.key, value ?? '')}
                    />
                  ) : f.kind === 'multi' ? (
                    <MultiSelect
                      label={f.label}
                      value={v as string[]}
                      disabled={locked}
                      options={f.options ?? []}
                      onChange={(value) => onChange(f.key, value)}
                    />
                  ) : f.kind === 'currency' ? (
                    <Combobox
                      label={f.label}
                      value={String(v)}
                      disabled={locked}
                      options={[
                        { value: '', label: 'Not set' },
                        ...(Intl as unknown as { supportedValuesOf: (k: string) => string[] })
                          .supportedValuesOf('currency')
                          .map((c) => ({ value: c, label: c })),
                      ]}
                      onChange={(value) => onChange(f.key, value)}
                    />
                  ) : f.kind === 'choice' ? (
                    <Select
                      value={String(v) || '__none__'}
                      disabled={locked}
                      onValueChange={(value) => onChange(f.key, value === '__none__' ? '' : value)}
                    >
                      <SelectTrigger id={id}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {f.defaultValue === undefined ? (
                          <SelectItem value="__none__">Not set</SelectItem>
                        ) : null}
                        {f.options?.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : f.kind === 'textarea' ? (
                    <Textarea
                      id={id}
                      rows={4}
                      value={String(v)}
                      maxLength={f.max}
                      disabled={locked}
                      onChange={(e) => onChange(f.key, e.target.value)}
                    />
                  ) : (
                    <Input
                      id={id}
                      type={f.kind === 'time' ? 'time' : 'text'}
                      inputMode={f.kind === 'number' ? 'numeric' : undefined}
                      value={String(v)}
                      disabled={locked}
                      onChange={(e) => onChange(f.key, e.target.value)}
                    />
                  )}
                </FormField>
              );
            })}
        </FormSection>
      ))}
    </>
  );
}
