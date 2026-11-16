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

  /**
   * The "Booking created" notice (Milestone 40, decision D4): written when a booking is confirmed, never when an
   * unpaid attempt is made or when one expires. Once per booking, however many times a confirmation is repeated.
   */
  async recordBookingConfirmedInTransaction(
    tx: TenantTransaction,
    input: { tenantId: string; propertyId: string; bookingId: string },
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO notifications (tenant_id, property_id, type, payload)
      SELECT b.tenant_id, b.property_id, 'BOOKING_CREATED',
        jsonb_build_object('bookingId', b.id::text, 'guestId', b.guest_id::text)
      FROM bookings b
      WHERE b.id = ${input.bookingId}::uuid AND b.tenant_id = ${input.tenantId}::uuid
        AND b.property_id = ${input.propertyId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
          WHERE n.tenant_id = b.tenant_id AND n.property_id = b.property_id
            AND n.type = 'BOOKING_CREATED' AND n.payload ->> 'bookingId' = b.id::text
        )
    `;
  }

  // The workspace service owns permission-routed reads and personal read receipts.
}
