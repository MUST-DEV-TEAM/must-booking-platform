import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { COUNTRY_CODES } from '@must/domain-contracts';
export type HotelSettings = {
  dateFormat?: string;
  legalName?: string | null;
  taxNumber?: string | null;
  country?: string | null;
  defaultCurrency?: string | null;
  languages?: string[];
  website?: string | null;
  reservationsEmail?: string | null;
  description?: string | null;
  starRating?: number | null;
  allowSameDayBooking?: boolean;
  sameDayCutoffTime?: string | null;
  maxGuestsPerBooking?: number | null;
  maxRoomsPerBooking?: number | null;
  noShowRule?: string | null;
  earlyCheckInPolicy?: string | null;
  earlyCheckInUntil?: string | null;
  earlyCheckInNote?: string | null;
  lateCheckOutPolicy?: string | null;
  lateCheckOutUntil?: string | null;
  lateCheckOutNote?: string | null;
  idRequiredAtArrival?: boolean;
  quietHoursFrom?: string | null;
  quietHoursTo?: string | null;
  childrenPolicy?: string | null;
  childrenPolicyNote?: string | null;
  petsPolicy?: string | null;
  petsPolicyNote?: string | null;
};
export const hotelFields = [
  { key: 'dateFormat', column: 'date_format', kind: 'text', max: 20 },
  { key: 'legalName', column: 'legal_name', kind: 'text', max: 200 },
  { key: 'taxNumber', column: 'tax_number', kind: 'text', max: 100 },
  { key: 'country', column: 'country', kind: 'country', max: 2 },
  { key: 'defaultCurrency', column: 'default_currency', kind: 'currency', max: 3 },
  { key: 'languages', column: 'languages', kind: 'languages', max: 0 },
  { key: 'website', column: 'website', kind: 'url', max: 2048 },
  { key: 'reservationsEmail', column: 'reservations_email', kind: 'email', max: 254 },
  { key: 'description', column: 'description', kind: 'text', max: 1000 },
  { key: 'starRating', column: 'star_rating', kind: 'stars', max: 0 },
  { key: 'allowSameDayBooking', column: 'same_day_booking_allowed', kind: 'boolean', max: 0 },
  { key: 'sameDayCutoffTime', column: 'same_day_cutoff_time', kind: 'time', max: 5 },
  { key: 'maxGuestsPerBooking', column: 'max_guests_per_booking', kind: 'integer', max: 0 },
  { key: 'maxRoomsPerBooking', column: 'max_rooms_per_booking', kind: 'integer', max: 0 },
  { key: 'noShowRule', column: 'no_show_rule', kind: 'no_show', max: 0 },
  { key: 'earlyCheckInPolicy', column: 'early_check_in_policy', kind: 'arrival', max: 0 },
  { key: 'earlyCheckInUntil', column: 'early_check_in_until', kind: 'time', max: 5 },
  { key: 'earlyCheckInNote', column: 'early_check_in_note', kind: 'text', max: 300 },
  { key: 'lateCheckOutPolicy', column: 'late_check_out_policy', kind: 'arrival', max: 0 },
  { key: 'lateCheckOutUntil', column: 'late_check_out_until', kind: 'time', max: 5 },
  { key: 'lateCheckOutNote', column: 'late_check_out_note', kind: 'text', max: 300 },
  { key: 'idRequiredAtArrival', column: 'id_required_at_arrival', kind: 'boolean', max: 0 },
  { key: 'quietHoursFrom', column: 'quiet_hours_from', kind: 'time', max: 5 },
  { key: 'quietHoursTo', column: 'quiet_hours_to', kind: 'time', max: 5 },
  { key: 'childrenPolicy', column: 'children_policy', kind: 'policy', max: 0 },
  { key: 'childrenPolicyNote', column: 'children_policy_note', kind: 'text', max: 300 },
  { key: 'petsPolicy', column: 'pets_policy', kind: 'policy', max: 0 },
  { key: 'petsPolicyNote', column: 'pets_policy_note', kind: 'text', max: 300 },
] as const;
export const hotelColumns = Prisma.raw(
  hotelFields.map((f) => `${f.column} AS "${f.key}"`).join(','),
);
export const LANGUAGE_CODES = ['en', 'sq', 'it', 'de', 'fr', 'es', 'el', 'tr'];
export function hotelInput(raw: Record<string, unknown>): HotelSettings {
  const out: Record<string, unknown> = {};
  for (const f of hotelFields) {
    if (!Object.hasOwn(raw, f.key)) continue;
    let v = raw[f.key];
    const bad = (message: string): never => {
      throw new BadRequestException(message);
    };
    if (f.kind === 'boolean') {
      if (typeof v !== 'boolean') bad('Choose yes or no.');
    } else if (f.kind === 'languages') {
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !LANGUAGE_CODES.includes(x)))
        bad('Choose languages from the list.');
      v = [...new Set(v as string[])].sort();
    } else if (v === null || v === '') {
      v = null;
    } else if (f.kind === 'integer' || f.kind === 'stars') {
      if (
        !Number.isSafeInteger(v) ||
        Number(v) < 1 ||
        Number(v) > (f.kind === 'stars' ? 5 : 2147483647)
      )
        bad(
          f.kind === 'stars'
            ? 'Choose a star rating from 1 to 5.'
            : 'Enter a positive whole-number booking limit.',
        );
    } else {
      if (typeof v !== 'string') bad('Enter a valid ' + f.key + '.');
      v = (v as string).trim();
      if (!v) v = null;
      if (v && f.max && (v as string).length > f.max)
        bad(`Keep ${f.key} to ${f.max} characters or fewer.`);
      if (v && f.kind === 'country' && !(COUNTRY_CODES as readonly string[]).includes(v as string))
        bad('Choose a country from the ISO list.');
      if (
        v &&
        f.kind === 'currency' &&
        !(Intl as unknown as { supportedValuesOf: (key: string) => string[] })
          .supportedValuesOf('currency')
          .includes(v as string)
      )
        bad('Choose a currency from the list.');
      if (v && f.kind === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v as string))
        bad('Use a local time such as 15:00.');
      if (v && f.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v as string))
        bad('Enter a valid reservations email address.');
      if (v && f.kind === 'url') {
        try {
          const u = new URL(v as string);
          if (u.protocol !== 'https:' || u.username || u.password) throw new Error();
        } catch {
          bad('Enter a full https website address.');
        }
      }
      const choices =
        f.kind === 'no_show'
          ? ['charge_first_night', 'charge_nothing', 'flag_for_review']
          : f.kind === 'arrival'
            ? ['not_offered', 'on_request', 'free_until']
            : f.kind === 'policy'
              ? ['allowed', 'on_request', 'not_allowed']
              : null;
      if (choices && v && !choices.includes(v as string)) bad('Choose a policy from the list.');
    }
    if (v === null && (f.kind === 'no_show' || f.kind === 'arrival' || f.kind === 'boolean'))
      bad('Choose a policy from the list.');
    if (f.key === 'dateFormat' && !['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].includes(String(v)))
      bad('Choose a supported hotel date format.');
    out[f.key] = v;
  }
  return out as HotelSettings;
}
export function checkHotelSettings(value: HotelSettings) {
  if (value.earlyCheckInPolicy === 'free_until' && !value.earlyCheckInUntil)
    throw new BadRequestException('Enter the free early check-in time.');
  if (value.lateCheckOutPolicy === 'free_until' && !value.lateCheckOutUntil)
    throw new BadRequestException('Enter the free late check-out time.');
  if (Boolean(value.quietHoursFrom) !== Boolean(value.quietHoursTo))
    throw new BadRequestException('Enter both quiet-hours times, or leave both empty.');
}
export function hotelUpdates(input: HotelSettings) {
  return Prisma.join(
    hotelFields
      .filter((f) => Object.hasOwn(input, f.key))
      .map(
        (f) =>
          Prisma.sql`${Prisma.raw(f.column)}=${f.kind === 'languages' ? Prisma.sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(input[f.key])}::jsonb))` : input[f.key]}`,
      ),
  );
}
