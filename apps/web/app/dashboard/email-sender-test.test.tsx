// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { EmailSenderTest, type SenderTestResult } from './email-sender-test';
import type { EmailSendingProfile } from './email-sending-profile';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const profile = (): EmailSendingProfile => ({
  version: 4,
  mode: 'SMTP',
  activeMode: 'DEFAULT',
  fromName: 'Hotel',
  fromAddress: 'hotel@example.test',
  domain: null,
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpSecurity: 'STARTTLS',
  fallbackGuest: true,
  credentialsPresent: true,
  fromVerifiedAt: '2026-10-20T10:00:00Z',
  connectionCheckedAt: '2026-10-20T10:00:00Z',
  connectionStatus: 'verified',
  connectionOperationId: null,
  connectionExpiresAt: null,
  domainStatus: 'unknown',
});
const initial = (): SenderTestResult => ({
  id: 'aaa9d549-bfef-487b-a1b9-f4148eaf0b91',
  mode: 'SMTP',
  recipient: 'actor@example.test',
  senderVersion: 4,
  createdAt: '2026-10-20T10:00:00Z',
  status: 'QUEUED',
  messageId: 'ab9e6247-ff17-43d6-80b3-96c291801118',
  provider: null,
  activationChanged: false,
});
let root: Root | undefined,
  result = initial(),
  status = 200;
const calls: { url: string; method: string; body: object | null; key: string | null }[] = [];
async function mount(p = profile(), disabled = false) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? (JSON.parse(String(init.body)) as object) : null,
        key: new Headers(init?.headers).get('idempotency-key'),
      });
      return Response.json(status === 200 ? result : { message: 'Sender test limit reached.' }, {
        status,
      });
    }),
  );
  if (!root) {
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () =>
    root!.render(
      createElement(EmailSenderTest, {
        base: '/api/tenants/t/properties/p',
        profile: p,
        disabled,
        busy: false,
        setBusy: vi.fn(),
      }),
    ),
  );
}
function button(label: string) {
  const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (n) => n.textContent?.trim() === label,
  );
  if (!node) throw Error('Missing button ' + label);
  return node;
}
async function click(node: HTMLElement) {
  await act(async () => node.click());
}
async function approve() {
  await click(button('Send test to my verified address'));
  const input = document.getElementById('confirm-reason') as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      'Check saved sender',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(button('Send test'));
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  calls.length = 0;
  result = initial();
  status = 200;
  vi.unstubAllGlobals();
});
it('keeps the custom test disabled until saved proof is ready and omits it for MUST mode', async () => {
  await mount({ ...profile(), fromVerifiedAt: null });
  expect(button('Send test to my verified address').disabled).toBe(true);
  expect(document.body.textContent).toContain('Verify the saved custom sender');
  await mount({ ...profile(), mode: 'DEFAULT' });
  expect(document.querySelector('button')).toBeNull();
});
it('sends only version/reason with a stable key and shows the actual queue recipient', async () => {
  await mount();
  await approve();
  expect(calls[0]).toMatchObject({
    url: '/api/tenants/t/properties/p/email-configuration/sending/test',
    method: 'POST',
    body: { version: 4, reason: 'Check saved sender' },
  });
  expect(calls[0]?.key).toBeTruthy();
  expect(document.body.textContent).toContain('actor@example.test');
  expect(document.body.textContent).toContain('Queued');
  expect(document.querySelector('input[type="email"]')).toBeNull();
});
it('refreshes through a read-only request and never treats SMTP acceptance as inbox delivery', async () => {
  await mount();
  await approve();
  result = { ...result, status: 'SENT', provider: 'smtp' };
  await click(button('Refresh test result'));
  expect(calls.at(-1)).toMatchObject({ method: 'GET', body: null });
  expect(document.body.textContent).toContain('Inbox delivery is not confirmed');
  expect(document.body.textContent).toContain('Accepted by sending service');
});
it('shows actual uncertainty with a scoped Delivery link and no automatic repeat', async () => {
  result = { ...result, status: 'UNKNOWN' };
  await mount();
  await approve();
  expect(document.body.textContent).toContain('Automatic retry and fallback are stopped');
  const link = document.querySelector<HTMLAnchorElement>('a');
  expect(link?.search).toContain('emailMessageId=ab9e6247');
  expect(calls).toHaveLength(1);
});
it('replays the original approval after a lost response despite newer setup metadata', async () => {
  status = 503;
  await mount();
  await approve();
  status = 200;
  await mount({ ...profile(), version: 5 });
  await click(button('Send test'));
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
  expect(document.body.textContent).toContain('earlier saved setup');
});
it('keeps new writes disabled for a read-only viewer while allowing result refresh', async () => {
  await mount();
  await approve();
  await mount(profile(), true);
  expect(button('Send test to my verified address').disabled).toBe(true);
  expect(button('Refresh test result').disabled).toBe(false);
  await click(button('Refresh test result'));
  expect(calls.at(-1)?.method).toBe('GET');
});
