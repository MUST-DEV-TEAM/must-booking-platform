import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { AuditLogService } from './audit-log.service';
import { pricingContext } from './pricing.repository';
export const pricingHash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function pricingInvalid(message: string): never {
  throw new BadRequestException({ code: 'PRICING_INVALID', message });
}
export function pricingVersion(body: unknown, required = true) {
  const v = (body ?? {}) as Record<string, unknown>;
  if (v.version === undefined && !required) return undefined;
  if (!Number.isInteger(v.version) || Number(v.version) < 0)
    pricingInvalid('A current integer version is required.');
  return Number(v.version);
}
export function pricingReason(body: unknown) {
  const value = body && typeof body === 'object' && 'reason' in body ? body.reason : undefined;
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length < 3 || value.length > 1000)
    pricingInvalid('Choose a change reason of 3-1000 characters.');
  return value.trim();
}
export function pricingKey(key: string | undefined) {
  if (!key || !/^[\x21-\x7e]{1,128}$/.test(key))
    pricingInvalid('Idempotency-Key is required (1-128 printable non-space characters).');
  return key;
}
export type PricingTable =
  'rate_plans' | 'rate_rules' | 'room_price_overrides' | 'pricing_adjustments' | 'pricing_charges';
type Intent = {
  action: string;
  body: unknown;
  table?: PricingTable;
  id?: string;
  ratePlanId?: string;
  version?: number;
  propertyVersion?: number;
};
@Injectable()
export class PricingWrites {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}
  async run<T>(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    key: string | undefined,
    intent: Intent,
    operation: (
      tx: TenantTransaction,
      context: Awaited<ReturnType<typeof pricingContext>>,
      before: Record<string, unknown> | null,
    ) => Promise<T>,
  ): Promise<T> {
    const operationKey = pricingKey(key),
      requestHash = pricingHash({ actorUserId, ...intent });
    try {
      return await this.database.withTenantTransaction(
        { tenantId, propertyId },
        async (tx) => {
          const c = await pricingContext(tx, tenantId, propertyId, true);
          if (c.readOnly)
            throw new ForbiddenException({
              code: 'PRICING_READ_ONLY',
              message: 'Prices are managed in Clock. Local pricing writes are disabled.',
            });
          const receipts = await tx.$queryRaw<
            Array<{ requestHash: string; response: Prisma.JsonValue }>
          >`SELECT request_hash AS "requestHash",response FROM pricing_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND idempotency_key=${operationKey}`;
          if (receipts[0]) {
            if (receipts[0].requestHash !== requestHash)
              throw new ConflictException({
                code: 'IDEMPOTENCY_KEY_REUSED',
                message: 'This key was already used for another pricing change.',
              });
            return receipts[0].response as T;
          }
          if (intent.propertyVersion !== undefined && c.pricingVersion !== intent.propertyVersion)
            throw new ConflictException({
              code: 'PRICING_VERSION_CONFLICT',
              message: 'Pricing changed. Reload and preview again.',
              currentVersion: c.pricingVersion,
            });
          let before: Record<string, unknown> | null = null;
          const where =
            intent.table === 'room_price_overrides'
              ? Prisma.sql`room_id=${intent.id}::uuid AND rate_plan_id=${intent.ratePlanId}::uuid`
              : Prisma.sql`id=${intent.id}::uuid`;
          if (intent.table && intent.id) {
            const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(
              Prisma.sql`SELECT * FROM ${Prisma.raw(intent.table)} WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND ${where} FOR UPDATE`,
            );
            before = rows[0] ?? null;
            if (!before && intent.table !== 'room_price_overrides')
              throw new NotFoundException('Pricing record not found.');
            if (intent.version === undefined || intent.version !== (before?.version ?? 0))
              throw new ConflictException({
                code: 'PRICING_VERSION_CONFLICT',
                message: 'This pricing record changed. Reload before editing.',
                currentVersion: before?.version ?? 0,
              });
            if (before?.is_fallback && intent.action.endsWith('.deleted'))
              throw new ConflictException('Replace the fallback plan before deleting it.');
          }
          if (intent.table === 'rate_plans' && before) {
            const v =
              intent.body && typeof intent.body === 'object'
                ? (intent.body as Record<string, unknown>)
                : {};
            if (before.lifecycle === 'Archived' && intent.action === 'rate_plan.updated')
              throw new ConflictException('Archived plans are read-only.');
            if (before.is_fallback && v.isActive === false)
              throw new ConflictException('Replace the fallback before deactivating it.');
            if (v.currency !== undefined && v.currency !== before.currency)
              throw new ConflictException('Currency is fixed after creation.');
          }
          if (
            intent.ratePlanId &&
            ['rate_rules', 'room_price_overrides'].includes(intent.table ?? '')
          ) {
            const plans = await tx.$queryRaw<
              Array<{ pricingBasis: string; lifecycle: string }>
            >`SELECT pricing_basis AS "pricingBasis",lifecycle FROM rate_plans WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${intent.ratePlanId}::uuid`;
            if (!plans[0]) throw new NotFoundException('Rate plan not found.');
            if (plans[0].pricingBasis !== 'independent' || plans[0].lifecycle === 'Archived')
              throw new ConflictException(
                'Only non-archived independent plans accept absolute prices.',
              );
          }
          let response: unknown = await operation(tx, c, before);
          let after: Record<string, unknown> | null = null;
          const resultId =
            response && typeof response === 'object' && 'id' in response
              ? String(response.id)
              : intent.id;
          if (intent.table && resultId) {
            if (intent.id && before && !intent.action.endsWith('.duplicated'))
              await tx.$executeRaw(
                Prisma.sql`UPDATE ${Prisma.raw(intent.table)} SET version=version+1 WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND ${where}`,
              );
            const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(
              Prisma.sql`SELECT * FROM ${Prisma.raw(intent.table)} WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND ${intent.table === 'room_price_overrides' ? where : Prisma.sql`id=${resultId}::uuid`}`,
            );
            after = rows[0] ?? null;
            if (response && typeof response === 'object' && !Array.isArray(response) && after)
              response = { ...response, version: after.version };
          }
          await tx.$executeRaw`UPDATE properties SET pricing_version=pricing_version+1 WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
          await this.audit.recordInTransaction(tx, {
            tenantId,
            propertyId,
            actorUserId,
            action: intent.action,
            targetType: 'pricing',
            targetId: resultId ?? randomUUID(),
            details: { before, after, intent: intent.body, result: response },
          });
          await tx.$executeRaw`INSERT INTO pricing_operations(tenant_id,property_id,idempotency_key,request_hash,response) VALUES(${tenantId}::uuid,${propertyId}::uuid,${operationKey},${requestHash},${JSON.stringify(response ?? null)}::jsonb)`;
          return response as T;
        },
        { timeoutMs: 30000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const code = String(error.meta?.code ?? '');
        if (error.code === 'P2002' || code === '23505')
          throw new ConflictException({
            code: 'PRICING_CONFLICT',
            message: 'An equivalent pricing record already exists. Reload before editing.',
          });
        if (error.code === 'P2003' || ['23503', '23514', '22P02'].includes(code))
          pricingInvalid('The pricing configuration violates its scope or lifecycle constraints.');
      }
      throw error;
    }
  }
}
