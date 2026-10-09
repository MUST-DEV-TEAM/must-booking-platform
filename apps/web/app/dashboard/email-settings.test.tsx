// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmailSettings, isEmailTab, type EmailTab } from './email-settings';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const base = '/api/tenants/t/properties/p';

const settings = {
  topics: [
    {
      topic: 'new_booking',
      label: 'New booking',
      hasGuestEmail: true,
      hasStaffEmail: true,
      guestEnabled: true,
      staffEnabled: true,
      customStaffRecipients: true,
      daysOffset: null,
      rules: [{ target: 'EMAIL', email: 'reception@hotel.test' }],
      staffRecipients: [{ email: 'reception@hotel.test' }],
    },
    {
      topic: 'pre_arrival',
      label: 'Pre-arrival reminder',
      hasGuestEmail: true,
      hasStaffEmail: false,
      guestEnabled: false,
      staffEnabled: true,
      customStaffRecipients: false,
      daysOffset: { value: 3, min: 1, max: 30, label: 'Days before check-in' },
      rules: [],
      staffRecipients: [],
    },
  ],
  options: { roleTemplates: [], staff: [] },
};

const templates = [
  {
    key: 'pre_arrival',
    label: 'Pre-arrival reminder',
    language: 'en',
    subject: 'See you soon at {hotel_name}',
    body: 'Hello {guest_name}',
    custom: false,
    defaultSubject: 'See you soon at {hotel_name}',
    defaultBody: 'Hello {guest_name}',
    placeholders: ['guest_name', 'hotel_name'],
  },
];

const activity = {
  items: [
    {
      id: 'm1',
      label: 'Booking confirmed (guest)',
      recipient: 'ana@example.test',
      subject: 'Booking confirmed — MH-1',
      status: 'FAILED',
      lastError: 'Resend email delivery failed with status 422.',
      bookingReference: 'MH-1',
      createdAt: '2026-10-09T10:00:00Z',
      canResend: true,
    },
  ],
  page: 1,
  pageSize: 25,
  total: 1,
};

type Call = { url: string; method: string; body: unknown };

function stubFetch() {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url === `${base}/notification-settings`) return Response.json(settings);
      if (url.startsWith(`${base}/notification-settings/`))
        return Response.json({ ...settings.topics[1], guestEnabled: true });
      if (url === '/api/tenants/t/my-email-preferences')
        return Response.json({
          muteOptionalEmails: false,
          optionalEmails: [{ topic: 'owner_daily_summary', label: 'Daily summary' }],
        });
      if (url === `${base}/email-templates`) return Response.json(templates);
      if (url === `${base}/email-templates/pre_arrival/preview`)
        return Response.json({ subject: 'See you soon at Villa', html: '<p>Hi</p>', text: 'Hi' });
      if (url === `${base}/email-sender`)
        return Response.json({
          fromAddress: 'bookings@mail.must.test',
          replyTo: null,
          hotelName: 'Villa',
        });
      if (url.startsWith(`${base}/email-activity?`)) return Response.json(activity);
      if (url === `${base}/email-activity/m1/resend`) return Response.json({ status: 'QUEUED' });
      return new Response('{}', { status: 404 });
    }),
  );
  return calls;
}

async function settle() {
  for (let i = 0; i < 6; i += 1)
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
}

async function mount(initialTab?: EmailTab) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(EmailSettings, { tenantId: 't', propertyId: 'p', initialTab }),
      ),
    );
  });
  await settle();
  return { container, root };
}

function button(container: Element, text: string) {
  const found = Array.from(container.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === text,
  );
  if (!found) throw new Error(`No "${text}" button`);
  return found;
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await settle();
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('EmailSettings', () => {
  it('knows its tabs', () => {
    expect(isEmailTab('activity')).toBe(true);
    expect(isEmailTab('nope')).toBe(false);
  });

  it('shows who gets each email and saves a change', async () => {
    const calls = stubFetch();
    const { container, root } = await mount();
    expect(container.textContent).toContain('New booking');
    expect(container.textContent).toContain('reception@hotel.test');
    expect(container.textContent).toContain('Days before check-in');
    expect(container.textContent).toContain('Daily summary');

    const guestToggle = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[2]!;
    await click(guestToggle);
    await click(button(container, 'Save Pre-arrival reminder'));
    const put = calls.find((call) => call.method === 'PUT');
    expect(put).toMatchObject({
      url: `${base}/notification-settings/pre_arrival`,
      body: { guestEnabled: true, customStaffRecipients: false, rules: [], daysOffset: 3 },
    });
    await act(async () => root.unmount());
  });

  it('previews a template in a sandboxed frame', async () => {
    stubFetch();
    const { container, root } = await mount('templates');
    expect(container.textContent).toContain('{guest_name}');
    await click(button(container, 'Preview'));
    const frame = container.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe('<p>Hi</p>');
    await act(async () => root.unmount());
  });

  it('shows the sender and the reply address', async () => {
    stubFetch();
    const { container, root } = await mount('sender');
    expect(container.textContent).toContain('bookings@mail.must.test');
    expect(container.textContent).toContain('add a support email');
    await act(async () => root.unmount());
  });

  it('lists sent emails and sends a failed one again', async () => {
    const calls = stubFetch();
    const { container, root } = await mount('activity');
    expect(container.textContent).toContain('Booking confirmed — MH-1');
    expect(container.textContent).toContain('Failed');
    expect(container.textContent).toContain('status 422');
    await click(button(container, 'Send again'));
    expect(calls.some((call) => call.url === `${base}/email-activity/m1/resend`)).toBe(true);
    await act(async () => root.unmount());
  });
});
