import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import {
  canTransition,
  isLifecycleState,
  LIFECYCLE_LABELS,
  needsDangerousPermission,
  type LifecycleState,
} from './hotel-lifecycle';
import { PlatformAuditService } from './platform-audit.service';
import { requireActor, type PlatformRequestContext } from './platform-console.decorators';

export interface LifecycleResult {
  tenantId: string;
  state: LifecycleState;
  version: number;
  reason: string;
  changedAt: string;
}

@Injectable()
export class PlatformLifecycleService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
  ) {}

  /**
   * Moves a hotel to a new lifecycle state. Serialised by a row lock and guarded by the version the
   * caller last saw, so two admins acting at once give one winner and one 409. No data is deleted.
   */
  async transition(
    tenantId: string,
    input: unknown,
    ctx: PlatformRequestContext,
  ): Promise<LifecycleResult> {
    const actor = requireActor(ctx);
    const body = (input ?? {}) as { to?: unknown; reason?: unknown; version?: unknown };
    if (!isLifecycleState(body.to))
      throw new BadRequestException('A valid target status is required.');
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 5 || reason.length > 1000)
      throw new BadRequestException('A reason of 5 to 1000 characters is required.');
    if (!Number.isInteger(body.version)) throw new BadRequestException('version is required.');
    const to = body.to;
    ctx.hint.reason = reason;
    ctx.hint.tenantId = tenantId;

    return this.database.withConsoleTenantTransaction({ tenantId }, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ name: string; state: LifecycleState; version: number }>
      >`
        SELECT "name", "lifecycle_state"::text AS "state", "lifecycle_version" AS "version"
        FROM "organizations" WHERE "id" = ${tenantId}::uuid FOR UPDATE
      `;
      const current = rows[0];
      if (!current) throw new NotFoundException('Hotel not found.');
      if (current.version !== body.version)
        throw new ConflictException(
          'This hotel was changed by someone else. Reload to see its current status.',
        );
      if (!canTransition(current.state, to))
        throw new ConflictException(
          `A hotel cannot move from ${LIFECYCLE_LABELS[current.state]} to ${LIFECYCLE_LABELS[to]}.`,
        );
      if (
        needsDangerousPermission(current.state, to) &&
        !actor.capabilities.includes('platform.hotels.dangerous')
      )
        throw new ForbiddenException(
          'Only a Super admin can cancel, archive or reinstate a hotel.',
        );

      const updated = await tx.$queryRaw<Array<{ version: number; changedAt: string }>>`
        UPDATE "organizations"
        SET "lifecycle_state" = ${to}::"OrganizationLifecycleState", "lifecycle_reason" = ${reason},
          "updated_at" = now()
        WHERE "id" = ${tenantId}::uuid
        RETURNING "lifecycle_version" AS "version", "lifecycle_changed_at" AS "changedAt"
      `;
      await tx.$executeRaw`
        INSERT INTO "organization_lifecycle_events"
          ("tenant_id", "from_state", "to_state", "reason", "actor_account_id", "actor_email")
        VALUES (${tenantId}::uuid, ${current.state}::"OrganizationLifecycleState",
          ${to}::"OrganizationLifecycleState", ${reason}, ${actor.accountId}::uuid, ${actor.email})
      `;
      await this.audit.recordInTransaction(tx, ctx, {
        action: 'platform.hotel.lifecycle_changed',
        tenantId,
        targetType: 'organization',
        targetId: tenantId,
        before: { state: current.state, version: current.version },
        after: { state: to, version: updated[0]?.version },
        reason,
        details: { hotel: current.name },
      });
      return {
        tenantId,
        state: to,
        version: updated[0]!.version,
        reason,
        changedAt: String(updated[0]!.changedAt),
      };
    });
  }

  async history(tenantId: string) {
    return this.database.withConsoleTenantTransaction(
      { tenantId },
      (tx) =>
        tx.$queryRaw<
          Array<{
            id: string;
            from: LifecycleState | null;
            to: LifecycleState;
            reason: string;
            actorEmail: string | null;
            createdAt: string;
          }>
        >`
        SELECT "id", "from_state"::text AS "from", "to_state"::text AS "to", "reason",
          "actor_email" AS "actorEmail", "created_at" AS "createdAt"
        FROM "organization_lifecycle_events"
        WHERE "tenant_id" = ${tenantId}::uuid
        ORDER BY "created_at" DESC, "id" DESC
        LIMIT 50
      `,
    );
  }
}
