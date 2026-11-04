import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditLogService } from './audit-log.service';
import { StaffInviteService } from './staff-invite.service';
import { TenantDatabaseService } from './tenant-database.service';
import { loadVenuePlan, requireDining } from './venue-plan';
import type { VenueRole } from './venue-capability-catalog';

export type VenueStaffView = {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: VenueRole;
  suspendedAt: Date | null;
};

const ROLES: readonly VenueRole[] = ['MANAGER', 'HOST'];

// Fixed column list, embedded as SQL (not as bind parameters).
const STAFF_COLUMNS = Prisma.raw(
  'a."user_id" AS "userId", u."email", u."first_name" AS "firstName", u."last_name" AS "lastName", a."role", a."suspended_at" AS "suspendedAt"',
);

function parseRole(body: unknown): VenueRole {
  const role =
    typeof body === 'object' && body !== null ? (body as { role?: unknown }).role : undefined;
  if (typeof role !== 'string' || !ROLES.includes(role as VenueRole))
    throw new BadRequestException('Role must be MANAGER or HOST.');
  return role as VenueRole;
}

@Injectable()
export class VenueStaffService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(StaffInviteService) private readonly invites: StaffInviteService,
  ) {}

  /**
   * Creates a new staff account and gives it a role at this restaurant, the same way a hotel creates
   * its own staff: whoever creates it hands over the password. It counts towards the staff limit.
   */
  async createAccount(
    tenantId: string,
    venueId: string,
    body: unknown,
    actorUserId: string,
  ): Promise<VenueStaffView> {
    const value = (typeof body === 'object' && body !== null ? body : {}) as Record<
      string,
      unknown
    >;
    const firstName = typeof value.firstName === 'string' ? value.firstName.trim() : '';
    const lastName = typeof value.lastName === 'string' ? value.lastName.trim() : '';
    const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : '';
    if (!firstName || firstName.length > 100)
      throw new BadRequestException('A first name is required.');
    if (lastName.length > 100) throw new BadRequestException('The last name is too long.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320)
      throw new BadRequestException('A valid email is required.');
    // The same rule as hotel staff accounts.
    const password = value.password;
    if (
      typeof password !== 'string' ||
      password.length < 12 ||
      password.length > 128 ||
      !/[a-z]/i.test(password) ||
      !/\d/.test(password)
    )
      throw new BadRequestException(
        'The password must be 12 to 128 characters with at least one letter and one digit.',
      );
    const role = parseRole(value);

    await this.database.withTenantTransaction({ tenantId }, async (tx) =>
      requireDining(await loadVenuePlan(tx, tenantId)),
    );
    const { userId } = await this.invites.createVenueDirect({
      tenantId,
      venueId,
      actorUserId,
      firstName,
      lastName: lastName || null,
      email,
      password,
      role,
    });
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const rows = await tx.$queryRaw<VenueStaffView[]>`
        SELECT ${STAFF_COLUMNS}
        FROM "venue_staff_assignments" a
        JOIN "users" u ON u."id" = a."user_id"
        WHERE a."tenant_id" = ${tenantId}::uuid AND a."venue_id" = ${venueId}::uuid
          AND a."user_id" = ${userId}::uuid
      `;
      return rows[0]!;
    });
  }

  list(tenantId: string, venueId: string): Promise<VenueStaffView[]> {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      return tx.$queryRaw<VenueStaffView[]>`
        SELECT ${STAFF_COLUMNS}
        FROM "venue_staff_assignments" a
        JOIN "users" u ON u."id" = a."user_id"
        WHERE a."tenant_id" = ${tenantId}::uuid AND a."venue_id" = ${venueId}::uuid
        ORDER BY u."email"
      `;
    });
  }

  async invite(tenantId: string, venueId: string, body: unknown, actorUserId: string) {
    const value = (body ?? {}) as Record<string, unknown>;
    const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320)
      throw new BadRequestException('A valid email is required.');
    const role = parseRole(body);
    const token = await this.invites.invite(
      { tenantId, email, assignments: [], venueAssignments: [{ venueId, role }] },
      actorUserId,
    );
    return { token };
  }

  async remove(tenantId: string, venueId: string, targetUserId: string, actorUserId: string) {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      // Serialize membership removal with the shared seat allocator.
      await tx.$queryRaw`SELECT id FROM organizations WHERE id=${tenantId}::uuid FOR UPDATE`;
      const removed = await tx.$queryRaw<
        Array<{ userId: string }>
      >`DELETE FROM venue_staff_assignments WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid AND user_id=${targetUserId}::uuid RETURNING user_id AS "userId"`;
      if (!removed.length) return;
      await tx.$executeRaw`DELETE FROM tenant_memberships m WHERE m.tenant_id=${tenantId}::uuid AND m.user_id=${targetUserId}::uuid AND m.role='STAFF'
        AND NOT EXISTS(SELECT 1 FROM property_staff_assignments a WHERE a.tenant_id=m.tenant_id AND a.user_id=m.user_id)
        AND NOT EXISTS(SELECT 1 FROM venue_staff_assignments a WHERE a.tenant_id=m.tenant_id AND a.user_id=m.user_id)`;
      await this.audit.recordInTransaction(tx, {
        tenantId,
        actorUserId,
        action: 'venue.staff_removed',
        targetType: 'venue',
        targetId: venueId,
        details: { userId: targetUserId },
      });
    });
  }

  /** Gives an existing workspace member a role at the venue, or changes the role they already have. */
  async assign(
    tenantId: string,
    venueId: string,
    targetUserId: string,
    body: unknown,
    actorUserId: string,
  ): Promise<VenueStaffView> {
    const role = parseRole(body);
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      const member = await tx.$queryRaw<Array<{ userId: string }>>`
        SELECT "user_id" AS "userId" FROM "tenant_memberships"
        WHERE "tenant_id" = ${tenantId}::uuid AND "user_id" = ${targetUserId}::uuid
      `;
      if (member.length !== 1)
        throw new NotFoundException('That person is not a member of this workspace.');
      const rows = await tx.$queryRaw<VenueStaffView[]>`
        WITH a AS (
          INSERT INTO "venue_staff_assignments" ("tenant_id", "venue_id", "user_id", "role", "created_by_user_id")
          VALUES (${tenantId}::uuid, ${venueId}::uuid, ${targetUserId}::uuid, ${role}, ${actorUserId}::uuid)
          ON CONFLICT ("tenant_id", "venue_id", "user_id")
          DO UPDATE SET "role" = EXCLUDED."role", "updated_at" = CURRENT_TIMESTAMP
          RETURNING "user_id", "role", "suspended_at"
        )
        SELECT ${STAFF_COLUMNS} FROM a JOIN "users" u ON u."id" = a."user_id"
      `;
      await this.audit.recordInTransaction(tx, {
        tenantId,
        actorUserId,
        action: 'venue.staff_assigned',
        targetType: 'venue',
        targetId: venueId,
        details: { userId: targetUserId, role },
      });
      return rows[0]!;
    });
  }

  async setSuspended(
    tenantId: string,
    venueId: string,
    targetUserId: string,
    suspended: boolean,
    actorUserId: string,
  ): Promise<VenueStaffView> {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      const rows = await tx.$queryRaw<VenueStaffView[]>`
        WITH a AS (
          UPDATE "venue_staff_assignments"
          SET "suspended_at" = CASE WHEN ${suspended}::boolean THEN CURRENT_TIMESTAMP ELSE NULL END,
              "updated_at" = CURRENT_TIMESTAMP
          WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid
            AND "user_id" = ${targetUserId}::uuid
          RETURNING "user_id", "role", "suspended_at"
        )
        SELECT ${STAFF_COLUMNS} FROM a JOIN "users" u ON u."id" = a."user_id"
      `;
      if (!rows[0]) throw new NotFoundException('That person is not assigned to this restaurant.');
      await this.audit.recordInTransaction(tx, {
        tenantId,
        actorUserId,
        action: suspended ? 'venue.staff_suspended' : 'venue.staff_resumed',
        targetType: 'venue',
        targetId: venueId,
        details: { userId: targetUserId },
      });
      return rows[0];
    });
  }
}
