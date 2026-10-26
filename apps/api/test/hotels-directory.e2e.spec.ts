import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, it } from 'vitest';
import { PropertiesService } from '../src/tenancy/properties.service';

it('projects safe hotel metadata with real SQL, tenant RLS and assignment-only staff visibility', async () => {
  const admin = new PrismaClient({
    datasources: {
      db: {
        url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
      },
    },
  });
  const rollback = new Error('rollback fixtures');
  try {
    await expect(
      admin.$transaction(
        async (tx) => {
          const plan = await tx.plan.create({
            data: {
              name: 'Hotels fixture ' + randomUUID(),
              maxProperties: 10,
              maxStaffSeats: 10,
              pmsEnabled: true,
              maxPmsConnectionsPerProperty: 1,
            },
          });
          const tenant = await tx.organization.create({
            data: { name: 'Hotels fixture', planId: plan.id },
          });
          const other = await tx.organization.create({
            data: { name: 'Outside fixture', planId: plan.id },
          });
          const users = await Promise.all(
            ['owner', 'admin', 'staff', 'suspended'].map((role) =>
              tx.user.create({ data: { email: `${role}-${randomUUID()}@example.test` } }),
            ),
          );
          for (let i = 0; i < users.length; i++)
            await tx.tenantMembership.create({
              data: {
                tenantId: tenant.id,
                userId: users[i].id,
                role: i === 0 ? 'OWNER' : i === 1 ? 'ADMIN' : 'STAFF',
              },
            });
          const hotel = async (tenantId: string, name: string) =>
            tx.property.create({
              data: {
                tenantId,
                name,
                slug: randomUUID(),
                address: 'Tirana',
                timezone: 'Europe/Tirane',
              },
            });
          const clock = await hotel(tenant.id, 'Clock hotel'),
            local = await hotel(tenant.id, 'MUST hotel');
          await hotel(other.id, 'Hidden hotel');
          const template = await tx.propertyRoleTemplate.create({
            data: { tenantId: tenant.id, propertyId: clock.id, name: 'Fixture', kind: 'CUSTOM' },
          });
          for (let i = 2; i < users.length; i++)
            await tx.propertyStaffAssignment.create({
              data: {
                tenantId: tenant.id,
                propertyId: clock.id,
                userId: users[i].id,
                roleTemplateId: template.id,
                suspendedAt: i === 3 ? new Date() : null,
              },
            });
          const connect = async (
            propertyId: string,
            provider: 'CLOCK_PMS' | 'POKPAY',
            enabled = true,
          ) => {
            const kind = provider === 'CLOCK_PMS' ? 'PMS' : 'PAYMENT';
            const c = await tx.integrationConnection.create({
              data: {
                tenantId: tenant.id,
                kind,
                provider,
                name: 'Fixture',
                encryptedCredentials: 'not-real-credentials',
                status: 'CONNECTED',
              },
            });
            await tx.propertyIntegrationConnection.create({
              data: { tenantId: tenant.id, propertyId, connectionId: c.id, kind, enabled },
            });
            return c;
          };
          const c = await connect(clock.id, 'CLOCK_PMS');
          await connect(clock.id, 'POKPAY');
          await connect(local.id, 'POKPAY', false);
          // Use the non-owner role inside one rollback-only transaction. No workers or providers run.
          await tx.$executeRawUnsafe('SET LOCAL ROLE must_booking_app');
          const database = {
            withTenantTransaction: async <T>(
              context: { tenantId: string },
              run: (db: Prisma.TransactionClient) => Promise<T>,
            ) => {
              await tx.$executeRaw`SELECT set_config('app.tenant_id',${context.tenantId},true),set_config('app.property_id','',true)`;
              return run(tx);
            },
          };
          const service = new PropertiesService(database as never, {} as never, {} as never);
          const rows = await service.list(tenant.id, users[0].id);
          expect(rows).toHaveLength(2);
          expect(rows.find((h) => h.id === clock.id)).toMatchObject({
            staffCount: 3,
            pmsSource: 'CLOCK_PMS',
            connectedProviders: ['CLOCK_PMS', 'POKPAY'],
          });
          expect(rows.find((h) => h.id === local.id)).toMatchObject({
            staffCount: 2,
            pmsSource: 'MUST',
            connectedProviders: [],
          });
          expect(JSON.stringify(rows)).not.toContain('not-real-credentials');
          expect((await service.list(tenant.id, users[1].id)).map((h) => h.id)).toEqual(
            rows.map((h) => h.id),
          );
          expect((await service.list(tenant.id, users[2].id)).map((h) => h.id)).toEqual([clock.id]);
          expect(await service.list(other.id, users[0].id)).toEqual([]);
          expect(await service.list(tenant.id, randomUUID())).toEqual([]);
          await tx.$executeRawUnsafe('RESET ROLE');
          await tx.integrationConnection.update({
            where: { id: c.id },
            data: { status: 'FAILED' },
          });
          await tx.$executeRawUnsafe('SET LOCAL ROLE must_booking_app');
          expect(
            (await service.list(tenant.id, users[0].id)).find((h) => h.id === clock.id),
          ).toMatchObject({ pmsSource: 'CLOCK_PMS', connectedProviders: ['POKPAY'] });
          throw rollback;
        },
        { timeout: 30000 },
      ),
    ).rejects.toBe(rollback);
  } finally {
    await admin.$disconnect();
  }
});
