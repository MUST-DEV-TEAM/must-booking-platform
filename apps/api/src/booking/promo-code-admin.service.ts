import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ClockAvailabilityService } from '../integrations/clock/clock-availability.service';
import { PropertyCurrencyService } from '../tenancy/property-currency.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { normalizePromoCode } from './promo-code.service';

export type PromoCodeView = {
  id: string;
  code: string;
  kind: 'PERCENT' | 'FIXED';
  value: string;
  currency: string | null;
  description: string | null;
  bookFrom: string | null;
  bookUntil: string | null;
  stayFrom: string | null;
  stayUntil: string | null;
  minNights: number | null;
  roomTypeIds: string[];
  maxRedemptions: number | null;
  redemptions: number;
  active: boolean;
};

export type PromoCodeInput = {
  code: string;
  kind: 'PERCENT' | 'FIXED';
  value: string;
  currency: string | null;
  description: string | null;
  bookFrom: string | null;
  bookUntil: string | null;
  stayFrom: string | null;
  stayUntil: string | null;
  minNights: number | null;
  roomTypeIds: string[] | null;
  maxRedemptions: number | null;
  active: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const optionalDay = (value: unknown, label: string): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !ISO_DAY.test(value) || Number.isNaN(Date.parse(value)))
    throw new BadRequestException(`${label} must be a date such as 2027-07-01.`);
  return value;
};
const optionalInt = (value: unknown, label: string): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1)
    throw new BadRequestException(`${label} must be a whole number of at least 1.`);
  return number;
};

/** Checks what the dashboard sends; the database repeats the important rules as constraints. */
export function parsePromoCodeInput(body: unknown, hotelCurrency: string): PromoCodeInput {
  const value = (body ?? {}) as Record<string, unknown>;
  const code = normalizePromoCode(value.code);
  if (!code) throw new BadRequestException('Enter a code of 3 to 30 letters, numbers, - or _.');
  const kind = value.kind === 'FIXED' ? 'FIXED' : value.kind === 'PERCENT' ? 'PERCENT' : null;
  if (!kind) throw new BadRequestException('Choose a percentage or a fixed amount.');
  const amount = Number(value.value);
  if (!Number.isFinite(amount) || amount <= 0)
    throw new BadRequestException('The discount must be more than zero.');
  if (kind === 'PERCENT' && amount > 100)
    throw new BadRequestException('A percentage cannot be more than 100.');
  const bookFrom = optionalDay(value.bookFrom, 'Booking from');
  const bookUntil = optionalDay(value.bookUntil, 'Booking until');
  const stayFrom = optionalDay(value.stayFrom, 'Stay from');
  const stayUntil = optionalDay(value.stayUntil, 'Stay until');
  if (bookFrom && bookUntil && bookFrom > bookUntil)
    throw new BadRequestException('Booking from must not be after booking until.');
  if (stayFrom && stayUntil && stayFrom > stayUntil)
    throw new BadRequestException('Stay from must not be after stay until.');
  const rooms = Array.isArray(value.roomTypeIds) ? value.roomTypeIds : null;
  if (rooms && rooms.some((id) => typeof id !== 'string' || !UUID.test(id)))
    throw new BadRequestException('Choose room types from the list.');
  const description =
    typeof value.description === 'string' && value.description.trim()
      ? value.description.trim().slice(0, 300)
      : null;
  return {
    code,
    kind,
    value: amount.toFixed(2),
    currency: kind === 'FIXED' ? hotelCurrency : null,
    description,
    bookFrom,
    bookUntil,
    stayFrom,
    stayUntil,
    minNights: optionalInt(value.minNights, 'Minimum nights'),
    roomTypeIds: rooms && rooms.length > 0 ? (rooms as string[]) : null,
    maxRedemptions: optionalInt(value.maxRedemptions, 'Maximum uses'),
    active: value.active !== false,
  };
}

@Injectable()
export class PromoCodeAdminService {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(PropertyCurrencyService) private readonly currencies: PropertyCurrencyService,
    @Inject(ClockAvailabilityService) private readonly clock: ClockAvailabilityService,
  ) {}

  /** The hotel's own codes, and the bonus codes Clock already has so a clash is visible. */
  async list(tenantId: string, propertyId: string) {
    const codes = await this.db.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<PromoCodeView[]>`
        SELECT id, code, kind, value::text AS value, currency, description,
               book_from::text AS "bookFrom", book_until::text AS "bookUntil",
               stay_from::text AS "stayFrom", stay_until::text AS "stayUntil",
               min_nights AS "minNights", COALESCE(room_type_ids::text[], '{}') AS "roomTypeIds",
               max_redemptions AS "maxRedemptions", redemptions, active
        FROM promo_codes
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        ORDER BY active DESC, code
      `,
    );
    const clockCodes = await this.clock
      .clockBonusCodes(tenantId, propertyId)
      .catch((): string[] => []);
    return { codes, clockCodes };
  }

  async create(tenantId: string, propertyId: string, body: unknown) {
    const { currency } = await this.currencies.resolve(tenantId, propertyId);
    const input = parsePromoCodeInput(body, currency);
    const clockCodes = await this.clock
      .clockBonusCodes(tenantId, propertyId)
      .catch((): string[] => []);
    if (clockCodes.includes(input.code))
      throw new ConflictException(
        'This code already exists in Clock as a bonus code. Choose another code, or manage it in Clock.',
      );
    try {
      const rows = await this.db.withTenantTransaction(
        { tenantId, propertyId },
        (tx) =>
          tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO promo_codes (tenant_id, property_id, code, kind, value, currency, description,
            book_from, book_until, stay_from, stay_until, min_nights, room_type_ids,
            max_redemptions, active)
          VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${input.code}, ${input.kind},
            ${input.value}::numeric, ${input.currency}, ${input.description},
            ${input.bookFrom}::date, ${input.bookUntil}::date, ${input.stayFrom}::date,
            ${input.stayUntil}::date, ${input.minNights}, ${input.roomTypeIds}::uuid[],
            ${input.maxRedemptions}, ${input.active})
          RETURNING id
        `,
      );
      return { id: rows[0]!.id };
    } catch (error) {
      if (
        String((error as { message?: string }).message).includes(
          'promo_codes_tenant_id_property_id_code_key',
        )
      )
        throw new ConflictException('You already have a code with this name.');
      throw error;
    }
  }

  /** Changes the rules and the on/off switch; the name of a code and its use count are kept. */
  async update(tenantId: string, propertyId: string, id: string, body: unknown) {
    if (!UUID.test(id)) throw new NotFoundException('Code not found.');
    const { currency } = await this.currencies.resolve(tenantId, propertyId);
    const input = parsePromoCodeInput(body, currency);
    const rows = await this.db.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
        UPDATE promo_codes SET kind = ${input.kind}, value = ${input.value}::numeric,
          currency = ${input.currency}, description = ${input.description},
          book_from = ${input.bookFrom}::date, book_until = ${input.bookUntil}::date,
          stay_from = ${input.stayFrom}::date, stay_until = ${input.stayUntil}::date,
          min_nights = ${input.minNights}, room_type_ids = ${input.roomTypeIds}::uuid[],
          max_redemptions = ${input.maxRedemptions}, active = ${input.active}, updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND id = ${id}::uuid AND code = ${input.code}
        RETURNING id
      `,
    );
    if (rows.length === 0) throw new NotFoundException('Code not found.');
    return { id };
  }
}
