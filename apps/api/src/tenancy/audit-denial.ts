import type { AuditLogService } from './audit-log.service';
/** Only established request scope is used. Logging failure must never grant a denied action. */
export async function auditDenial(
  audit: AuditLogService,
  context: { tenantId: string; propertyId?: string; userId: string } | undefined,
  reasonCode: string,
  capability?: string,
) {
  if (!context?.tenantId || !context.propertyId || !context.userId) return;
  try {
    await audit.record({
      ...context,
      actorUserId: context.userId,
      action: 'auth.access_denied',
      targetType: 'property',
      targetId: context.propertyId,
      result: 'denied',
      source: 'MUST_STAFF',
      details: { reasonCode, ...(capability ? { capability } : {}) },
    });
  } catch {
    /* AuditLogService emits the storage-failure signal; access remains denied. */
  }
}
