import { Controller, Get, Inject, Injectable, NotFoundException, Req } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BOOKING_NEEDS_ATTENTION_STATUSES } from '../booking/booking-attention';
import { RequiresCapability } from './capabilities.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { TenantDatabaseService } from './tenant-database.service';
import { buildHealthSignals, type HealthFacts } from './system-health';

type Connection = { provider: string; status: 'PENDING' | 'CONNECTED' | 'FAILED' };

/** Reads already-stored facts only: no provider call is made to produce these signals. */
@Injectable()
export class SystemHealthService {
  constructor(@Inject(TenantDatabaseService) private readonly db: TenantDatabaseService) {}

  async get(tenantId: string, propertyId: string) {
    const scope = { tenantId, propertyId };
    const facts = await this.db.withTenantTransaction(scope, async (tx) => {
      const property = await tx.$queryRaw<
        Array<{ stripe: boolean; pokpay: boolean; payAtHotel: boolean }>
      >`SELECT stripe_enabled AS stripe, pokpay_enabled AS pokpay, pay_at_hotel_enabled AS "payAtHotel"
        FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
      if (!property[0]) throw new NotFoundException('Property not found.');
      const connections = await tx.$queryRaw<
        Array<
          Connection & { kind: string } & {
            lastTestResult: string | null;
            lastWebhookReceivedAt: Date | null;
          }
        >
      >`
        SELECT c.kind::text AS kind, c.provider::text AS provider, c.status::text AS status,
          c.last_test_result AS "lastTestResult", c.last_webhook_received_at AS "lastWebhookReceivedAt"
        FROM property_integration_connections pc
        JOIN integration_connections c ON c.tenant_id=pc.tenant_id AND c.id=pc.connection_id
        WHERE pc.tenant_id=${tenantId}::uuid AND pc.property_id=${propertyId}::uuid AND pc.enabled`;
      const counts = await tx.$queryRaw<
        Array<{
          reviews: number;
          operations: number;
          bookings: number;
          payments: number;
          emailsFailed: number;
          emailsStuck: number;
        }>
      >(Prisma.sql`SELECT
          (SELECT count(*)::int FROM manual_review_items WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND status='OPEN') AS reviews,
          (SELECT count(*)::int FROM integration_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND status='FAILED' AND created_at>now()-interval '24 hours') AS operations,
          (SELECT count(*)::int FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND status::text=ANY(${[...BOOKING_NEEDS_ATTENTION_STATUSES]}::text[])) AS bookings,
          (SELECT count(*)::int FROM payments WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND status ILIKE 'fail%' AND created_at>now()-interval '24 hours') AS payments,
          (SELECT count(*)::int FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND status::text='FAILED' AND created_at>now()-interval '24 hours') AS "emailsFailed",
          (SELECT count(*)::int FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND status::text='QUEUED' AND created_at<now()-interval '30 minutes' AND created_at>now()-interval '24 hours') AS "emailsStuck"`);
      const pms = connections.find((c) => c.kind === 'PMS');
      const facts: HealthFacts = {
        now: new Date(),
        pms: pms
          ? {
              provider: pms.provider,
              status: pms.status,
              lastTestResult: pms.lastTestResult,
              lastWebhookReceivedAt: pms.lastWebhookReceivedAt,
            }
          : null,
        openManualReviews: counts[0]!.reviews,
        failedProviderOperations24h: counts[0]!.operations,
        bookingsNeedingAttention: counts[0]!.bookings,
        gateways: property[0],
        paymentConnections: connections
          .filter((c) => c.kind === 'PAYMENT')
          .map((c) => ({ provider: c.provider, status: c.status })),
        failedPayments24h: counts[0]!.payments,
        emailsFailed24h: counts[0]!.emailsFailed,
        emailsStuckQueued: counts[0]!.emailsStuck,
      };
      return facts;
    });
    const signals = buildHealthSignals(facts);
    return {
      checkedAt: facts.now.toISOString(),
      overall: signals.some((s) => s.status === 'attention')
        ? 'attention'
        : signals.some((s) => s.status === 'unknown')
          ? 'unknown'
          : 'healthy',
      signals,
    };
  }
}

type Request = { tenantContext: { tenantId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/system-health')
export class SystemHealthController {
  constructor(@Inject(SystemHealthService) private readonly health: SystemHealthService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('bookings.view')
  get(@Req() r: Request) {
    return this.health.get(r.tenantContext.tenantId, r.tenantContext.propertyId);
  }
}
