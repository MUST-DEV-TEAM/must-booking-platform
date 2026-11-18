/**
 * The rules for the hotel Profile fields, written once. The Settings form shows these messages as
 * the owner types and the API refuses the same values, so the two can never disagree
 * (settings redesign plan, S0d and S2a).
 */
export const PROPERTY_TYPES = [
  { value: 'hotel', label: 'Hotel' },
  { value: 'resort', label: 'Resort' },
  { value: 'boutique_hotel', label: 'Boutique hotel' },
  { value: 'apartment_hotel', label: 'Apartment hotel' },
  { value: 'apartments', label: 'Apartments' },
  { value: 'guesthouse', label: 'Guesthouse or B&B' },
  { value: 'hostel', label: 'Hostel' },
  { value: 'villa', label: 'Villa' },
  { value: 'motel', label: 'Motel' },
  { value: 'campsite', label: 'Campsite or glamping' },
] as const;

export type ProfileFieldKey =
  | 'chainName'
  | 'propertyType'
  | 'starRatingOfficial'
  | 'yearOpened'
  | 'yearRenovated'
  | 'summary'
  | 'description'
  | 'legalName'
  | 'taxNumber'
  | 'tourismLicence'
  | 'vatRegistered';

export const PROFILE_FIELD_KEYS: readonly ProfileFieldKey[] = [
  'chainName',
  'propertyType',
  'starRatingOfficial',
  'yearOpened',
  'yearRenovated',
  'summary',
  'description',
  'legalName',
  'taxNumber',
  'tourismLicence',
  'vatRegistered',
];

export const FIRST_YEAR = 1800;
export const SUMMARY_MAX = 160;
export const DESCRIPTION_MIN = 50;
export const DESCRIPTION_MAX = 1000;

const TEXT_MAX: Partial<Record<ProfileFieldKey, number>> = {
  chainName: 120,
  summary: SUMMARY_MAX,
  description: DESCRIPTION_MAX,
  legalName: 200,
  tourismLicence: 50,
};

/** Trims text, makes a tax number upper case without spaces, and turns empty text into null. */
export function normaliseProfileValue(key: ProfileFieldKey, raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  let value = raw.trim();
  if (key === 'taxNumber') value = value.replace(/\s+/g, '').toUpperCase();
  return value === '' ? null : value;
}

/** The message for one field's value, or null when it is fine. `year` is the current year. */
export function checkProfileField(
  key: ProfileFieldKey,
  value: unknown,
  context: { country?: string | null; year: number },
): string | null {
  if (value === null || value === undefined) return null;
  if (key === 'starRatingOfficial' || key === 'vatRegistered')
    return typeof value === 'boolean' ? null : 'Choose yes or no.';
  if (key === 'yearOpened' || key === 'yearRenovated')
    return Number.isInteger(value) &&
      (value as number) >= FIRST_YEAR &&
      (value as number) <= context.year
      ? null
      : `Choose a year from ${FIRST_YEAR} to ${context.year}.`;
  if (typeof value !== 'string') return 'Enter text.';
  const max = TEXT_MAX[key];
  if (max && value.length > max) return `Keep this to ${max} characters or fewer.`;
  if (/[\r\n]/.test(value) && key !== 'description') return 'Use a single line.';
  if (/[<>\\`]/.test(value)) return 'Remove the characters < > \\ and `.';
  if (key === 'propertyType')
    return PROPERTY_TYPES.some((type) => type.value === value)
      ? null
      : 'Choose a property type from the list.';
  if (key === 'description' && value.length < DESCRIPTION_MIN)
    return `Write at least ${DESCRIPTION_MIN} characters, or leave it empty.`;
  if (key === 'taxNumber') {
    if (context.country === 'AL')
      return /^[A-Z]\d{8}[A-Z]$/.test(value)
        ? null
        : 'An Albanian NUIS is a letter, 8 digits and a letter, such as L12345678A.';
    return /^[A-Z0-9]{3,30}$/.test(value)
      ? null
      : 'Use 3 to 30 letters and digits, with no symbols.';
  }
  return null;
}

/** Rules that look at more than one field; returns messages by field. */
export function checkProfileCombination(values: {
  yearOpened?: number | null;
  yearRenovated?: number | null;
  starRating?: number | null;
  starRatingOfficial?: boolean;
}): Partial<Record<ProfileFieldKey, string>> {
  const out: Partial<Record<ProfileFieldKey, string>> = {};
  if (
    values.yearOpened != null &&
    values.yearRenovated != null &&
    values.yearRenovated < values.yearOpened
  )
    out.yearRenovated = 'The last renovation cannot be before the year opened.';
  if (values.starRatingOfficial && !values.starRating)
    out.starRatingOfficial = 'Set a star rating first, or switch this off.';
  return out;
}
