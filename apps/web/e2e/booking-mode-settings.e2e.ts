import { expect, test } from '@playwright/test';

import {
  cleanupE2EData,
  closeE2EDatabase,
  credentials,
  currentTenant,
  resetSignupRateLimit,
  signup,
  verifyEmail,
} from './support';

test.beforeEach(async () => {
  await resetSignupRateLimit();
});

test.afterEach(async () => {
  await cleanupE2EData();
});

test.afterAll(async () => {
  await closeE2EDatabase();
});

test('changing booking mode in Settings changes real booking enforcement', async ({ browser }) => {
  const account = credentials('booking-mode-settings');
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await signup(page, account);
    await verifyEmail(page, account);
    const tenant = await currentTenant(page);
    const catalog = await createCatalog(page, tenant);

    const blockedInRoomTypeOnly = await createGuestBooking(page, tenant, catalog);
    expect(blockedInRoomTypeOnly).toMatchObject({
      ok: false,
      error: { code: 'ROOM_ID_NOT_ALLOWED' },
    });

    await page.goto(
      `/dashboard/${tenant.tenantId}?propertyId=${tenant.propertyId}&section=settings`,
    );
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Booking mode' }).selectOption('INDIVIDUAL_ROOM_ONLY');
    const saveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith(`/api/tenants/${tenant.tenantId}/properties/${tenant.propertyId}`),
    );
    await page.getByRole('button', { name: 'Save booking mode' }).click();
    expect((await saveResponse).status()).toBe(200);
    await expect(page.getByText('Settings saved.')).toBeVisible();

    const acceptedInIndividualRoomOnly = await createGuestBooking(page, tenant, catalog);
    expect(acceptedInIndividualRoomOnly).toMatchObject({
      ok: true,
      value: { roomId: catalog.roomId, status: 'CONFIRMED' },
    });
  } finally {
    await context.close();
  }
});

async function createCatalog(
  page: Parameters<typeof currentTenant>[0],
  tenant: Awaited<ReturnType<typeof currentTenant>>,
) {
  const base = `/api/tenants/${tenant.tenantId}/properties/${tenant.propertyId}`;
  return page.evaluate(async (propertyBase) => {
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

    await api('/payment-gateways', {
      method: 'PATCH',
      body: JSON.stringify({ stripe: false, pokpay: false, payAtHotel: true }),
    });
    const roomType = await api<{ id: string }>('/room-types', {
      method: 'POST',
      body: JSON.stringify({ name: 'Settings Test Room Type', maxOccupancy: 2 }),
    });
    const room = await api<{ id: string }>(`/room-types/${roomType.id}/rooms`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Settings Test Room' }),
    });
    const ratePlan = await api<{ id: string }>('/rate-plans', {
      method: 'POST',
      body: JSON.stringify({ name: 'Settings Test Flexible', currency: 'EUR' }),
    });
    await api(`/rate-plans/${ratePlan.id}/rules`, {
      method: 'POST',
      body: JSON.stringify({
        roomTypeId: roomType.id,
        startsOn: null,
        endsOn: null,
        amount: '100.00',
      }),
    });
    return { roomTypeId: roomType.id, roomId: room.id, ratePlanId: ratePlan.id };
  }, base);
}

async function createGuestBooking(
  page: Parameters<typeof currentTenant>[0],
  tenant: Awaited<ReturnType<typeof currentTenant>>,
  catalog: { roomTypeId: string; roomId: string; ratePlanId: string },
) {
  return page.evaluate(
    async ({ bookingBase, catalog: selectedCatalog }) => {
      const startsOn = '2037-06-10';
      const endsOn = '2037-06-12';
      const quoteResponse = await fetch(`${bookingBase}/quotes`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...selectedCatalog, startsOn, endsOn }),
      });
      if (!quoteResponse.ok) throw new Error(`Quote failed with ${quoteResponse.status}.`);
      const quote = (await quoteResponse.json()) as { total: unknown; quoteToken: string };
      const bookingResponse = await fetch(`${bookingBase}/bookings`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          ...selectedCatalog,
          startsOn,
          endsOn,
          guest: {
            email: `booking-mode-${crypto.randomUUID()}@example.test`,
            firstName: 'Settings',
            lastName: 'Guest',
            phone: null,
          },
          total: quote.total,
          quoteToken: quote.quoteToken,
          paymentMethod: 'pay_at_hotel',
        }),
      });
      return bookingResponse.json();
    },
    {
      bookingBase: `/api/tenants/${tenant.tenantId}/properties/${tenant.propertyId}`,
      catalog,
    },
  );
}
