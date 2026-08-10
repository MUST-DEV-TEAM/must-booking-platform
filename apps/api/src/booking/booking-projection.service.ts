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
  specialRequests: string | null;
  roomTypeId: string;
  roomTypeName: string;
  roomId: string | null;
  ratePlanId: string;
  ratePlanName: string;
  startsOn: string;
  endsOn: string;
  status: BookingStatus;
  paymentMethod: BookingPaymentMethod;
  total: { amount: string; currency: string };
  paidAmount: string;
  refundedAmount: string;
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
          b.special_requests AS "specialRequests",
          b.room_type_id AS "roomTypeId", rt.name AS "roomTypeName", b.room_id AS "roomId",
          b.rate_plan_id AS "ratePlanId", rp.name AS "ratePlanName",
          b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn", b.status,
          b.payment_method AS "paymentMethod",
          b.total_amount::text AS "totalAmount", rp.currency, b.external_reference AS "externalReference",
          COALESCE(payment_totals."paidAmount", 0)::text AS "paidAmount",
          COALESCE(payment_totals."refundedAmount", 0)::text AS "refundedAmount",
          b.version, b.created_at AS "createdAt", b.updated_at AS "updatedAt"
        FROM bookings b
        JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
        JOIN room_types rt
          ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
        JOIN rate_plans rp
          ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
        LEFT JOIN LATERAL (
          SELECT SUM(CASE WHEN p.kind = 'CHARGE' AND p.status = 'succeeded' THEN p.amount ELSE 0 END) AS "paidAmount",
            SUM(CASE WHEN p.kind = 'REFUND' THEN p.amount ELSE 0 END) AS "refundedAmount"
          FROM payments p
          WHERE p.tenant_id = b.tenant_id AND p.property_id = b.property_id AND p.booking_id = b.id
        ) payment_totals ON TRUE
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
