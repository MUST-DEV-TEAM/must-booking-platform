// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailSettings, isEmailTab, type EmailTab } from './email-settings';
import { EmailsWorkspace } from './emails';
import { downloadCsv } from '../../lib/download-csv';
vi.mock('../../lib/download-csv', () => ({ downloadCsv: vi.fn() }));
import { focusManager } from '@tanstack/react-query';
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
function mockFetch(failure?: number, detail: object = message) {
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
      if (url.endsWith('/resend-copy')) return Response.json({ messageId: 'm2' });
      if (url.endsWith('/email-activity/export'))
        return Response.json({
          csv: '\uFEFFauthorized evidence',
          filename: 'deliveries.csv',
          count: 1,
          version: 1,
        });
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
          volume24h: 1,
          volume7d: 1,
          attempted7d: 1,
          bounceRate: 0,
          complaintRate: 0,
          queued: 0,
          oldestQueued: null,
          suppressedAddresses: 0,
          failingTopics: [],
          actionNeeded: [],
          counts: [{ status: 'FAILED', count: 1, today: 1 }],
          domainAuthentication: 'UNKNOWN',
          testTrafficExcluded: true,
        });
      if (url.includes('/email-activity?'))
        return Response.json({
          observedAt: '2026-10-19T10:00:00Z',
          exportVersion: 0,
          timezone: 'Europe/Tirane',
          items: [message],
          total: 1,
          page: 1,
          pageSize: 100,
        });
      if (url === base + '/email-activity/m1') return Response.json(detail);
      if (url === base + '/email-activity/m2')
        return Response.json({
          ...message,
          id: 'm2',
          version: 1,
          status: 'QUEUED',
          canResend: false,
          resendOfMessageId: 'm1',
          lastError: null,
        });
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
    expect(host.textContent).toContain('Volume - last 24 hours');
    expect(host.textContent).toContain('Controlled tests are excluded');
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
  it('sends global delivery filters and ordering to the server and can clear the complete scope', async () => {
    const calls = mockFetch();
    await mount('activity');
    expect(document.body.textContent).not.toContain('Export page CSV');
    await fill(
      document.querySelector<HTMLInputElement>('[aria-label="Search all records"]')!,
      'MH-999',
    );
    expect(
      calls.some(
        (c) =>
          c.url.includes('/email-activity?') &&
          new URL(c.url, 'http://localhost').searchParams.get('search') === 'MH-999',
      ),
    ).toBe(true);
    await fill(
      document.querySelector<HTMLInputElement>('[aria-label="Delivery recipient"]')!,
      'ana@example.test',
    );
    await click(button('Recipient', document.querySelector('thead')!));
    const latest = calls.filter((c) => c.url.includes('/email-activity?')).at(-1)!;
    expect(new URL(latest.url, 'http://localhost').searchParams.get('sort')).toBe('recipient');
    expect(new URL(latest.url, 'http://localhost').searchParams.get('recipient')).toBe(
      'ana@example.test',
    );
    await click(button('Clear delivery filters'));
    const clear = new URL(
      calls.filter((c) => c.url.includes('/email-activity?')).at(-1)!.url,
      'http://localhost',
    );
    for (const key of ['search', 'recipient', 'from', 'to', 'topic', 'status'])
      expect(clear.searchParams.get(key)).toBe('');
  });
  it('confirms a versioned bulk retry with a required reason and no local export', async () => {
    const calls = mockFetch();
    await mount('activity');
    await click(
      document.querySelector<HTMLButtonElement>('[aria-label="Select Booking confirmed (guest)"]')!,
    );
    await click(button('Retry selected failed'));
    expect(button('Retry selected').disabled).toBe(true);
    await fill(
      document.querySelector<HTMLTextAreaElement>('#confirm-reason')!,
      'Provider is working again',
    );
    await click(button('Retry selected'));
    const bulk = calls.find((call) => call.url.endsWith('/bulk-retry'));
    expect(bulk).toMatchObject({
      method: 'POST',
      body: { messages: [{ id: 'm1', version: 3 }], reason: 'Provider is working again' },
    });
    expect(bulk!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Copy selected');
  });
  it('audits the exact global filter and observation cutoff before downloading CSV', async () => {
    vi.mocked(downloadCsv).mockClear();
    const calls = mockFetch();
    await mount('activity');
    await click(button('Export filtered CSV'));
    expect(button('Export CSV').disabled).toBe(true);
    await fill(
      document.querySelector<HTMLTextAreaElement>('#confirm-reason')!,
      'Review hotel email evidence',
    );
    await click(button('Export CSV'));
    const request = calls.find((c) => c.url.endsWith('/email-activity/export'));
    expect(request).toMatchObject({
      method: 'POST',
      body: {
        version: 0,
        through: '2026-10-19T10:00:00Z',
        reason: 'Review hotel email evidence',
        filters: { filter: 'all', search: '', sort: 'created', direction: 'desc' },
      },
    });
    expect(request!.body).not.toHaveProperty('ids');
    expect(request!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(downloadCsv).toHaveBeenCalledWith({
      csv: '\uFEFFauthorized evidence',
      filename: 'deliveries.csv',
      count: 1,
      version: 1,
    });
  });
  it('shows observed event history and the provider receipt without inventing missing earlier steps', async () => {
    mockFetch();
    const original = fetch;
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) =>
      String(input).endsWith('/email-activity/m1')
        ? Response.json({
            ...message,
            provider: 'resend',
            providerMessageId: 'mock-receipt',
            timelineHasCreation: true,
            timeline: [
              {
                id: 'event-1',
                kind: 'SENT',
                status: 'SENT',
                attemptCount: 1,
                provider: 'resend',
                providerMessageId: 'mock-receipt',
                observedAt: '2026-10-19T10:00:00Z',
              },
            ],
          })
        : original(input, init),
    );
    await mount('activity');
    await click(button('Booking confirmed (guest)'));
    expect(document.body.textContent).toContain('Observed delivery timeline');
    expect(document.body.textContent).toContain('Attempt 1 / resend');
    expect(document.body.textContent).toContain('mock-receipt');
    expect(document.body.textContent).not.toContain('Earlier steps were not recorded');
  });
  it('opens a safe retained preview and confirms an explicit versioned copy with source navigation', async () => {
    const detail = {
      ...message,
      status: 'SENT',
      lastError: null,
      canResend: false,
      canSendCopy: true,
      renderedPreview: {
        subject: 'Prepared message',
        html: '<p>Sanitized recorded wording</p>',
        text: 'Sanitized recorded wording',
        capturedAt: '2026-10-19T10:00:00Z',
        expiresAt: '2026-10-26T10:00:00Z',
      },
    };
    const calls = mockFetch(undefined, detail);
    await mount('activity');
    await click(button('Booking confirmed (guest)'));
    expect(document.querySelector('iframe')).toBeNull();
    await click(button('View retained message'));
    expect(document.querySelector('iframe')?.getAttribute('sandbox')).toBe('');
    expect(document.querySelector('iframe')?.getAttribute('srcdoc')).toContain(
      'Sanitized recorded wording',
    );
    expect(document.body.textContent).toContain(
      'Links, remote images and active content are removed',
    );
    await click(button('Hide retained message'));
    expect(document.querySelector('iframe')).toBeNull();
    await click(button('Send another copy'));
    expect(button('Send copy').disabled).toBe(true);
    expect(document.body.textContent).toContain('duplicate an email they already received');
    await fill(
      document.querySelector<HTMLTextAreaElement>('#confirm-reason')!,
      'Guest requested another copy',
    );
    await click(button('Send copy'));
    const copy = calls.find((call) => call.url.endsWith('/resend-copy'));
    expect(copy).toMatchObject({
      method: 'POST',
      body: { version: 3, reason: 'Guest requested another copy' },
    });
    expect(copy!.headers.get('Idempotency-Key')).toBeTruthy();
    await click(button('View new delivery'));
    expect(button('View original delivery')).toBeDefined();
    await click(button('View original delivery'));
    expect(button('Send another copy')).toBeDefined();
  });
  it('keeps another-copy writes disabled for an unverified viewer', async () => {
    const calls = mockFetch(undefined, {
      ...message,
      status: 'SENT',
      canResend: false,
      canSendCopy: true,
    });
    await mount('activity', false);
    await click(button('Booking confirmed (guest)'));
    expect(button('Send another copy').disabled).toBe(true);
    expect(calls.some((call) => call.method !== 'GET')).toBe(false);
  });
  it('does not display a previous viewer cache while the new viewer authorization is pending or denied', async () => {
    mockFetch();
    await mount(undefined, true, true);
    expect(document.body.textContent).toContain('ana@example.test');
    const pending: ((response: Response) => void)[] = [];
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => pending.push(resolve)));
    await act(async () =>
      root!.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(EmailsWorkspace, {
            tenantId: 't',
            propertyId: 'p',
            viewerId: 'different-viewer',
            canWrite: false,
          }),
        ),
      ),
    );
    expect(document.body.textContent).not.toContain('ana@example.test');
    expect(document.querySelector('table')).toBeNull();
    await act(async () =>
      pending.forEach((resolve) =>
        resolve(Response.json({ message: 'Permission denied' }, { status: 403 })),
      ),
    );
    await settle();
    expect(document.body.textContent).toContain('Email access unavailable');
    expect(document.body.textContent).not.toContain('ana@example.test');
  });
  it('keeps unsaved template text on background focus and requires confirmation before reloading newer wording', async () => {
    const calls = mockFetch(),
      original = fetch;
    let changed = false;
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const response = await original(input, init);
      if (
        changed &&
        String(input).includes('/email-template-versions/') &&
        (!init?.method || init.method === 'GET')
      ) {
        const value = await response.json();
        return Response.json({
          ...value,
          version: 3,
          draft: { ...value.draft, body: 'Another staff member saved this wording' },
        });
      }
      return response;
    });
    try {
      await mount('templates');
      await click(button('Pre-arrival reminder'));
      await fill(
        document.querySelector<HTMLTextAreaElement>('#template-body')!,
        'My unsaved wording',
      );
      changed = true;
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await settle();
      expect(document.querySelector<HTMLTextAreaElement>('#template-body')!.value).toBe(
        'My unsaved wording',
      );
      expect(
        calls.filter(
          (call) => call.url.includes('/email-template-versions/') && call.method === 'GET',
        ),
      ).toHaveLength(1);
      await click(button('Reload wording'));
      expect(button('Keep editing')).toBeDefined();
      await click(button('Keep editing'));
      expect(document.querySelector<HTMLTextAreaElement>('#template-body')!.value).toBe(
        'My unsaved wording',
      );
      await click(button('Reload wording'));
      await click(button('Discard changes'));
      expect(document.querySelector<HTMLTextAreaElement>('#template-body')!.value).toBe(
        'Another staff member saved this wording',
      );
    } finally {
      focusManager.setFocused(undefined);
    }
  });
  it('retries the same copy approval after a lost response and a background source-version refresh', async () => {
    const detail = {
      ...message,
      status: 'SENT',
      lastError: null,
      canResend: false,
      canSendCopy: true,
    };
    const calls = mockFetch(undefined, detail),
      original = fetch;
    let attempts = 0;
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const response = await original(input, init);
      return String(input).endsWith('/resend-copy') && ++attempts === 1
        ? Response.json({ message: 'Copy recorded; retry the same request' }, { status: 503 })
        : response;
    });
    try {
      await mount('activity');
      await click(button('Booking confirmed (guest)'));
      await click(button('Send another copy'));
      await fill(
        document.querySelector<HTMLTextAreaElement>('#confirm-reason')!,
        'Guest requested another copy',
      );
      await click(button('Send copy'));
      expect(document.body.textContent).toContain('Copy recorded; retry the same request');
      detail.version = 4;
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await settle();
      expect(
        calls.filter((call) => call.url.endsWith('/email-activity/m1') && call.method === 'GET')
          .length,
      ).toBeGreaterThan(1);
      await click(button('Send copy'));
      const copies = calls.filter((call) => call.url.endsWith('/resend-copy'));
      expect(copies.map((call) => call.body?.version)).toEqual([3, 3]);
      expect(copies[0].headers.get('Idempotency-Key')).toBe(
        copies[1].headers.get('Idempotency-Key'),
      );
    } finally {
      focusManager.setFocused(undefined);
    }
  });
  it('prevents new edits while a draft save and its authoritative refresh are pending', async () => {
    mockFetch();
    const original = fetch;
    let released = false;
    let release: (() => void) | undefined;
    const savedBody = 'Saved edited wording for {guest_name} at {hotel_name}';
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const response = await original(input, init),
        url = String(input);
      if (url.endsWith('/draft') && init?.method === 'PUT')
        return new Promise<Response>((resolve) => {
          release = () => {
            released = true;
            resolve(response);
          };
        });
      if (
        released &&
        url.includes('/email-template-versions/') &&
        (!init?.method || init.method === 'GET')
      ) {
        const value = await response.json();
        return Response.json({ ...value, version: 3, draft: { ...value.draft, body: savedBody } });
      }
      return response;
    });
    await mount('templates');
    await click(button('Pre-arrival reminder'));
    await fill(document.querySelector<HTMLTextAreaElement>('#template-body')!, savedBody);
    await click(button('Save draft'));
    expect(document.querySelector<HTMLTextAreaElement>('#template-body')!.disabled).toBe(true);
    expect(button('Reload wording').disabled).toBe(true);
    expect(button('Back to templates').disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Language"]')!.disabled).toBe(
      true,
    );
    await act(async () => release!());
    await settle();
    expect(document.querySelector<HTMLTextAreaElement>('#template-body')!.disabled).toBe(false);
    expect(document.querySelector<HTMLTextAreaElement>('#template-body')!.value).toBe(savedBody);
    expect(document.body.textContent).toContain('version 3');
  });
});
