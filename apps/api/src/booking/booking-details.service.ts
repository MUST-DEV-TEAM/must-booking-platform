import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { CapabilitiesService } from '../tenancy/capabilities.service';
import { AuditLogService } from '../tenancy/audit-log.service';
import { pricingContext, pricingFacts } from '../tenancy/pricing.repository';
import { evaluatePricing, minor } from './pricing-evaluator';
import { bookingContactSql } from './booking-contact';
import { validBookingOccupancy } from './booking-occupancy';
import { NOTIFICATION_UUID } from '../tenancy/notification-registry';
type Context = { tenantId: string; propertyId: string; userId: string };
export type BookingDetails = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  specialRequests: string | null;
  estimatedArrivalTime: string | null;
  adults: number;
  children: number;
};
type Edit = Partial<BookingDetails> & { expectedVersion: number };
type Row = BookingDetails & {
  id: string;
  version: number;
  roomTypeId: string;
  roomId: string | null;
  ratePlanId: string;
  startsOn: string;
  endsOn: string;
  total: string;
  currency: string;
  source: string | null;
  externalBookingId: string | null;
  maxOccupancy: number;
};
const fields = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'specialRequests',
  'estimatedArrivalTime',
  'adults',
  'children',
] as const;
@Injectable()
export class BookingDetailsService {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(CapabilitiesService) private readonly caps: CapabilitiesService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}
  async edit(c: Context, id: string, body: unknown, key: string | undefined) {
    if (!(await this.caps.effective(c)).includes('bookings.edit'))
      throw new ForbiddenException('Requires bookings.edit.');
    if (!NOTIFICATION_UUID.test(id)) throw new BadRequestException('Invalid reservation id.');
    if (!key?.trim() || key.length > 200)
      throw new BadRequestException('An Idempotency-Key of up to 200 characters is required.');
    const input = this.input(body),
      operationKey = `booking-details:${key.trim()}`;
    const hash = createHash('sha256')
      .update(JSON.stringify({ id, actor: c.userId, input }))
      .digest('hex');
    return this.db.withTenantTransaction(
      c,
      async (tx) => {
        const inserted = await tx.$queryRaw<
          { id: string }[]
        >`INSERT INTO integration_operations(tenant_id,property_id,idempotency_key,aggregate_id,request_hash,status) VALUES(${c.tenantId}::uuid,${c.propertyId}::uuid,${operationKey},${id}::uuid,${hash},'PENDING') ON CONFLICT(tenant_id,idempotency_key) DO NOTHING RETURNING id`;
        if (!inserted[0]) {
          const prior = await tx.$queryRaw<
            { hash: string; result: unknown }[]
          >`SELECT request_hash AS hash,result FROM integration_operations WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND idempotency_key=${operationKey} FOR UPDATE`;
          if (prior[0]?.hash !== hash)
            throw new ConflictException(
              'This Idempotency-Key was used for different reservation details.',
            );
          if (!prior[0].result)
            throw new ConflictException('This edit is in progress. Retry with the same key.');
          return prior[0].result;
        }
        const property = await pricingContext(tx, c.tenantId, c.propertyId, true);
        const rows = await tx.$queryRaw<
          Row[]
        >`SELECT b.id,b.version,b.external_booking_id AS "externalBookingId",
    ${bookingContactSql.firstName} AS "firstName",${bookingContactSql.lastName} AS "lastName",${bookingContactSql.email} AS email,${bookingContactSql.phone} AS phone,
    b.special_requests AS "specialRequests",b.estimated_arrival_time AS "estimatedArrivalTime",b.adults,b.children,
    b.room_type_id AS "roomTypeId",b.room_id AS "roomId",b.rate_plan_id AS "ratePlanId",b.starts_on::text AS "startsOn",b.ends_on::text AS "endsOn",b.total_amount::text AS total,b.source,rp.currency,rt.max_occupancy AS "maxOccupancy"
    FROM bookings b LEFT JOIN guests g ON g.tenant_id=b.tenant_id AND g.id=b.guest_id
    JOIN rate_plans rp ON rp.tenant_id=b.tenant_id AND rp.property_id=b.property_id AND rp.id=b.rate_plan_id
    JOIN room_types rt ON rt.tenant_id=b.tenant_id AND rt.property_id=b.property_id AND rt.id=b.room_type_id
    WHERE b.tenant_id=${c.tenantId}::uuid AND b.property_id=${c.propertyId}::uuid AND b.id=${id}::uuid FOR UPDATE OF b,rt`;
        const row = rows[0];
        if (!row) throw new NotFoundException('Reservation not found in this hotel.');
        if (property.readOnly || row.externalBookingId)
          throw new ConflictException(
            'These reservation details are managed in Clock and are read-only here.',
          );
        if (row.version !== input.expectedVersion)
          throw new ConflictException(
            'This reservation changed. Reload it before saving your details.',
          );
        const next: BookingDetails = {
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          phone: row.phone,
          specialRequests: row.specialRequests,
          estimatedArrivalTime: row.estimatedArrivalTime,
          adults: row.adults,
          children: row.children,
          ...input,
        };
        if (!validBookingOccupancy(next) || next.adults + next.children > row.maxOccupancy)
          throw new BadRequestException(
            `Choose at least one adult and no more than ${row.maxOccupancy} guests in this room.`,
          );
        const changes = Object.fromEntries(
          fields.filter((f) => row[f] !== next[f]).map((f) => [f, { old: row[f], new: next[f] }]),
        );
        if (next.adults !== row.adults || next.children !== row.children) {
          const facts = await pricingFacts(tx, c.tenantId, c.propertyId);
          const pricing = {
            ratePlanId: row.ratePlanId,
            roomTypeId: row.roomTypeId,
            ...(row.roomId ? { roomId: row.roomId } : {}),
            startsOn: row.startsOn,
            endsOn: row.endsOn,
            today: property.today,
            channel: row.source === 'WEBSITE' ? ('website' as const) : ('staff' as const),
          };
          const before = evaluatePricing(facts, {
              ...pricing,
              adults: row.adults,
              children: row.children,
            }),
            after = evaluatePricing(facts, {
              ...pricing,
              adults: next.adults,
              children: next.children,
            });
          if (
            !before.valid ||
            !after.valid ||
            !before.total ||
            !after.total ||
            before.total.currency !== row.currency ||
            after.total.currency !== row.currency ||
            minor(before.total.amount) !== minor(row.total) ||
            minor(after.total.amount) !== minor(row.total)
          )
            throw new ConflictException(
              'This guest-count change would change the price, or its price cannot be verified. Use the future amend stay flow.',
            );
        }
        const contactChanged = ['firstName', 'lastName', 'email', 'phone'].some(
          (f) => f in changes,
        );
        if (Object.keys(changes).length) {
          await tx.$executeRaw`UPDATE bookings SET guest_contact=CASE WHEN ${contactChanged} THEN ${JSON.stringify({ firstName: next.firstName, lastName: next.lastName, email: next.email, phone: next.phone })}::jsonb ELSE guest_contact END,
     special_requests=${next.specialRequests},estimated_arrival_time=${next.estimatedArrivalTime},adults=${next.adults},children=${next.children},guest_count=${next.adults + next.children},version=version+1,updated_at=now()
     WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND id=${id}::uuid AND version=${input.expectedVersion}`;
          await this.audit.recordInTransaction(tx, {
            ...c,
            actorUserId: c.userId,
            action: 'booking.details_edited',
            targetType: 'booking',
            targetId: id,
            details: { changes },
          });
        }
        const result = { ok: true, version: row.version + (Object.keys(changes).length ? 1 : 0) };
        await tx.$executeRaw`UPDATE integration_operations SET status='SUCCEEDED',result=${JSON.stringify(result)}::jsonb,updated_at=now() WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND idempotency_key=${operationKey}`;
        return result;
      },
      { timeoutMs: 15000 },
    );
  }
  private input(value: unknown): Edit {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new BadRequestException('Enter reservation details.');
    const raw = value as Record<string, unknown>;
    if (Object.keys(raw).some((f) => f !== 'expectedVersion' && !fields.some((k) => k === f)))
      throw new BadRequestException(
        'Only contact details, notes, arrival time and guest counts can be edited here. Use amend stay for other changes.',
      );
    if (!Number.isSafeInteger(raw.expectedVersion) || Number(raw.expectedVersion) < 1)
      throw new BadRequestException('Reload the reservation before editing.');
    const result: Edit = { expectedVersion: raw.expectedVersion as number };
    for (const f of fields) {
      if (!(f in raw)) continue;
      const v = raw[f];
      if (f === 'adults' || f === 'children') {
        if (!Number.isSafeInteger(v) || Number(v) < (f === 'adults' ? 1 : 0))
          throw new BadRequestException(
            f === 'adults' ? 'Enter at least one adult.' : 'Enter zero or more children.',
          );
        result[f] = v as number;
        continue;
      }
      if (v !== null && typeof v !== 'string') throw new BadRequestException(`Enter a valid ${f}.`);
      let text = typeof v === 'string' ? v.trim() : null;
      if (f === 'firstName' || f === 'lastName') {
        if (!text || text.length > 100)
          throw new BadRequestException(
            `Enter a ${f === 'firstName' ? 'first' : 'last'} name of up to 100 characters.`,
          );
      }
      if (f === 'email') {
        if (!text || text.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text))
          throw new BadRequestException('Enter a valid guest email address.');
        text = text.toLowerCase();
      }
      if (f === 'phone' && text && (text.length > 50 || !/^\+?[0-9][0-9 ]{4,19}$/.test(text)))
        throw new BadRequestException(
          'Enter a phone number with digits, spaces and an optional + prefix.',
        );
      if (f === 'specialRequests' && text && text.length > 2000)
        throw new BadRequestException('Keep notes to 2000 characters or fewer.');
      if (f === 'estimatedArrivalTime' && text && !/^([01]\d|2[0-3]):[0-5]\d$/.test(text))
        throw new BadRequestException('Enter an arrival time as HH:mm, for example 18:30.');
      result[f] = text || null;
    }
    return result;
  }
}
