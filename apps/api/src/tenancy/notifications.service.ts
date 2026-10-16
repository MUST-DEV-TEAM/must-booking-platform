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

/** The reservation a notification is about, so the inbox can say who and when. */
export type NotificationBooking = {
  id: string;
  externalReference: string;
  status: string;
  startsOn: string;
  endsOn: string;
  guestName: string | null;
  guestEmail: string | null;
  roomTypeName: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      const bookingIds = [
        ...new Set(
          items.flatMap((item) =>
            typeof item.payload?.bookingId === 'string' && UUID.test(item.payload.bookingId)
              ? [item.payload.bookingId]
              : [],
          ),
        ),
      ];
      const bookings = bookingIds.length
        ? await tx.$queryRaw<NotificationBooking[]>`
            SELECT b.id, b.external_reference AS "externalReference", b.status,
              b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn",
              NULLIF(TRIM(CONCAT_WS(' ', g.first_name, g.last_name)), '') AS "guestName",
              g.email AS "guestEmail", rt.name AS "roomTypeName"
            FROM bookings b
            LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
            JOIN room_types rt
              ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
            WHERE b.tenant_id = ${tenantId}::uuid AND b.property_id = ${propertyId}::uuid
              AND b.id = ANY(${bookingIds}::uuid[])
          `
        : [];
      const byId = new Map(bookings.map((booking) => [booking.id, booking]));
      return {
        items: items.map((item) => ({
          ...item,
          booking:
            typeof item.payload?.bookingId === 'string'
              ? (byId.get(item.payload.bookingId) ?? null)
              : null,
        })),
        page,
        pageSize,
        total: total[0]?.count ?? 0,
      };
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

  async markAllRead(tenantId: string, propertyId: string): Promise<{ updated: number }> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const updated = await tx.$executeRaw`
        UPDATE notifications
        SET read_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND read_at IS NULL
      `;
      return { updated };
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
