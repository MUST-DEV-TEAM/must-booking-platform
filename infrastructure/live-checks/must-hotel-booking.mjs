// Live booking check for the Must Hotel test property on booking.must.al.
//
// Books one real pay-at-hotel stay through the public API the website uses and
// waits until it has a real Clock reservation (Clock demo account 16307), then
// opens a PokPay staging checkout for a second stay. Test bookings are kept,
// by the owner's choice; the unpaid PokPay one expires on its own.
//
// It refuses to run against anything but Must Hotel: Empire Beach Resort is a
// real hotel and must never get test bookings.
//
// Usage: node infrastructure/live-checks/must-hotel-booking.mjs
// Env: LIVE_API_URL (default https://booking.must.al/api), MUST_HOTEL_TENANT_ID,
//      MUST_HOTEL_PROPERTY_ID. Writes a short Markdown summary to SUMMARY_FILE or, in GitHub Actions, GITHUB_STEP_SUMMARY.

import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

const MUST_HOTEL_TENANT_ID = 'fdb9f701-510e-4deb-857b-08a87fcdfbcc';
const MUST_HOTEL_PROPERTY_ID = '9231b946-f244-4a84-af54-0774710f3464';
const REFERENCE_PREFIX = 'MH-';
// Resend's test inbox: accepted and "delivered" without reaching anyone.
const GUEST_EMAIL = 'delivered@resend.dev';

const apiUrl = (process.env.LIVE_API_URL || 'https://booking.must.al/api').replace(/\/$/, '');
const tenantId = process.env.MUST_HOTEL_TENANT_ID || MUST_HOTEL_TENANT_ID;
const propertyId = process.env.MUST_HOTEL_PROPERTY_ID || MUST_HOTEL_PROPERTY_ID;
const base = `${apiUrl}/tenants/${tenantId}/properties/${propertyId}`;
const summary = [];

if (tenantId !== MUST_HOTEL_TENANT_ID || propertyId !== MUST_HOTEL_PROPERTY_ID) {
  fail('This check only runs against the Must Hotel test property.');
}

function note(line) {
  console.log(line);
  summary.push(line);
}

function fail(message) {
  note(`FAILED: ${message}`);
  writeSummary();
  process.exit(1);
}

function writeSummary() {
  const summaryFile = process.env.SUMMARY_FILE || process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) appendFileSync(summaryFile, `${summary.join('\n')}\n`);
}

function isoDay(offsetDays) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function call(session, method, path, body, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      cookie: `must_guest_session=${session}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Kept as text for the error message.
  }
  return { status: response.status, json, text: text.slice(0, 300) };
}

// The catalog needs the stay dates for properties that sell individual rooms, and
// then says which rooms are free for them.
async function catalogFor(stay) {
  const query = `?startsOn=${stay.startsOn}&endsOn=${stay.endsOn}`;
  const response = await call(randomUUID(), 'GET', `/public/catalog${query}`);
  if (response.status !== 200) fail(`catalog request returned HTTP ${response.status}.`);
  return response.json;
}

function pickRoom(catalog) {
  for (const roomType of catalog.roomTypes ?? []) {
    if (roomType.requiresRatePlanSelection && !roomType.ratePlans?.length) continue;
    const rooms = roomType.rooms ?? [];
    if (rooms.length === 0) return { roomType };
    const free = rooms.find((room) => room.isAvailable);
    if (free) return { roomType, room: free };
  }
  return null;
}

async function book(session, paymentMethod, firstName) {
  // Try a few stays 30-60 days out, so one sold-out night doesn't fail the check.
  for (const offset of [30, 37, 44, 51, 58]) {
    const stay = { startsOn: isoDay(offset), endsOn: isoDay(offset + 1) };
    const catalog = await catalogFor(stay);
    const choice = pickRoom(catalog);
    if (!choice) {
      note(`- ${stay.startsOn}: no free room in the catalog, trying another date.`);
      continue;
    }
    const { roomType, room } = choice;
    const selection = {
      roomTypeId: roomType.id,
      ...(room ? { roomId: room.id } : {}),
      ...(roomType.requiresRatePlanSelection ? { ratePlanId: roomType.ratePlans[0]?.id } : {}),
      ...stay,
      adults: 1,
    };
    const quote = await call(session, 'POST', '/quotes', selection);
    if (quote.status !== 201 || !quote.json?.quoteToken) {
      note(
        `- ${stay.startsOn}: no quote (HTTP ${quote.status} ${quote.text}), trying another date.`,
      );
      continue;
    }
    const created = await call(
      session,
      'POST',
      '/bookings',
      {
        ...selection,
        guest: { email: GUEST_EMAIL, firstName, lastName: 'Live Check', phone: null },
        total: quote.json.total,
        quoteToken: quote.json.quoteToken,
        paymentMethod,
      },
      { 'Idempotency-Key': randomUUID() },
    );
    if (created.json?.ok) return { booking: created.json.value, stay, roomType };
    const code = created.json?.error?.code ?? `HTTP ${created.status}`;
    if (code !== 'AVAILABILITY_FAILED')
      fail(`${paymentMethod} booking was refused: ${code} ${created.text}`);
    note(`- ${stay.startsOn}: sold out, trying another date.`);
  }
  fail(`no bookable night found for ${paymentMethod} in the next 60 days.`);
}

async function waitForClock(session, bookingId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const read = await call(session, 'GET', `/public/bookings/${bookingId}`);
    const booking = read.json;
    if (booking?.status === 'CONFIRMED' && /^\d+$/.test(String(booking.externalBookingId)))
      return booking;
    if (
      booking &&
      [
        'CANCELLED',
        'AVAILABILITY_FAILED',
        'PAYMENT_FAILED',
        'PMS_REJECTED',
        'MANUAL_REVIEW',
      ].includes(booking.status)
    )
      fail(`booking ${bookingId} ended as ${booking.status} instead of reaching Clock.`);
    await sleep(3_000);
  }
  fail(`booking ${bookingId} did not get a Clock reservation within a minute.`);
}

const catalog = await catalogFor({ startsOn: isoDay(30), endsOn: isoDay(31) });
note(`Must Hotel live check, ${new Date().toISOString()}`);
note(
  `Payment methods offered: ${catalog.paymentMethods.join(', ')}. Booking mode: ${catalog.bookingMode ?? 'unknown'}.`,
);

if (!catalog.paymentMethods.includes('pay_at_hotel'))
  fail('pay at hotel is not enabled for Must Hotel, so the Clock check cannot run.');
const payAtHotelSession = randomUUID();
const payAtHotel = await book(payAtHotelSession, 'pay_at_hotel', 'PayAtHotel');
if (!String(payAtHotel.booking.externalReference).startsWith(REFERENCE_PREFIX))
  fail(
    `booking reference ${payAtHotel.booking.externalReference} is not a Must Hotel (MH-) reference.`,
  );
const confirmed = await waitForClock(payAtHotelSession, payAtHotel.booking.id);
note(
  `OK pay at hotel (${payAtHotel.roomType.name}): ${confirmed.externalReference}, ${payAtHotel.stay.startsOn}, Clock reservation ${confirmed.externalBookingId}.`,
);

if (catalog.paymentMethods.includes('pokpay')) {
  const pokpay = await book(randomUUID(), 'pokpay', 'PokPay');
  const checkout = pokpay.booking.checkoutUrl ? new URL(pokpay.booking.checkoutUrl) : null;
  if (!checkout || !/pokpay/i.test(checkout.hostname))
    fail(
      `PokPay booking ${pokpay.booking.externalReference} came back without a PokPay checkout link.`,
    );
  note(
    `OK PokPay: ${pokpay.booking.externalReference}, ${pokpay.stay.startsOn}, checkout opened on ${checkout.hostname} (left unpaid; it expires on its own).`,
  );
} else {
  note('Skipped PokPay: it is not enabled for Must Hotel.');
}

writeSummary();
