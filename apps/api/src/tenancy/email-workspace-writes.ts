import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';

export type EmailContext = { tenantId: string; propertyId: string };

/** Serializes hotel email mutations and commits their retry receipt with the audit. */
export async function emailWrite<T>(
  database: TenantDatabaseService,
  audit: AuditLogService,
  context: EmailContext,
  actorUserId: string,
  idempotencyKey: string | undefined,
  action: string,
  targetId: string,
  input: object,
  change: (tx: TenantTransaction) => Promise<{ response: T; details: Record<string, unknown> }>,
): Promise<T> {
  if (!idempotencyKey || !/^[\x21-\x7e]{1,128}$/.test(idempotencyKey))
    throw new BadRequestException('A valid Idempotency-Key is required.');
  const hash = createHash('sha256')
    .update(JSON.stringify({ actorUserId, action, targetId, input }))
    .digest('hex');
  return database.withTenantTransaction(context, async (tx) => {
    const property = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM properties WHERE tenant_id=${context.tenantId}::uuid AND id=${context.propertyId}::uuid FOR UPDATE
    `;
    if (!property.length) throw new NotFoundException('Property was not found.');
    const receipts = await tx.$queryRaw<{ hash: string; response: T }[]>`
      SELECT request_hash AS hash,response FROM email_workspace_operations
      WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND idempotency_key=${idempotencyKey}
    `;
    if (receipts[0]) {
      if (receipts[0].hash !== hash)
        throw new ConflictException('Idempotency-Key was already used for a different request.');
      return receipts[0].response;
    }
    const result = await change(tx);
    await audit.recordInTransaction(tx, {
      ...context,
      actorUserId,
      action,
      targetType: 'email',
      targetId,
      details: result.details,
    });
    await tx.$executeRaw`
      INSERT INTO email_workspace_operations(tenant_id,property_id,idempotency_key,request_hash,response)
      VALUES(${context.tenantId}::uuid,${context.propertyId}::uuid,${idempotencyKey},${hash},${JSON.stringify(result.response)}::jsonb)
    `;
    return result.response;
  });
}
