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

// The 10th and 11th of next month: always in the future, and one "Next month" click away.
const nextMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));
const isoDay = (day: number) =>
  new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), day))
    .toISOString()
    .slice(0, 10);
const firstNight = isoDay(10);
const secondNight = isoDay(11);
const firstNightLabel = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
}).format(new Date(`${firstNight}T00:00:00Z`));

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
    await page.getByRole('button', { name: 'Next month' }).click();

    const roomOnBlockedNight = page.getByRole('button', {
      name: new RegExp(`^Calendar Block Test Room, ${firstNightLabel}: `),
    });
    await expect(roomOnBlockedNight).toHaveAttribute(
      'title',
      'Calendar Block Test Room: 1 available',
    );

    await page.getByRole('button', { name: 'Block availability' }).click();
    await expect(page.getByRole('heading', { name: 'Block availability' })).toBeVisible();
    await page.getByLabel('Room types to block').selectOption([catalog.roomTypeId]);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByLabel('Specific rooms to block').selectOption([catalog.roomId]);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.locator(`[data-day="${firstNight}"] button`).click();
    await page.locator(`[data-day="${secondNight}"] button`).click();

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
      // Picking specific rooms blocks just those rooms, not the whole room type.
      roomTypeIds: [],
      roomIds: [catalog.roomId],
    });
    await expect(page.getByText('Availability block created.')).toBeVisible();
    await expect(roomOnBlockedNight).toHaveAttribute('title', 'Calendar Block Test Room: Sold out');
  } finally {
    await context.close();
  }
});

async function createCalendarCatalog(
  page: Parameters<typeof currentTenant>[0],
  tenant: Awaited<ReturnType<typeof currentTenant>>,
) {
  const base = `/api/tenants/${tenant.tenantId}/properties/${tenant.propertyId}`;
  return page.evaluate(
    async ({ propertyBase, firstNight, secondNight }) => {
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
          startsOn: firstNight,
          endsOn: secondNight,
          availableUnits: 2,
        }),
      });
      return { roomTypeId: roomType.id, roomId: room.id };
    },
    { propertyBase: base, firstNight, secondNight },
  );
}
