# Clock booking status survey (read-only script, 2026-10-09)

A read-only script used on 2026-10-09 to see which booking statuses Clock really returns for the Clock **sandbox** test property (account 16307), so the status mapping in `clock-booking-status.ts` rests on evidence. It never boots the application, so no queues, schedulers, mail or payment sweeps start. It opens one read-only database transaction to load the connection and then makes Clock GET requests only; it prints counts, status names and booking numbers, never credentials or guest details.

It was run from a server-side workspace (the import paths start with `/workspace/`); change them to relative `apps/api/src/...` paths to run it from a checkout, and set `INTEGRATION_CREDENTIALS_KEY`. Aim it only at the sandbox property.

An earlier version that started the full application was replaced by this one and is not kept.

```ts
// Read-only survey of the booking statuses Clock really returns for the TEST property.
// Does NOT boot AppModule: no BullMQ workers, schedulers, mail or payment sweeps start.
// One read-only DB transaction to load the connection, then Clock GET requests only.
// Prints only counts, status names and booking numbers. Never prints credentials or guest details.
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';

import { decryptCredentialPayload } from '/workspace/apps/api/src/integrations/credential-cipher';
import { parseClockCredentials } from '/workspace/apps/api/src/integrations/clock/clock-credentials';
import { ClockHttpClient } from '/workspace/apps/api/src/integrations/clock/clock-http-client';

const TEST_TENANT_ID = 'fdb9f701-510e-4deb-857b-08a87fcdfbcc';
const TEST_PROPERTY_ID = '9231b946-f244-4a84-af54-0774710f3464';
const TEST_CLOCK_ACCOUNT = '16307';
const EMPIRE_CLOCK_ID = '14688';
const MAX_DETAILS = 400;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const iso = (date: Date) => date.toISOString().slice(0, 10);

async function loadCredentials(): Promise<Record<string, string>> {
  const key = process.env.INTEGRATION_CREDENTIALS_KEY;
  if (!key) throw new Error('INTEGRATION_CREDENTIALS_KEY must be configured.');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$queryRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, TEST_TENANT_ID);
      await tx.$queryRawUnsafe(`SELECT set_config('app.property_id', $1, true)`, TEST_PROPERTY_ID);
      return tx.$queryRawUnsafe<Array<{ provider: string; encryptedCredentials: string }>>(
        `SELECT c.provider::text AS provider, c.encrypted_credentials AS "encryptedCredentials"
         FROM integration_connections c
         JOIN property_integration_connections pic
           ON pic.tenant_id = c.tenant_id AND pic.connection_id = c.id
         WHERE c.tenant_id = $1::uuid AND pic.property_id = $2::uuid
           AND c.kind = 'PMS' AND pic.enabled = true`,
        TEST_TENANT_ID,
        TEST_PROPERTY_ID,
      );
    });
    if (rows.length !== 1 || rows[0].provider !== 'CLOCK_PMS')
      throw new Error(`Expected exactly one Clock PMS connection, found ${rows.length}.`);
    return JSON.parse(decryptCredentialPayload(rows[0].encryptedCredentials, key)) as Record<string, string>;
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const parsed = parseClockCredentials(await loadCredentials());
  if (!parsed.ok) throw new Error(parsed.message);
  const { accountId, subscriptionId } = parsed.value;
  if ([accountId, subscriptionId].includes(EMPIRE_CLOCK_ID) || ![accountId, subscriptionId].includes(TEST_CLOCK_ACCOUNT))
    throw new Error('Refusing: connection is not the Must Hotel test Clock account.');

  const client = new ClockHttpClient();
  const get = async (path: string, query?: Record<string, string>) => {
    await wait(300); // stay under Clock's 4 requests/second
    const response = await client.request<unknown>(parsed.value, {
      api: 'pms_api', method: 'GET', path, query, timeoutMs: 15_000,
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`GET ${path} -> HTTP ${response.status}`);
    return response.body;
  };

  const ids = new Set<number>();
  const start = new Date(); start.setUTCMonth(start.getUTCMonth() - 18);
  const end = new Date(); end.setUTCMonth(end.getUTCMonth() + 12);
  for (let from = start; from < end; ) {
    const to = new Date(from.getTime() + 31 * 86_400_000);
    const listed = await get('/bookings/', { 'arrival.lt': iso(to), 'departure.gt': iso(from) });
    if (Array.isArray(listed)) for (const id of listed) if (typeof id === 'number') ids.add(id);
    from = to;
  }
  console.log(`Clock booking ids found (${iso(start)} to ${iso(end)}): ${ids.size}`);

  const counts = new Map<string, { count: number; example: string }>();
  const otherStatusFields = new Map<string, Map<string, number>>();
  let read = 0;
  for (const id of ids) {
    if (read >= MAX_DETAILS) break;
    read += 1;
    const detail = (await get(`/bookings/${id}`)) as Record<string, unknown>;
    const status = String(detail.status);
    const entry = counts.get(status) ?? { count: 0, example: String(detail.number ?? id) };
    entry.count += 1;
    counts.set(status, entry);
    for (const [key, value] of Object.entries(detail)) {
      if (!/status|state/i.test(key) || key === 'status') continue;
      const values = otherStatusFields.get(key) ?? new Map<string, number>();
      const label = value !== null && typeof value === 'object' ? '<object>' : String(value);
      values.set(label, (values.get(label) ?? 0) + 1);
      otherStatusFields.set(key, values);
    }
  }
  console.log(`Booking details read: ${read}`);
  for (const [status, { count, example }] of counts) console.log(`status=${status} count=${count} example=#${example}`);
  for (const [key, values] of otherStatusFields)
    console.log(`field ${key}: ${[...values].map(([v, n]) => `${v}=${n}`).join(', ')}`);
}

void main().catch((error) => { console.error(String(error)); process.exitCode = 1; });
```
