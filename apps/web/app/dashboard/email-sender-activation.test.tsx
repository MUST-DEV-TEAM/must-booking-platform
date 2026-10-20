// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { EmailSenderActivation } from './email-sender-activation';
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
let root: Root | undefined;
const calls: { url: string; body: object; key: string | null }[] = [];
async function mount(value = profile(), disabled = false, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        body: JSON.parse(String(init.body)) as object,
        key: new Headers(init.headers).get('idempotency-key'),
      });
      return Response.json(status === 200 ? value : { message: 'Response unavailable' }, {
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
      createElement(EmailSenderActivation, {
        base: '/api/tenants/t/properties/p',
        profile: value,
        disabled,
        setBusy: vi.fn(),
        refresh: vi.fn(async () => {}),
      }),
    ),
  );
}
function button(label: string) {
  const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!node) throw Error('Missing button ' + label);
  return node;
}
async function click(node: HTMLElement) {
  await act(async () => node.click());
}
async function reason() {
  const input = document.getElementById('confirm-reason') as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      'Verified sender setup',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  calls.length = 0;
  vi.unstubAllGlobals();
});
it('keeps unverified setup inactive and explains the missing proof', async () => {
  await mount({ ...profile(), fromVerifiedAt: null });
  expect(button('Activate custom sender').disabled).toBe(true);
  expect(document.body.textContent).toContain('verify the From mailbox');
  expect(calls).toHaveLength(0);
});
it('confirms a reasoned, versioned and keyed activation of ready setup', async () => {
  await mount();
  await click(button('Activate custom sender'));
  expect(button('Activate sender').disabled).toBe(true);
  await reason();
  await click(button('Activate sender'));
  expect(calls[0]).toMatchObject({
    url: '/api/tenants/t/properties/p/email-configuration/sending/activate',
    body: { version: 4, reason: 'Verified sender setup' },
  });
  expect(calls[0]?.key).toBeTruthy();
});
it('pauses active custom delivery with a clear frozen-attempt explanation', async () => {
  await mount({ ...profile(), activeMode: 'SMTP' });
  await click(button('Pause custom sending'));
  expect(document.body.textContent).toContain('Already frozen attempts keep their original sender');
  await reason();
  await click(button('Pause sender'));
  expect(calls[0]?.url).toContain('/pause');
});
it('retains the original approval version and key after a lost response and metadata refresh', async () => {
  await mount(profile(), false, 503);
  await click(button('Activate custom sender'));
  await reason();
  await click(button('Activate sender'));
  await mount({ ...profile(), version: 5 });
  await click(button('Activate sender'));
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
});
it('keeps activation disabled for read-only users and hides it for default mode', async () => {
  await mount(profile(), true);
  expect(button('Activate custom sender').disabled).toBe(true);
  await mount({ ...profile(), mode: 'DEFAULT' });
  expect(document.querySelector('button')).toBeNull();
});
