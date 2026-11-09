import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { parseVenueCreate, parseVenueUpdate, slugifyVenueName } from './venue-input';
import { loadVenuePlan, requireDining } from './venue-plan';

export type VenueView = {
  id: string;
  propertyId: string | null;
  name: string;
  slug: string;
  timezone: string | null;
  currency: string | null;
  address: string | null;
  phone: string | null;
  contactEmail: string | null;
  active: boolean;
  description: string | null;
  /** Set once the first-time setup has been finished; online booking never opens before that. */
  setupCompletedAt: Date | null;
  advanceBookingDays: number;
  maxOnlinePartySize: number;
  holdMinutes: number;
  lastBookingMinutesBeforeClose: number;
  diningMinutes: number;
  depositMode: 'none' | 'percent' | 'fixed';
  /** Exact text with two decimals ("30.00"). */
  depositValue: string;
  depositMinParty: number;
  freeCancelHours: number;
};

// Fixed column lists, embedded as SQL (not as bind parameters).
const VENUE_COLUMNS = Prisma.raw(
  'v."id", v."property_id" AS "propertyId", v."name", v."slug", v."timezone", v."currency", v."address", v."phone", v."contact_email" AS "contactEmail", v."active", v."description", v."setup_completed_at" AS "setupCompletedAt", v."advance_booking_days" AS "advanceBookingDays", v."max_online_party_size" AS "maxOnlinePartySize", v."hold_minutes" AS "holdMinutes", v."last_booking_minutes_before_close" AS "lastBookingMinutesBeforeClose", v."dining_minutes" AS "diningMinutes", v."deposit_mode" AS "depositMode", v."deposit_value"::text AS "depositValue", v."deposit_min_party" AS "depositMinParty", v."free_cancel_hours" AS "freeCancelHours"',
);
const VENUE_RETURNING = Prisma.raw(
  '"id", "property_id" AS "propertyId", "name", "slug", "timezone", "currency", "address", "phone", "contact_email" AS "contactEmail", "active", "description", "setup_completed_at" AS "setupCompletedAt", "advance_booking_days" AS "advanceBookingDays", "max_online_party_size" AS "maxOnlinePartySize", "hold_minutes" AS "holdMinutes", "last_booking_minutes_before_close" AS "lastBookingMinutesBeforeClose", "dining_minutes" AS "diningMinutes", "deposit_mode" AS "depositMode", "deposit_value"::text AS "depositValue", "deposit_min_party" AS "depositMinParty", "free_cancel_hours" AS "freeCancelHours"',
);

@Injectable()
export class VenuesService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  /** Workspace owners and admins see every venue; everyone else sees the ones they are assigned to. */
  async list(tenantId: string, userId: string): Promise<VenueView[]> {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      const member = await tx.$queryRaw<Array<{ role: 'OWNER' | 'ADMIN' | 'STAFF' }>>`
        SELECT "role" FROM "tenant_memberships"
        WHERE "tenant_id" = ${tenantId}::uuid AND "user_id" = ${userId}::uuid
      `;
      if (member[0]?.role === 'OWNER' || member[0]?.role === 'ADMIN')
        return tx.$queryRaw<VenueView[]>`
          SELECT ${VENUE_COLUMNS} FROM "venues" v
          WHERE v."tenant_id" = ${tenantId}::uuid
          ORDER BY v."name"
        `;
      return tx.$queryRaw<VenueView[]>`
        SELECT ${VENUE_COLUMNS} FROM "venues" v
        JOIN "venue_staff_assignments" a
          ON a."tenant_id" = v."tenant_id" AND a."venue_id" = v."id"
         AND a."user_id" = ${userId}::uuid AND a."suspended_at" IS NULL
        WHERE v."tenant_id" = ${tenantId}::uuid
        ORDER BY v."name"
      `;
    });
  }

  async get(tenantId: string, venueId: string): Promise<VenueView> {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      return this.findVenue(tx, tenantId, venueId);
    });
  }

  async create(tenantId: string, actorUserId: string, body: unknown): Promise<VenueView> {
    const input = parseVenueCreate(body);
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      // Serialise creates per workspace so two requests cannot both pass the limit check.
      await tx.$queryRaw`SELECT 1 AS "locked" FROM "organizations" WHERE "id" = ${tenantId}::uuid FOR UPDATE`;
      const plan = await loadVenuePlan(tx, tenantId);
      requireDining(plan);
      if (plan.maxVenues !== null && plan.activeVenues >= plan.maxVenues)
        throw new ConflictException({
          message: `Your plan allows ${plan.maxVenues} restaurant${plan.maxVenues === 1 ? '' : 's'}.`,
          code: 'VENUE_LIMIT_REACHED',
        });
      if (input.propertyId) await this.requireProperty(tx, tenantId, input.propertyId);
      const slug = await this.uniqueSlug(tx, tenantId, slugifyVenueName(input.name));
      const id = randomUUID();
      const rows = await tx.$queryRaw<VenueView[]>`
        INSERT INTO "venues" ("id", "tenant_id", "property_id", "name", "slug", "timezone", "currency", "address", "phone", "contact_email", "description")
        VALUES (${id}::uuid, ${tenantId}::uuid, ${input.propertyId}::uuid, ${input.name}, ${slug},
                ${input.timezone}, ${input.currency}, ${input.address}, ${input.phone}, ${input.contactEmail}, ${input.description})
        RETURNING ${VENUE_RETURNING}
      `;
      await this.audit.recordInTransaction(tx, {
        tenantId,
        actorUserId,
        action: 'venue.created',
        targetType: 'venue',
        targetId: id,
        details: { name: input.name },
      });
      return rows[0]!;
    });
  }

  async update(
    tenantId: string,
    venueId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<VenueView> {
    const input = parseVenueUpdate(body);
    return this.database
      .withTenantTransaction({ tenantId }, async (tx) => {
        requireDining(await loadVenuePlan(tx, tenantId));
        if ('propertyId' in input) {
          // Which hotel a restaurant belongs to is a workspace-level decision: venue managers may edit
          // their restaurant, but only a workspace owner or admin may change its hotel link.
          const member = await tx.$queryRaw<Array<{ role: 'OWNER' | 'ADMIN' | 'STAFF' }>>`
            SELECT "role" FROM "tenant_memberships"
            WHERE "tenant_id" = ${tenantId}::uuid AND "user_id" = ${actorUserId}::uuid
          `;
          if (member[0]?.role !== 'OWNER' && member[0]?.role !== 'ADMIN')
            throw new ForbiddenException(
              'Only a workspace owner or admin can change which hotel a restaurant is linked to.',
            );
        }
        if (input.propertyId) await this.requireProperty(tx, tenantId, input.propertyId);
        const has = (key: keyof typeof input) => key in input;
        const rows = await tx.$queryRaw<VenueView[]>`
        UPDATE "venues" SET
          "name" = CASE WHEN ${has('name')}::boolean THEN ${input.name ?? null} ELSE "name" END,
          "timezone" = CASE WHEN ${has('timezone')}::boolean THEN ${input.timezone ?? null} ELSE "timezone" END,
          "currency" = CASE WHEN ${has('currency')}::boolean THEN ${input.currency ?? null} ELSE "currency" END,
          "address" = CASE WHEN ${has('address')}::boolean THEN ${input.address ?? null} ELSE "address" END,
          "phone" = CASE WHEN ${has('phone')}::boolean THEN ${input.phone ?? null} ELSE "phone" END,
          "contact_email" = CASE WHEN ${has('contactEmail')}::boolean THEN ${input.contactEmail ?? null} ELSE "contact_email" END,
          "property_id" = CASE WHEN ${has('propertyId')}::boolean THEN ${input.propertyId ?? null}::uuid ELSE "property_id" END,
          "description" = CASE WHEN ${has('description')}::boolean THEN ${input.description ?? null} ELSE "description" END,
          "advance_booking_days" = CASE WHEN ${has('advanceBookingDays')}::boolean THEN ${input.advanceBookingDays ?? null}::integer ELSE "advance_booking_days" END,
          "max_online_party_size" = CASE WHEN ${has('maxOnlinePartySize')}::boolean THEN ${input.maxOnlinePartySize ?? null}::integer ELSE "max_online_party_size" END,
          "hold_minutes" = CASE WHEN ${has('holdMinutes')}::boolean THEN ${input.holdMinutes ?? null}::integer ELSE "hold_minutes" END,
          "last_booking_minutes_before_close" = CASE WHEN ${has('lastBookingMinutesBeforeClose')}::boolean THEN ${input.lastBookingMinutesBeforeClose ?? null}::integer ELSE "last_booking_minutes_before_close" END,
          "dining_minutes" = CASE WHEN ${has('diningMinutes')}::boolean THEN ${input.diningMinutes ?? null}::integer ELSE "dining_minutes" END,
          "deposit_mode" = CASE WHEN ${has('depositMode')}::boolean THEN ${input.depositMode ?? null} ELSE "deposit_mode" END,
          "deposit_value" = CASE WHEN ${has('depositValue')}::boolean THEN ${input.depositValue ?? null}::numeric ELSE "deposit_value" END,
          "deposit_min_party" = CASE WHEN ${has('depositMinParty')}::boolean THEN ${input.depositMinParty ?? null}::integer ELSE "deposit_min_party" END,
          "free_cancel_hours" = CASE WHEN ${has('freeCancelHours')}::boolean THEN ${input.freeCancelHours ?? null}::integer ELSE "free_cancel_hours" END,
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${venueId}::uuid
        RETURNING ${VENUE_RETURNING}
      `;
        if (!rows[0]) throw new NotFoundException('Restaurant was not found.');
        await this.audit.recordInTransaction(tx, {
          tenantId,
          actorUserId,
          action: 'venue.updated',
          targetType: 'venue',
          targetId: venueId,
          details: { fields: Object.keys(input) },
        });
        return rows[0];
      })
      .catch((error: unknown) => {
        // A value inside its own limits can still break a rule between fields (a percentage over 100).
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: string }).code === 'P2010' &&
          (error as { meta?: { code?: string } }).meta?.code === '23514'
        )
          throw new BadRequestException('One of the settings is outside its allowed range.');
        throw error;
      });
  }

  async deactivate(tenantId: string, venueId: string, actorUserId: string): Promise<VenueView> {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      const rows = await tx.$queryRaw<VenueView[]>`
        UPDATE "venues" SET "active" = false, "updated_at" = CURRENT_TIMESTAMP
        WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${venueId}::uuid
        RETURNING ${VENUE_RETURNING}
      `;
      if (!rows[0]) throw new NotFoundException('Restaurant was not found.');
      await this.audit.recordInTransaction(tx, {
        tenantId,
        actorUserId,
        action: 'venue.deactivated',
        targetType: 'venue',
        targetId: venueId,
      });
      return rows[0];
    });
  }

  /** Switches a restaurant back on. Already-active restaurants are returned as they are. */
  async activate(tenantId: string, venueId: string, actorUserId: string): Promise<VenueView> {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      await tx.$queryRaw`SELECT 1 AS "locked" FROM "organizations" WHERE "id" = ${tenantId}::uuid FOR UPDATE`;
      const plan = await loadVenuePlan(tx, tenantId);
      requireDining(plan);
      const current = await tx.$queryRaw<Array<{ active: boolean }>>`
        SELECT "active" FROM "venues"
        WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${venueId}::uuid
      `;
      if (!current[0]) throw new NotFoundException('Restaurant was not found.');
      if (current[0].active) return this.findVenue(tx, tenantId, venueId);
      if (plan.maxVenues !== null && plan.activeVenues >= plan.maxVenues)
        throw new ConflictException({
          message: `Your plan allows ${plan.maxVenues} restaurant${plan.maxVenues === 1 ? '' : 's'}.`,
          code: 'VENUE_LIMIT_REACHED',
        });
      const rows = await tx.$queryRaw<VenueView[]>`
        UPDATE "venues" SET "active" = true, "updated_at" = CURRENT_TIMESTAMP
        WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${venueId}::uuid
        RETURNING ${VENUE_RETURNING}
      `;
      await this.audit.recordInTransaction(tx, {
        tenantId,
        actorUserId,
        action: 'venue.activated',
        targetType: 'venue',
        targetId: venueId,
      });
      return rows[0]!;
    });
  }

  /**
   * Marks the first-time setup as finished. It refuses until the essentials exist: a time zone and
   * currency, at least one opening-hours service and at least one table.
   */
  async completeSetup(tenantId: string, venueId: string, actorUserId: string): Promise<VenueView> {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      const venue = await this.findVenue(tx, tenantId, venueId);
      const counts = await tx.$queryRaw<Array<{ services: number; tables: number }>>`
        SELECT
          (SELECT COUNT(*)::integer FROM "venue_services"
            WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid) AS "services",
          (SELECT COUNT(*)::integer FROM "venue_tables"
            WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid AND "active") AS "tables"
      `;
      const missing: string[] = [];
      if (!venue.timezone || !venue.currency) missing.push('basics');
      if ((counts[0]?.services ?? 0) === 0) missing.push('hours');
      if ((counts[0]?.tables ?? 0) === 0) missing.push('tables');
      if (missing.length > 0)
        throw new BadRequestException({
          message: 'Finish the required steps before completing the setup.',
          code: 'SETUP_INCOMPLETE',
          missing,
        });
      const rows = await tx.$queryRaw<VenueView[]>`
        UPDATE "venues"
        SET "setup_completed_at" = COALESCE("setup_completed_at", CURRENT_TIMESTAMP),
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${venueId}::uuid
        RETURNING ${VENUE_RETURNING}
      `;
      if (!venue.setupCompletedAt)
        await this.audit.recordInTransaction(tx, {
          tenantId,
          actorUserId,
          action: 'venue.setup_completed',
          targetType: 'venue',
          targetId: venueId,
        });
      return rows[0]!;
    });
  }

  private async requireProperty(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "properties"
      WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${propertyId}::uuid
    `;
    if (rows.length !== 1)
      throw new BadRequestException('That hotel property does not belong to this workspace.');
  }

  private async uniqueSlug(tx: TenantTransaction, tenantId: string, base: string): Promise<string> {
    const taken = await tx.$queryRaw<Array<{ slug: string }>>`
      SELECT "slug" FROM "venues"
      WHERE "tenant_id" = ${tenantId}::uuid AND ("slug" = ${base} OR "slug" LIKE ${base + '-%'})
    `;
    const used = new Set(taken.map((row) => row.slug));
    if (!used.has(base)) return base;
    for (let n = 2; ; n += 1) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }

  private async findVenue(
    tx: TenantTransaction,
    tenantId: string,
    venueId: string,
  ): Promise<VenueView> {
    const rows = await tx.$queryRaw<VenueView[]>`
      SELECT ${VENUE_COLUMNS} FROM "venues" v
      WHERE v."tenant_id" = ${tenantId}::uuid AND v."id" = ${venueId}::uuid
    `;
    if (!rows[0]) throw new NotFoundException('Restaurant was not found.');
    return rows[0];
  }
}
