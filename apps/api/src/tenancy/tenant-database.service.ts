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
  ): Promise<T> {
    const tenantId = this.requireUuid(context.tenantId, 'tenantId');
    const propertyId = context.propertyId ? this.requireUuid(context.propertyId, 'propertyId') : '';

    return this.$transaction(async (transaction) => {
      // `true` makes set_config equivalent to SET LOCAL: values disappear at commit/rollback.
      await transaction.$executeRaw`
        SELECT set_config('app.tenant_id', ${tenantId}, true),
               set_config('app.property_id', ${propertyId}, true)
      `;

      return operation(transaction);
    });
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
