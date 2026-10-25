import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// LOCAL DEMO ONLY. Seeds the four platform roles and a few hotels in different states so the
// platform console can be looked at and screenshotted. Needs the API running (default
// http://localhost:3100) and uses the migration connection from MIGRATION_DATABASE_URL.
// Never run this against a shared or production database.
//
//   pnpm seed:platform-console-demo
const API = process.env.PLATFORM_DEMO_API ?? 'http://localhost:3100';
const migrationUrl = process.env.MIGRATION_DATABASE_URL?.trim();
if (!migrationUrl) throw new Error('MIGRATION_DATABASE_URL must be configured.');
if (/(prod|live)/i.test(migrationUrl))
  throw new Error('Refusing to seed a production-looking database.');

const PLATFORM_PASSWORD = 'Console-Demo-Pass-1';
const OWNER_PASSWORD = 'Owner-demo-pass-1';
const db = new PrismaClient({ datasources: { db: { url: migrationUrl } } });

async function http(
  method: string,
  path: string,
  body?: unknown,
  cookie = '',
  extra: Record<string, string> = {},
) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-platform-console': '1',
      ...(cookie ? { cookie } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : undefined,
    cookie: (response.headers.getSetCookie?.() ?? [])
      .map((entry) => entry.split(';')[0])
      .join('; '),
  };
}

async function platformAccount(roleKey: string, email: string, first: string) {
  const hash = await bcrypt.hash(PLATFORM_PASSWORD, 10);
  await db.$executeRaw`
    INSERT INTO platform_accounts (email, first_name, last_name, password_hash, role_id, status)
    SELECT ${email}, ${first}, 'Demo', ${hash}, r.id, 'ACTIVE' FROM platform_roles r WHERE r.key = ${roleKey}
    ON CONFLICT (lower(email)) DO NOTHING`;
}

async function signupHotel(name: string, email: string) {
  const signup = await http('POST', '/auth/signup', {
    organizationName: name,
    propertyName: name,
    propertyAddress: 'Rruga e Plazhit 1, Durres',
    propertyTimezone: 'Europe/Tirane',
    email,
    password: OWNER_PASSWORD,
  });
  if (signup.status === 409) {
    const rows = await db.$queryRaw<Array<{ tenantId: string }>>`
      SELECT tm.tenant_id AS "tenantId" FROM tenant_memberships tm JOIN users u ON u.id = tm.user_id WHERE u.email = ${email}`;
    return rows[0]!.tenantId;
  }
  if (signup.status !== 201) throw new Error(`Signup failed for ${name}: ${signup.status}`);
  await db.$executeRaw`UPDATE users SET email_verified_at = now() WHERE email = ${email}`;
  return signup.body.organization.id as string;
}

async function main() {
  await platformAccount('super_admin', 'super@example.test', 'Rea');
  await platformAccount('operations', 'ops@example.test', 'Oli');
  await platformAccount('finance', 'finance@example.test', 'Fia');
  await platformAccount('auditor', 'auditor@example.test', 'Ana');

  const empire = await signupHotel('Empire Beach Demo', 'owner-empire@example.test');
  const harbor = await signupHotel('Harbor Inn', 'owner-harbor@example.test');
  const lagoon = await signupHotel('Lagoon Suites', 'owner-lagoon@example.test');

  await db.$executeRaw`UPDATE organizations SET country = 'AL', time_zone = 'Europe/Tirane', currency = 'EUR', onboarding_mode = 'CLOCK' WHERE id = ${empire}::uuid`;
  await db.$executeRaw`UPDATE organizations SET country = 'AL', time_zone = 'Europe/Tirane', currency = 'EUR', onboarding_mode = 'MUST_SOURCE' WHERE id IN (${harbor}::uuid, ${lagoon}::uuid)`;
  await db.$executeRaw`UPDATE properties SET phone = '+355 52 000 111', support_email = 'info@empire.example', check_in_time = '14:00', check_out_time = '11:00', public_website_origin = 'https://empire.example', wordpress_connected_at = now() - interval '3 days' WHERE tenant_id = ${empire}::uuid`;
  await db.$executeRaw`
    INSERT INTO integration_connections (tenant_id, kind, provider, name, encrypted_credentials, status, last_tested_at)
    SELECT ${empire}::uuid, 'PMS', 'CLOCK_PMS', 'Empire Clock', 'demo-not-a-secret', 'CONNECTED', now() - interval '1 hour'
    WHERE NOT EXISTS (SELECT 1 FROM integration_connections WHERE tenant_id = ${empire}::uuid AND provider = 'CLOCK_PMS')`;
  await db.$executeRaw`
    INSERT INTO integration_connections (tenant_id, kind, provider, name, encrypted_credentials, status, last_tested_at, last_test_result)
    SELECT ${harbor}::uuid, 'PAYMENT', 'POKPAY', 'PokPay', 'demo-not-a-secret', 'FAILED', now() - interval '2 hours', 'Invalid key id'
    WHERE NOT EXISTS (SELECT 1 FROM integration_connections WHERE tenant_id = ${harbor}::uuid AND provider = 'POKPAY')`;

  // Everything below goes through the real console API, so it is audited like production use.
  const ops = await http('POST', '/platform-console/auth/login', {
    email: 'ops@example.test',
    password: PLATFORM_PASSWORD,
  });
  const superAdmin = await http('POST', '/platform-console/auth/login', {
    email: 'super@example.test',
    password: PLATFORM_PASSWORD,
  });
  const key = () => ({ 'idempotency-key': crypto.randomUUID() });
  const state = async (id: string) =>
    (await http('GET', `/platform-console/hotels/${id}`, undefined, ops.cookie)).body.lifecycle;

  const created = await http(
    'POST',
    '/platform-console/hotels',
    {
      hotelName: 'Sea Breeze Hotel',
      ownerName: 'Sara Seabreeze',
      ownerEmail: 'sara@seabreeze.example',
      country: 'AL',
      timeZone: 'Europe/Tirane',
      currency: 'EUR',
      mode: 'MUST_SOURCE',
    },
    ops.cookie,
    key(),
  );
  console.log('Sea Breeze Hotel:', created.status);

  const move = async (id: string, to: string, reason: string, client = ops) => {
    const current = await state(id);
    if (current.state === to) return;
    const response = await http(
      'POST',
      `/platform-console/hotels/${id}/lifecycle`,
      { to, reason, version: current.version },
      client.cookie,
      key(),
    );
    if (response.status !== 201)
      console.log(`  ${to} for ${id}: ${response.status} ${JSON.stringify(response.body)}`);
  };
  await move(empire, 'ACTIVE', 'Contract signed and Clock connected');
  await move(lagoon, 'ACTIVE', 'Contract signed');
  await move(lagoon, 'PAST_DUE', 'Invoice 2026-114 is 30 days overdue');
  await move(
    harbor,
    'SUSPENDED',
    'Owner asked us to pause the account while they change payment provider',
  );
  void superAdmin;

  console.log(
    'Demo ready. Platform sign-in: super|ops|finance|auditor@example.test /',
    PLATFORM_PASSWORD,
  );
  console.log(
    'Hotel owners: owner-empire|owner-harbor|owner-lagoon@example.test /',
    OWNER_PASSWORD,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
