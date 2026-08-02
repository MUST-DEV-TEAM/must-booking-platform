import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';

export type NotificationType =
  'BOOKING_CREATED' | 'BOOKING_NEEDS_ATTENTION' | 'PAYMENT_REFUNDED' | 'STAFF_SEAT_CAP_REACHED';

export type Notification = {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
};

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

  async list(tenantId: string, propertyId: string, query: unknown) {
    const { page, pageSize } = this.page(query);
    const offset = (page - 1) * pageSize;
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const [items, total] = await Promise.all([
        tx.$queryRaw<Notification[]>`
          SELECT id, type, payload, read_at AS "readAt", created_at AS "createdAt"
          FROM notifications
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          ORDER BY created_at DESC, id DESC
          LIMIT ${pageSize} OFFSET ${offset}
        `,
        tx.$queryRaw<[{ count: number }]>`
          SELECT COUNT(*)::int AS count
          FROM notifications
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        `,
      ]);
      return { items, page, pageSize, total: total[0]?.count ?? 0 };
    });
  }

  async markRead(
    tenantId: string,
    propertyId: string,
    notificationId: string,
  ): Promise<Notification> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRaw<Notification[]>`
        UPDATE notifications
        SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
        WHERE id = ${notificationId}::uuid AND tenant_id = ${tenantId}::uuid
          AND property_id = ${propertyId}::uuid
        RETURNING id, type, payload, read_at AS "readAt", created_at AS "createdAt"
      `;
      if (!rows[0]) throw new NotFoundException('Notification was not found.');
      return rows[0];
    });
  }

  private page(query: unknown): { page: number; pageSize: number } {
    const value = (query ?? {}) as Record<string, unknown>;
    const page = value.page === undefined ? 1 : Number(value.page);
    const pageSize = value.pageSize === undefined ? 20 : Number(value.pageSize);
    if (!Number.isInteger(page) || page < 1)
      throw new BadRequestException('page must be positive.');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
      throw new BadRequestException('pageSize must be between 1 and 100.');
    return { page, pageSize };
  }
}
