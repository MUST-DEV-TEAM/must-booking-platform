'use client';
import { useEffect, useState } from 'react';
import { COUNTRY_CODES } from '@must/domain-contracts';
import {
  SettingsFields,
  type SettingValue,
  type SettingGroup,
} from '../../components/ui/settings-fields';
import type { Property } from './settings-areas';
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
      title: 'Business',
      description:
        'Hotel business details. The default currency is a preference; it never converts existing prices.',
      fields: [
        {
          key: 'supportEmail',
          label: 'Guest contact email',
          placeholder: 'reservations@example.com',
          hint: 'Shown as an Email link in guest messages.',
          max: 254,
        },
        {
          key: 'phone',
          label: 'Guest contact phone',
          placeholder: '+355 ...',
          hint: 'Include the country code. Shown as a clickable phone number.',
          max: 100,
        },
        { key: 'legalName', label: 'Legal business name', max: 200 },
        {
          key: 'taxNumber',
          label: 'Tax number (NUIS)',
          hint: 'Optional. Enter the hotel business tax reference.',
          max: 100,
        },
        { key: 'country', label: 'Country', kind: 'country' },
        { key: 'defaultCurrency', label: 'Default currency', kind: 'currency' },
        {
          key: 'languages',
          label: 'Guest-facing languages',
          kind: 'multi',
          defaultValue: [],
          hint: 'Languages the hotel offers. This does not translate booking pages or emails.',
          options: options([
            ['en', 'English'],
            ['sq', 'Albanian'],
            ['it', 'Italian'],
            ['de', 'German'],
            ['fr', 'French'],
            ['es', 'Spanish'],
            ['el', 'Greek'],
            ['tr', 'Turkish'],
          ]),
        },
        {
          key: 'website',
          label: 'Hotel website',
          hint: 'Use a full https address. This does not change the WordPress connection.',
          max: 2048,
        },
        {
          key: 'reservationsEmail',
          label: 'Reservations email',
          hint: 'Stored separately from the support email used by existing booking emails.',
          max: 254,
        },
      ],
    },
    {
      title: 'About the hotel',
      description:
        'Optional descriptive information. No pricing or booking decisions use these fields.',
      fields: [
        {
          key: 'description',
          label: 'Description',
          kind: 'textarea',
          max: 1000,
          hint: 'Plain text, up to 1000 characters.',
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
  const saved = initial(),
    savedText = JSON.stringify(saved);
  useEffect(() => setValues(JSON.parse(savedText)), [savedText]);
  const dirty = JSON.stringify(values) !== savedText,
    errors: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (typeof v === 'string') {
      if (f.max && v.length > f.max) errors[f.key] = `Keep this to ${f.max} characters or fewer.`;
      if (f.kind === 'number' && v && (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 2147483647))
        errors[f.key] = 'Enter a positive whole number, or leave empty.';
      if (f.kind === 'time' && v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))
        errors[f.key] = 'Use a time such as 15:00.';
    }
  }
  if (values.website) {
    try {
      const u = new URL(String(values.website));
      if (u.protocol !== 'https:' || u.username || u.password) throw new Error();
    } catch {
      errors.website = 'Enter a full https website address.';
    }
  }
  if (
    values.reservationsEmail &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(values.reservationsEmail))
  )
    errors.reservationsEmail = 'Enter a valid reservations email address.';
  if (values.country && !(COUNTRY_CODES as readonly string[]).includes(String(values.country)))
    errors.country = 'Choose a country from the list.';
  for (const prefix of ['earlyCheckIn', 'lateCheckOut'])
    if (values[prefix + 'Policy'] === 'free_until' && !values[prefix + 'Until'])
      errors[prefix + 'Until'] = 'Enter the free-until time.';
  if (Boolean(values.quietHoursFrom) !== Boolean(values.quietHoursTo))
    errors.quietHoursTo = 'Enter both quiet-hours times, or leave both empty.';
  if (values.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(values.supportEmail)))
    errors.supportEmail = 'Enter a valid contact email.';
  const update: Partial<Property> = {};
  for (const f of fields)
    if (JSON.stringify(values[f.key]) !== JSON.stringify(saved[f.key])) {
      const v = values[f.key];
      (update as Record<string, unknown>)[f.key] =
        f.kind === 'number' || f.key === 'starRating'
          ? v === ''
            ? null
            : Number(v)
          : typeof v === 'string'
            ? v.trim() || null
            : v;
    }
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
