import { bookingContactSql } from '../booking/booking-contact';
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Injectable,
  Query,
  Req,
} from '@nestjs/common';

import { CapabilitiesService } from './capabilities.service';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { TenantDatabaseService } from './tenant-database.service';

export type SearchItem = {
  type: 'booking' | 'guest' | 'room' | 'room_type' | 'staff' | 'email' | 'payment' | 'rate_plan';
  id: string;
  /** Id of the record the link should open when it is not the item itself (a room's type, a payment's booking). */
  target?: string;
  title: string;
  subtitle: string;
};
export type SearchGroup = {
  key: 'bookings' | 'guests' | 'accommodations' | 'staff' | 'emails' | 'payments' | 'ratePlans';
  label: string;
  items: SearchItem[];
};

const MIN_LENGTH = 2;
const MAX_LENGTH = 80;
const PER_GROUP = 5;

/** Makes user text safe inside a LIKE pattern (no wildcard injection). */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * A phone-like search ("0691 234", "+355 69 12") becomes its digits so it matches numbers stored
 * with any spacing or dashes. Returns null when the text is not phone-like.
 */
export function phoneDigits(text: string): string | null {
  if (!/^[\d\s+().-]+$/.test(text)) return null;
  const digits = text.replace(/\D/g, '');
  return digits.length >= 4 ? digits : null;
}

export function cleanSearchText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (text.length > MAX_LENGTH) throw new BadRequestException('The search text is too long.');
  return text;
}

/** Quick lookup across bookings, guests and accommodations; each group only for people who may see it. */
@Injectable()
export class GlobalSearchService {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(CapabilitiesService) private readonly capabilities: CapabilitiesService,
  ) {}

  async search(tenantId: string, propertyId: string, userId: string, raw: unknown) {
    const query = cleanSearchText(raw);
    if (query.length < MIN_LENGTH) return { query, groups: [] as SearchGroup[] };
    const caps = await this.capabilities.effective({ tenantId, propertyId, userId });
    const like = likePattern(query);
    // Never matches when the text is not phone-like, so name searches are unaffected.
    const digits = phoneDigits(query);
    const digitsLike = digits ? `%${digits}%` : 'not-a-phone-search';
    const groups = await this.db.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const out: SearchGroup[] = [];
      if (caps.includes('bookings.view')) {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            ref: string | null;
            status: string;
            startsOn: string;
            endsOn: string;
            guest: string | null;
            email: string | null;
          }>
        >`SELECT b.id, b.external_reference AS ref, b.status::text AS status,
            b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn",
            NULLIF(TRIM(CONCAT_WS(' ', ${bookingContactSql.firstName}, ${bookingContactSql.lastName})), '') AS guest, ${bookingContactSql.email} AS email
          FROM bookings b
          LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
          WHERE b.tenant_id = ${tenantId}::uuid AND b.property_id = ${propertyId}::uuid
            AND (COALESCE(b.external_reference, '') ILIKE ${like} ESCAPE '\\'
              OR CONCAT_WS(' ', ${bookingContactSql.firstName}, ${bookingContactSql.lastName}) ILIKE ${like} ESCAPE '\\'
              OR COALESCE(${bookingContactSql.email}, '') ILIKE ${like} ESCAPE '\\'
              OR COALESCE(${bookingContactSql.phone}, '') ILIKE ${like} ESCAPE '\\'
              OR regexp_replace(COALESCE(${bookingContactSql.phone}, ''), '[^0-9]', '', 'g') LIKE ${digitsLike})
          ORDER BY b.created_at DESC LIMIT ${PER_GROUP}`;
        out.push({
          key: 'bookings',
          label: 'Reservations',
          items: rows.map((r) => ({
            type: 'booking' as const,
            id: r.id,
            title: `${r.ref ?? 'Reservation'} · ${r.guest ?? r.email ?? 'No guest'}`,
            subtitle: `${r.startsOn} – ${r.endsOn} · ${r.status.replaceAll('_', ' ').toLowerCase()}`,
          })),
        });
      }
      if (caps.includes('guests.view')) {
        const rows = await tx.$queryRaw<
          Array<{ id: string; name: string | null; email: string | null; phone: string | null }>
        >`SELECT g.id, NULLIF(TRIM(CONCAT_WS(' ', g.first_name, g.last_name)), '') AS name, g.email, g.phone
          FROM guests g
          WHERE g.tenant_id = ${tenantId}::uuid
            AND EXISTS (SELECT 1 FROM bookings b WHERE b.tenant_id = g.tenant_id
              AND b.property_id = ${propertyId}::uuid AND b.guest_id = g.id)
            AND (CONCAT_WS(' ', g.first_name, g.last_name) ILIKE ${like} ESCAPE '\\'
              OR COALESCE(g.email, '') ILIKE ${like} ESCAPE '\\'
              OR COALESCE(g.phone, '') ILIKE ${like} ESCAPE '\\'
              OR regexp_replace(COALESCE(g.phone, ''), '[^0-9]', '', 'g') LIKE ${digitsLike})
          ORDER BY g.updated_at DESC LIMIT ${PER_GROUP}`;
        out.push({
          key: 'guests',
          label: 'Guests',
          items: rows.map((r) => ({
            type: 'guest' as const,
            id: r.id,
            title: r.name ?? r.email ?? 'Guest',
            subtitle: [r.email, r.phone].filter(Boolean).join(' · '),
          })),
        });
      }
      // Same access as the Accommodations page, which these results open.
      if (caps.includes('accommodations.manage') || caps.includes('photos.manage')) {
        const rooms = await tx.$queryRaw<
          Array<{ id: string; name: string; typeName: string; typeId: string }>
        >`SELECT r.id, r.name, rt.name AS "typeName", rt.id AS "typeId" FROM rooms r
          JOIN room_types rt ON rt.tenant_id = r.tenant_id AND rt.property_id = r.property_id AND rt.id = r.room_type_id
          WHERE r.tenant_id = ${tenantId}::uuid AND r.property_id = ${propertyId}::uuid
            AND (r.name ILIKE ${like} ESCAPE '\\' OR COALESCE(r.title, '') ILIKE ${like} ESCAPE '\\')
          ORDER BY r.name LIMIT ${PER_GROUP}`;
        const types = await tx.$queryRaw<Array<{ id: string; name: string; status: string }>>`
          SELECT id, name, status::text AS status FROM room_types
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
            AND name ILIKE ${like} ESCAPE '\\' ORDER BY name LIMIT 3`;
        out.push({
          key: 'accommodations',
          label: 'Rooms and room types',
          items: [
            ...rooms.map((r) => ({
              type: 'room' as const,
              id: r.id,
              target: r.typeId,
              title: r.name,
              subtitle: `Room · ${r.typeName}`,
            })),
            ...types.map((r) => ({
              type: 'room_type' as const,
              id: r.id,
              title: r.name,
              subtitle: `Room type · ${r.status.toLowerCase()}`,
            })),
          ],
        });
      }
      // Same access as the Payments page (it needs both permissions).
      if (caps.includes('payments.view') && caps.includes('bookings.view')) {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            bookingId: string;
            ref: string | null;
            amount: string;
            currency: string;
            kind: string;
            status: string;
            createdAt: Date;
          }>
        >`SELECT p.id, p.booking_id AS "bookingId", b.external_reference AS ref, p.amount::text AS amount,
            p.currency, p.kind::text AS kind, p.status, p.created_at AS "createdAt"
          FROM payments p
          JOIN bookings b ON b.tenant_id = p.tenant_id AND b.property_id = p.property_id AND b.id = p.booking_id
          LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
          WHERE p.tenant_id = ${tenantId}::uuid AND p.property_id = ${propertyId}::uuid
            AND (p.external_payment_id ILIKE ${like} ESCAPE '\\'
              OR COALESCE(b.external_reference, '') ILIKE ${like} ESCAPE '\\'
              OR CONCAT_WS(' ', ${bookingContactSql.firstName}, ${bookingContactSql.lastName}) ILIKE ${like} ESCAPE '\\'
              OR COALESCE(${bookingContactSql.email}, '') ILIKE ${like} ESCAPE '\\')
          ORDER BY p.created_at DESC LIMIT ${PER_GROUP}`;
        out.push({
          key: 'payments',
          label: 'Payments',
          items: rows.map((r) => ({
            type: 'payment' as const,
            id: r.id,
            target: r.bookingId,
            title: `${r.ref ?? 'Payment'} · ${r.amount} ${r.currency}`,
            subtitle: `${r.kind.toLowerCase()} · ${r.status.toLowerCase()} · ${r.createdAt.toISOString().slice(0, 10)}`,
          })),
        });
      }
      if (caps.includes('rates.manage')) {
        const rows = await tx.$queryRaw<Array<{ id: string; name: string; currency: string }>>`
          SELECT id, name, currency FROM rate_plans
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
            AND name ILIKE ${like} ESCAPE '\\' ORDER BY name LIMIT ${PER_GROUP}`;
        out.push({
          key: 'ratePlans',
          label: 'Rate plans',
          items: rows.map((r) => ({
            type: 'rate_plan' as const,
            id: r.id,
            title: r.name,
            subtitle: `Rate plan · ${r.currency}`,
          })),
        });
      }
      if (caps.includes('staff.view')) {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            name: string | null;
            email: string;
            role: string;
            roleName: string | null;
          }>
        >`SELECT u.id, NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS name, u.email,
            tm.role::text AS role, prt.name AS "roleName"
          FROM tenant_memberships tm
          JOIN users u ON u.id = tm.user_id
          LEFT JOIN property_staff_assignments psa ON psa.tenant_id = tm.tenant_id
            AND psa.property_id = ${propertyId}::uuid AND psa.user_id = tm.user_id
          LEFT JOIN property_role_templates prt ON prt.tenant_id = psa.tenant_id
            AND prt.property_id = psa.property_id AND prt.id = psa.role_template_id
          WHERE tm.tenant_id = ${tenantId}::uuid
            AND (tm.role::text IN ('OWNER', 'ADMIN') OR psa.id IS NOT NULL)
            AND (CONCAT_WS(' ', u.first_name, u.last_name) ILIKE ${like} ESCAPE '\\'
              OR u.email ILIKE ${like} ESCAPE '\\')
          ORDER BY u.email LIMIT ${PER_GROUP}`;
        out.push({
          key: 'staff',
          label: 'Staff',
          items: rows.map((r) => ({
            type: 'staff' as const,
            id: r.id,
            title: r.name ?? r.email,
            subtitle: `${r.email} · ${r.roleName ?? r.role.toLowerCase()}`,
          })),
        });
      }
      if (caps.includes('settings.manage')) {
        const rows = await tx.$queryRaw<
          Array<{ id: string; subject: string; recipient: string; status: string; createdAt: Date }>
        >`SELECT id, subject, recipient_email AS recipient, status::text AS status, created_at AS "createdAt"
          FROM email_messages
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
            AND (recipient_email ILIKE ${like} ESCAPE '\\' OR subject ILIKE ${like} ESCAPE '\\')
          ORDER BY created_at DESC LIMIT ${PER_GROUP}`;
        out.push({
          key: 'emails',
          label: 'Emails sent',
          items: rows.map((r) => ({
            type: 'email' as const,
            id: r.id,
            title: r.subject,
            subtitle: `${r.recipient} · ${r.status.toLowerCase()} · ${r.createdAt.toISOString().slice(0, 10)}`,
          })),
        });
      }
      return out;
    });
    return { query, groups: groups.filter((group) => group.items.length > 0) };
  }
}

type Request = { tenantContext: { tenantId: string; propertyId: string; userId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/search')
export class GlobalSearchController {
  constructor(@Inject(GlobalSearchService) private readonly search: GlobalSearchService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  get(@Query('q') q: unknown, @Req() r: Request) {
    return this.search.search(
      r.tenantContext.tenantId,
      r.tenantContext.propertyId,
      r.tenantContext.userId,
      q,
    );
  }
}
