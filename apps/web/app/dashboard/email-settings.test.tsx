// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailSettings, isEmailTab, type EmailTab } from './email-settings';
import { EmailsWorkspace } from './emails';
import { DashboardQueryProvider } from './query-provider';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const base = '/api/tenants/t/properties/p';
const template = {
  key: 'pre_arrival',
  label: 'Pre-arrival reminder',
  subject: 'Hello {guest_name}',
  body: 'Welcome to {hotel_name}',
  custom: false,
  placeholders: ['guest_name', 'hotel_name', 'booking_reference'],
};
const message = {
  id: 'm1',
  label: 'Booking confirmed (guest)',
  eventType: 'booking.confirmed',
  recipient: 'ana@example.test',
  subject: 'Booking MH-1',
  status: 'FAILED',
  attemptCount: 2,
  lastError: 'Provider rejected the address.',
  bookingReference: 'MH-1',
  createdAt: '2026-10-19T08:00:00Z',
  sentAt: null,
  deliveredAt: null,
  canResend: true,
  version: 3,
};
const versions = {
  key: 'pre_arrival',
  language: 'en',
  version: 2,
  live: { subject: template.subject, body: template.body },
  draft: {
    revision: 1,
    subject: 'Draft {guest_name}',
    body: '{hotel_name} {booking_reference}',
    createdAt: '2026-10-19',
    actorUserId: 'u',
  },
  history: [],
};
const settings = {
  topics: [
    {
      topic: 'pre_arrival',
      label: 'Pre-arrival reminder',
      hasGuestEmail: true,
      hasStaffEmail: false,
      guestEnabled: false,
      staffEnabled: false,
      customStaffRecipients: false,
      daysOffset: { value: 3, min: 1, max: 30, label: 'Days before check-in' },
      rules: [],
      staffRecipients: [],
    },
  ],
  options: { roleTemplates: [], staff: [] },
};
let root: Root | null = null;
function mockFetch(failure?: number) {
  const calls: {
    url: string;
    method: string;
    body: Record<string, unknown> | null;
    headers: Headers;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input),
        method = init?.method ?? 'GET',
        body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ url, method, body, headers: new Headers(init?.headers) });
      if (failure)
        return Response.json(
          { message: failure === 403 ? 'Permission denied' : 'Email service unavailable' },
          { status: failure, headers: { 'x-request-id': 'email-ref-17' } },
        );
      if (method !== 'GET') {
        if (url.endsWith('/preview'))
          return Response.json({
            subject: 'Preview',
            html: '<p>Example only</p>',
            text: 'Example only',
          });
        return Response.json(
          url.includes('email-configuration')
            ? { version: 2, senderName: null, replyTo: null, defaultLanguage: 'en' }
            : { status: 'QUEUED', ...versions },
        );
      }
      if (url === base + '/email-templates') return Response.json([template]);
      if (url.includes('/email-template-versions/')) return Response.json(versions);
      if (url === base + '/email-activity/overview')
        return Response.json({
          days: 7,
          counts: [{ status: 'FAILED', count: 1, today: 1 }],
          domainAuthentication: 'UNKNOWN',
          testTrafficExcluded: true,
        });
      if (url.includes('/email-activity?'))
        return Response.json({ items: [message], total: 1, page: 1, pageSize: 100 });
      if (url === base + '/email-activity/m1') return Response.json(message);
      if (url === base + '/email-configuration')
        return Response.json({
          version: 1,
          senderName: null,
          replyTo: null,
          defaultLanguage: 'en',
        });
      if (url === base + '/notification-settings') return Response.json(settings);
      if (url === base + '/email-sender')
        return Response.json({
          fromAddress: 'booking@mail.example.test',
          replyTo: null,
          hotelName: 'Villa',
        });
      if (url === base + '/review-links')
        return Response.json({
          links: { google: 'https://g.page/r/villa/review' },
          sites: [{ key: 'google', label: 'Google reviews' }],
        });
      if (url === base + '/email-suppressions') return Response.json([]);
      if (url.includes('my-email-preferences'))
        return Response.json({
          version: 1,
          muteOptionalEmails: false,
          optionalEmails: [{ topic: 'owner_daily_summary', label: 'Daily summary' }],
        });
      return Response.json({ message: 'Unexpected route' }, { status: 404 });
    }),
  );
  return calls;
}
async function settle() {
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
}
async function mount(tab?: EmailTab, canWrite = true, workspace = false) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        workspace
          ? createElement(EmailsWorkspace, { tenantId: 't', propertyId: 'p', canWrite })
          : createElement(EmailSettings, {
              tenantId: 't',
              propertyId: 'p',
              initialTab: tab,
              canWrite,
            }),
      ),
    ),
  );
  await settle();
  return host;
}
function button(label: string, scope: ParentNode = document) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!found) throw new Error('Missing button ' + label);
  return found;
}
async function click(node: HTMLElement) {
  await act(async () => node.click());
  await settle();
}
async function fill(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
describe('Emails workspace and legacy links', () => {
  it('recognizes saved tabs and shows actual delivery evidence in the new overview', async () => {
    expect(isEmailTab('activity')).toBe(true);
    expect(isEmailTab('bad')).toBe(false);
    mockFetch();
    const host = await mount(undefined, true, true);
    expect(host.textContent).toContain('Sent / delivered (7 days)');
    expect(host.textContent).toContain('controlled tests excluded');
    expect(host.textContent).toContain('Booking MH-1');
  });
  it('preserves recipient timing, sender, review links and personal mute configuration', async () => {
    const calls = mockFetch();
    const host = await mount('recipients');
    expect(host.textContent).toContain('Sender and language');
    expect(host.textContent).toContain('Daily summary');
    expect(host.textContent).toContain('Review links');
    expect(host.querySelector('input[value="https://g.page/r/villa/review"]')).not.toBeNull();
    await click(button('Save pre-arrival reminder'));
    const save = calls.find((row) => row.url.endsWith('/topics/pre_arrival'));
    expect(save).toMatchObject({
      method: 'PUT',
      body: {
        version: 1,
        guestEnabled: false,
        customStaffRecipients: false,
        rules: [],
        daysOffset: 3,
      },
    });
    expect(save!.body).not.toHaveProperty('staffEnabled');
    expect(save!.headers.get('Idempotency-Key')).toBeTruthy();
  });
  it('opens the template editor, saves only a draft and renders a sandboxed preview', async () => {
    const calls = mockFetch();
    await mount('templates');
    await click(button('Pre-arrival reminder'));
    await click(button('Save draft'));
    expect(calls.find((row) => row.url.endsWith('/draft'))).toMatchObject({
      method: 'PUT',
      body: { version: 2, language: 'en', subject: 'Draft {guest_name}' },
    });
    await click(button('Preview'));
    const frame = document.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe('<p>Example only</p>');
    expect(calls.some((row) => row.url.endsWith('/publish'))).toBe(false);
  });
  it('requires a reason for controlled tests and never offers guest recipient input', async () => {
    const calls = mockFetch();
    await mount('templates');
    await click(button('Pre-arrival reminder'));
    await click(button('Send controlled test'));
    expect(button('Send test to my address').disabled).toBe(true);
    expect(document.querySelector('input[type="email"]')).toBeNull();
    await fill(
      document.querySelector<HTMLTextAreaElement>('#confirm-reason')!,
      'Review revised wording',
    );
    await click(button('Send test to my address'));
    expect(calls.find((row) => row.url.endsWith('/test'))).toMatchObject({
      body: { version: 2, reason: 'Review revised wording' },
    });
    expect(calls.find((row) => row.url.endsWith('/test'))!.body).not.toHaveProperty('to');
  });
  it('shows failure detail and confirms a versioned retry of the approved message', async () => {
    const calls = mockFetch();
    await mount('activity');
    await click(button('Booking confirmed (guest)'));
    expect(document.body.textContent).toContain('Provider rejected the address.');
    await click(button('Retry approved message'));
    await fill(
      document.querySelector<HTMLTextAreaElement>('#confirm-reason')!,
      'Retry recovered delivery',
    );
    await click(button('Retry'));
    const retry = calls.find((row) => row.url.endsWith('/m1/retry'));
    expect(retry).toMatchObject({
      method: 'POST',
      body: { version: 3, reason: 'Retry recovered delivery' },
    });
    expect(retry!.headers.get('Idempotency-Key')).toBeTruthy();
  });
  it('disables configuration and template writes when email is not verified', async () => {
    mockFetch();
    const host = await mount('sender', false);
    expect(button('Save sender and language').disabled).toBe(true);
    expect(host.textContent).toContain('Read only. Verify your email');
  });
  it.each([403, 500])('shows a settled %s error with request reference', async (status) => {
    mockFetch(status);
    const host = await mount(undefined, true, true);
    expect(host.textContent).toContain(
      status === 403 ? 'Email access unavailable' : 'Emails unavailable',
    );
    expect(host.textContent).toContain('email-ref-17');
    expect(host.querySelector('table')).toBeNull();
  });
});
