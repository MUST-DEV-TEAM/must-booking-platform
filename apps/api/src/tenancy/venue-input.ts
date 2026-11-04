import { BadRequestException } from '@nestjs/common';

export type VenueInput = {
  name: string;
  timezone: string | null;
  currency: string | null;
  address: string | null;
  phone: string | null;
  contactEmail: string | null;
  propertyId: string | null;
  description: string | null;
};

/** Booking rules and the simple deposit rule, set during first-time setup. Always present on a venue. */
export type VenueRules = {
  advanceBookingDays: number;
  maxOnlinePartySize: number;
  holdMinutes: number;
  lastBookingMinutesBeforeClose: number;
  diningMinutes: number;
  depositMode: 'none' | 'percent' | 'fixed';
  /** Exact text with two decimals ("30.00"): a percentage or a money amount, never a float. */
  depositValue: string;
  depositMinParty: number;
  freeCancelHours: number;
};

const RULE_LIMITS: Record<
  Exclude<keyof VenueRules, 'depositMode' | 'depositValue'>,
  { label: string; min: number; max: number }
> = {
  advanceBookingDays: { label: 'Advance booking days', min: 1, max: 365 },
  maxOnlinePartySize: { label: 'Largest online party', min: 1, max: 100 },
  holdMinutes: { label: 'Table hold minutes', min: 5, max: 60 },
  lastBookingMinutesBeforeClose: { label: 'Last booking before closing', min: 0, max: 240 },
  diningMinutes: { label: 'Time at the table', min: 30, max: 480 },
  depositMinParty: { label: 'Smallest party that pays a deposit', min: 1, max: 100 },
  freeCancelHours: { label: 'Free cancellation hours', min: 0, max: 720 },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A URL-safe name for a venue: lowercase ASCII words joined by dashes. */
export function slugifyVenueName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'venue';
}

function record(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new BadRequestException('A JSON object is required.');
  return raw as Record<string, unknown>;
}

function text(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new BadRequestException(`${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max)
    throw new BadRequestException(`${field} must be at most ${max} characters.`);
  return trimmed === '' ? null : trimmed;
}

function field<K extends keyof VenueInput>(key: K, value: unknown): VenueInput[K] {
  switch (key) {
    case 'name': {
      const name = text(value, 'Name', 200);
      if (!name) throw new BadRequestException('Name is required.');
      return name as VenueInput[K];
    }
    case 'timezone': {
      const timezone = text(value, 'Timezone', 100);
      if (timezone) {
        try {
          new Intl.DateTimeFormat('en', { timeZone: timezone });
        } catch {
          throw new BadRequestException('Timezone is not a valid IANA time zone.');
        }
      }
      return timezone as VenueInput[K];
    }
    case 'currency': {
      const currency = text(value, 'Currency', 3);
      if (currency && !/^[A-Z]{3}$/.test(currency))
        throw new BadRequestException('Currency must be three capital letters, for example ALL.');
      return currency as VenueInput[K];
    }
    case 'address':
      return text(value, 'Address', 500) as VenueInput[K];
    case 'phone':
      return text(value, 'Phone', 100) as VenueInput[K];
    case 'contactEmail': {
      const email = text(value, 'Contact email', 320);
      if (email && !EMAIL.test(email))
        throw new BadRequestException('Contact email is not a valid email address.');
      return email as VenueInput[K];
    }
    case 'propertyId': {
      const id = text(value, 'Property', 36);
      if (id && !UUID.test(id)) throw new BadRequestException('Property must be a valid id.');
      return id as VenueInput[K];
    }
    case 'description':
      return text(value, 'Description', 1000) as VenueInput[K];
    default:
      throw new BadRequestException('Unknown field.');
  }
}

function wholeNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw new BadRequestException(`${label} must be a whole number from ${min} to ${max}.`);
  return value;
}

/** A deposit amount as exact text with two decimals; numbers and numeric text are both accepted. */
function depositAmount(value: unknown): string {
  const raw = typeof value === 'number' ? String(value) : value;
  if (typeof raw !== 'string' || !/^\d{1,10}(\.\d{1,2})?$/.test(raw.trim()))
    throw new BadRequestException(
      'The deposit amount must be a positive number with up to two decimals.',
    );
  const [whole, decimals = ''] = raw.trim().split('.');
  return `${whole}.${decimals.padEnd(2, '0')}`;
}

function ruleField<K extends keyof VenueRules>(key: K, value: unknown): VenueRules[K] {
  if (key === 'depositMode') {
    if (value !== 'none' && value !== 'percent' && value !== 'fixed')
      throw new BadRequestException('The deposit mode must be none, percent or fixed.');
    return value as VenueRules[K];
  }
  if (key === 'depositValue') return depositAmount(value) as VenueRules[K];
  const limit = RULE_LIMITS[key as keyof typeof RULE_LIMITS];
  return wholeNumber(value, limit.label, limit.min, limit.max) as VenueRules[K];
}

const KEYS: Array<keyof VenueInput> = [
  'name',
  'timezone',
  'currency',
  'address',
  'phone',
  'contactEmail',
  'propertyId',
  'description',
];

const RULE_KEYS: Array<keyof VenueRules> = [
  'advanceBookingDays',
  'maxOnlinePartySize',
  'holdMinutes',
  'lastBookingMinutesBeforeClose',
  'diningMinutes',
  'depositMode',
  'depositValue',
  'depositMinParty',
  'freeCancelHours',
];

export function parseVenueCreate(raw: unknown): VenueInput {
  const body = record(raw);
  const input = {} as VenueInput;
  for (const key of KEYS) (input[key] as unknown) = field(key, body[key]);
  return input;
}

/** Only the fields present in the body are returned; a present empty value clears the field. */
export function parseVenueUpdate(raw: unknown): Partial<VenueInput & VenueRules> {
  const body = record(raw);
  const input: Partial<VenueInput & VenueRules> = {};
  for (const key of KEYS) if (key in body) (input[key] as unknown) = field(key, body[key]);
  for (const key of RULE_KEYS) if (key in body) (input[key] as unknown) = ruleField(key, body[key]);
  if (
    input.depositMode === 'percent' &&
    input.depositValue !== undefined &&
    Number(input.depositValue) > 100
  )
    throw new BadRequestException('A percentage deposit cannot be more than 100.');
  if (Object.keys(input).length === 0) throw new BadRequestException('Nothing to update.');
  return input;
}
