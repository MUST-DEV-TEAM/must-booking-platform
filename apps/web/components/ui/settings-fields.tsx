'use client';
import { currentCurrencyCodes } from '../../lib/currencies';
import { FormField } from './form-field';
import { FormSection } from './form-section';
import { Input, Textarea } from './input';
import { Switch } from './switch';
import { MultiSelect } from './multi-select';
import { CountrySelect } from './country-select';
import { Combobox } from './combobox';
import { MonthDayField } from './month-day-field';
import { WeekdayChips } from './weekday-chips';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './select';
import { SegmentedControl } from './segmented-control';
import { Checkbox } from './checkbox';
import { Badge } from './badge';
import { Label } from './label';
import type { ReactNode } from 'react';
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
    /** Drawn by the caller: its element is passed in `extras` under this field's key. */
    | 'custom'
    /** A map pin that writes `pin.latKey` and `pin.lngKey`; the field's own key is not saved. */
    | 'location'
    /** A month and a day of the year (a yearly season start or end). */
    | 'monthday'
    /** Seven weekday chips. */
    | 'weekdays';
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
  /** Keep the label for screen readers only. */
  hideLabel?: boolean;
  /** How much of the row the field takes: the whole row, half of it, or a third. Default: by kind. */
  span?: 'full' | 'half' | 'third';
  /** For a read-only field: a short note inside the box, for example "from Accommodations". */
  suffix?: string;
  /** For a yes/no field: draw it as a bordered row (title and help left, switch right). */
  boxed?: boolean;
  /** For a yes/no field: draw it as a tickbox with its label beside it. */
  checkbox?: boolean;
  /** Type the value in a fixed-width font (codes and numbers). */
  mono?: boolean;
  /** Help text that depends on the chosen country; `hint` is used for any other country. */
  hintByCountry?: Record<string, string>;
  /** Drawn by the field before it, as a tickbox under it, instead of as a field of its own. */
  inlineWith?: string;
  /** For a location field: where the pin is saved and which fields make the address to look up. */
  pin?: { latKey: string; lngKey: string; addressKeys: readonly string[] };
};
export type SettingGroup = {
  title: string;
  description: string;
  fields: SettingField[];
  compact?: boolean;
};
/** "EUR · Euro". */
function currencyLabel(code: string): string {
  if (!code) return 'Not set';
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'currency' }).of(code);
    return name && name !== code ? `${code} · ${name}` : code;
  } catch {
    return code;
  }
}

/** The zone most hotels in these countries use, offered first as "suggested". */
const SUGGESTED_ZONE: Record<string, string> = {
  AL: 'Europe/Tirane',
  XK: 'Europe/Belgrade',
  ME: 'Europe/Podgorica',
  MK: 'Europe/Skopje',
  RS: 'Europe/Belgrade',
  GR: 'Europe/Athens',
  IT: 'Europe/Rome',
  HR: 'Europe/Zagreb',
  BA: 'Europe/Sarajevo',
  BG: 'Europe/Sofia',
  TR: 'Europe/Istanbul',
  DE: 'Europe/Berlin',
  FR: 'Europe/Paris',
  ES: 'Europe/Madrid',
  GB: 'Europe/London',
  US: 'America/New_York',
};
const offsets = new Map<string, string>();
/** "UTC+1" for a zone, today. */
function utcOffset(zone: string): string {
  let text = offsets.get(zone);
  if (text === undefined) {
    try {
      const part = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName')?.value;
      text = (part ?? '').replace('GMT', 'UTC');
      if (text === 'UTC') text = 'UTC+0';
    } catch {
      text = '';
    }
    offsets.set(zone, text);
  }
  return text;
}

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
  currencyBadge,
  extras,
}: {
  groups: SettingGroup[];
  values: Record<string, SettingValue>;
  onChange: (key: string, value: SettingValue) => void;
  errors: Record<string, string>;
  disabled: boolean;
  currencyLocked?: boolean;
  /** The note shown in a locked currency box, for example "From Clock · Locked". */
  currencyBadge?: string;
  /** Elements for `custom` fields, by field key. A custom field with no element is not shown. */
  extras?: Record<string, ReactNode>;
}) {
  return (
    <>
      {groups.map((group) => (
        <FormSection key={group.title} title={group.title} description={group.description}>
          <div className={group.compact ? 'grid gap-4 sm:grid-cols-6' : 'flex flex-col gap-4'}>
            {group.fields
              .filter(
                (f) =>
                  (!f.when || values[f.when.key] === f.when.value) &&
                  (!f.whenSet || Boolean(values[f.whenSet])) &&
                  (!f.whenOff || values[f.whenOff] === false) &&
                  !f.inlineWith &&
                  !(f.kind === 'custom' && !extras?.[f.key]),
              )
              .map((f) => {
                const id = 'hotel-' + f.key,
                  v = values[f.key] ?? '',
                  locked = disabled || (f.kind === 'currency' && currencyLocked === true);
                if (f.boxed && f.kind === 'boolean')
                  // Laid out like the field beside it: an empty label row, then a row level with the
                  // input (title left, switch right), then the help text level with its hint.
                  return (
                    <div key={f.key} className="flex min-w-0 flex-col gap-1.5 sm:col-span-3">
                      <span aria-hidden="true" className="hidden h-3.5 sm:block" />
                      <div className="flex min-h-9 items-center justify-between gap-4">
                        <Label htmlFor={id} className="text-sm font-medium">
                          {f.label}
                        </Label>
                        <Switch
                          id={id}
                          checked={v === true}
                          disabled={locked}
                          onCheckedChange={(value) => onChange(f.key, value)}
                        />
                      </div>
                      {f.hint ? (
                        <p className="m-0 text-xs text-muted-foreground">{f.hint}</p>
                      ) : null}
                    </div>
                  );
                return (
                  <FormField
                    key={f.key}
                    labelHidden={
                      f.kind === 'location' || f.checkbox === true || f.hideLabel === true
                    }
                    layout={f.kind === 'boolean' && !f.checkbox ? 'toggle' : 'stack'}
                    className={
                      f.boxed
                        ? 'sm:col-span-3 sm:mt-[1.3rem] sm:self-start'
                        : f.span === 'half'
                          ? 'sm:col-span-3'
                          : f.span === 'third'
                            ? 'sm:col-span-2'
                            : f.span === 'full'
                              ? 'sm:col-span-6'
                              : f.kind === 'boolean' ||
                                  (![
                                    'time',
                                    'number',
                                    'choice',
                                    'year',
                                    'decimal',
                                    'region',
                                    'timezone',
                                    'static',
                                    'monthday',
                                  ].includes(f.kind ?? '') &&
                                    !(f.kind === undefined && f.max !== undefined && f.max <= 20))
                                ? 'sm:col-span-6'
                                : 'sm:col-span-3'
                    }
                    htmlFor={id}
                    label={f.label}
                    required={f.required}
                    hint={
                      f.kind === 'currency'
                        ? `Prices, payments and refunds use it.${currencyLocked ? ' Locked because bookings exist.' : ''}`
                        : f.counter && f.max
                          ? `${f.hint ? f.hint + ' ' : ''}${String(v).length} / ${f.max}`
                          : (f.hintByCountry?.[String(values.country ?? '')] ?? f.hint)
                    }
                    error={errors[f.key]}
                  >
                    {f.kind === 'custom' ? (
                      extras?.[f.key]
                    ) : f.kind === 'currency' && currencyLocked ? (
                      <div className="flex h-9 items-center justify-between gap-2 rounded-md border bg-muted px-3 text-sm">
                        <span>{currencyLabel(String(v))}</span>
                        <Badge variant="secondary">{currencyBadge ?? 'Locked'}</Badge>
                      </div>
                    ) : f.kind === 'stars' ? (
                      <div className="flex flex-col gap-2">
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
                        {group.fields
                          .filter((other) => other.inlineWith === f.key && v !== '')
                          .map((other) => (
                            <label key={other.key} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={values[other.key] === true}
                                disabled={locked}
                                onCheckedChange={(value) => onChange(other.key, value === true)}
                              />
                              {other.label}
                            </label>
                          ))}
                      </div>
                    ) : f.kind === 'timezone' ? (
                      <Combobox
                        label={f.label}
                        value={String(v)}
                        disabled={locked}
                        placeholder="Search time zones…"
                        triggerClassName="w-full"
                        options={timeZones(String(v)).map((zone) => {
                          const suggested = SUGGESTED_ZONE[String(values.country ?? '')] === zone;
                          const notes = [utcOffset(zone), suggested ? 'suggested' : ''].filter(
                            Boolean,
                          );
                          return {
                            value: zone,
                            label: `${zone.replaceAll('_', ' ')}${notes.length ? ` (${notes.join(', ')})` : ''}`,
                          };
                        })}
                        onChange={(value) => onChange(f.key, value)}
                      />
                    ) : f.kind === 'static' ? (
                      <div
                        id={id}
                        className="flex h-9 items-center justify-between gap-2 rounded-md border bg-muted px-3 text-sm"
                      >
                        <span>{String(v) || 'Not counted yet'}</span>
                        {f.suffix ? (
                          <span className="text-xs text-muted-foreground">{f.suffix}</span>
                        ) : null}
                      </div>
                    ) : f.kind === 'location' && f.pin ? (
                      <LocationPin
                        latitude={String(values[f.pin.latKey] ?? '')}
                        longitude={String(values[f.pin.lngKey] ?? '')}
                        address={f.pin.addressKeys
                          .map((key) => String(values[key] ?? '').trim())
                          .filter(Boolean)
                          .join(', ')}
                        disabled={locked}
                        label={String(values.name ?? '') || undefined}
                        onChange={(lat, lng) => {
                          onChange(f.pin!.latKey, lat);
                          onChange(f.pin!.lngKey, lng);
                        }}
                      >
                        {(
                          [
                            [f.pin.latKey, 'Latitude', '-90 to 90'],
                            [f.pin.lngKey, 'Longitude', '-180 to 180'],
                          ] as const
                        ).map(([key, label, hint]) => (
                          <FormField
                            key={key}
                            label={label}
                            htmlFor={'hotel-' + key}
                            hint={hint}
                            error={errors[key]}
                          >
                            <Input
                              id={'hotel-' + key}
                              className="font-mono text-xs"
                              inputMode="decimal"
                              value={String(values[key] ?? '')}
                              disabled={locked}
                              onChange={(e) => onChange(key, e.target.value)}
                            />
                          </FormField>
                        ))}
                      </LocationPin>
                    ) : f.kind === 'boolean' && f.checkbox ? (
                      <div className="flex items-center gap-2 text-sm">
                        <Checkbox
                          id={id}
                          checked={v === true}
                          disabled={locked}
                          onCheckedChange={(value) => onChange(f.key, value === true)}
                        />
                        <span
                          aria-hidden="true"
                          onClick={() => !locked && onChange(f.key, v !== true)}
                        >
                          {f.label}
                        </span>
                      </div>
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
                          // A currency saved earlier stays selectable even if it is no longer in use.
                          ...(v && !currentCurrencyCodes.includes(String(v))
                            ? [String(v), ...currentCurrencyCodes]
                            : currentCurrencyCodes
                          ).map((c) => ({ value: c, label: c })),
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
                    ) : f.kind === 'monthday' ? (
                      <MonthDayField
                        label={f.label}
                        value={String(v)}
                        disabled={locked}
                        onChange={(value) => onChange(f.key, value)}
                      />
                    ) : f.kind === 'weekdays' ? (
                      <WeekdayChips
                        label={f.label}
                        value={(v as string[]).map(Number)}
                        disabled={locked}
                        onChange={(days) => onChange(f.key, days.map(String))}
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
                            : f.mono
                              ? 'font-mono text-xs'
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
