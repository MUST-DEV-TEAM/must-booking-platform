import { Inject, Injectable } from '@nestjs/common';

import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';

import type { NotificationType } from './notification-registry';
export type { NotificationType } from './notification-registry';

@Injectable()
export class NotificationsService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  record(
    tenantId: string,
    propertyId: string,
    type: NotificationType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      this.recordInTransaction(tx, { tenantId, propertyId, type, payload }),
    );
  }

  async recordInTransaction(
    tx: TenantTransaction,
    input: {
      tenantId: string;
      propertyId: string;
      type: NotificationType;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO notifications (tenant_id, property_id, type, payload)
      VALUES (
        ${input.tenantId}::uuid, ${input.propertyId}::uuid, ${input.type},
        ${JSON.stringify(input.payload)}::jsonb
      )
    `;
  }

  // The workspace service owns permission-routed reads and personal read receipts.
}
