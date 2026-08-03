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

test('Calendar blocks selected room types and rooms, then refreshes their availability', async ({
  browser,
}) => {
  const account = credentials('calendar-availability-blocking');
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await signup(page, account);
    await verifyEmail(page, account);
    const tenant = await currentTenant(page);
    const catalog = await createCalendarCatalog(page, tenant);

    await page.goto(
      `/dashboard/${tenant.tenantId}?propertyId=${tenant.propertyId}&section=calendar`,
    );
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Block availability' })).toBeVisible();

    const availabilityOnBlockedNight = page
      .getByRole('button', { name: 'Open 2026-08-10' })
      .getByTitle('Calendar Block Test Room Type: 2 remaining');
    await expect(availabilityOnBlockedNight).toBeVisible();

    await page.getByLabel('Room types to block').selectOption([catalog.roomTypeId]);
    await page.getByLabel('Specific rooms to block').selectOption([catalog.roomId]);
    await page.locator('[data-day="2026-08-10"] button').click();
    await page.locator('[data-day="2026-08-11"] button').click();

    const saveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response
          .url()
          .endsWith(
            `/api/tenants/${tenant.tenantId}/properties/${tenant.propertyId}/availability-blocks`,
          ),
    );
    await page.getByRole('button', { name: 'Create availability block' }).click();
    const savedBlock = await saveResponse;
    expect(savedBlock.status()).toBe(201);
    await expect(savedBlock.json()).resolves.toMatchObject({
      roomTypeIds: [catalog.roomTypeId],
      roomIds: [catalog.roomId],
    });
    await expect(page.getByText('Availability block created.')).toBeVisible();
    await expect(
      page
        .getByRole('button', { name: 'Open 2026-08-10' })
        .getByTitle('Calendar Block Test Room Type: 0 remaining'),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

async function createCalendarCatalog(
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

    await api('', { method: 'PATCH', body: JSON.stringify({ bookingMode: 'MIXED' }) });
    const roomType = await api<{ id: string }>('/room-types', {
      method: 'POST',
      body: JSON.stringify({ name: 'Calendar Block Test Room Type', maxOccupancy: 2 }),
    });
    const room = await api<{ id: string }>(`/room-types/${roomType.id}/rooms`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Calendar Block Test Room' }),
    });
    await api('/inventory-units', {
      method: 'PUT',
      body: JSON.stringify({
        roomTypeId: roomType.id,
        startsOn: '2026-08-10',
        endsOn: '2026-08-11',
        availableUnits: 2,
      }),
    });
    return { roomTypeId: roomType.id, roomId: room.id };
  }, base);
}
