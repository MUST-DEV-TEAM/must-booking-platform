'use client';
import { useEffect, useState } from 'react';
import {
  ALBANIA_REGIONS,
  BOOKING_LIMIT_RANGES,
  checkBookingLimit,
  checkSeason,
  checkWeekdays,
  type BookingLimitKey,
  COMMON_LANGUAGE_CODES,
  COUNTRY_CODES,
  LANGUAGE_CODES,
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
import type { Property } from './settings-areas';
/** "Albanian · Shqip", the common languages first, then every other one by name. */
export function languageOptions() {
  const english = new Intl.DisplayNames(['en'], { type: 'language' });
  const label = (code: string) => {
    const name = english.of(code) ?? code;
    let own = name;
    try {
      own = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? name;
    } catch {
      /* no native name known */
    }
    return own && own.toLowerCase() !== name.toLowerCase()
      ? `${name} · ${own.charAt(0).toUpperCase()}${own.slice(1)}`
      : name;
  };
  const common = new Set<string>(COMMON_LANGUAGE_CODES);
  const all = LANGUAGE_CODES.map((code) => ({ value: code, label: label(code) })).sort((x, y) =>
    x.label.localeCompare(y.label),
  );
  return [
    ...COMMON_LANGUAGE_CODES.map((code) => ({
      value: code,
      label: label(code),
      group: 'Common',
    })),
    ...all
      .filter((item) => !common.has(item.value))
      .map((item) => ({ ...item, group: 'All languages' })),
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
      title: 'Currency and languages',
      description: 'The default currency is a preference; it never converts existing prices.',
      fields: [
        { key: 'defaultCurrency', label: 'Default currency', kind: 'currency' },
        {
          key: 'languages',
          label: 'Guest-facing languages',
          kind: 'multi',
          defaultValue: [],
          hint: 'Languages the hotel offers. This does not translate booking pages or emails.',
          options: languageOptions(),
        },
      ],
    },
    {
      title: 'Location',
      description: 'Where the hotel is. The street address is in Hotel identity above.',
      fields: [
        { key: 'addressLine2', label: 'Address line 2', max: 200, hint: 'Optional.' },
        { key: 'city', label: 'City', max: 100 },
        { key: 'country', label: 'Country', kind: 'country' },
        {
          key: 'region',
          label: 'Region',
          kind: 'region',
          max: 100,
          optionsByCountry: { AL: ALBANIA_REGIONS },
          hint: 'Albania: choose the county.',
        },
        { key: 'postalCode', label: 'Postal code', max: 20, hint: 'Albania: 4 digits.' },
        {
          key: 'latitude',
          label: 'Latitude',
          kind: 'decimal',
          hint: 'Optional. From -90 to 90, up to 6 decimals.',
        },
        {
          key: 'longitude',
          label: 'Longitude',
          kind: 'decimal',
          hint: 'Optional. From -180 to 180, up to 6 decimals.',
        },
        {
          key: 'directions',
          label: 'Directions',
          kind: 'textarea',
          max: 300,
          counter: true,
          hint: 'Shown in the confirmation email, for example how to find the entrance.',
        },
        {
          key: 'nearestAirportCode',
          label: 'Nearest airport',
          max: 3,
          placeholder: 'TIA',
          hint: '3-letter airport code.',
        },
        {
          key: 'nearestAirportKm',
          label: 'Distance to the airport (km)',
          kind: 'decimal',
          hint: '0 to 500, one decimal.',
        },
      ],
    },
    {
      title: 'About the hotel',
      description: 'How the hotel is classified and described to guests.',
      fields: [
        { key: 'chainName', label: 'Chain or brand', max: 120, hint: 'Optional.' },
        {
          key: 'propertyType',
          label: 'Property type',
          kind: 'choice',
          options: PROPERTY_TYPES,
        },
        {
          key: 'starRating',
          label: 'Star rating',
          kind: 'choice',
          options: options([
            ['1', '1 star'],
            ['2', '2 stars'],
            ['3', '3 stars'],
            ['4', '4 stars'],
            ['5', '5 stars'],
          ]),
          hint: 'Leave not set for no star rating.',
        },
        {
          key: 'starRatingOfficial',
          label: 'Rating issued by the national tourism authority',
          kind: 'boolean',
          defaultValue: false,
          whenSet: 'starRating',
        },
        { key: 'yearOpened', label: 'Year opened', kind: 'year' },
        { key: 'yearRenovated', label: 'Last renovated', kind: 'year' },
        {
          key: 'summary',
          label: 'Short summary',
          max: SUMMARY_MAX,
          counter: true,
          hint: 'One line shown in search results and emails.',
        },
        {
          key: 'description',
          label: 'Description',
          kind: 'textarea',
          max: DESCRIPTION_MAX,
          counter: true,
          hint: 'Plain text, 50 to 1000 characters, or leave empty.',
        },
      ],
    },
    {
      title: 'Formats',
      description: "How dates, times and numbers are shown to this hotel's staff.",
      fields: [
        {
          key: 'dateFormat',
          defaultValue: 'DD/MM/YYYY',
          label: 'Hotel date format',
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
    {
      title: 'Legal and tax',
      description: 'The legal name and tax number appear in payment and refund emails.',
      fields: [
        { key: 'legalName', label: 'Legal business name', max: 200 },
        {
          key: 'taxNumber',
          label: 'Tax number (NUIS)',
          hint: 'Albania: a letter, 8 digits and a letter, such as L12345678A.',
          max: 30,
        },
        { key: 'vatRegistered', label: 'VAT registered', kind: 'boolean', defaultValue: false },
        { key: 'tourismLicence', label: 'Tourism licence number', max: 50 },
      ],
    },
  ],
  'booking-rules': [
    {
      title: 'Booking notice and season',
      description:
        'How early guests must book, and the time of year the hotel takes bookings. Leave empty for no limit.',
      fields: [
        {
          key: 'minNoticeHours',
          label: 'Book at least (hours before check-in day)',
          kind: 'number',
          hint: '0 to 720 hours. 24 means the day before at the latest.',
        },
        {
          key: 'seasonOpenFrom',
          label: 'Open from',
          kind: 'monthday',
          hint: 'Leave both dates empty to be open all year.',
        },
        { key: 'seasonOpenTo', label: 'Open until', kind: 'monthday' },
      ],
    },
    {
      title: 'Arrival and departure days',
      description: 'Guests can only arrive and leave on the days switched on. At least one day.',
      fields: [
        {
          key: 'arrivalDays',
          label: 'Arrival days',
          kind: 'weekdays',
          defaultValue: ['1', '2', '3', '4', '5', '6', '7'],
        },
        {
          key: 'departureDays',
          label: 'Departure days',
          kind: 'weekdays',
          defaultValue: ['1', '2', '3', '4', '5', '6', '7'],
        },
      ],
    },
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
        {
          key: 'maxGuestsPerBooking',
          label: 'Maximum guests per booking',
          kind: 'number',
          hint: '1 to 50.',
        },
        {
          key: 'maxRoomsPerBooking',
          label: 'Maximum rooms per booking',
          kind: 'number',
          hint: '1 to 20.',
        },
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
) {
  const groups = hotelSettingGroups[area],
    fields = groups.flatMap((g) => g.fields);
  const initial = () =>
    Object.fromEntries(
      fields.map((f) => {
        const v = (property as unknown as Record<string, unknown>)[f.key];
        return [
          f.key,
          Array.isArray(v)
            ? v.map(String)
            : typeof v === 'boolean'
              ? v
              : v === null || v === undefined
                ? (f.defaultValue ?? '')
                : String(v),
        ];
      }),
    ) as Record<string, SettingValue>;
  const [values, setValues] = useState(initial);
  const saved = initial(),
    savedText = JSON.stringify(saved);
  useEffect(() => setValues(JSON.parse(savedText)), [savedText]);
  const dirty = JSON.stringify(values) !== savedText,
    errors: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (typeof v === 'string') {
      if (f.max && v.length > f.max) errors[f.key] = `Keep this to ${f.max} characters or fewer.`;
      if (f.kind === 'number' && v && f.key in BOOKING_LIMIT_RANGES) {
        const message = checkBookingLimit(
          f.key as BookingLimitKey,
          /^\d+$/.test(v) ? Number(v) : NaN,
        );
        if (message) errors[f.key] = message;
      } else if (
        f.kind === 'number' &&
        v &&
        (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 2147483647)
      )
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
  if (['yearOpened', 'yearRenovated', 'starRating', 'starRatingOfficial'].some(changed))
    Object.assign(
      errors,
      checkProfileCombination({
        yearOpened: typed('yearOpened') as number | null,
        yearRenovated: typed('yearRenovated') as number | null,
        starRating: values.starRating ? Number(values.starRating) : null,
        starRatingOfficial: Boolean(values.starRating) && values.starRatingOfficial === true,
      }),
    );
  for (const key of ['arrivalDays', 'departureDays'])
    if (key in values && changed(key) && checkWeekdays((values[key] as string[]).map(Number)))
      errors[key] = 'Choose at least one day.';
  if ((changed('seasonOpenFrom') || changed('seasonOpenTo')) && 'seasonOpenFrom' in values) {
    const season = checkSeason(
      String(values.seasonOpenFrom) || null,
      String(values.seasonOpenTo) || null,
    );
    if (season) errors.seasonOpenTo = season;
  }
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
  for (const f of fields)
    if (JSON.stringify(values[f.key]) !== JSON.stringify(saved[f.key])) {
      const v = values[f.key];
      (update as Record<string, unknown>)[f.key] =
        f.kind === 'weekdays'
          ? (v as string[]).map(Number).sort()
          : f.kind === 'number' || f.kind === 'year' || f.key === 'starRating'
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
        groups={area === 'general' ? groups : groups.map((group) => ({ ...group, compact: true }))}
        values={values}
        onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
        errors={errors}
        disabled={!canWrite}
        currencyLocked={property.defaultCurrencyLocked}
      />
    ),
  };
}
