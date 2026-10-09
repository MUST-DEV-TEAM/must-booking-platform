import { randomUUID } from 'node:crypto';

import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  capturedEmail,
  cleanupE2EData,
  closeE2EDatabase,
  credentials,
  currentTenant,
  resetSignupRateLimit,
  signup,
  verifyEmail,
} from './support';

// The whole guest journey the WordPress booking page drives, end to end against the
// real API, database and email pipeline: quote, book, confirmation email, the property
// seeing the booking, cancellation (by staff and by the guest's emailed link), the
// cancellation emails, and the room becoming bookable again. Clock and payment
// providers are not involved; the property takes pay-at-hotel bookings.

const websiteOrigin = 'https://hotel.e2e.test';
const startsOn = '2037-07-14';
const endsOn = '2037-07-16';

type Tenant = Awaited<ReturnType<typeof currentTenant>>;
type Catalog = { roomTypeId: string; ratePlanId: string };
type Booking = { id: string; externalReference: string; status: string };
type BookingResult = { ok: true; value: Booking } | { ok: false; error: { code: string } };

test.beforeEach(async () => {
  await resetSignupRateLimit();
});

test.afterEach(async () => {
  await cleanupE2EData();
});

test.afterAll(async () => {
  await closeE2EDatabase();
});

test('a guest books, the property sees and cancels it, and the room is bookable again', async ({
  browser,
  baseURL,
}) => {
  const owner = credentials('guest-journey-owner');
  const context = await browser.newContext();
  const page = await context.newPage();
  const guest = await guestSession(baseURL);
  const nextGuest = await guestSession(baseURL);

  try {
    await signup(page, owner);
    await verifyEmail(page, owner);
    const tenant = await currentTenant(page);
    const catalog = await createSingleRoomCatalog(page, tenant);

    const guestEmail = `e2e-guest-${randomUUID()}@example.test`;
    const booked = await bookAsGuest(guest, tenant, catalog, guestEmail, 'Ada');
    expect(booked, JSON.stringify(booked)).toMatchObject({
      ok: true,
      value: { status: 'CONFIRMED' },
    });
    const booking = (booked as Extract<BookingResult, { ok: true }>).value;

    const confirmation = await capturedEmail(guestEmail, (subject) =>
      subject.endsWith(`booking confirmed — ${booking.externalReference}`),
    );
    expect(confirmation.text).toContain('Payment will be collected at the hotel on arrival.');
    expect(confirmation.text).toContain(`${startsOn} to ${endsOn}`);

    // The only room is taken, so a second guest cannot book the same nights.
    const secondGuestEmail = `e2e-guest-${randomUUID()}@example.test`;
    const overbooked = await bookAsGuest(nextGuest, tenant, catalog, secondGuestEmail, 'Grace');
    expect(overbooked).toMatchObject({ ok: false });

    await page.goto(
      `/dashboard/${tenant.tenantId}?propertyId=${tenant.propertyId}&section=reservations`,
    );
    await expect(page.getByRole('heading', { name: 'Reservations' })).toBeVisible();
    await page.getByLabel('Search guest').fill(guestEmail);
    await page.getByRole('button', { name: 'View details' }).first().click();
    const details = page.getByRole('region', { name: 'Reservation details' });
    await expect(details.getByRole('heading', { name: 'Ada Guest' })).toBeVisible();
    await expect(details.getByText(booking.externalReference)).toBeVisible();
    await expect(details.getByText(guestEmail)).toBeVisible();
    await expect(details.getByText('Confirmed', { exact: true })).toBeVisible();

    page.once('dialog', (dialog) => void dialog.accept());
    await details.getByRole('button', { name: 'Cancel reservation' }).click();
    // Cancelling closes the details panel; the list row shows the new status.
    await expect(details).toHaveCount(0);
    await expect(
      page.getByRole('row', { name: /Ada Guest/ }).getByText('Cancelled', { exact: true }),
    ).toBeVisible();

    await capturedEmail(
      guestEmail,
      (subject) => subject === `Booking ${booking.externalReference} cancelled`,
    );

    const rebooked = await bookAsGuest(nextGuest, tenant, catalog, secondGuestEmail, 'Grace');
    expect(rebooked, JSON.stringify(rebooked)).toMatchObject({
      ok: true,
      value: { status: 'CONFIRMED' },
    });
  } finally {
    await guest.dispose();
    await nextGuest.dispose();
    await context.close();
  }
});

test('a guest cancels from the link in their confirmation email on another device', async ({
  browser,
  baseURL,
}) => {
  const owner = credentials('guest-self-cancel-owner');
  const context = await browser.newContext();
  const page = await context.newPage();
  const guest = await guestSession(baseURL);
  const otherDevice = await guestSession(baseURL);

  try {
    await signup(page, owner);
    await verifyEmail(page, owner);
    const tenant = await currentTenant(page);
    const catalog = await createSingleRoomCatalog(page, tenant);

    const guestEmail = `e2e-guest-${randomUUID()}@example.test`;
    const booked = await bookAsGuest(guest, tenant, catalog, guestEmail, 'Alan');
    expect(booked, JSON.stringify(booked)).toMatchObject({
      ok: true,
      value: { status: 'CONFIRMED' },
    });
    const booking = (booked as Extract<BookingResult, { ok: true }>).value;

    const confirmation = await capturedEmail(guestEmail, (subject) =>
      subject.endsWith(`booking confirmed — ${booking.externalReference}`),
    );
    const link = emailLinks(confirmation).find((url) => url.origin === websiteOrigin);
    expect(link?.searchParams.get('must_action')).toBe('cancel');
    expect(link?.searchParams.get('booking_id')).toBe(booking.id);
    const cancellationToken = link?.searchParams.get('cancellationToken') ?? '';

    // Without the token, another browser cannot see or cancel the booking.
    const propertyBase = `/api/tenants/${tenant.tenantId}/properties/${tenant.propertyId}`;
    const unauthorized = await otherDevice.get(`${propertyBase}/public/bookings/${booking.id}`);
    expect(unauthorized.status()).toBe(404);

    const tokenQuery = `cancellationToken=${encodeURIComponent(cancellationToken)}`;
    const viewed = await otherDevice.get(
      `${propertyBase}/public/bookings/${booking.id}?${tokenQuery}`,
    );
    expect(viewed.status()).toBe(200);
    const current = (await viewed.json()) as { status: string; version: number };
    expect(current.status).toBe('CONFIRMED');

    const cancelled = await otherDevice.delete(
      `${propertyBase}/bookings/${booking.id}?${tokenQuery}`,
      {
        headers: { 'Idempotency-Key': randomUUID() },
        data: { expectedVersion: current.version, reason: 'Plans changed.' },
      },
    );
    expect(cancelled.status()).toBe(200);
    expect(await cancelled.json()).toMatchObject({ ok: true, value: { status: 'CANCELLED' } });

    await capturedEmail(
      guestEmail,
      (subject) => subject === `Booking ${booking.externalReference} cancelled`,
    );
  } finally {
    await guest.dispose();
    await otherDevice.dispose();
    await context.close();
  }
});

// The API issues guests a Secure session cookie, which a plain-http test client would
// drop, so each guest carries its own session explicitly, like a separate browser.
function guestSession(baseURL: string | undefined): Promise<APIRequestContext> {
  return request.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: `must_guest_session=${randomUUID()}` },
  });
}

async function createSingleRoomCatalog(page: Page, tenant: Tenant): Promise<Catalog> {
  const base = `/api/tenants/${tenant.tenantId}/properties/${tenant.propertyId}`;
  return page.evaluate(
    async ({ propertyBase, origin, startsOn, endsOn }) => {
      async function api<T>(path: string, init?: RequestInit): Promise<T> {
        const response = await fetch(`${propertyBase}${path}`, {
          ...init,
          credentials: 'include',
          headers: { 'content-type': 'application/json', ...init?.headers },
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(`Request to ${path} failed with ${response.status}.`);
        return body as T;
      }

      await api('/public-website-origin', {
        method: 'PATCH',
        body: JSON.stringify({ publicWebsiteOrigin: origin }),
      });
      await api('/payment-gateways', {
        method: 'PATCH',
        body: JSON.stringify({ stripe: false, pokpay: false, payAtHotel: true }),
      });
      const roomType = await api<{ id: string }>('/room-types', {
        method: 'POST',
        body: JSON.stringify({ name: 'Journey Sea View', maxOccupancy: 2 }),
      });
      await api(`/room-types/${roomType.id}/rooms`, {
        method: 'POST',
        body: JSON.stringify({ name: 'Journey Room 101' }),
      });
      await api('/inventory-units', {
        method: 'PUT',
        body: JSON.stringify({ roomTypeId: roomType.id, startsOn, endsOn, availableUnits: 1 }),
      });
      const ratePlan = await api<{ id: string }>('/rate-plans', {
        method: 'POST',
        body: JSON.stringify({ name: 'Journey Flexible', currency: 'EUR' }),
      });
      await api(`/rate-plans/${ratePlan.id}/rules`, {
        method: 'POST',
        body: JSON.stringify({
          roomTypeId: roomType.id,
          startsOn: null,
          endsOn: null,
          amount: '120.00',
        }),
      });
      return { roomTypeId: roomType.id, ratePlanId: ratePlan.id };
    },
    { propertyBase: base, origin: websiteOrigin, startsOn, endsOn },
  );
}

async function bookAsGuest(
  guest: APIRequestContext,
  tenant: Tenant,
  catalog: Catalog,
  email: string,
  firstName: string,
): Promise<BookingResult> {
  const base = `/api/tenants/${tenant.tenantId}/properties/${tenant.propertyId}`;
  const quoteResponse = await guest.post(`${base}/quotes`, {
    data: { ...catalog, startsOn, endsOn },
  });
  expect(quoteResponse.status()).toBe(201);
  const quote = (await quoteResponse.json()) as { total: unknown; quoteToken: string };
  const bookingResponse = await guest.post(`${base}/bookings`, {
    headers: { 'Idempotency-Key': randomUUID() },
    data: {
      ...catalog,
      startsOn,
      endsOn,
      guest: { email, firstName, lastName: 'Guest', phone: null },
      total: quote.total,
      quoteToken: quote.quoteToken,
      paymentMethod: 'pay_at_hotel',
      returnUrl: `${websiteOrigin}/book/`,
    },
  });
  return (await bookingResponse.json()) as BookingResult;
}

function emailLinks(message: { html: string; text: string }): URL[] {
  const urls = `${message.text}\n${message.html}`.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  return urls.flatMap((value) => {
    try {
      return [new URL(value.replace(/&amp;/g, '&'))];
    } catch {
      return [];
    }
  });
}
