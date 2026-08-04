import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export interface TenantDatabaseContext {
  tenantId: string;
  propertyId?: string;
}

export interface PlatformAdminDatabaseContext {
  role: 'platform_admin';
}

export type TenantTransaction = Prisma.TransactionClient;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantDatabaseService extends PrismaClient implements OnModuleDestroy {
  async withTenantTransaction<T>(
    context: TenantDatabaseContext,
    operation: (transaction: TenantTransaction) => Promise<T>,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    const tenantId = this.requireUuid(context.tenantId, 'tenantId');
    const propertyId = context.propertyId ? this.requireUuid(context.propertyId, 'propertyId') : '';

    return this.$transaction(
      async (transaction) => {
        // `true` makes set_config equivalent to SET LOCAL: values disappear at commit/rollback.
        await transaction.$executeRaw`
        SELECT set_config('app.tenant_id', ${tenantId}, true),
               set_config('app.property_id', ${propertyId}, true)
      `;

        return operation(transaction);
      },
      // Prisma's 5000ms default interactive-transaction timeout is too short
      // for a transaction that makes a real outbound HTTP call inside it
      // (e.g. ClockBookingService calling Clock) — a slow-but-successful
      // third-party response must not spuriously abort a committed-so-far
      // local write. Callers making no such call should leave this unset.
      options?.timeoutMs ? { timeout: options.timeoutMs } : undefined,
    );
  }

  async withPlatformAdminTransaction<T>(
    context: PlatformAdminDatabaseContext,
    operation: (transaction: TenantTransaction) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (transaction) => {
      // Keep the platform role transaction-local for the same reason as tenant
      // context: it must not leak to another request through Prisma's pool.
      await transaction.$executeRaw`
        SELECT set_config('app.role', ${context.role}, true)
      `;

      return operation(transaction);
    });
  }

  /**
   * The public webhook endpoint doesn't know a request's tenant until it has
   * looked the connection up by its random webhookPublicId — this is that
   * one lookup, running under the read-only "webhook_gateway" RLS carve-out
   * instead of a real tenant context (which isn't known yet).
   */
  async withWebhookGatewayLookup<T>(
    operation: (transaction: TenantTransaction) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT set_config('app.role', 'webhook_gateway', true)
      `;

      return operation(transaction);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  private requireUuid(value: string, name: string): string {
    if (!uuidPattern.test(value)) {
      throw new TypeError(`${name} must be a UUID`);
    }

    return value;
  }
}
