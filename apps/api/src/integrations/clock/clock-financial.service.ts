import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { IntegrationConnectionsService } from '../integration-connections.service';
import { ClockBookingConsistencyService } from './clock-booking-consistency.service';
import { parseClockCredentials } from './clock-credentials';
export class ClockFinancialCurrencyError extends Error {
  constructor() {
    super(
      'Clock bills and payments use inconsistent currencies. Collection is blocked while automatic checks continue; review the currency setup for this booking.',
    );
  }
}

type Scope = { tenantId: string; propertyId: string };
type Money = { amount: string; currency: string };
export type ClockFinancialSnapshot = {
  bookingId: string;
  bookingVersion: number;
  localPaid: string;
  localRefunded: string;
  connectionId: string;
  fetchedAt: string;
  balance: Money;
  paid: Money;
  refunded: Money;
  folios: Array<{
    id: string;
    deposit: boolean;
    value: Money;
    balance: Money;
    payments: Array<{ id: string; amount: Money; type: string; reference: string | null }>;
  }>;
};
const currency = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{3}$/.test(v);
function signed(cents: bigint) {
  return (
    (cents < 0n ? '-' : '') +
    (cents < 0n ? -cents : cents) / 100n +
    '.' +
    ((cents < 0n ? -cents : cents) % 100n).toString().padStart(2, '0')
  );
}
function money(v: unknown): Money {
  if (!v || typeof v !== 'object') throw new Error('Clock financial amount is missing.');
  const m = v as Record<string, unknown>;
  if (typeof m.cents !== 'number' || !Number.isSafeInteger(m.cents) || !currency(m.currency))
    throw new Error('Clock financial amount is invalid.');
  return { amount: signed(BigInt(m.cents)), currency: m.currency };
}
export function financialSnapshot(
  raw: Awaited<ReturnType<ClockBookingConsistencyService['financialData']>>,
  identity: {
    bookingId: string;
    bookingVersion: number;
    localPaid: string;
    localRefunded: string;
    connectionId: string;
    fetchedAt: string;
  },
): ClockFinancialSnapshot {
  const balance = money(raw.booking.balance);
  let paid = 0n,
    refunded = 0n,
    folioBalances = 0n;
  const seen = new Set<string>();
  const folios = raw.folios.map(({ detail, credits }) => {
    const value = money(detail.value),
      folioBalance = money(detail.balance);
    if (value.currency !== balance.currency || folioBalance.currency !== balance.currency)
      throw new ClockFinancialCurrencyError();
    folioBalances += BigInt((detail.balance as { cents: number }).cents);
    let creditNet = 0n;
    const payments = credits.flatMap((v: unknown) => {
      if (!v || typeof v !== 'object') throw new Error('Clock payment is invalid.');
      const c = v as Record<string, unknown>;
      if (c.voided_at || c.archived_at) return [];
      if (
        !Number.isSafeInteger(c.id) ||
        !Number.isSafeInteger(c.value_cents) ||
        !currency(c.currency) ||
        c.currency !== balance.currency
      )
        throw new Error('Clock payment amount is incomplete.');
      const id = String(c.id);
      if (seen.has(id)) throw new Error('Clock returned a repeated payment identity.');
      seen.add(id);
      const cents = BigInt(c.value_cents as number);
      creditNet += cents;
      // Internal transfers are not new guest money. Provider balance remains authoritative.
      const type = typeof c.payment_type === 'string' ? c.payment_type : 'other';
      if (!['transfer', 'cross_account_transfer'].includes(type)) {
        if (cents >= 0n) paid += cents;
        else refunded -= cents;
      }
      return [
        {
          id,
          amount: { amount: signed(cents), currency: c.currency },
          type,
          reference: typeof c.reference === 'string' ? c.reference.slice(0, 300) : null,
        },
      ];
    });
    if (
      BigInt((detail.value as { cents: number }).cents) - creditNet !==
      BigInt((detail.balance as { cents: number }).cents)
    )
      throw new ConflictException(
        'Clock bills changed during the financial check. They will be checked again.',
      );
    return {
      id: String(detail.id),
      deposit: detail.deposit === true,
      value,
      balance: folioBalance,
      payments,
    };
  });
  if (folioBalances !== BigInt((raw.booking.balance as { cents: number }).cents))
    throw new ConflictException(
      'Clock bills changed during the financial check. They will be checked again.',
    );
  return {
    ...identity,
    balance,
    paid: { amount: signed(paid), currency: balance.currency },
    refunded: { amount: signed(refunded), currency: balance.currency },
    folios,
  };
}
@Injectable()
export class ClockFinancialService {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockBookingConsistencyService) private readonly reader: ClockBookingConsistencyService,
  ) {}
  async refresh(scope: Scope, bookingId: string): Promise<ClockFinancialSnapshot | null> {
    const connection = await this.connections.activePmsConnectionCredentials(
      scope.tenantId,
      scope.propertyId,
    );
    if (connection?.provider !== 'CLOCK_PMS') return null;
    const before = await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<
          Array<{
            external: string | null;
            version: number;
            at: Date;
            paid: string;
            refunded: string;
          }>
        >`SELECT b.external_booking_id AS external,b.version,now() AS at,COALESCE((SELECT sum(amount) FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='CHARGE' AND status IN ('PAID','succeeded')),0)::text AS paid,COALESCE((SELECT sum(amount) FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='REFUND' AND status='REFUNDED'),0)::text AS refunded FROM bookings b WHERE b.tenant_id=${scope.tenantId}::uuid AND b.property_id=${scope.propertyId}::uuid AND b.id=${bookingId}::uuid`,
    );
    if (!before[0]) throw new NotFoundException('Booking not found.');
    if (!before[0].external) return null;
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) throw new BadRequestException('Clock connection needs review.');
    const raw = await this.reader.financialData(parsed.value, before[0].external);
    const snapshot = financialSnapshot(raw, {
      bookingId,
      bookingVersion: before[0].version,
      localPaid: before[0].paid,
      localRefunded: before[0].refunded,
      connectionId: connection.connectionId,
      fetchedAt: before[0].at.toISOString(),
    });
    await this.db.withTenantTransaction(scope, async (tx) => {
      const current = await tx.$queryRaw<
        Array<{ version: number; external: string; connection: string }>
      >`SELECT b.version,b.external_booking_id AS external,pc.connection_id AS connection FROM bookings b JOIN property_integration_connections pc ON pc.tenant_id=b.tenant_id AND pc.property_id=b.property_id AND pc.kind='PMS' AND pc.enabled WHERE b.tenant_id=${scope.tenantId}::uuid AND b.property_id=${scope.propertyId}::uuid AND b.id=${bookingId}::uuid FOR SHARE OF b,pc`;
      if (
        current[0]?.version !== before[0].version ||
        current[0]?.external !== before[0].external ||
        current[0]?.connection !== connection.connectionId
      )
        throw new ConflictException(
          'Booking changed during the financial check. It will be checked again.',
        );
      await tx.$executeRaw`INSERT INTO clock_sync_jobs(tenant_id,property_id,connection_id,resource,snapshot,status,last_success_at,next_run_at) VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${connection.connectionId}::uuid,${'financial:' + bookingId},${JSON.stringify(snapshot)}::jsonb,'SYNCED',now(),now()+interval '5 minutes') ON CONFLICT(tenant_id,property_id,connection_id,resource) DO UPDATE SET snapshot=CASE WHEN (clock_sync_jobs.snapshot->>'fetchedAt')::timestamptz > ${before[0].at} THEN clock_sync_jobs.snapshot ELSE EXCLUDED.snapshot END,last_success_at=now(),updated_at=now()`;
    });
    return snapshot;
  }
  async read(scope: Scope, bookingId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(bookingId)) throw new BadRequestException('Invalid booking.');
    const connection = await this.connections.activePmsConnectionCredentials(
      scope.tenantId,
      scope.propertyId,
    );
    if (connection?.provider !== 'CLOCK_PMS') return { data: null, status: 'NOT_CONNECTED' };
    return this.db.withTenantTransaction(scope, async (tx) => {
      const booking = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM bookings WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${bookingId}::uuid AND external_booking_id IS NOT NULL`;
      if (!booking[0]) return { data: null, status: 'NOT_LINKED' };
      await tx.$executeRaw`INSERT INTO clock_sync_jobs(tenant_id,property_id,connection_id,resource,next_run_at) VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${connection.connectionId}::uuid,${'financial:' + bookingId},now()) ON CONFLICT DO NOTHING`;
      const rows = await tx.$queryRaw<
        Array<{ data: ClockFinancialSnapshot | null; status: string; lastError: string | null }>
      >`SELECT snapshot AS data,status,last_error AS "lastError" FROM clock_sync_jobs WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND connection_id=${connection.connectionId}::uuid AND resource=${'financial:' + bookingId}`;
      return rows[0];
    });
  }
}
