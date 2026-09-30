import { Inject, Injectable } from '@nestjs/common';

import { TenantDatabaseService } from '../tenancy/tenant-database.service';

export type PaymentLedgerEntry = {
  id: string;
  kind: 'CHARGE' | 'REFUND';
  provider: string;
  method: string | null;
  externalPaymentId: string;
  status: string;
  amount: string;
  currency: string;
  note: string | null;
  createdAt: string;
  /** Who recorded it, when an audit entry ties the payment to a staff user. */
  actorEmail: string | null;
};

export type PaymentLedgerEvent = {
  action: string;
  createdAt: string;
  actorEmail: string | null;
  details: Record<string, unknown>;
};

export type PaymentLedger = {
  bookingId: string;
  entries: PaymentLedgerEntry[];
  events: PaymentLedgerEvent[];
};

type EntryRow = Omit<PaymentLedgerEntry, 'createdAt' | 'actorEmail'> & { createdAt: Date };
type EventRow = {
  action: string;
  createdAt: Date;
  actorEmail: string | null;
  details: Record<string, unknown> | null;
};

// Audit details can carry provider payloads; only these fields are shown to staff.
const VISIBLE_DETAIL_KEYS = [
  'amount',
  'note',
  'reason',
  'reference',
  'externalBookingId',
  'folioId',
  'creditItemId',
  'paymentSubType',
  'paymentType',
  'chargeExternalPaymentId',
  'refundExternalPaymentId',
  'idempotentReplay',
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PaymentLedgerService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  /** One booking's payment rows and audit trail, or null when it is not in this property. */
  async ledger(
    context: { tenantId: string; propertyId: string },
    bookingId: string,
  ): Promise<PaymentLedger | null> {
    if (!UUID.test(bookingId)) return null;
    return this.database.withTenantTransaction(context, async (tx) => {
      const booking = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM bookings
        WHERE id = ${bookingId}::uuid AND tenant_id = ${context.tenantId}::uuid
          AND property_id = ${context.propertyId}::uuid
      `;
      if (booking.length === 0) return null;

      const payments = await tx.$queryRaw<EntryRow[]>`
        SELECT p.id, p.kind::text AS kind, p.provider, p.method,
          p.external_payment_id AS "externalPaymentId", p.status, p.amount::text AS amount,
          p.currency, p.note, p.created_at AS "createdAt"
        FROM payments p
        WHERE p.booking_id = ${bookingId}::uuid AND p.tenant_id = ${context.tenantId}::uuid
          AND p.property_id = ${context.propertyId}::uuid
        ORDER BY p.created_at, p.id
      `;
      const events = await tx.$queryRaw<EventRow[]>`
        SELECT a.action, a.created_at AS "createdAt", u.email AS "actorEmail", a.details
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.target_type = 'booking' AND a.target_id = ${bookingId}
          AND a.tenant_id = ${context.tenantId}::uuid
        ORDER BY a.created_at, a.id
      `;

      // A refund's audit entry names the provider refund id, which is the payment row's
      // external id, so that is how a payment row finds the person who issued it.
      const actorByPayment = new Map<string, string | null>();
      for (const event of events) {
        const details = event.details ?? {};
        for (const key of ['refundExternalPaymentId', 'reference'] as const) {
          const value = details[key];
          if (typeof value === 'string' && !actorByPayment.has(value))
            actorByPayment.set(value, event.actorEmail);
        }
      }

      return {
        bookingId,
        entries: payments.map((payment) => ({
          ...payment,
          createdAt: payment.createdAt.toISOString(),
          actorEmail: actorByPayment.get(payment.externalPaymentId) ?? null,
        })),
        events: events.map((event) => ({
          action: event.action,
          createdAt: event.createdAt.toISOString(),
          actorEmail: event.actorEmail,
          details: Object.fromEntries(
            VISIBLE_DETAIL_KEYS.flatMap((key) =>
              event.details && key in event.details ? [[key, event.details[key]]] : [],
            ),
          ),
        })),
      };
    });
  }
}
