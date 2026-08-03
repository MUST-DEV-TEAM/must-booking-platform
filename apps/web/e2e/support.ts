import { createHash, randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';
import { expect, type Page } from '@playwright/test';
import { createClient } from 'redis';

const mailSinkOrigin = 'http://127.0.0.1:3130';
const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL;
const redisUrl = process.env.E2E_REDIS_URL ?? process.env.REDIS_URL;

if (!databaseUrl) {
  throw new Error(
    'E2E_DATABASE_URL or MIGRATION_DATABASE_URL must be set. Playwright loads apps/api/.env by default.',
  );
}
if (!redisUrl) throw new Error('E2E_REDIS_URL or REDIS_URL must be set for the E2E suite.');

const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const redis = createClient({ url: redisUrl });
let redisConnection: Promise<unknown> | undefined;
const createdTenantIds = new Set<string>();
const createdEmails = new Set<string>();

export type Credentials = {
  email: string;
  password: string;
  organizationName: string;
  propertyName: string;
};

type EmailMessage = {
  html: string;
  subject: string;
  text: string;
  to: string[];
};

type Membership = { tenantId: string; organizationName: string; role: string };
type Property = { id: string; name: string };

export function credentials(label: string): Credentials {
  const suffix = randomUUID();
  const email = `e2e-${label}-${suffix}@example.test`;
  createdEmails.add(email);
  return {
    email,
    password: `E2e!password-${suffix}`,
    organizationName: `E2E ${label} ${suffix.slice(0, 8)}`,
    propertyName: `E2E Hotel ${suffix.slice(0, 8)}`,
  };
}

export async function signup(page: Page, account: Credentials): Promise<void> {
  await page.goto('/signup');
  await page.getByLabel('Organization name').fill(account.organizationName);
  await page.getByLabel('First property name').fill(account.propertyName);
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Create free workspace' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function verifyEmail(page: Page, account: Credentials): Promise<void> {
  const verificationUrl = await capturedEmailLink(
    account.email,
    'Verify your MUST Booking email address',
    '/email-verification',
  );
  await page.goto(verificationUrl);
  await expect(page).toHaveURL(/\/dashboard$/);
  await currentTenant(page);
}

export async function login(page: Page, account: Pick<Credentials, 'email' | 'password'>) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

export async function currentTenant(page: Page): Promise<{ tenantId: string; propertyId: string }> {
  const memberships = await page.evaluate(async () => {
    const response = await fetch('/api/auth/memberships', { credentials: 'include' });
    return (await response.json()) as { memberships: Membership[] };
  });
  const tenantId = memberships.memberships[0]?.tenantId;
  if (!tenantId) throw new Error('Expected the signed-in account to have a tenant membership.');

  const properties = await page.evaluate(async (id) => {
    const response = await fetch(`/api/tenants/${id}/properties`, { credentials: 'include' });
    return (await response.json()) as Property[];
  }, tenantId);
  const propertyId = properties[0]?.id;
  if (!propertyId) throw new Error('Expected the signed-in tenant to have a property.');

  createdTenantIds.add(tenantId);
  return { tenantId, propertyId };
}

export async function createInvitation(
  page: Page,
  command: {
    tenantId: string;
    propertyId: string;
    roleTemplateId: string;
    email: string;
  },
): Promise<string> {
  const result = await page.evaluate(async (invitation) => {
    const response = await fetch(`/api/tenants/${invitation.tenantId}/staff-invitations`, {
      body: JSON.stringify({
        email: invitation.email,
        assignments: [
          {
            propertyId: invitation.propertyId,
            roleTemplateId: invitation.roleTemplateId,
          },
        ],
      }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    return { body: await response.json().catch(() => null), status: response.status };
  }, command);
  const token =
    result.body && typeof result.body === 'object' && 'token' in result.body
      ? (result.body as { token?: unknown }).token
      : undefined;
  if (result.status !== 201 || typeof token !== 'string') {
    throw new Error(`Creating the staff invitation failed with status ${result.status}.`);
  }
  return token;
}

export async function createRoleTemplate(tenantId: string, propertyId: string): Promise<string> {
  const name = `E2E invitation role ${randomUUID().slice(0, 8)}`;
  const templates = await database.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "property_role_templates" ("tenant_id", "property_id", "name", "kind")
    VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${name}, 'CUSTOM')
    RETURNING "id"
  `;
  if (!templates[0]?.id) throw new Error('Could not create the E2E staff role template.');
  return templates[0].id;
}

export async function promoteToPlatformAdmin(tenantId: string, email: string): Promise<void> {
  await deleteTenant(tenantId);
  const updated = await database.$executeRaw`
    UPDATE "users"
    SET "is_platform_admin" = true,
        "email_verified_at" = COALESCE("email_verified_at", CURRENT_TIMESTAMP)
    WHERE "email" = ${email}
  `;
  if (updated !== 1) throw new Error('Could not promote the E2E account to platform admin.');
}

export async function membershipCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth/memberships', { credentials: 'include' });
    const body = (await response.json()) as { memberships?: unknown[] };
    return body.memberships?.length ?? 0;
  });
}

export async function cleanupE2EData(): Promise<void> {
  const emails = [...createdEmails];
  if (emails.length > 0) {
    const memberships = await database.$queryRaw<Array<{ tenantId: string }>>`
      SELECT DISTINCT "tenant_id" AS "tenantId"
      FROM "tenant_memberships"
      WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "email" IN (${Prisma.join(emails)}))
    `;
    for (const membership of memberships) createdTenantIds.add(membership.tenantId);
  }

  for (const tenantId of createdTenantIds) await deleteTenant(tenantId);

  if (emails.length > 0) {
    await database.$executeRaw`
      DELETE FROM "audit_logs"
      WHERE "actor_user_id" IN (SELECT "id" FROM "users" WHERE "email" IN (${Prisma.join(emails)}))
    `;
    await database.$executeRaw`
      DELETE FROM "users" WHERE "email" IN (${Prisma.join(emails)})
    `;
  }
  createdTenantIds.clear();
  createdEmails.clear();
}

export async function resetSignupRateLimit(): Promise<void> {
  const client = await redisClient();
  await client.del(`rate-limit:signup:ip:${hash('::ffff:127.0.0.1')}`);
}

export async function closeE2EDatabase(): Promise<void> {
  await database.$disconnect();
  if (redis.isOpen) await redis.quit();
  redisConnection = undefined;
}

export async function capturedEmailLink(
  email: string,
  subject: string,
  path: string,
): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const response = await fetch(`${mailSinkOrigin}/messages?to=${encodeURIComponent(email)}`);
        const messages = (await response.json()) as EmailMessage[];
        const message = messages.find((candidate) => candidate.subject === subject);
        link = message ? findLink(message, path) : undefined;
        return link ?? null;
      },
      { intervals: [100, 250, 500], timeout: 15_000 },
    )
    .not.toBeNull();
  if (!link) throw new Error(`No ${path} link was captured for ${email}.`);
  return link;
}

function findLink(message: EmailMessage, expectedPath: string): string | undefined {
  const urls = `${message.text}\n${message.html}`.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  return urls.find((value) => {
    try {
      return new URL(value.replace(/&amp;/g, '&')).pathname === expectedPath;
    } catch {
      return false;
    }
  });
}

async function deleteTenant(tenantId: string): Promise<void> {
  await database.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      DELETE FROM "integration_operations" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await transaction.$executeRaw`
      DELETE FROM "payments" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await transaction.$executeRaw`
      DELETE FROM "payment_provider_sessions" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await transaction.$executeRaw`DELETE FROM "bookings" WHERE "tenant_id" = ${tenantId}::uuid`;
    await transaction.$executeRaw`
      DELETE FROM "notifications" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await transaction.$executeRaw`DELETE FROM "guests" WHERE "tenant_id" = ${tenantId}::uuid`;
    await transaction.$executeRaw`
      DELETE FROM "availability_block_room_types" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await transaction.$executeRaw`
      DELETE FROM "availability_block_rooms" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await transaction.$executeRaw`
      DELETE FROM "availability_blocks" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await transaction.$executeRaw`
      DELETE FROM "room_availability" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await transaction.$executeRaw`
      DELETE FROM "inventory_units" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await transaction.$executeRaw`
      DELETE FROM "room_price_overrides" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await transaction.$executeRaw`
      DELETE FROM "rate_rules" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await transaction.$executeRaw`
      DELETE FROM "rate_plans" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await transaction.$executeRaw`DELETE FROM "rooms" WHERE "tenant_id" = ${tenantId}::uuid`;
    await transaction.$executeRaw`
      DELETE FROM "room_types" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await transaction.$executeRaw`
      DELETE FROM "property_staff_capability_overrides" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await transaction.$executeRaw`
      DELETE FROM "property_staff_assignments" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await transaction.$executeRaw`
      DELETE FROM "property_role_template_capabilities" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await transaction.$executeRaw`
      DELETE FROM "property_role_templates" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await transaction.$executeRaw`DELETE FROM "capabilities" WHERE "tenant_id" = ${tenantId}::uuid`;
    await transaction.$executeRaw`
      DELETE FROM "tenant_memberships" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await transaction.$executeRaw`DELETE FROM "properties" WHERE "tenant_id" = ${tenantId}::uuid`;
    await transaction.$executeRaw`DELETE FROM "audit_logs" WHERE "tenant_id" = ${tenantId}::uuid`;
    await transaction.$executeRaw`DELETE FROM "organizations" WHERE "id" = ${tenantId}::uuid`;
  });
}

async function redisClient() {
  if (!redis.isOpen) {
    redisConnection ??= redis.connect();
    await redisConnection;
  }
  return redis;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
