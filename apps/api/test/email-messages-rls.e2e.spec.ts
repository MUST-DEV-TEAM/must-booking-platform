import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Milestone 22 Task 3: behavioral proof that email_messages is tenant- and
// property-isolated by row-level security, not merely that the table exists.
const migrationPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});
const runtimePrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

async function asRuntimeRole<T>(
  context: { tenantId?: string; propertyId?: string; role?: string },
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return runtimePrisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT set_config('app.tenant_id', ${context.tenantId ?? ''}, true),
             set_config('app.property_id', ${context.propertyId ?? ''}, true),
             set_config('app.role', ${context.role ?? ''}, true)
    `;
    return operation(transaction);
  });
}

describe('email_messages row-level security', () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const propertyA1 = randomUUID();
  const propertyA2 = randomUUID();
  const propertyB = randomUUID();
  const sharedKey = `rls-test/${randomUUID()}`;

  async function insertMessage(
    tx: Prisma.TransactionClient,
    tenantId: string,
    propertyId: string | null,
    key: string,
  ) {
    await tx.$executeRaw`
      INSERT INTO "email_messages" ("tenant_id", "property_id", "event_type", "recipient_email", "subject", "idempotency_key")
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, 'booking.confirmed', 'guest@example.test', 'Test', ${key})
    `;
  }

  beforeAll(async () => {
    await migrationPrisma.$executeRaw`
      INSERT INTO "organizations" ("id", "name")
      VALUES (${tenantA}::uuid, 'Email RLS A'), (${tenantB}::uuid, 'Email RLS B')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "properties" ("id", "tenant_id", "name", "slug")
      VALUES
        (${propertyA1}::uuid, ${tenantA}::uuid, 'A1', ${`email-rls-a1-${propertyA1}`}),
        (${propertyA2}::uuid, ${tenantA}::uuid, 'A2', ${`email-rls-a2-${propertyA2}`}),
        (${propertyB}::uuid, ${tenantB}::uuid, 'B1', ${`email-rls-b1-${propertyB}`})
    `;
    await asRuntimeRole({ tenantId: tenantA, propertyId: propertyA1 }, (tx) =>
      insertMessage(tx, tenantA, propertyA1, sharedKey),
    );
    await asRuntimeRole({ tenantId: tenantA, propertyId: propertyA2 }, (tx) =>
      insertMessage(tx, tenantA, propertyA2, `${sharedKey}/a2`),
    );
    await asRuntimeRole({ tenantId: tenantA }, (tx) =>
      insertMessage(tx, tenantA, null, `${sharedKey}/tenant`),
    );
    await asRuntimeRole({ tenantId: tenantB, propertyId: propertyB }, (tx) =>
      insertMessage(tx, tenantB, propertyB, sharedKey),
    );
  });

  afterAll(async () => {
    await migrationPrisma.$executeRaw`
      DELETE FROM "email_messages" WHERE "tenant_id" IN (${tenantA}::uuid, ${tenantB}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "properties" WHERE "tenant_id" IN (${tenantA}::uuid, ${tenantB}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "organizations" WHERE "id" IN (${tenantA}::uuid, ${tenantB}::uuid)
    `;
    await migrationPrisma.$disconnect();
    await runtimePrisma.$disconnect();
  });

  it('hides every row when no tenant context is set', async () => {
    const rows = await asRuntimeRole(
      {},
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "email_messages"`,
    );
    expect(rows).toEqual([]);
  });

  it('shows a tenant only its own rows', async () => {
    const rows = await asRuntimeRole(
      { tenantId: tenantA },
      (tx) => tx.$queryRaw<{ tenant_id: string }[]>`SELECT "tenant_id" FROM "email_messages"`,
    );
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.tenant_id))).toEqual(new Set([tenantA]));
  });

  it('narrows a property-scoped session to that property (tenant-level rows are hidden)', async () => {
    const rows = await asRuntimeRole(
      { tenantId: tenantA, propertyId: propertyA1 },
      (tx) =>
        tx.$queryRaw<{ property_id: string | null }[]>`SELECT "property_id" FROM "email_messages"`,
    );
    expect(rows).toEqual([{ property_id: propertyA1 }]);
  });

  it('rejects inserting a row for another tenant or another property', async () => {
    await expect(
      asRuntimeRole({ tenantId: tenantA }, (tx) =>
        insertMessage(tx, tenantB, propertyB, 'cross-tenant'),
      ),
    ).rejects.toThrow();
    await expect(
      asRuntimeRole({ tenantId: tenantA, propertyId: propertyA1 }, (tx) =>
        insertMessage(tx, tenantA, propertyA2, 'cross-property'),
      ),
    ).rejects.toThrow();
  });

  it('rejects a cross-tenant property reference through the composite foreign key', async () => {
    await expect(
      asRuntimeRole({ tenantId: tenantA }, (tx) =>
        insertMessage(tx, tenantA, propertyB, 'fk-mismatch'),
      ),
    ).rejects.toThrow();
  });

  it('enforces one row per idempotency key within a tenant but allows the same key in another', async () => {
    await expect(
      asRuntimeRole({ tenantId: tenantA, propertyId: propertyA1 }, (tx) =>
        insertMessage(tx, tenantA, propertyA1, sharedKey),
      ),
    ).rejects.toThrow();
    // tenant B already stored `sharedKey` in beforeAll without conflict.
    const rows = await asRuntimeRole(
      { tenantId: tenantB },
      (tx) =>
        tx.$queryRaw<{ idempotency_key: string }[]>`SELECT "idempotency_key" FROM "email_messages"`,
    );
    expect(rows.map((row) => row.idempotency_key)).toEqual([sharedKey]);
  });

  it('keeps account-level (no tenant) mail invisible to tenants and writable only under the platform_mail role', async () => {
    const accountKey = `rls-test/account/${randomUUID()}`;
    const insertAccountMail = (tx: Prisma.TransactionClient, key: string) =>
      tx.$executeRaw`
        INSERT INTO "email_messages" ("tenant_id", "event_type", "recipient_email", "subject", "idempotency_key")
        VALUES (NULL, 'account.password_reset', 'owner@example.test', 'Reset', ${key})
      `;

    // Without the role, even a tenant session cannot create tenant-less mail.
    await expect(
      asRuntimeRole({ tenantId: tenantA }, (tx) => insertAccountMail(tx, accountKey)),
    ).rejects.toThrow();
    await asRuntimeRole({ role: 'platform_mail' }, (tx) => insertAccountMail(tx, accountKey));

    // Tenants never see it.
    const seenByTenant = await asRuntimeRole(
      { tenantId: tenantA },
      (tx) =>
        tx.$queryRaw<
          { idempotency_key: string }[]
        >`SELECT "idempotency_key" FROM "email_messages" WHERE "tenant_id" IS NULL`,
    );
    expect(seenByTenant).toEqual([]);

    // The platform_mail role sees only tenant-less rows and cannot write tenant rows.
    const seenByMailRole = await asRuntimeRole(
      { role: 'platform_mail' },
      (tx) =>
        tx.$queryRaw<{ tenant_id: string | null }[]>`SELECT "tenant_id" FROM "email_messages"`,
    );
    expect(seenByMailRole.every((row) => row.tenant_id === null)).toBe(true);
    await expect(
      asRuntimeRole({ role: 'platform_mail' }, (tx) =>
        insertMessage(tx, tenantA, propertyA1, 'mail-role-tenant-write'),
      ),
    ).rejects.toThrow();

    // The platform admin can read it; a duplicate key is rejected by the partial unique index.
    const seenByAdmin = await asRuntimeRole(
      { role: 'platform_admin' },
      (tx) =>
        tx.$queryRaw<
          { idempotency_key: string }[]
        >`SELECT "idempotency_key" FROM "email_messages" WHERE "idempotency_key" = ${accountKey}`,
    );
    expect(seenByAdmin).toHaveLength(1);
    await expect(
      asRuntimeRole({ role: 'platform_mail' }, (tx) => insertAccountMail(tx, accountKey)),
    ).rejects.toThrow();

    await migrationPrisma.$executeRaw`DELETE FROM "email_messages" WHERE "idempotency_key" = ${accountKey}`;
  });

  it('lets a platform admin read across tenants but not write', async () => {
    const rows = await asRuntimeRole(
      { role: 'platform_admin' },
      (tx) =>
        tx.$queryRaw<{ tenant_id: string }[]>`
        SELECT "tenant_id" FROM "email_messages" WHERE "tenant_id" IN (${tenantA}::uuid, ${tenantB}::uuid)
      `,
    );
    expect(new Set(rows.map((row) => row.tenant_id))).toEqual(new Set([tenantA, tenantB]));
    await expect(
      asRuntimeRole({ role: 'platform_admin' }, (tx) =>
        insertMessage(tx, tenantA, propertyA1, 'admin-write'),
      ),
    ).rejects.toThrow();
  });
});
