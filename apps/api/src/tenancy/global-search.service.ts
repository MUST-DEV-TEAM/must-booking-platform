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
  type: 'booking' | 'guest' | 'room' | 'room_type';
  id: string;
  title: string;
  subtitle: string;
};
export type SearchGroup = {
  key: 'bookings' | 'guests' | 'accommodations';
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
            NULLIF(TRIM(CONCAT_WS(' ', g.first_name, g.last_name)), '') AS guest, g.email
          FROM bookings b
          LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
          WHERE b.tenant_id = ${tenantId}::uuid AND b.property_id = ${propertyId}::uuid
            AND (COALESCE(b.external_reference, '') ILIKE ${like} ESCAPE '\\'
              OR CONCAT_WS(' ', g.first_name, g.last_name) ILIKE ${like} ESCAPE '\\'
              OR COALESCE(g.email, '') ILIKE ${like} ESCAPE '\\'
              OR COALESCE(g.phone, '') ILIKE ${like} ESCAPE '\\')
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
              OR COALESCE(g.phone, '') ILIKE ${like} ESCAPE '\\')
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
      if (caps.includes('calendar.view')) {
        const rooms = await tx.$queryRaw<
          Array<{ id: string; name: string; typeName: string }>
        >`SELECT r.id, r.name, rt.name AS "typeName" FROM rooms r
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
