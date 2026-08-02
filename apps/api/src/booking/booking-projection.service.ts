import { Inject, Injectable } from '@nestjs/common';
import { BookingPaymentMethod, BookingStatus } from '@must/domain-contracts';

import { TenantDatabaseService } from '../tenancy/tenant-database.service';

export type BookingProjection = {
  id: string;
  guestId: string;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestEmail: string;
  guestPhone: string | null;
  guestStreetAddress: string | null;
  guestAddressLine2: string | null;
  guestCity: string | null;
  guestCounty: string | null;
  guestPostcode: string | null;
  roomTypeId: string;
  roomTypeName: string;
  ratePlanId: string;
  ratePlanName: string;
  startsOn: string;
  endsOn: string;
  status: BookingStatus;
  paymentMethod: BookingPaymentMethod;
  total: { amount: string; currency: string };
  externalReference: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class BookingProjectionService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  async list(tenantId: string, propertyId: string): Promise<BookingProjection[]> {
    const rows = await this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<
          Array<
            Omit<BookingProjection, 'total'> & {
              totalAmount: string;
              currency: string;
            }
          >
        >`
        SELECT b.id, b.guest_id AS "guestId", g.first_name AS "guestFirstName",
          g.last_name AS "guestLastName", g.email AS "guestEmail", g.phone AS "guestPhone",
          g.street_address AS "guestStreetAddress", g.address_line_2 AS "guestAddressLine2",
          g.city AS "guestCity", g.county AS "guestCounty", g.postcode AS "guestPostcode",
          b.room_type_id AS "roomTypeId", rt.name AS "roomTypeName",
          b.rate_plan_id AS "ratePlanId", rp.name AS "ratePlanName",
          b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn", b.status,
          b.payment_method AS "paymentMethod",
          b.total_amount::text AS "totalAmount", rp.currency, b.external_reference AS "externalReference",
          b.version, b.created_at AS "createdAt", b.updated_at AS "updatedAt"
        FROM bookings b
        JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
        JOIN room_types rt
          ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
        JOIN rate_plans rp
          ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
        WHERE b.tenant_id = ${tenantId}::uuid AND b.property_id = ${propertyId}::uuid
        ORDER BY b.starts_on DESC, b.created_at DESC, b.id DESC
      `,
    );
    return rows.map(({ totalAmount, currency, ...booking }) => ({
      ...booking,
      total: { amount: totalAmount, currency },
    }));
  }
}
