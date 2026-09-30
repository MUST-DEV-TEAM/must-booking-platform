/**
 * Quick guest booking from the command line, for testing and for AI agents.
 *
 * It calls the same public guest API the WordPress widget uses (catalog -> quote
 * -> booking), so there is no login, no session to borrow and no browser
 * automation for the booking itself. The only step left for a human or a browser
 * is paying on the PokPay checkout page that `book` prints.
 *
 * Required environment (no defaults on purpose, so a run always names its target):
 *   MUST_TENANT_ID, MUST_PROPERTY_ID
 * Optional: MUST_API_BASE (default https://booking.must.al/api)
 *
 * Usage (from apps/api):
 *   pnpm agent:booking catalog --from 2026-10-03 --to 2026-10-04
 *   pnpm agent:booking book --room 237 --from 2026-10-03 --to 2026-10-04 \
 *        --email guest@example.com --first Test --last Guest [--adults 1] [--phone +355...]
 *   pnpm agent:booking status [bookingId]
 *   pnpm agent:booking cancel [bookingId]
 *
 * The last booking (id, guest session cookie, cancellation token) is remembered in
 * the OS temp folder so `status` and `cancel` work without arguments.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Room = { id: string; name: string; isAvailable?: boolean };
type RoomType = {
  id: string;
  name: string;
  maxOccupancy: number;
  requiresRatePlanSelection: boolean;
  ratePlans: Array<{ id: string; name?: string }>;
  rooms: Room[];
};
type Catalog = { roomTypes: RoomType[]; paymentMethods: string[] };
type LastBooking = {
  bookingId: string;
  session: string;
  cancellationToken?: string;
  base: string;
  tenantId: string;
  propertyId: string;
};

const STATE_FILE = join(tmpdir(), 'must-agent-booking-last.json');

function fail(message: string): never {
  console.error(`agent-booking: ${message}`);
  process.exit(1);
}

function flags(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith('--')) continue;
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`${key} needs a value.`);
    result[key.slice(2)] = value;
    index += 1;
  }
  return result;
}

function target() {
  const tenantId = process.env.MUST_TENANT_ID?.trim();
  const propertyId = process.env.MUST_PROPERTY_ID?.trim();
  if (!tenantId || !propertyId) fail('set MUST_TENANT_ID and MUST_PROPERTY_ID.');
  const base = (process.env.MUST_API_BASE?.trim() || 'https://booking.must.al/api').replace(
    /\/$/,
    '',
  );
  return {
    tenantId,
    propertyId,
    base,
    root: `${base}/tenants/${tenantId}/properties/${propertyId}`,
  };
}

async function call<T>(
  method: string,
  url: string,
  session: string,
  body?: unknown,
  idempotent = false,
): Promise<{ status: number; body: T }> {
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: `must_guest_session=${session}`,
      ...(idempotent ? { 'idempotency-key': randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON error page: keep the raw text.
  }
  return { status: response.status, body: parsed as T };
}

function requireDate(value: string | undefined, name: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`--${name} must be YYYY-MM-DD.`);
  return value;
}

async function loadCatalog(root: string, from: string, to: string): Promise<Catalog> {
  const url = `${root}/public/catalog?startsOn=${from}&endsOn=${to}`;
  const response = await call<Catalog>('GET', url, randomUUID());
  if (response.status !== 200)
    fail(`catalog failed (${response.status}): ${JSON.stringify(response.body)}`);
  return response.body;
}

function loadLast(): LastBooking {
  if (!existsSync(STATE_FILE))
    fail('no remembered booking yet; run `book` first or pass a booking id.');
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as LastBooking;
}

async function catalogCommand(options: Record<string, string>) {
  const { root } = target();
  const catalog = await loadCatalog(
    root,
    requireDate(options.from, 'from'),
    requireDate(options.to, 'to'),
  );
  console.log(`payment methods: ${catalog.paymentMethods.join(', ') || '(none)'}`);
  for (const type of catalog.roomTypes) {
    const free = type.rooms.filter((room) => room.isAvailable !== false);
    console.log(
      `${type.name} (${type.id}) max ${type.maxOccupancy}: ${free.length}/${type.rooms.length} rooms free`,
    );
    console.log(`  free: ${free.map((room) => room.name).join(', ') || '-'}`);
  }
}

async function bookCommand(options: Record<string, string>) {
  const { root, base, tenantId, propertyId } = target();
  const from = requireDate(options.from, 'from');
  const to = requireDate(options.to, 'to');
  const roomName = options.room ?? fail('--room is required (for example --room 237).');
  const email = options.email ?? fail('--email is required.');
  const adults = Number(options.adults ?? '1');
  const method = options.method ?? 'pokpay';

  const catalog = await loadCatalog(root, from, to);
  if (!catalog.paymentMethods.includes(method))
    fail(
      `payment method "${method}" is not enabled (available: ${catalog.paymentMethods.join(', ')}).`,
    );
  const matches = catalog.roomTypes.flatMap((type) =>
    type.rooms.filter((room) => room.name === roomName).map((room) => ({ type, room })),
  );
  if (matches.length !== 1)
    fail(
      matches.length === 0
        ? `room "${roomName}" not found.`
        : `room name "${roomName}" is ambiguous.`,
    );
  const { type, room } = matches[0];
  if (room.isAvailable === false) fail(`room ${roomName} is not available ${from} to ${to}.`);
  if (type.requiresRatePlanSelection && type.ratePlans.length !== 1)
    fail(`room type "${type.name}" needs a rate plan choice; this tool does not pick one.`);
  const ratePlanId = type.ratePlans[0]?.id ?? '';

  // One guest session must carry the quote and the booking: the quote token is
  // bound to it.
  const session = randomUUID();
  const quote = await call<{ quoteToken: string; total: { amount: string; currency: string } }>(
    'POST',
    `${root}/quotes`,
    session,
    {
      roomTypeId: type.id,
      roomId: room.id,
      ratePlanId,
      startsOn: from,
      endsOn: to,
      adults,
      children: 0,
      guestCount: adults,
    },
  );
  if (quote.status !== 201) fail(`quote failed (${quote.status}): ${JSON.stringify(quote.body)}`);

  const booking = await call<{
    ok?: boolean;
    value?: {
      id: string;
      status?: string;
      version?: number;
      checkoutUrl?: string;
      cancellationToken?: string;
    };
    error?: unknown;
  }>(
    'POST',
    `${root}/bookings`,
    session,
    {
      roomTypeId: type.id,
      roomId: room.id,
      ratePlanId,
      startsOn: from,
      endsOn: to,
      adults,
      children: 0,
      guestCount: adults,
      total: quote.body.total,
      quoteToken: quote.body.quoteToken,
      paymentMethod: method,
      guest: {
        email,
        firstName: options.first ?? 'Test',
        lastName: options.last ?? 'Guest',
        phone: options.phone ?? null,
      },
    },
    true,
  );
  if (booking.status >= 300 || !booking.body.ok || !booking.body.value)
    fail(`booking failed (${booking.status}): ${JSON.stringify(booking.body)}`);

  const value = booking.body.value;
  const last: LastBooking = {
    bookingId: value.id,
    session,
    cancellationToken: value.cancellationToken,
    base,
    tenantId,
    propertyId,
  };
  writeFileSync(STATE_FILE, JSON.stringify(last), 'utf8');
  console.log(
    JSON.stringify(
      {
        bookingId: value.id,
        status: value.status,
        room: roomName,
        dates: `${from} -> ${to}`,
        total: quote.body.total,
        checkoutUrl: value.checkoutUrl ?? null,
      },
      null,
      2,
    ),
  );
  if (value.checkoutUrl)
    console.log('\nOpen checkoutUrl and pay with the PokPay staging test card.');
}

async function status(bookingId?: string) {
  const { root } = target();
  const last = existsSync(STATE_FILE) ? loadLast() : undefined;
  const id = bookingId ?? last?.bookingId ?? fail('no booking id.');
  const token = last && last.bookingId === id ? last.cancellationToken : undefined;
  const query = token ? `?cancellationToken=${encodeURIComponent(token)}` : '';
  const response = await call<Record<string, unknown>>(
    'GET',
    `${root}/public/bookings/${id}${query}`,
    last?.session ?? randomUUID(),
  );
  console.log(JSON.stringify({ http: response.status, ...response.body }, null, 2));
  return response.body as { version?: number };
}

async function cancelCommand(bookingId?: string) {
  const { root } = target();
  const last = loadLast();
  const id = bookingId ?? last.bookingId;
  if (id !== last.bookingId || !last.cancellationToken)
    fail('can only cancel the remembered booking (it needs its cancellation token).');
  const current = await status(id);
  if (typeof current.version !== 'number') fail('could not read the booking version.');
  const response = await call<unknown>(
    'DELETE',
    `${root}/bookings/${id}?cancellationToken=${encodeURIComponent(last.cancellationToken)}`,
    last.session,
    { expectedVersion: current.version, reason: 'agent test booking' },
    true,
  );
  console.log(JSON.stringify({ cancelHttp: response.status, body: response.body }, null, 2));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'catalog':
      return catalogCommand(flags(rest));
    case 'book':
      return bookCommand(flags(rest));
    case 'status':
      await status(rest[0]);
      return;
    case 'cancel':
      return cancelCommand(rest[0]);
    default:
      fail('usage: catalog | book | status | cancel (see the header of this file).');
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
