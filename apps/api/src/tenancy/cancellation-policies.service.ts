import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';

export type CancellationPolicy = {
  id: string;
  name: string;
  freeCancellationDaysBeforeArrival: number;
};
export type ClockPolicyCatalog = {
  propertyFreeCancellationDays: number;
  policies: CancellationPolicy[];
  ratePlans: Array<{ id: string; name: string; cancellationPolicyId: string | null }>;
};

@Injectable()
export class CancellationPoliciesService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async listClockCatalog(tenantId: string, propertyId: string): Promise<ClockPolicyCatalog> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const [property, policies, ratePlans] = await Promise.all([
        tx.$queryRaw<
          Array<{ days: number }>
        >`SELECT free_cancellation_days_before_arrival AS days FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`,
        this.listInTransaction(tx, tenantId, propertyId),
        tx.$queryRaw<
          ClockPolicyCatalog['ratePlans']
        >`SELECT id, name, cancellation_policy_id AS "cancellationPolicyId" FROM rate_plans WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND clock_shadow_room_type_id IS NOT NULL ORDER BY created_at`,
      ]);
      if (!property[0]) throw new NotFoundException('Property not found.');
      return { propertyFreeCancellationDays: property[0].days, policies, ratePlans };
    });
  }

  async create(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<CancellationPolicy> {
    const input = this.input(body);
    const id = randomUUID();
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.requireWithinPropertyWindow(tx, tenantId, propertyId, input.days);
      try {
        const rows = await tx.$queryRaw<
          CancellationPolicy[]
        >`INSERT INTO cancellation_policies (id, tenant_id, property_id, name, free_cancellation_days_before_arrival) VALUES (${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${input.name}, ${input.days}) RETURNING id, name, free_cancellation_days_before_arrival AS "freeCancellationDaysBeforeArrival"`;
        await this.record(tx, tenantId, propertyId, actorUserId, 'cancellation_policy.created', id);
        return rows[0]!;
      } catch (error) {
        this.rethrowUnique(error);
      }
    });
  }

  async update(
    tenantId: string,
    propertyId: string,
    policyId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<CancellationPolicy> {
    const input = this.input(body);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.requireWithinPropertyWindow(tx, tenantId, propertyId, input.days);
      try {
        const rows = await tx.$queryRaw<
          CancellationPolicy[]
        >`UPDATE cancellation_policies SET name=${input.name}, free_cancellation_days_before_arrival=${input.days}, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${policyId}::uuid RETURNING id, name, free_cancellation_days_before_arrival AS "freeCancellationDaysBeforeArrival"`;
        if (!rows[0]) throw new NotFoundException('Cancellation policy not found.');
        await this.record(
          tx,
          tenantId,
          propertyId,
          actorUserId,
          'cancellation_policy.updated',
          policyId,
        );
        return rows[0];
      } catch (error) {
        this.rethrowUnique(error);
      }
    });
  }

  async remove(
    tenantId: string,
    propertyId: string,
    policyId: string,
    actorUserId: string,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const use = await tx.$queryRaw<
        Array<{ count: number }>
      >`SELECT COUNT(*)::int AS count FROM rate_plans WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND cancellation_policy_id=${policyId}::uuid`;
      if ((use[0]?.count ?? 0) > 0)
        throw new ConflictException(
          'Unassign this cancellation policy from every rate plan before deleting it.',
        );
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`DELETE FROM cancellation_policies WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${policyId}::uuid RETURNING id`;
      if (!rows[0]) throw new NotFoundException('Cancellation policy not found.');
      await this.record(
        tx,
        tenantId,
        propertyId,
        actorUserId,
        'cancellation_policy.deleted',
        policyId,
      );
    });
  }

  async assignToClockRatePlan(
    tenantId: string,
    propertyId: string,
    ratePlanId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<{ id: string; cancellationPolicyId: string | null }> {
    const policyId = this.assignmentInput(body);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      if (policyId) {
        const policies = await tx.$queryRaw<
          Array<{ days: number }>
        >`SELECT free_cancellation_days_before_arrival AS days FROM cancellation_policies WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${policyId}::uuid`;
        if (!policies[0]) throw new NotFoundException('Cancellation policy not found.');
        await this.requireWithinPropertyWindow(tx, tenantId, propertyId, policies[0].days);
      }
      const rows = await tx.$queryRaw<
        Array<{ id: string; cancellationPolicyId: string | null }>
      >`UPDATE rate_plans SET cancellation_policy_id=${policyId}::uuid, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${ratePlanId}::uuid AND clock_shadow_room_type_id IS NOT NULL RETURNING id, cancellation_policy_id AS "cancellationPolicyId"`;
      if (!rows[0]) throw new NotFoundException('Clock-managed rate plan not found.');
      await this.record(
        tx,
        tenantId,
        propertyId,
        actorUserId,
        'clock_shadow_rate_plan.cancellation_policy_assigned',
        ratePlanId,
      );
      return rows[0];
    });
  }

  private listInTransaction(tx: TenantTransaction, tenantId: string, propertyId: string) {
    return tx.$queryRaw<
      CancellationPolicy[]
    >`SELECT id, name, free_cancellation_days_before_arrival AS "freeCancellationDaysBeforeArrival" FROM cancellation_policies WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid ORDER BY created_at`;
  }
  private input(body: unknown) {
    const v = (body ?? {}) as Record<string, unknown>;
    const name = typeof v.name === 'string' ? v.name.trim() : '';
    const days = v.freeCancellationDaysBeforeArrival;
    if (!name || name.length > 200)
      throw new BadRequestException('name is required and must be at most 200 characters.');
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 0)
      throw new BadRequestException(
        'freeCancellationDaysBeforeArrival must be a non-negative integer.',
      );
    return { name, days };
  }
  private assignmentInput(body: unknown): string | null {
    const value = (body ?? {}) as Record<string, unknown>;
    if (value.cancellationPolicyId === null) return null;
    if (typeof value.cancellationPolicyId !== 'string' || !value.cancellationPolicyId)
      throw new BadRequestException('cancellationPolicyId must be a policy ID or null.');
    return value.cancellationPolicyId;
  }
  private async requireWithinPropertyWindow(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    days: number,
  ) {
    const rows = await tx.$queryRaw<
      Array<{ days: number }>
    >`SELECT free_cancellation_days_before_arrival AS days FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
    if (!rows[0]) throw new NotFoundException('Property not found.');
    if (days > rows[0].days)
      throw new BadRequestException(
        `A cancellation policy cannot exceed this property's ${rows[0].days}-day self-service cancellation window.`,
      );
  }
  private async record(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    action: string,
    targetId: string,
  ) {
    await this.audit.recordInTransaction(tx, {
      tenantId,
      propertyId,
      actorUserId,
      action,
      targetType: 'cancellation_policy',
      targetId,
    });
  }
  private rethrowUnique(error: unknown): never {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2010' &&
      (error as { meta?: { code?: string } }).meta?.code === '23505'
    )
      throw new ConflictException(
        'A cancellation policy with this name already exists for this property.',
      );
    throw error;
  }
}
