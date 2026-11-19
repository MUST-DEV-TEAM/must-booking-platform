'use client';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ALBANIA_REGIONS,
  COMMON_LANGUAGE_CODES,
  COUNTRY_CODES,
  HOTEL_LANGUAGES,
  DESCRIPTION_MAX,
  PROFILE_FIELD_KEYS,
  PROPERTY_TYPES,
  SUMMARY_MAX,
  checkProfileCombination,
  checkProfileField,
  normaliseProfileValue,
  type ProfileFieldKey,
} from '@must/domain-contracts';
import {
  SettingsFields,
  type SettingValue,
  type SettingGroup,
} from '../../components/ui/settings-fields';
import { timeZoneOptions, type Property } from './settings-areas';
/** "Albanian · Shqip": the English name and the language's own name, or just the name when they match. */
export function languageLabel(code: string) {
  const known = HOTEL_LANGUAGES.find((language) => language.code === code);
  if (known)
    return known.native.toLowerCase() === known.name.toLowerCase()
      ? known.name
      : `${known.name} · ${known.native}`;
  // A code saved long ago that is no longer offered: the browser's name for it.
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The common languages first, then the other modern ones by name. */
export function languageOptions() {
  const common = new Set<string>(COMMON_LANGUAGE_CODES);
  const rest = HOTEL_LANGUAGES.filter(({ code }) => !common.has(code))
    .map(({ code }) => ({ value: code, label: languageLabel(code) }))
    .sort((x, y) => x.label.localeCompare(y.label));
  return [
    ...COMMON_LANGUAGE_CODES.map((code) => ({
      value: code,
      label: languageLabel(code),
      group: 'Common',
    })),
    ...rest.map((item) => ({ ...item, group: 'All languages' })),
  ];
}
const options = (pairs: string[][]) => pairs.map(([value, label]) => ({ value, label }));
const arrival = options([
  ['not_offered', 'Not offered'],
  ['on_request', 'On request'],
  ['free_until', 'Free until a set time'],
]);
const policy = options([
  ['allowed', 'Allowed'],
  ['on_request', 'On request'],
  ['not_allowed', 'Not allowed'],
]);
export const hotelSettingGroups: Record<
  'general' | 'booking-rules' | 'check-in-out',
  SettingGroup[]
> = {
  general: [
    {
      title: 'Hotel identity',
      description: 'Shown to guests on the booking page, in emails and on your website.',
      fields: [
        {
          key: 'name',
          label: 'Hotel name',
          max: 120,
          required: true,
          span: 'half',
          counter: true,
          hint: 'Shown everywhere.',
        },
        {
          key: 'chainName',
          label: 'Chain or brand',
          max: 120,
          span: 'half',
          placeholder: 'Leave empty if independent',
          hint: 'Optional.',
        },
        {
          key: 'propertyType',
          label: 'Property type',
          kind: 'choice',
          options: PROPERTY_TYPES,
          required: true,
          span: 'half',
          hint: 'Used for booking page wording, website search data and channels.',
        },
        { key: 'starRating', label: 'Star rating', kind: 'stars', span: 'half' },
        {
          key: 'starRatingOfficial',
          label: 'Issued by the national tourism authority',
          kind: 'boolean',
          defaultValue: false,
          inlineWith: 'starRating',
        },
        {
          key: 'yearOpened',
          label: 'Year opened',
          kind: 'year',
          span: 'third',
          hint: 'Optional. 4 digits.',
        },
        {
          key: 'yearRenovated',
          label: 'Last renovated',
          kind: 'year',
          span: 'third',
          hint: 'Optional. Not before the year opened.',
        },
        {
          key: 'roomCount',
          label: 'Number of rooms',
          kind: 'static',
          span: 'third',
          suffix: 'from Accommodations',
          hint: 'Counted automatically, never typed.',
        },
        {
          key: 'summary',
          label: 'Short summary',
          max: SUMMARY_MAX,
          counter: true,
          hint: 'Shown in Google results and the website header.',
          span: 'full',
        },
        {
          key: 'description',
          label: 'Description',
          kind: 'textarea',
          max: DESCRIPTION_MAX,
          counter: true,
          hint: 'Plain text, 50 to 1000 characters, or leave empty.',
          span: 'full',
        },
      ],
    },
    {
      title: 'Location',
      description: 'Used for the "Find us" link, emails, your website and channels.',
      fields: [
        { key: 'address', label: 'Street address', max: 200, required: true, span: 'full' },
        {
          key: 'addressLine2',
          label: 'Address line 2',
          max: 200,
          span: 'full',
          placeholder: 'Building, floor (optional)',
        },
        { key: 'city', label: 'City', max: 100, required: true, span: 'third' },
        {
          key: 'region',
          label: 'Region (qark)',
          kind: 'region',
          max: 100,
          span: 'third',
          optionsByCountry: { AL: ALBANIA_REGIONS },
        },
        {
          key: 'postalCode',
          label: 'Postal code',
          max: 20,
          span: 'third',
          hint: 'Use the local postal code format.',
          hintByCountry: { AL: '4 digits.' },
        },
        {
          key: 'country',
          label: 'Country',
          kind: 'country',
          required: true,
          span: 'half',
          hint: 'Also sets the postal code format and suggests the time zone.',
        },
        {
          key: 'timezone',
          label: 'Time zone',
          kind: 'timezone',
          required: true,
          span: 'half',
          hint: 'Changing it shifts arrival times of existing bookings; you are asked to confirm.',
        },
        {
          key: 'mapPin',
          label: 'Map pin',
          kind: 'location',
          span: 'full',
          pin: {
            latKey: 'latitude',
            lngKey: 'longitude',
            addressKeys: ['address', 'city', 'postalCode', 'countryName'],
          },
        },
        { key: 'latitude', label: 'Latitude', kind: 'decimal', inlineWith: 'mapPin' },
        { key: 'longitude', label: 'Longitude', kind: 'decimal', inlineWith: 'mapPin' },
        {
          key: 'directions',
          label: 'Directions',
          max: 300,
          counter: true,
          span: 'third',
          hint: 'In the confirmation email.',
        },
        {
          key: 'nearestAirportCode',
          label: 'Nearest airport',
          max: 3,
          span: 'third',
          placeholder: 'TIA',
          hint: '3-letter code (Tirana: TIA).',
        },
        {
          key: 'nearestAirportKm',
          label: 'Distance to airport (km)',
          kind: 'decimal',
          span: 'third',
          hint: 'In km, 1 decimal.',
        },
      ],
    },
    {
      title: 'Legal and tax',
      description:
        'Printed in the footer of payment and refund emails. Clock still issues the fiscal invoices.',
      fields: [
        { key: 'legalName', label: 'Legal business name', max: 200, span: 'half' },
        {
          key: 'taxNumber',
          label: 'Tax number (NUIS)',
          max: 30,
          span: 'half',
          mono: true,
          placeholder: 'L12345678A',
          hint: '3 to 30 letters and digits.',
          hintByCountry: { AL: 'Letter, 8 digits, letter.' },
        },
        {
          key: 'tourismLicence',
          label: 'Tourism licence number',
          max: 50,
          span: 'half',
          placeholder: 'Optional',
          hint: 'Some countries require it on the website.',
        },
        {
          key: 'vatRegistered',
          label: 'VAT registered',
          kind: 'boolean',
          defaultValue: false,
          boxed: true,
          hint: 'Shown on receipts. Rates are set in Taxes and fees.',
        },
        {
          key: 'registeredSameAsHotel',
          label: 'Registered address is the same as the hotel address',
          kind: 'boolean',
          defaultValue: true,
          checkbox: true,
          span: 'full',
        },
        {
          key: 'registeredStreet',
          label: 'Registered street address',
          max: 200,
          whenOff: 'registeredSameAsHotel',
          required: true,
          span: 'full',
        },
        {
          key: 'registeredCity',
          label: 'Registered city',
          max: 100,
          whenOff: 'registeredSameAsHotel',
          required: true,
          span: 'half',
        },
        {
          key: 'registeredPostalCode',
          label: 'Registered postal code',
          max: 20,
          whenOff: 'registeredSameAsHotel',
          span: 'half',
        },
      ],
    },
    {
      title: 'Languages spoken at the hotel',
      description: 'Shown to guests on the booking page and your website.',
      fields: [
        {
          key: 'languages',
          label: 'Languages',
          kind: 'multi',
          defaultValue: [],
          hint: 'At least one. This does not translate booking pages or emails.',
          options: languageOptions(),
        },
      ],
    },
    {
      title: 'Currency',
      description: '',
      fields: [
        { key: 'defaultCurrency', label: 'Hotel currency', kind: 'currency', span: 'half' },
        { key: 'alsoShow', label: 'Also show prices in', kind: 'custom', span: 'half' },
        {
          key: 'exchangeRates',
          label: 'Exchange rates',
          kind: 'custom',
          span: 'full',
          hideLabel: true,
        },
      ],
    },
    {
      title: 'Formats',
      description: 'How dates, times and numbers look on staff screens and in reports.',
      fields: [
        {
          key: 'dateFormat',
          defaultValue: 'DD/MM/YYYY',
          label: 'Date format',
          kind: 'choice',
          options: options([
            ['DD/MM/YYYY', 'DD/MM/YYYY'],
            ['MM/DD/YYYY', 'MM/DD/YYYY'],
            ['YYYY-MM-DD', 'YYYY-MM-DD'],
          ]),
          hint: 'Shared by everyone working in this hotel.',
        },
        {
          key: 'timeFormat',
          label: 'Time format',
          kind: 'choice',
          defaultValue: '24h',
          options: options([
            ['24h', '24 hour (15:30)'],
            ['12h', '12 hour (3:30 PM)'],
          ]),
        },
        {
          key: 'weekStart',
          label: 'First day of the week',
          kind: 'choice',
          defaultValue: 'monday',
          options: options([
            ['monday', 'Monday'],
            ['sunday', 'Sunday'],
          ]),
          hint: 'Used by the Calendar.',
        },
        {
          key: 'numberFormat',
          label: 'Number format',
          kind: 'choice',
          defaultValue: 'comma_dot',
          options: options([
            ['comma_dot', '1,234.56'],
            ['dot_comma', '1.234,56'],
          ]),
        },
      ],
    },
  ],
  'booking-rules': [
    {
      title: 'Same-day booking',
      description: 'Applied to guests and staff, using the hotel time zone.',
      fields: [
        {
          key: 'allowSameDayBooking',
          label: 'Allow same-day bookings',
          kind: 'boolean',
          defaultValue: true,
        },
        {
          key: 'sameDayCutoffTime',
          label: 'Same-day cutoff time',
          kind: 'time',
          hint: 'Optional. Same-day arrivals close at this local time.',
        },
      ],
    },
    {
      title: 'Booking size limits',
      description:
        'Limits apply to a whole booking or multi-room order, including children. Leave empty for no extra limit.',
      fields: [
        { key: 'maxGuestsPerBooking', label: 'Maximum guests per booking', kind: 'number' },
        { key: 'maxRoomsPerBooking', label: 'Maximum rooms per booking', kind: 'number' },
      ],
    },
    {
      title: 'No-show guidance',
      description: 'Staff guidance only. Saving this policy never charges a guest.',
      fields: [
        {
          key: 'noShowRule',
          label: 'If a guest does not arrive',
          kind: 'choice',
          defaultValue: 'flag_for_review',
          options: options([
            ['charge_first_night', 'Charge first night'],
            ['charge_nothing', 'Charge nothing'],
            ['flag_for_review', 'Flag for review'],
          ]),
        },
      ],
    },
  ],
  'check-in-out': [
    {
      title: 'Early check-in and late check-out',
      description:
        'Informational policies. Staff must agree any special arrangements with the guest.',
      fields: [
        {
          key: 'earlyCheckInPolicy',
          label: 'Early check-in',
          kind: 'choice',
          defaultValue: 'not_offered',
          options: arrival,
        },
        {
          key: 'earlyCheckInUntil',
          label: 'Free early check-in until',
          kind: 'time',
          when: { key: 'earlyCheckInPolicy', value: 'free_until' },
        },
        { key: 'earlyCheckInNote', label: 'Early check-in note', max: 300 },
        {
          key: 'lateCheckOutPolicy',
          label: 'Late check-out',
          kind: 'choice',
          defaultValue: 'not_offered',
          options: arrival,
        },
        {
          key: 'lateCheckOutUntil',
          label: 'Free late check-out until',
          kind: 'time',
          when: { key: 'lateCheckOutPolicy', value: 'free_until' },
        },
        { key: 'lateCheckOutNote', label: 'Late check-out note', max: 300 },
      ],
    },
    {
      title: 'Arrival',
      description: 'Times are local to the hotel. Quiet hours can continue overnight.',
      fields: [
        {
          key: 'idRequiredAtArrival',
          label: 'ID required at arrival',
          kind: 'boolean',
          defaultValue: false,
        },
        { key: 'quietHoursFrom', label: 'Quiet hours from', kind: 'time' },
        { key: 'quietHoursTo', label: 'Quiet hours until', kind: 'time' },
      ],
    },
    {
      title: 'Children and pets',
      description: 'Optional information for staff. Notes are plain text, up to 300 characters.',
      fields: [
        { key: 'childrenPolicy', label: 'Children policy', kind: 'choice', options: policy },
        { key: 'childrenPolicyNote', label: 'Children policy note', max: 300 },
        { key: 'petsPolicy', label: 'Pets policy', kind: 'choice', options: policy },
        { key: 'petsPolicyNote', label: 'Pets policy note', max: 300 },
      ],
    },
  ],
};
export function useHotelSettings(
  property: Property,
  area: keyof typeof hotelSettingGroups,
  canWrite: boolean,
  extras?: Record<string, ReactNode>,
) {
  const savedLanguages = Array.isArray(property.languages) ? property.languages : [];
  const groups = hotelSettingGroups[area].map((group) => ({
    ...group,
    fields: group.fields.map((f) =>
      f.kind === 'multi' && f.key === 'languages'
        ? {
            ...f,
            options: [
              ...(f.options ?? []),
              ...savedLanguages
                .filter((code) => !f.options?.some((o) => o.value === code))
                .map((code) => ({ value: code, label: languageLabel(code), group: 'Saved' })),
            ],
          }
        : f,
    ),
  }));
  const fields = groups.flatMap((g) => g.fields),
    saveable = fields.filter(
      (f) => f.kind !== 'static' && f.kind !== 'location' && f.kind !== 'custom',
    );
  const initial = () =>
    Object.fromEntries(
      fields.map((f) => {
        const v = (property as unknown as Record<string, unknown>)[f.key];
        return [
          f.key,
          Array.isArray(v)
            ? v
            : typeof v === 'boolean'
              ? v
              : v === null || v === undefined
                ? (f.defaultValue ?? '')
                : String(v),
        ];
      }),
    ) as Record<string, SettingValue>;
  const [values, setValues] = useState(initial);
  const countryName = (code: unknown) => {
    try {
      return code ? (new Intl.DisplayNames(['en'], { type: 'region' }).of(String(code)) ?? '') : '';
    } catch {
      return '';
    }
  };
  const saved = initial(),
    savedText = JSON.stringify(saved);
  useEffect(() => setValues(JSON.parse(savedText)), [savedText]);
  const dirty = JSON.stringify(values) !== savedText,
    errors: Record<string, string> = {};
  for (const f of saveable) {
    const v = values[f.key];
    // A hidden field (its switch or choice says it does not apply) is never required.
    const shown =
      (!f.when || values[f.when.key] === f.when.value) &&
      (!f.whenSet || Boolean(values[f.whenSet])) &&
      (!f.whenOff || values[f.whenOff] === false);
    if (f.required && shown && typeof v === 'string' && !v.trim()) {
      errors[f.key] = `Enter the ${f.label.toLowerCase()}.`;
      continue;
    }
    if (typeof v === 'string') {
      if (f.key === 'name' && /[<>\\\r\n]/.test(v))
        errors[f.key] = 'Use a single line without < > or \\.';
      if (f.max && v.length > f.max) errors[f.key] = `Keep this to ${f.max} characters or fewer.`;
      if (f.kind === 'number' && v && (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 2147483647))
        errors[f.key] = 'Enter a positive whole number, or leave empty.';
      if (f.kind === 'time' && v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))
        errors[f.key] = 'Use a time such as 15:00.';
    }
  }
  const changed = (key: string) => JSON.stringify(values[key]) !== JSON.stringify(saved[key]);
  const yearNow = new Date().getFullYear();
  const typed = (key: string): unknown => {
    const v = values[key];
    if (key === 'yearOpened' || key === 'yearRenovated') return v === '' ? null : Number(v);
    if (key === 'latitude' || key === 'longitude' || key === 'nearestAirportKm')
      return typeof v === 'string' ? normaliseProfileValue(key, v) : v;
    return typeof v === 'string' ? normaliseProfileValue(key as ProfileFieldKey, v) : v;
  };
  for (const key of PROFILE_FIELD_KEYS) {
    if (!(key in values)) continue;
    if (!changed(key) && !(key === 'taxNumber' && changed('country'))) continue;
    const message = checkProfileField(key, typed(key), {
      country: String(values.country || '') || null,
      year: yearNow,
    });
    if (message) errors[key] = message;
  }
  if (
    [
      'yearOpened',
      'yearRenovated',
      'starRating',
      'starRatingOfficial',
      'registeredSameAsHotel',
      'registeredStreet',
      'registeredCity',
    ].some(changed)
  )
    Object.assign(
      errors,
      checkProfileCombination({
        yearOpened: typed('yearOpened') as number | null,
        yearRenovated: typed('yearRenovated') as number | null,
        starRating: values.starRating ? Number(values.starRating) : null,
        starRatingOfficial: Boolean(values.starRating) && values.starRatingOfficial === true,
        ...('registeredSameAsHotel' in values
          ? {
              registeredSameAsHotel: values.registeredSameAsHotel !== false,
              registeredStreet: String(values.registeredStreet ?? '').trim() || null,
              registeredCity: String(values.registeredCity ?? '').trim() || null,
            }
          : {}),
      }),
    );
  if (
    'timezone' in values &&
    changed('timezone') &&
    !timeZoneOptions(String(saved.timezone ?? '')).includes(String(values.timezone))
  )
    errors.timezone = 'Choose a time zone from the list.';
  if (changed('languages') && Array.isArray(values.languages) && values.languages.length === 0)
    errors.languages = 'Choose at least one language.';
  if (values.country && !(COUNTRY_CODES as readonly string[]).includes(String(values.country)))
    errors.country = 'Choose a country from the list.';
  for (const prefix of ['earlyCheckIn', 'lateCheckOut'])
    if (values[prefix + 'Policy'] === 'free_until' && !values[prefix + 'Until'])
      errors[prefix + 'Until'] = 'Enter the free-until time.';
  if (Boolean(values.quietHoursFrom) !== Boolean(values.quietHoursTo))
    errors.quietHoursTo = 'Enter both quiet-hours times, or leave both empty.';
  const update: Partial<Property> = {};
  for (const f of saveable)
    if (JSON.stringify(values[f.key]) !== JSON.stringify(saved[f.key])) {
      const v = values[f.key];
      (update as Record<string, unknown>)[f.key] =
        f.kind === 'number' || f.kind === 'year' || f.key === 'starRating'
          ? v === ''
            ? null
            : Number(v)
          : typeof v === 'string'
            ? (PROFILE_FIELD_KEYS as readonly string[]).includes(f.key)
              ? (normaliseProfileValue(f.key as ProfileFieldKey, v) as string | null)
              : v.trim() || null
            : v;
    }
  if (update.starRating === null && saved.starRatingOfficial === true)
    update.starRatingOfficial = false;
  return {
    dirty,
    errors,
    update,
    discard: () => setValues(initial()),
    fields: (
      <SettingsFields
        groups={groups.map((group) => ({ ...group, compact: true }))}
        values={{ ...values, countryName: countryName(values.country) }}
        onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
        errors={errors}
        disabled={!canWrite}
        currencyLocked={property.defaultCurrencyLocked}
        currencyBadge={property.pmsSource === 'CLOCK_PMS' ? 'From Clock · Locked' : 'Locked'}
        extras={extras}
      />
    ),
  };
}
