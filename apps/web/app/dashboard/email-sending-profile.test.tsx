// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { EmailSendingSetup, type EmailSendingProfile } from './email-sending-profile';
import { validEmailDmarc, validEmailDnsRecords } from './email-domain-setup';
import { UnsavedChangesBoundary } from '../../components/ui/unsaved-changes';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const base = '/api/tenants/tenant/properties/property',
  url = base + '/email-configuration/sending';
const defaults = (): EmailSendingProfile => ({
  version: 1,
  mode: 'DEFAULT',
  activeMode: 'DEFAULT',
  fromName: null,
  fromAddress: null,
  domain: null,
  smtpHost: null,
  smtpPort: null,
  smtpSecurity: null,
  fallbackGuest: true,
  credentialsPresent: false,
  fromVerifiedAt: null,
  connectionStatus: 'unknown',
  connectionCheckedAt: null,
  connectionOperationId: null,
  connectionExpiresAt: null,
  domainStatus: 'unknown',
});
const smtp = (): EmailSendingProfile => ({
  ...defaults(),
  version: 2,
  mode: 'SMTP',
  fromName: 'Hotel',
  fromAddress: 'hotel@example.test',
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpSecurity: 'STARTTLS',
  credentialsPresent: true,
});
type Call = {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
  headers: Headers;
  wire: string;
};
function server(profile = defaults()) {
  const defaultWrite: (call: Call) => Response = () => Response.json(profile);
  const state = {
    profile,
    calls: [] as Call[],
    status: 200,
    onWrite: defaultWrite,
    operation: {
      id: 'operation',
      state: 'unknown',
      version: 3,
      message: 'No final result was recorded. Run a new connection check.',
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const call: Call = {
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
        headers: new Headers(init?.headers),
        wire: String(init?.body ?? ''),
      };
      state.calls.push(call);
      if (state.status !== 200)
        return Response.json(
          { message: state.status === 403 ? 'Permission denied' : 'Setup unavailable' },
          { status: state.status, headers: { 'x-request-id': 'setup-ref-1' } },
        );
      if (call.method !== 'GET') return state.onWrite(call);
      return Response.json(call.url.includes('/operations/') ? state.operation : state.profile);
    }),
  );
  return state;
}
let root: Root | null = null,
  client: QueryClient | null = null;
async function settle() {
  for (let n = 0; n < 3; n++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
}
async function render(canWrite = true) {
  client ??= new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  if (!root) {
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () =>
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          UnsavedChangesBoundary,
          null,
          createElement(EmailSendingSetup, { base, canWrite }),
        ),
      ),
    ),
  );
  await settle();
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
  await settle();
}
async function fill(id: string, value: string) {
  const node = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
  expect(node).toBeTruthy();
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
async function choose(label: string) {
  await click(
    document.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Sending option"]')!,
  );
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (n) => n.textContent?.trim() === label,
  );
  expect(option).toBeTruthy();
  await click(option!.querySelector('button') ?? option!);
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  client?.clear();
  client = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', window.location.pathname);
});

it('requests a From proof only for checked, saved setup and preserves its approved key after a lost response', async () => {
  const state = server({ ...smtp(), connectionStatus: 'verified' });
  let attempts = 0;
  state.onWrite = (call) => {
    expect(call.url).toBe(url + '/verify-from');
    if (++attempts === 1)
      return Response.json({ message: 'Response unavailable' }, { status: 500 });
    state.profile = { ...state.profile, version: 3 };
    return Response.json({
      id: 'proof',
      state: 'pending',
      version: 3,
      message: 'Enter the emailed code within 30 minutes.',
    });
  };
  await render();
  await click(button('Email a verification code'));
  await fill('confirm-reason', 'Confirm hotel sender ownership');
  await click(button('Send verification code'));
  expect(document.body.textContent).toContain('Response unavailable');
  await click(button('Send verification code'));
  const writes = state.calls.filter((c) => c.method === 'POST');
  expect(writes).toHaveLength(2);
  expect(writes[0].wire).toBe(writes[1].wire);
  expect(writes[0].headers.get('idempotency-key')).toBe(writes[1].headers.get('idempotency-key'));
  expect(document.body.textContent).toContain('Enter the emailed code within 30 minutes.');
  expect(document.body.textContent).toContain('Default MUST sender');
  await fill('sending-from-name', 'Unsaved setup');
  expect(button('Email a verification code').disabled).toBe(true);
  expect(button('Verify From address').disabled).toBe(true);
});

it('consumes a fragment code into component memory, clears browser history and clears it after confirmation', async () => {
  const code = 'test-only-mailbox-proof';
  window.history.replaceState(null, '', '#sender-proof=' + code);
  const state = server({ ...smtp(), connectionStatus: 'verified' });
  state.onWrite = (call) => {
    expect(call.url).toBe(url + '/verify-from/confirm');
    expect(call.body).toMatchObject({ version: 2, code });
    state.profile = { ...state.profile, version: 3, fromVerifiedAt: '2026-10-20T12:00:00Z' };
    return Response.json({
      id: 'proof',
      state: 'verified',
      version: 3,
      message: 'From address verified. Custom sending is not yet activated.',
    });
  };
  await render();
  expect(window.location.hash).toBe('');
  expect(
    (document.getElementById('sender-verification-code') as HTMLInputElement).value === code,
  ).toBe(true);
  expect(
    JSON.stringify(
      client!
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
    ).includes(code),
  ).toBe(false);
  await click(button('Verify From address'));
  expect((document.getElementById('sender-verification-code') as HTMLInputElement).value).toBe('');
  expect(document.body.textContent).toContain(
    'From address verified. Custom sending is not yet activated.',
  );
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

it('shows invalid/locked proof results and disables verification when current write access is revoked', async () => {
  const state = server({ ...smtp(), connectionStatus: 'verified' });
  state.onWrite = () =>
    Response.json({
      id: 'proof',
      state: 'invalid',
      version: 2,
      message: 'That code is not correct.',
    });
  await render();
  await fill('sender-verification-code', 'test-only-wrong-code');
  await click(button('Verify From address'));
  expect(document.body.textContent).toContain('That code is not correct.');
  state.onWrite = () =>
    Response.json({ id: 'proof', state: 'locked', version: 2, message: 'Request a new email.' });
  await fill('sender-verification-code', 'another-test-only-wrong-code');
  await click(button('Verify From address'));
  expect(document.body.textContent).toContain('Request a new email.');
  await click(button('Email a verification code'));
  await render(false);
  expect(button('Send verification code').disabled).toBe(true);
  await click(button('Cancel'));
  expect(button('Email a verification code').disabled).toBe(true);
  expect(button('Verify From address').disabled).toBe(true);
});

it('shows current sender separately from saved setup and omits unsupported activation and send controls', async () => {
  server();
  await render();
  expect(document.body.textContent).toContain('Currently sending with');
  expect(document.body.textContent).toContain(
    'Saving prepares your setup; it does not activate custom sending.',
  );
  expect(button('Save sending setup').disabled).toBe(true);
  expect(
    [...document.querySelectorAll('button')].some((n) =>
      /send test|activate|re.check domain/i.test(n.textContent ?? ''),
    ),
  ).toBe(false);
  await choose('Custom SMTP');
  await click(button('Save sending setup'));
  expect(document.body.textContent).toContain('Enter a valid From email address.');
});

it('separates checking from explicit registration and displays exact provider DNS with independent DMARC evidence', async () => {
  const state = server({
    ...defaults(),
    version: 2,
    mode: 'RESEND',
    domain: 'hotel.example.com',
    fromAddress: 'booking@hotel.example.com',
    credentialsPresent: true,
  });
  const records = [
    {
      record: 'DKIM',
      name: 'resend._domainkey',
      type: 'TXT',
      value: 'p=exact-provider-value',
      status: 'pending',
      ttl: 'Auto',
    },
  ];
  state.onWrite = (call) => {
    expect(call.url).toBe(url + '/domain/check');
    expect(call.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    const creating = call.body?.allowCreate === true;
    state.profile = {
      ...state.profile,
      version: state.profile.version + 2,
      domainStatus: creating ? 'pending' : 'not_found',
      dnsRecords: creating ? records : [],
    };
    return Response.json({
      kind: 'DOMAIN_CHECK',
      id: 'domain-op',
      state: creating ? 'pending' : 'not_found',
      version: state.profile.version,
      domain: 'hotel.example.com',
      records: creating ? records : [],
      message: creating ? 'Publish these exact DNS records.' : 'Domain is not in this account.',
      dmarc: creating
        ? {
            name: '_dmarc.hotel.example.com',
            type: 'TXT',
            state: 'absent',
            values: [],
            observedAt: '2026-10-20T12:00:00Z',
            message: 'A parent-domain policy may apply.',
          }
        : null,
    });
  };
  await render();
  expect(document.body.textContent).not.toContain('Register domain in Resend');
  await click(button('Check saved domain'));
  await fill('confirm-reason', 'Inspect domain first');
  await click(button('Check domain'));
  expect(document.body.textContent).toContain('Domain is not in this account.');
  await click(button('Register domain in Resend'));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'receiving and tracking disabled',
  );
  await fill('confirm-reason', 'Register this hotel domain');
  await click(button('Register domain'));
  expect(document.body.textContent).toContain('p=exact-provider-value');
  expect(document.body.textContent).toContain('resend._domainkey');
  expect(document.body.textContent).toContain('A parent-domain policy may apply.');
  expect(document.body.textContent).toContain('do not replace an existing policy');
  expect(document.querySelector('button[aria-label="Copy DNS value 1"]')).toBeTruthy();
  const writes = state.calls.filter((c) => c.method === 'POST');
  expect(writes.map((c) => c.body?.allowCreate)).toEqual([false, true]);
  expect(
    writes[0].headers.get('idempotency-key') === writes[1].headers.get('idempotency-key'),
  ).toBe(false);
});

it('keeps default-domain diagnostics read-only at the provider and disables unverified/dirty setup operations', async () => {
  const state = server();
  state.onWrite = (call) => {
    expect(call.body?.allowCreate).toBe(false);
    state.profile = { ...state.profile, version: 3, domainStatus: 'verified' };
    return Response.json({
      kind: 'DOMAIN_CHECK',
      id: 'default-domain',
      state: 'verified',
      version: 3,
      domain: 'must.example.com',
      records: [],
      dmarc: null,
      message: 'Provider verified the shared sender.',
    });
  };
  await render();
  expect(document.body.textContent).toContain('Hotel staff cannot register it');
  await click(button('Check MUST sender domain'));
  await fill('confirm-reason', 'Review shared DNS');
  await click(button('Check domain'));
  expect(document.body.textContent).not.toContain('Register domain in Resend');
  await render(false);
  expect(button('Check MUST sender domain').disabled).toBe(true);
  await render(true);
  await choose('Custom SMTP');
  expect(button('Check MUST sender domain').disabled).toBe(true);
});

it('rejects malformed DNS/DMARC evidence and keeps publication separate from alignment', () => {
  expect(validEmailDnsRecords({ value: 'not-an-array' })).toBe(false);
  expect(
    validEmailDnsRecords([
      { record: 'SPF', name: 'send', type: 'TXT', value: 42, status: 'verified', ttl: 300 },
    ]),
  ).toBe(false);
  expect(
    validEmailDmarc({
      name: '_dmarc.example.com',
      type: 'TXT',
      state: 'verified',
      values: [],
      observedAt: '2026-10-20T12:00:00Z',
      message: 'bad state',
    }),
  ).toBe(false);
  expect(validEmailDmarc(null)).toBe(true);
});
it('uses blank replacement credentials, confirms a versioned setup without exposing its secret, and clears it after save', async () => {
  const state = server();
  state.onWrite = (call) => {
    expect(call.method).toBe('PUT');
    state.profile = smtp();
    return Response.json(state.profile);
  };
  await render();
  await choose('Custom SMTP');
  await fill('sending-from-address', 'hotel@example.test');
  await fill('sending-smtp-host', 'smtp.example.com');
  await fill('sending-smtp-username', 'test-user');
  await fill('sending-secret', 'test-only-replacement');
  await click(button('Save sending setup'));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).not.toContain('test-only-replacement');
  expect(button('Save setup').disabled).toBe(true);
  await fill('confirm-reason', 'Prepare hotel sender');
  await click(button('Save setup'));
  const call = state.calls.find((c) => c.method === 'PUT')!;
  expect(call.body).toMatchObject({
    version: 1,
    mode: 'SMTP',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    reason: 'Prepare hotel sender',
  });
  expect(call.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
  expect(document.getElementById('sending-secret')).toBeNull();
  expect(JSON.stringify(client!.getQueryData(['emails', base, 'sending-profile']))).not.toContain(
    'test-only-replacement',
  );
  expect(document.body.textContent).toContain('Saved — replace to rotate');
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});
it('preserves the exact approval and key after a lost save response', async () => {
  const state = server(smtp());
  let attempts = 0;
  state.onWrite = () =>
    ++attempts === 1
      ? Response.json({ message: 'Response unavailable' }, { status: 500 })
      : Response.json({ ...smtp(), version: 3, fromName: 'New hotel' });
  await render();
  await fill('sending-from-name', 'New hotel');
  await click(button('Save sending setup'));
  await fill('confirm-reason', 'Update sender name');
  await click(button('Save setup'));
  expect(document.body.textContent).toContain('Response unavailable');
  await click(button('Save setup'));
  const writes = state.calls.filter((c) => c.method === 'PUT');
  expect(writes).toHaveLength(2);
  expect(writes[0].wire).toBe(writes[1].wire);
  expect(writes[0].headers.get('idempotency-key')).toBe(writes[1].headers.get('idempotency-key'));
});
it('checks only saved setup with a reason and retains actual result after the new profile version loads', async () => {
  const state = server(smtp());
  state.onWrite = (call) => {
    expect(call.url).toBe(url + '/check');
    state.profile = {
      ...smtp(),
      version: 4,
      connectionStatus: 'verified',
      connectionOperationId: 'operation',
    };
    return Response.json({
      id: 'operation',
      version: 4,
      state: 'verified',
      message: 'SMTP connection verified. The From address still needs mailbox verification.',
    });
  };
  await render();
  await fill('sending-from-name', 'Unsaved name');
  expect(button('Check saved SMTP connection').disabled).toBe(true);
  await click(button('Reload sending setup'));
  await click(button('Discard changes'));
  expect((document.getElementById('sending-from-name') as HTMLInputElement).value).toBe('Hotel');
  await click(button('Check saved SMTP connection'));
  expect(button('Check connection').disabled).toBe(true);
  await fill('confirm-reason', 'Check encrypted connection');
  await click(button('Check connection'));
  expect(state.calls.filter((c) => c.method === 'POST')[0].body).toEqual({
    version: 2,
    reason: 'Check encrypted connection',
  });
  expect(document.body.textContent).toContain(
    'SMTP connection verified. The From address still needs mailbox verification.',
  );
  expect(document.body.textContent).toContain('Connected');
});
it('keeps reads available while all write controls and an already-open confirmation fail closed', async () => {
  const state = server({ ...smtp(), connectionOperationId: 'operation' });
  await render();
  await click(button('Check saved SMTP connection'));
  await fill('confirm-reason', 'Check connection');
  await render(false);
  expect(button('Check connection').disabled).toBe(true);
  await click(button('Keep it'));
  expect(button('Check saved SMTP connection').disabled).toBe(true);
  expect(button('Reload sending setup').disabled).toBe(false);
  expect(button('Refresh connection result').disabled).toBe(false);
  await click(button('Refresh connection result'));
  expect(document.body.textContent).toContain(
    'No final result was recorded. Run a new connection check.',
  );
  expect(state.calls.every((c) => c.method === 'GET')).toBe(true);
});
it('discards a local draft on explicit reload even when the server version has not changed', async () => {
  server(smtp());
  await render();
  await fill('sending-from-name', 'Unsaved replacement');
  await click(button('Reload sending setup'));
  await click(button('Keep editing'));
  expect((document.getElementById('sending-from-name') as HTMLInputElement).value).toBe(
    'Unsaved replacement',
  );
  await click(button('Reload sending setup'));
  await click(button('Discard changes'));
  expect((document.getElementById('sending-from-name') as HTMLInputElement).value).toBe('Hotel');
  expect(button('Save sending setup').disabled).toBe(true);
});
it('hides stale configuration on denial and retries a referenced load failure', async () => {
  const state = server();
  state.status = 500;
  await render();
  expect(document.body.textContent).toContain('setup-ref-1');
  expect(document.body.textContent).toContain('Sending setup unavailable');
  state.status = 200;
  await click(button('Try again'));
  expect(document.body.textContent).toContain('Sending options');
  state.status = 403;
  await click(button('Reload sending setup'));
  expect(document.body.textContent).toContain('Permission denied');
  expect(document.querySelector('[role="combobox"]')).toBeNull();
});
it('explains a check invalidated by credential rotation instead of showing the old connection as verified', async () => {
  const state = server(smtp());
  state.onWrite = () => {
    state.profile = {
      ...smtp(),
      version: 4,
      connectionStatus: 'unknown',
      connectionOperationId: null,
    };
    return Response.json({
      id: 'old-operation',
      version: 4,
      state: 'stale',
      message: 'Configuration changed or the check expired. Run a new connection check.',
    });
  };
  await render();
  await click(button('Check saved SMTP connection'));
  await fill('confirm-reason', 'Check before another owner rotates credentials');
  await click(button('Check connection'));
  expect(document.body.textContent).toContain(
    'Configuration changed or the check expired. Run a new connection check.',
  );
  expect(document.body.textContent).toContain('No current result');
});

it('shows official Gmail app-password guidance and account-wide sending limits for SMTP', async () => {
  server(smtp());
  await render();
  expect(document.body.textContent).toContain('2-Step Verification');
  expect(document.body.textContent).toContain('500-message daily limit');
  expect(document.body.textContent).toContain('up to 2,000 messages');
  expect(
    document.querySelector('a[href="https://support.google.com/accounts/answer/185833"]'),
  ).toBeTruthy();
  expect(
    document.querySelector(
      'a[href="https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace"]',
    ),
  ).toBeTruthy();
});
