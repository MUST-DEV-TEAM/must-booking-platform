'use client';
import { FormField } from './form-field';
import { FormSection } from './form-section';
import { Input, Textarea } from './input';
import { Switch } from './switch';
import { MultiSelect } from './multi-select';
import { CountrySelect } from './country-select';
import { Combobox } from './combobox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './select';
import { SegmentedControl } from './segmented-control';
import { LocationPin } from './location-pin';
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
    | 'currency'
    | 'year'
    | 'decimal'
    | 'region'
    /** Not rated, or 1 to 5 stars, as a row of buttons. */
    | 'stars'
    /** A searchable list of IANA time zones. */
    | 'timezone'
    /** Shown, never edited or saved (for example a count worked out elsewhere). */
    | 'static'
    /** A map pin that writes `pin.latKey` and `pin.lngKey`; the field's own key is not saved. */
    | 'location';
  hint?: string;
  placeholder?: string;
  options?: readonly { value: string; label: string; group?: string }[];
  max?: number;
  defaultValue?: SettingValue;
  when?: { key: string; value: string };
  /** For a region field: the choices per country code; other countries type the region. */
  optionsByCountry?: Record<string, readonly string[]>;
  /** Show only while another field has any value. */
  whenSet?: string;
  /** Show a "used / max" counter under the field. */
  counter?: boolean;
  /** Show only while this switch is off. */
  whenOff?: string;
  /** Marked as required next to the label. */
  required?: boolean;
  /** For a location field: where the pin is saved and which fields make the address to look up. */
  pin?: { latKey: string; lngKey: string; addressKeys: readonly string[] };
};
export type SettingGroup = {
  title: string;
  description: string;
  fields: SettingField[];
  compact?: boolean;
};
/** Every IANA time zone this browser knows, with the saved one kept even if it is not in the list. */
function timeZones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones =
      (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.(
        'timeZone',
      ) ?? [];
  } catch {
    zones = [];
  }
  return !current || zones.includes(current) ? zones : [current, ...zones];
}

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
          <div className={group.compact ? 'grid gap-4 sm:grid-cols-2' : 'flex flex-col gap-4'}>
            {group.fields
              .filter(
                (f) =>
                  (!f.when || values[f.when.key] === f.when.value) &&
                  (!f.whenSet || Boolean(values[f.whenSet])) &&
                  (!f.whenOff || values[f.whenOff] === false),
              )
              .map((f) => {
                const id = 'hotel-' + f.key,
                  v = values[f.key] ?? '',
                  locked = disabled || (f.kind === 'currency' && currencyLocked === true);
                return (
                  <FormField
                    key={f.key}
                    layout={f.kind === 'boolean' ? 'toggle' : 'stack'}
                    className={
                      f.kind === 'boolean' ||
                      (![
                        'time',
                        'number',
                        'choice',
                        'year',
                        'decimal',
                        'region',
                        'timezone',
                        'static',
                      ].includes(f.kind ?? '') &&
                        !(f.kind === undefined && f.max !== undefined && f.max <= 20))
                        ? 'sm:col-span-2'
                        : undefined
                    }
                    htmlFor={id}
                    label={f.label}
                    required={f.required}
                    hint={
                      f.kind === 'currency' && currencyLocked
                        ? 'Prices already exist. Their currencies stay on the rate plans.'
                        : f.counter && f.max
                          ? `${f.hint ? f.hint + ' ' : ''}${String(v).length}/${f.max}`
                          : f.hint
                    }
                    error={errors[f.key]}
                  >
                    {f.kind === 'stars' ? (
                      <SegmentedControl
                        label={f.label}
                        value={String(v)}
                        disabled={locked}
                        onChange={(value) => onChange(f.key, value)}
                        options={[
                          { value: '', label: 'Not rated' },
                          ...['1', '2', '3', '4', '5'].map((n) => ({
                            value: n,
                            label: `${n} ★`,
                            hint: `${n} star${n === '1' ? '' : 's'}`,
                          })),
                        ]}
                      />
                    ) : f.kind === 'timezone' ? (
                      <Combobox
                        label={f.label}
                        value={String(v)}
                        disabled={locked}
                        placeholder="Search time zones…"
                        triggerClassName="w-full"
                        options={timeZones(String(v)).map((zone) => ({
                          value: zone,
                          label: zone.replaceAll('_', ' '),
                        }))}
                        onChange={(value) => onChange(f.key, value)}
                      />
                    ) : f.kind === 'static' ? (
                      <p id={id} className="m-0 text-sm font-semibold">
                        {String(v) || 'Not counted yet'}
                      </p>
                    ) : f.kind === 'location' && f.pin ? (
                      <LocationPin
                        latitude={String(values[f.pin.latKey] ?? '')}
                        longitude={String(values[f.pin.lngKey] ?? '')}
                        address={f.pin.addressKeys
                          .map((key) => String(values[key] ?? '').trim())
                          .filter(Boolean)
                          .join(', ')}
                        disabled={locked}
                        onChange={(lat, lng) => {
                          onChange(f.pin!.latKey, lat);
                          onChange(f.pin!.lngKey, lng);
                        }}
                      />
                    ) : f.kind === 'boolean' ? (
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
                    ) : f.kind === 'year' ? (
                      <Combobox
                        label={f.label}
                        value={String(v)}
                        disabled={locked}
                        placeholder="Type a year…"
                        options={[
                          { value: '', label: 'Not set' },
                          ...Array.from({ length: new Date().getFullYear() - 1799 }, (_, i) =>
                            String(new Date().getFullYear() - i),
                          ).map((year) => ({ value: year, label: year })),
                        ]}
                        onChange={(value) => onChange(f.key, value)}
                      />
                    ) : f.kind === 'region' &&
                      f.optionsByCountry?.[String(values.country ?? '')] ? (
                      <Combobox
                        label={f.label}
                        value={String(v)}
                        disabled={locked}
                        options={[
                          { value: '', label: 'Not set' },
                          ...f.optionsByCountry[String(values.country)]!.map((name) => ({
                            value: name,
                            label: name,
                          })),
                        ]}
                        onChange={(value) => onChange(f.key, value)}
                      />
                    ) : f.kind === 'choice' ? (
                      <Select
                        value={String(v) || '__none__'}
                        disabled={locked}
                        onValueChange={(value) =>
                          onChange(f.key, value === '__none__' ? '' : value)
                        }
                      >
                        <SelectTrigger id={id} className="w-full">
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
                        placeholder={f.placeholder}
                        disabled={locked}
                        onChange={(e) => onChange(f.key, e.target.value)}
                      />
                    ) : (
                      <Input
                        id={id}
                        className={
                          f.kind === 'time' || f.kind === 'number' || f.kind === 'decimal'
                            ? 'sm:max-w-64'
                            : undefined
                        }
                        type={f.kind === 'time' ? 'time' : 'text'}
                        inputMode={
                          f.kind === 'number'
                            ? 'numeric'
                            : f.kind === 'decimal'
                              ? 'decimal'
                              : undefined
                        }
                        placeholder={f.placeholder}
                        value={String(v)}
                        disabled={locked}
                        onChange={(e) => onChange(f.key, e.target.value)}
                      />
                    )}
                  </FormField>
                );
              })}
          </div>
        </FormSection>
      ))}
    </>
  );
}
